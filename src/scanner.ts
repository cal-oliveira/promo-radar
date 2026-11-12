import { chromium, type Browser } from "playwright";
import { EventEmitter } from "node:events";
import { db, type ProductRow } from "./db.js";
import { activeSources, type FoundCoupon, type RawOffer, type Source, type SourceResult } from "./sources/index.js";
import { matches, dropOutliers } from "./matcher.js";

export const bus = new EventEmitter();

const INTERVAL_MIN = Number(process.env.SCAN_INTERVAL_MIN ?? 2);
/** Queda mínima (R$) sobre o recorde para disparar alarme; evita alarme por centavos. */
export const MIN_DROP = Number(process.env.MIN_DROP ?? 1);

let browser: Browser | null = null;
let running = false;
let timer: NodeJS.Timeout | null = null;
export const state = { running: false, lastCycle: null as string | null, nextCycle: null as string | null, intervalMin: INTERVAL_MIN };

async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function runSource(source: Source, query: string): Promise<SourceResult> {
  if (source.fetchOffers) return source.fetchOffers(query);
  const b = await getBrowser();
  const ctx = await b.newContext({ locale: "pt-BR", viewport: { width: 1366, height: 900 } });
  // Sem imagens/fontes: carrega mais rápido e gasta menos banda das lojas.
  await ctx.route("**/*", (route) => (["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue()));
  try {
    const page = await ctx.newPage();
    const res = await page.goto(source.searchUrl(query), { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
    if (source.waitFor) await page.waitForSelector(source.waitFor, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return await source.extract!(page);
  } finally {
    await ctx.close();
  }
}

function setSourceStatus(id: string, ok: boolean, count: number, message: string) {
  db.prepare(
    `INSERT INTO source_status (source, last_run, ok, count, message) VALUES (?, datetime('now'), ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET last_run = excluded.last_run, ok = excluded.ok, count = excluded.count, message = excluded.message`,
  ).run(id, ok ? 1 : 0, count, message);
}

function saveCoupons(coupons: FoundCoupon[]) {
  const stmt = db.prepare(
    `INSERT INTO coupons (store, code, title, url, source, min_order, discount) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(store, code) DO UPDATE SET last_seen = datetime('now'), title = COALESCE(excluded.title, title),
       min_order = COALESCE(excluded.min_order, min_order), discount = COALESCE(excluded.discount, discount)`,
  );
  for (const c of coupons) stmt.run(c.store, c.code, c.title, c.url, c.source, c.minOrder ?? null, c.discount ?? null);
}

function upsertOffer(productId: number, o: RawOffer): { id: number; changed: boolean } {
  const prev = db.prepare("SELECT id, final_price FROM offers WHERE product_id = ? AND url = ?").get(productId, o.url) as
    | { id: number; final_price: number }
    | undefined;
  if (prev) {
    db.prepare(
      "UPDATE offers SET title = ?, store = ?, price = ?, final_price = ?, coupon = ?, note = ?, image = COALESCE(?, image), last_seen = datetime('now') WHERE id = ?",
    ).run(o.title, o.store, o.price, o.finalPrice, o.coupon ?? null, o.note ?? null, o.image ?? null, prev.id);
    const changed = Math.abs(prev.final_price - o.finalPrice) >= 0.01;
    if (changed) db.prepare("INSERT INTO price_history (offer_id, final_price) VALUES (?, ?)").run(prev.id, o.finalPrice);
    return { id: prev.id, changed };
  }
  const r = db
    .prepare("INSERT INTO offers (product_id, source, store, title, url, price, final_price, coupon, note, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(productId, o.source, o.store, o.title, o.url, o.price, o.finalPrice, o.coupon ?? null, o.note ?? null, o.image ?? null);
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO price_history (offer_id, final_price) VALUES (?, ?)").run(id, o.finalPrice);
  return { id, changed: true };
}

/** Última busca por produto+fonte, para fontes com minIntervalMin (ex.: AliExpress a cada 10 min). */
const lastRun = new Map<string, number>();
function due(s: Source, productId: number) {
  if (!s.minIntervalMin) return true;
  const key = `${productId}:${s.id}`;
  const prev = lastRun.get(key) ?? 0;
  if (Date.now() - prev < s.minIntervalMin * 60_000 - 15_000) return false;
  lastRun.set(key, Date.now());
  return true;
}

export async function scanProduct(p: ProductRow) {
  const rules = {
    must: JSON.parse(p.must) as string[],
    exclude: JSON.parse(p.exclude) as string[],
    minPrice: p.min_price,
    maxPrice: p.max_price,
  };
  const sources = activeSources().filter((s) => due(s, p.id));
  bus.emit("event", { type: "scan", productId: p.id, status: "start" });

  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        const { offers, coupons } = await runSource(s, p.query);
        if (coupons?.length) saveCoupons(coupons);
        const ok = offers.filter((o) => matches(o, rules));
        setSourceStatus(s.id, true, offers.length, `${offers.length} anúncios, ${ok.length} batem com "${p.name}"`);
        return ok;
      } catch (e: any) {
        setSourceStatus(s.id, false, 0, String(e?.message ?? e).slice(0, 200));
        return [];
      }
    }),
  );

  ingestOffers(p, dropOutliers(results.flat()));
  db.prepare("UPDATE products SET baseline_done = 1, last_scan = datetime('now') WHERE id = ?").run(p.id);
  bus.emit("event", { type: "scan", productId: p.id, status: "done" });
}

/**
 * Grava ofertas de um produto, atualiza o recorde e cria alerta se alguma bateu o recorde.
 * Usado pelo scanner e pela skill /cacar-oferta (via POST /api/products/:id/offers).
 */
export function ingestOffers(p: ProductRow, offers: RawOffer[]): { alertId: number | null; best: number | null } {
  const prevBest = p.best_price;
  let best = p.best_price;
  let bestOfferId = p.best_offer_id;
  const fresh: { offerId: number; old: number | null; price: number }[] = [];

  for (const o of offers) {
    const { id } = upsertOffer(p.id, o);
    if (best == null || o.finalPrice < best - (p.baseline_done ? MIN_DROP : 0)) {
      if (p.baseline_done) fresh.push({ offerId: id, old: prevBest, price: o.finalPrice });
      best = o.finalPrice;
      bestOfferId = id;
    }
  }
  db.prepare("UPDATE products SET best_price = ?, best_offer_id = ? WHERE id = ?").run(best, bestOfferId, p.id);

  // Um alarme por lote: o da oferta mais barata.
  const top = fresh.sort((a, b) => a.price - b.price)[0];
  if (!top) return { alertId: null, best };
  const r = db.prepare("INSERT INTO alerts (product_id, offer_id, old_price, new_price) VALUES (?, ?, ?, ?)").run(p.id, top.offerId, top.old, top.price);
  const alertId = Number(r.lastInsertRowid);
  bus.emit("event", { type: "alert", alertId, productId: p.id });
  return { alertId, best };
}

export async function runCycle() {
  if (running) return;
  running = true;
  state.running = true;
  bus.emit("event", { type: "cycle", status: "start" });
  try {
    const products = db.prepare("SELECT * FROM products ORDER BY id").all() as ProductRow[];
    // Um produto por vez: as fontes de cada produto rodam em paralelo, mas sem martelar as lojas.
    for (const p of products) await scanProduct(p);
  } finally {
    running = false;
    state.running = false;
    state.lastCycle = new Date().toISOString();
    bus.emit("event", { type: "cycle", status: "done" });
  }
}

export function startScheduler() {
  const tick = async () => {
    await runCycle().catch((e) => console.error("[scanner]", e));
    const jitter = Math.random() * 30_000; // não bater sempre no mesmo segundo
    const ms = INTERVAL_MIN * 60_000 + jitter;
    state.nextCycle = new Date(Date.now() + ms).toISOString();
    timer = setTimeout(tick, ms);
  };
  tick();
}

export async function stopScheduler() {
  if (timer) clearTimeout(timer);
  await browser?.close();
}
