import type { Page } from "playwright";
import { parseBRL } from "../text.js";

export type RawOffer = {
  source: string;
  store: string;
  title: string;
  url: string;
  price: number;
  /** Preço que você paga de fato (à vista/Pix com desconto, cupom já aplicado quando informado). */
  finalPrice: number;
  coupon?: string | null;
  note?: string | null;
  image?: string | null;
};

export type FoundCoupon = { store: string; code: string; title: string; url: string; source: string; minOrder?: number | null; discount?: number | null };

/** "R$ 50 de desconto em compras a partir de R$ 290" / "R$550 OFF ... acima de R$3.400" -> { discount: 50, minOrder: 290 } */
export function couponTier(text: string): { discount: number | null; minOrder: number | null } {
  const t = text.replace(/\u00a0/g, " ");
  const d = t.match(/R\$\s*([\d.]+(?:,\d{1,2})?)\s*(?:de desconto|off|de economia|de abatimento)/i) ?? t.match(/(?:economize|desconto de)\s*R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  const m = t.match(/(?:a partir de|acima de|compras? (?:de|acima de)|m[ií]nim[oa] de)\s*R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  const num = (x?: string) => (x ? parseBRL(x) : null);
  return { discount: num(d?.[1]), minOrder: num(m?.[1]) };
}

export type Source = {
  id: string;
  label: string;
  kind: "loja" | "comunidade";
  searchUrl: (q: string) => string;
  /** Espera algo aparecer antes de extrair (seletor CSS). */
  waitFor?: string;
  /** Fonte via navegador (Playwright). */
  extract?: (page: Page) => Promise<SourceResult>;
  /** Fonte via HTTP/JSON, sem navegador. */
  fetchOffers?: (q: string) => Promise<SourceResult>;
  /** Intervalo mínimo entre buscas desta fonte para o mesmo produto (min). Padrão: todo ciclo. */
  minIntervalMin?: number;
  /** Desligada por padrão (ex.: loja bloqueia navegador automatizado). Ligue com SOURCES=... */
  disabledReason?: string;
};

export type SourceResult = { offers: RawOffer[]; coupons?: FoundCoupon[] };

const slug = (q: string) => q.trim().toLowerCase().replace(/\s+/g, "-");
const enc = encodeURIComponent;

// Os extratores rodam dentro da página. São strings para não passar pelo transpiler
// (o tsx injeta helpers como __name que não existem no navegador).
const PRICE_FN = `
  const P = (s) => {
    if (!s) return null;
    const m = String(s).replace(/\\u00a0/g, ' ').match(/(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,2}))?/);
    return m ? parseFloat(m[1].replace(/\\./g, '') + '.' + (m[2] || '0')) : null;
  };
  const T = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : '');
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return h; } };
`;

async function run<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(`(() => { ${PRICE_FN} ${body} })()`) as Promise<T>;
}

type Item = { title: string; url: string; price: number | null; final: number | null; store?: string; coupon?: string | null; note?: string | null; image?: string | null };

function toOffers(source: { id: string }, items: Item[], defaultStore: string): RawOffer[] {
  return items
    .filter((i) => i.title && i.url && (i.final ?? i.price))
    .map((i) => {
      const price = (i.price ?? i.final)!;
      const finalPrice = Math.min(price, i.final ?? price);
      return {
        source: source.id,
        store: i.store || defaultStore,
        title: i.title,
        url: i.url.split("#")[0],
        price,
        finalPrice,
        coupon: i.coupon ?? null,
        note: i.note ?? null,
        image: i.image ?? null,
      };
    });
}

const amazon: Source = {
  id: "amazon",
  label: "Amazon",
  kind: "loja",
  searchUrl: (q) => `https://www.amazon.com.br/s?k=${enc(q)}`,
  waitFor: '[data-component-type="s-search-result"]',
  async extract(page) {
    const items = await run<Item[]>(page, `
      return [...document.querySelectorAll('[data-component-type="s-search-result"]')].map((el) => {
        const a = el.querySelector('a[href*="/dp/"]');
        const h2 = el.querySelector('h2');
        const title = (h2 && (h2.getAttribute('aria-label') || T(h2))) || '';
        const priceEl = el.querySelector('.a-price:not([data-a-strike]) .a-offscreen');
        const price = P(T(priceEl));
        const coupon = T(el.querySelector('.s-coupon-unclipped, [data-component-type="s-coupon-component"]')) || null;
        const asin = el.getAttribute('data-asin');
        return { title, url: asin ? 'https://www.amazon.com.br/dp/' + asin : (a ? abs(a.getAttribute('href')) : ''), price, final: price, note: coupon };
      });
    `);
    return { offers: toOffers(this, items, "Amazon") };
  },
};

const kabum: Source = {
  id: "kabum",
  label: "KaBuM!",
  kind: "loja",
  searchUrl: (q) => `https://www.kabum.com.br/busca/${slug(q)}`,
  async extract(page) {
    const items = await run<Item[]>(page, `
      const nd = document.getElementById('__NEXT_DATA__');
      if (!nd) return [];
      let data = JSON.parse(nd.textContent).props?.pageProps?.data;
      if (typeof data === 'string') data = JSON.parse(data);
      const list = data?.catalogServer?.data || [];
      return list.filter((p) => p.available).map((p) => ({
        title: p.name,
        url: 'https://www.kabum.com.br/produto/' + p.code + '/' + p.friendlyName,
        price: p.price || null,
        final: p.priceWithDiscount || p.price || null,
        store: p.sellerName && p.sellerName !== 'KaBuM!' ? 'KaBuM! (' + p.sellerName + ')' : 'KaBuM!',
        note: p.priceWithDiscount ? 'preço no Pix' : null,
        image: p.thumbnail || p.image || null,
      }));
    `);
    return { offers: toOffers(this, items, "KaBuM!") };
  },
};

const pichau: Source = {
  id: "pichau",
  label: "Pichau",
  kind: "loja",
  searchUrl: (q) => `https://www.pichau.com.br/search?q=${enc(q)}`,
  waitFor: 'a[data-cy="list-product"]',
  async extract(page) {
    const items = await run<Item[]>(page, `
      return [...document.querySelectorAll('a[data-cy="list-product"]')].map((a) => {
        const vista = P(T(a.querySelector('[class*="price_vista"]:not([class*="text"]):not([class*="additional"])')));
        const total = P(T(a.querySelector('[class*="price_total"]')));
        return { title: T(a.querySelector('h2')), url: abs(a.getAttribute('href')), price: total || vista, final: vista || total, note: vista ? 'preço no Pix' : null };
      });
    `);
    return { offers: toOffers(this, items, "Pichau") };
  },
};

const terabyte: Source = {
  id: "terabyte",
  label: "Terabyte",
  kind: "loja",
  searchUrl: (q) => `https://www.terabyteshop.com.br/busca?str=${enc(q)}`,
  waitFor: ".product-item",
  async extract(page) {
    const items = await run<Item[]>(page, `
      return [...document.querySelectorAll('.product-item[data-tss-price]')]
        .filter((el) => el.getAttribute('data-tss-estoque') !== '0')
        .map((el) => {
          const a = el.querySelector('a[href*="/produto/"]');
          const price = parseFloat(el.getAttribute('data-tss-price'));
          return { title: a ? (a.getAttribute('title') || T(a)) : '', url: a ? abs(a.getAttribute('href')) : '', price, final: price, note: 'preço à vista' };
        });
    `);
    return { offers: toOffers(this, items, "Terabyte") };
  },
};

const pelando: Source = {
  id: "pelando",
  label: "Pelando",
  kind: "comunidade",
  searchUrl: (q) => `https://www.pelando.com.br/busca/${slug(q)}`,
  waitFor: "h3 a[data-deal-id]",
  async extract(page) {
    const items = await run<Item[]>(page, `
      return [...document.querySelectorAll('h3 a[data-deal-id]')]
        .filter((a) => a.getAttribute('data-inactive') !== 'true')
        .map((a) => {
          let card = a; for (let i = 0; i < 6 && card.parentElement; i++) { card = card.parentElement; if (card.querySelector('[class*="deal-card-stamp"]')) break; }
          const stamp = card.querySelector('[class*="deal-card-stamp"]');
          const store = T(card.querySelector('a[href^="/cupons-de-descontos/"]')) || 'Pelando';
          const codeEl = card.querySelector('[class*="coupon-code"] [class*="code"], [class*="coupon-code"] .code');
          const price = stamp && /R\\$/.test(stamp.textContent) ? P(T(stamp)) : null;
          return { title: T(a), url: abs(a.getAttribute('href')), price, final: price, store: store + ' (via Pelando)', coupon: codeEl ? T(codeEl) : null };
        });
    `);
    const offers = toOffers(this, items, "Pelando");
    const coupons: FoundCoupon[] = items
      .filter((i) => i.coupon)
      .map((i) => ({ store: (i.store || "").replace(" (via Pelando)", ""), code: i.coupon!, title: i.title, url: i.url, source: "pelando" }));
    return { offers, coupons };
  },
};

/** Nome único por loja (o Promobit escreve "Aliexpress", o resto do app "AliExpress"). */
const STORE_ALIAS: Record<string, string> = { aliexpress: "AliExpress", kabum: "KaBuM!", "kabum!": "KaBuM!" };
export const canonStore = (name: string) => STORE_ALIAS[name.trim().toLowerCase()] ?? name.trim();

const COUPON_RE = /^[A-Z0-9][A-Z0-9_-]{3,24}$/;
/** "AEMEGA3 + Cupom da Loja + Moedas" -> "AEMEGA3". Só aceita se o texto começar com um código. */
const leadingCode = (raw: string) => {
  const first = raw.trim().split(/[\s+,;/]+/)[0] ?? "";
  return COUPON_RE.test(first) && /\d/.test(first) ? first : COUPON_RE.test(raw.trim()) ? raw.trim() : null;
};

const promobit: Source = {
  id: "promobit",
  label: "Promobit",
  kind: "comunidade",
  searchUrl: (q) => `https://api.promobit.com.br/search?q=${enc(q)}`,
  // Usa a mesma API JSON que o site do Promobit consome: sem navegador, já com loja,
  // cupom e status (ofertas encerradas vêm separadas e são ignoradas).
  async fetchOffers(q) {
    const r = await fetch(this.searchUrl(q), { headers: { accept: "application/json", referer: "https://www.promobit.com.br/" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d: any = await r.json();
    const offers: RawOffer[] = (d.active_offers ?? [])
      .filter((o: any) => o.offer_status_name === "APPROVED" && o.offer_price > 0)
      .map((o: any) => {
        const raw = (o.offer_coupon ?? "").trim();
        const code = leadingCode(raw);
        return {
          source: "promobit",
          store: `${canonStore(o.store_name)} (via Promobit)`,
          title: o.offer_title,
          url: `https://www.promobit.com.br/oferta/${o.offer_slug}/`,
          price: o.offer_old_price && o.offer_old_price > o.offer_price ? o.offer_old_price : o.offer_price,
          finalPrice: o.offer_price,
          coupon: code,
          image: o.offer_photo ? `https://www.promobit.com.br/static/p${o.offer_photo}` : null,
          note: [code && raw === code ? null : raw || null, `postado ${String(o.offer_published).slice(0, 16).replace("T", " ")}`].filter(Boolean).join(" · "),
        } satisfies RawOffer;
      });
    const coupons: FoundCoupon[] = [
      ...(d.coupons ?? [])
        .filter((c: any) => c.coupon_status_name === "APPROVED" && c.coupon_code)
        .map((c: any) => ({ store: canonStore(c.store_name), code: c.coupon_code, title: c.coupon_title, url: `https://www.promobit.com.br${c.coupon_url}`, source: "promobit" })),
      ...offers.filter((o) => o.coupon).map((o) => ({ store: o.store.replace(" (via Promobit)", ""), code: o.coupon!, title: o.title, url: o.url, source: "promobit" })),
    ];
    return { offers, coupons };
  },
};

/** Lê o JSON que a busca do AliExpress já embute na página (window._dida_config_._init_data_). */
function aliItems(html: string): any[] {
  const k = html.indexOf("_init_data_= {");
  if (k < 0) throw new Error("busca sem dados (layout mudou ou a loja pediu verificação)");
  const start = html.indexOf("{", html.indexOf("data:", k));
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { end = i + 1; break; }
  }
  const find = (o: any): any[] | null => {
    if (!o || typeof o !== "object") return null;
    if (Array.isArray(o.itemList?.content)) return o.itemList.content;
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  return find(JSON.parse(html.slice(start, end))) ?? [];
}

const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const aliexpress: Source = {
  id: "aliexpress",
  label: "AliExpress",
  kind: "loja",
  searchUrl: (q) => `https://pt.aliexpress.com/w/wholesale-${enc(slug(q))}.html`,
  minIntervalMin: 10,
  async fetchOffers(q) {
    const r = await fetch(this.searchUrl(q), { headers: { accept: "text/html", "accept-language": "pt-BR,pt;q=0.9" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = aliItems(await r.text());
    const offers: RawOffer[] = items
      // productType "ad" = anúncio patrocinado: fica de fora.
      .filter((it) => it.productType !== "ad" && !it.p4p && it.prices?.salePrice?.minPrice > 0)
      .map((it) => {
        const sale = it.prices.salePrice;
        const orig = it.prices.originalPrice?.minPrice;
        const tags: string[] = (it.sellingPoints ?? []).map((sp: any) => sp.sellingPointTagId ?? "");
        const texts: string[] = (it.sellingPoints ?? []).flatMap((sp: any) =>
          (sp.materials ?? []).filter((m: any) => m.type === "TEXT" && !/^#/.test(m.value)).map((m: any) => strip(m.value)),
        );
        const coins = texts.find((t) => /moedas/i.test(t));
        const storeCoupon = texts.find((t) => /cupom|cupon/i.test(t) && !/novo usu/i.test(t));
        const note = [
          tags.includes("local_flag") ? "envio do Brasil" : null,
          texts.some((t) => /frete gr/i.test(t)) ? "frete grátis" : null,
          storeCoupon ?? null,
          coins ?? null,
          it.trade?.tradeDesc ? strip(it.trade.tradeDesc) : null,
          it.evaluation?.starRating ? `nota ${it.evaluation.starRating}` : null,
          "preço da variação mais barata, sem desconto de novo usuário",
        ].filter(Boolean).join(" · ");
        return {
          source: "aliexpress",
          store: "AliExpress",
          title: it.title?.displayTitle ?? "",
          url: `https://pt.aliexpress.com/item/${it.productId}.html`,
          price: orig && orig > sale.minPrice ? orig : sale.minPrice,
          finalPrice: sale.minPrice,
          coupon: null,
          note,
          image: it.image?.imgUrl ? (it.image.imgUrl.startsWith("//") ? `https:${it.image.imgUrl}` : it.image.imgUrl) + "_220x220.jpg" : null,
        } satisfies RawOffer;
      })
      .filter((o) => o.title);
    // Códigos gerais do AliExpress (AEMEGA..., por faixa de valor) postados no Promobit.
    const coupons = await aliCoupons().catch(() => []);
    return { offers, coupons };
  },
};

let aliCouponCache: { at: number; list: FoundCoupon[] } | null = null;
/**
 * Códigos gerais do AliExpress postados no Promobit. As postagens trazem a faixa
 * ("R$ 50 de desconto em compras a partir de R$ 290"), que guardamos para escolher
 * só os cupons que cabem no preço de cada oferta.
 */
async function aliCoupons(): Promise<FoundCoupon[]> {
  if (aliCouponCache && Date.now() - aliCouponCache.at < 30 * 60_000) return aliCouponCache.list;
  const byCode = new Map<string, FoundCoupon>();
  for (const q of ["cupom aliexpress", "AEMEGA", "AFFNOV"]) {
    const r = await fetch(`https://api.promobit.com.br/search?q=${enc(q)}`, { headers: { accept: "application/json", referer: "https://www.promobit.com.br/" } });
    if (!r.ok) continue;
    const d: any = await r.json();
    const found = [
      ...(d.coupons ?? [])
        .filter((c: any) => c.coupon_status_name === "APPROVED" && /ali/i.test(c.store_name))
        .map((c: any) => ({ code: c.coupon_code, text: `${c.coupon_title ?? ""} ${c.coupon_description ?? ""}`, title: c.coupon_title, url: `https://www.promobit.com.br${c.coupon_url}` })),
      ...(d.active_offers ?? [])
        .filter((o: any) => o.offer_status_name === "APPROVED" && /ali/i.test(o.store_name) && o.offer_coupon)
        .map((o: any) => ({ code: leadingCode(o.offer_coupon), text: o.offer_title, title: o.offer_title, url: `https://www.promobit.com.br/oferta/${o.offer_slug}/` })),
    ];
    for (const f of found) {
      if (!f.code) continue;
      const tier = couponTier(f.text);
      const prev = byCode.get(f.code);
      // Prefere a postagem que traz a faixa completa (desconto + mínimo).
      if (!prev || (tier.minOrder != null && prev.minOrder == null)) {
        byCode.set(f.code, { store: "AliExpress", code: f.code, title: f.title, url: f.url, source: "promobit", ...tier });
      }
    }
  }
  const list = [...byCode.values()];
  aliCouponCache = { at: Date.now(), list };
  return list;
}

const BLOCKED = "a loja bloqueia navegador automatizado (HTTP 403/503 no teste)";
amazon.disabledReason = BLOCKED;
pichau.disabledReason = BLOCKED;
terabyte.disabledReason = BLOCKED;
pelando.disabledReason = BLOCKED;

export const SOURCES: Source[] = [kabum, promobit, aliexpress, amazon, pichau, terabyte, pelando];

/** Fontes ativas: SOURCES=kabum,promobit,amazon no ambiente sobrescreve o padrão. */
export function activeSources(): Source[] {
  const env = process.env.SOURCES?.split(",").map((x) => x.trim()).filter(Boolean);
  return SOURCES.filter((s) => (env ? env.includes(s.id) : !s.disabledReason));
}

export { parseBRL };
