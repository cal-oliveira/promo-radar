import express from "express";
import { db, getSetting, setSetting, type ProductRow } from "./db.js";
import { CATALOG, CATEGORIES, EXCLUDE_BY_CATEGORY, suggest, brandsFor } from "./catalog.js";
import { mustFromName, norm } from "./text.js";
import { SOURCES, activeSources } from "./sources/index.js";
import { matches } from "./matcher.js";
import { MIN_DROP, bus, ingestOffers, runCycle, runSource, scanProduct, startScheduler, state, stopScheduler } from "./scanner.js";
import { autoValidateEnabled, enqueueOfferValidation, enqueueValidation } from "./validator.js";
import type { RawOffer } from "./sources/index.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/categories", (_req, res) => {
  res.json(CATEGORIES.map((c) => ({ ...c, brands: brandsFor(c.id) })));
});

app.get("/api/suggest", (req, res) => {
  const q = String(req.query.q ?? "");
  const cat = CATEGORIES.find((c) => norm(c.label) === norm(q) || c.id === norm(q));
  const items = cat ? CATALOG.filter((i) => i.category === cat.id) : suggest(q, 12);
  res.json(items);
});

const defaultExclude = (cat: string | null) => [...EXCLUDE_BY_CATEGORY._all, ...(cat ? EXCLUDE_BY_CATEGORY[cat] ?? [] : [])];

const baseStore = (store: string) => store.replace(/\s*\(via [^)]+\)\s*$/i, "").trim();

type CouponRow = { code: string; title: string | null; status: string; check_message: string | null; min_order: number | null; discount: number | null };
/**
 * Cupons conhecidos da loja que podem valer para um preço: tira os recusados e os que
 * exigem compra mínima acima do preço; ordena pelo maior desconto.
 */
function storeCoupons(store: string, price: number | null): CouponRow[] {
  const rows = db
    .prepare(
      `SELECT code, title, status, check_message, min_order, discount FROM coupons
       WHERE lower(store) = lower(?) AND status != 'invalido' AND last_seen >= datetime('now', '-3 days')`,
    )
    .all(store) as CouponRow[];
  return rows
    .filter((c) => price == null || c.min_order == null || c.min_order <= price)
    // Primeiro os de faixa conhecida (maior desconto antes); os sem compra mínima conhecida vão para o fim.
    .sort((a, b) => Number(a.min_order == null) - Number(b.min_order == null) || (b.discount ?? -1) - (a.discount ?? -1))
    .slice(0, 8);
}

function productView(p: ProductRow) {
  const best = p.best_offer_id ? db.prepare("SELECT * FROM offers WHERE id = ?").get(p.best_offer_id) : null;
  const current = db
    .prepare("SELECT * FROM offers WHERE product_id = ? AND last_seen >= datetime(?, '-10 minutes') ORDER BY final_price ASC LIMIT 8")
    .all(p.id, p.last_scan ?? "1970-01-01");
  const count = (db.prepare("SELECT COUNT(*) AS n FROM offers WHERE product_id = ?").get(p.id) as { n: number }).n;
  const withHints = (current as any[]).map((o) => {
    // Palpite só com cupom de faixa conhecida (ou que já funcionou no checkout).
    const c = storeCoupons(baseStore(o.store), o.final_price).find((x) => x.discount != null && (x.min_order != null || x.status === "valido"));
    return { ...o, coupon_hint: c ? { code: c.code, discount: c.discount, min_order: c.min_order, status: c.status } : null };
  });
  // Menor total confirmado no checkout nas últimas 24 h (cupom digitado ou desconto automático da loja).
  const checkout = db
    .prepare(
      `SELECT id AS offer_id, url, store, title, final_price AS listed, validation_total AS total, validation_code AS code,
              validation_via AS via, validation_message AS message, validation_at AS at,
              validation_steps AS steps, validation_breakdown AS breakdown
       FROM offers WHERE product_id = ? AND validation_status = 'valido' AND validation_total IS NOT NULL
         AND validation_at >= datetime('now', '-24 hours')
       ORDER BY validation_total ASC, validation_at DESC LIMIT 1`,
    )
    .get(p.id) as Record<string, any> | undefined;
  if (checkout) {
    checkout.steps = checkout.steps ? JSON.parse(checkout.steps) : [];
    checkout.breakdown = checkout.breakdown ? JSON.parse(checkout.breakdown) : [];
  }
  const exclude = JSON.parse(p.exclude) as string[];
  const defaults = new Set(defaultExclude(p.category));
  return { ...p, checkout: checkout ?? null, must: JSON.parse(p.must), exclude, exclude_extra: exclude.filter((x) => !defaults.has(x)), best, current: withHints, offerCount: count };
}

/**
 * Busca ao vivo para o autocomplete: anúncios reais, com foto, para o usuário escolher
 * exatamente o modelo. speed=fast usa as fontes HTTP (~1 s); speed=slow as de navegador.
 */
const lookupCache = new Map<string, { at: number; items: unknown[] }>();
app.get("/api/lookup", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const speed = req.query.speed === "slow" ? "slow" : "fast";
  if (q.length < 3) return res.json([]);
  const key = `${speed}:${q.toLowerCase()}`;
  const hit = lookupCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return res.json(hit.items);
  const sources = activeSources().filter((s) => (speed === "fast" ? !!s.fetchOffers : !s.fetchOffers));
  const results = await Promise.all(
    sources.map((s) =>
      Promise.race([
        runSource(s, q).then((r) => r.offers),
        new Promise<RawOffer[]>((resolve) => setTimeout(() => resolve([]), 15_000)),
      ]).catch(() => [] as RawOffer[]),
    ),
  );
  const seen = new Set<string>();
  const items = results
    .flat()
    .filter((o) => o.title && !seen.has(o.url) && seen.add(o.url))
    .slice(0, 80)
    .map((o) => ({ title: o.title, url: o.url, store: o.store, price: o.finalPrice, image: o.image ?? null, source: o.source }));
  lookupCache.set(key, { at: Date.now(), items });
  res.json(items);
});

app.get("/api/products", (_req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as ProductRow[];
  res.json(rows.map(productView));
});

app.post("/api/products", (req, res) => {
  const { name, query, category, must, minPrice, maxPrice, catalog, image, refUrl } = req.body ?? {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Informe o produto." });
  const fromCatalog = catalog ? CATALOG.find((i) => i.name === name) : undefined;
  const cat = fromCatalog?.category ?? category ?? null;
  const exclude = [...defaultExclude(cat), ...(Array.isArray(req.body?.exclude) ? req.body.exclude.map(String) : [])];
  const r = db
    .prepare("INSERT INTO products (name, query, category, must, exclude, min_price, max_price, image, ref_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      name,
      fromCatalog?.query ?? query ?? name,
      cat,
      JSON.stringify(fromCatalog?.must ?? must ?? mustFromName(name)),
      JSON.stringify(exclude),
      minPrice ?? fromCatalog?.min ?? null,
      maxPrice ?? null,
      typeof image === "string" ? image : null,
      typeof refUrl === "string" ? refUrl : null,
    );
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(r.lastInsertRowid) as ProductRow;
  scanProduct(p).catch((e) => console.error(e)); // primeira varredura já, sem esperar o ciclo
  res.status(201).json(productView(p));
});

app.patch("/api/products/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id) as ProductRow | undefined;
  if (!p) return res.status(404).json({ error: "produto não encontrado" });
  const b = req.body ?? {};
  const minPrice = "minPrice" in b ? b.minPrice ?? null : p.min_price;
  const maxPrice = "maxPrice" in b ? b.maxPrice ?? null : p.max_price;
  db.prepare("UPDATE products SET min_price = ?, max_price = ? WHERE id = ?").run(minPrice, maxPrice, p.id);
  if (typeof b.name === "string" && b.name.trim()) db.prepare("UPDATE products SET name = ? WHERE id = ?").run(b.name.trim(), p.id);
  // Filtro novo: tira do histórico o que não bate mais e recalcula os recordes (sem tocar alarme).
  if (Array.isArray(b.must) && b.must.length) {
    const must = b.must.map(String);
    const exclude = [...defaultExclude(p.category), ...(Array.isArray(b.exclude) ? b.exclude.map(String) : [])];
    const rules = { must, exclude, minPrice, maxPrice: null };
    const offers = db.prepare("SELECT id, title, final_price FROM offers WHERE product_id = ?").all(p.id) as { id: number; title: string; final_price: number }[];
    const drop = offers.filter((o) => !matches({ title: o.title, finalPrice: o.final_price } as RawOffer, rules));
    const del = db.prepare("DELETE FROM offers WHERE id = ?");
    for (const o of drop) del.run(o.id);
    const best = db.prepare("SELECT id, final_price FROM offers WHERE product_id = ? ORDER BY final_price ASC LIMIT 1").get(p.id) as { id: number; final_price: number } | undefined;
    const bestCo = db.prepare("SELECT MIN(validation_total) AS t FROM offers WHERE product_id = ? AND validation_status = 'valido'").get(p.id) as { t: number | null };
    db.prepare("UPDATE products SET must = ?, exclude = ?, best_price = ?, best_offer_id = ?, best_checkout = ? WHERE id = ?").run(
      JSON.stringify(must), JSON.stringify(exclude), best?.final_price ?? null, best?.id ?? null, bestCo.t, p.id,
    );
    return res.json({ ok: true, removed: drop.length, kept: offers.length - drop.length });
  }
  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/products/:id/offers", (req, res) => {
  res.json(db.prepare("SELECT * FROM offers WHERE product_id = ? ORDER BY final_price ASC LIMIT 50").all(req.params.id));
});

app.get("/api/alerts", (req, res) => {
  const onlyOpen = req.query.open === "1";
  res.json(
    db
      .prepare(
        `SELECT a.*, p.name AS product_name, o.title, o.url, o.store, o.coupon, o.note,
                o.final_price AS listed, o.validation_via AS via, o.validation_code AS code, o.validation_at AS tested_at
         FROM alerts a JOIN products p ON p.id = a.product_id JOIN offers o ON o.id = a.offer_id
         ${onlyOpen ? "WHERE a.acked = 0" : ""} ORDER BY a.id DESC LIMIT 50`,
      )
      .all(),
  );
});

app.post("/api/alerts/ack", (req, res) => {
  const id = req.body?.id;
  if (id) db.prepare("UPDATE alerts SET acked = 1 WHERE id = ?").run(id);
  else db.prepare("UPDATE alerts SET acked = 1 WHERE acked = 0").run();
  res.json({ ok: true });
});

/** Detalhes de um alerta para a skill /validar-cupom: oferta, produto e cupons conhecidos da loja. */
app.get("/api/alerts/:id", (req, res) => {
  const a = db
    .prepare(
      `SELECT a.*, p.name AS product_name, p.query, o.title, o.url, o.store, o.coupon, o.note, o.price, o.final_price, o.source
       FROM alerts a JOIN products p ON p.id = a.product_id JOIN offers o ON o.id = a.offer_id WHERE a.id = ?`,
    )
    .get(req.params.id) as Record<string, any> | undefined;
  if (!a) return res.status(404).json({ error: "alerta não encontrado" });
  const store = baseStore(a.store);
  res.json({ ...a, store_name: store, store_coupons: storeCoupons(store, a.final_price) });
});

/** Detalhes de uma oferta para a skill /validar-cupom (botão "Testar cupons"). */
app.get("/api/offers/:id", (req, res) => {
  const o = db
    .prepare("SELECT o.*, p.name AS product_name, p.query FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ?")
    .get(req.params.id) as Record<string, any> | undefined;
  if (!o) return res.status(404).json({ error: "oferta não encontrada" });
  const store = baseStore(o.store);
  res.json({ ...o, store_name: store, store_coupons: storeCoupons(store, o.final_price) });
});

const V_ALLOWED = ["valido", "invalido", "sem_cupom", "bloqueado", "erro"];
function saveOfferValidation(offerId: number, b: any) {
  db.prepare(
    `UPDATE offers SET validation_status = ?, validation_total = ?, validation_code = ?, validation_via = ?, validation_message = ?,
       validation_steps = ?, validation_breakdown = ?, validation_at = datetime('now') WHERE id = ?`,
  ).run(
    b.status,
    typeof b.total === "number" ? b.total : null,
    b.code || null,
    b.via || (b.code ? `cupom ${b.code}` : null),
    b.message ?? null,
    Array.isArray(b.steps) ? JSON.stringify(b.steps.map(String).slice(0, 12)) : null,
    Array.isArray(b.breakdown)
      ? JSON.stringify(b.breakdown.filter((x: any) => x && x.label).map((x: any) => ({ label: String(x.label), amount: Number(x.amount) })).slice(0, 12))
      : null,
    offerId,
  );
}

/**
 * Sirene de checkout. Toca quando o teste confirma o negócio:
 * - teste disparado por queda no anúncio: o total do checkout ficou no preço novo ou abaixo dele;
 * - qualquer teste: o total ficou abaixo do menor total já confirmado no checkout;
 * - primeiro teste do produto (manual): o total ficou abaixo do menor preço de anúncio.
 * Já nasce validado, então não volta para a fila do Claude.
 */
function checkoutAlarm(offerId: number, priceAlert?: { new_price: number; old_price: number | null }) {
  const o = db
    .prepare("SELECT id, product_id, validation_status, validation_total, validation_via, validation_message FROM offers WHERE id = ?")
    .get(offerId) as { id: number; product_id: number; validation_status: string; validation_total: number | null; validation_via: string | null; validation_message: string | null } | undefined;
  if (!o || o.validation_status !== "valido" || o.validation_total == null) return;
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(o.product_id) as ProductRow | undefined;
  if (!p) return;
  const total = o.validation_total;
  const prevCo = p.best_checkout;
  if (prevCo == null || total < prevCo) db.prepare("UPDATE products SET best_checkout = ? WHERE id = ?").run(total, p.id);

  let ref: number | null = null;
  if (priceAlert && total <= priceAlert.new_price + 0.005) ref = priceAlert.old_price ?? prevCo ?? priceAlert.new_price;
  else if (prevCo != null && total < prevCo - MIN_DROP) ref = prevCo;
  else if (!priceAlert && prevCo == null && p.best_price != null && total < p.best_price - MIN_DROP) ref = p.best_price;
  if (ref == null) return;

  const r = db
    .prepare(
      `INSERT INTO alerts (product_id, offer_id, old_price, new_price, kind, validation_status, validation_total, validation_message, validation_at)
       VALUES (?, ?, ?, ?, 'checkout', 'valido', ?, ?, datetime('now'))`,
    )
    .run(p.id, o.id, ref, total, total, o.validation_via ?? o.validation_message);
  bus.emit("event", { type: "alert", alertId: Number(r.lastInsertRowid), productId: p.id, kind: "checkout" });
}

/** Resultado do teste de uma oferta, enviado pela skill. */
app.post("/api/offers/:id/validation", (req, res) => {
  const b = req.body ?? {};
  if (!V_ALLOWED.includes(b.status)) return res.status(400).json({ error: `status deve ser um de: ${V_ALLOWED.join(", ")}` });
  saveOfferValidation(Number(req.params.id), b);
  bus.emit("event", { type: "validation", offerId: Number(req.params.id), status: b.status });
  checkoutAlarm(Number(req.params.id));
  res.json({ ok: true });
});

/** Botão "Testar cupons" de uma oferta. */
app.post("/api/offers/:id/validate", (req, res) => {
  res.json(enqueueOfferValidation(Number(req.params.id)));
});

/** Resultado da validação, enviado pela skill. */
app.post("/api/alerts/:id/validation", (req, res) => {
  const { status, total, code, message } = req.body ?? {};
  if (!V_ALLOWED.includes(status)) return res.status(400).json({ error: `status deve ser um de: ${V_ALLOWED.join(", ")}` });
  db.prepare("UPDATE alerts SET validation_status = ?, validation_total = ?, validation_message = ?, validation_at = datetime('now') WHERE id = ?").run(
    status,
    typeof total === "number" ? total : null,
    [code ? `cupom ${code}` : null, message].filter(Boolean).join(" · ") || null,
    req.params.id,
  );
  const al = db.prepare("SELECT offer_id, kind, new_price, old_price FROM alerts WHERE id = ?").get(req.params.id) as
    | { offer_id: number; kind: string; new_price: number; old_price: number | null }
    | undefined;
  if (al) {
    saveOfferValidation(al.offer_id, req.body);
    checkoutAlarm(al.offer_id, al.kind === "preco" ? al : undefined);
  }
  bus.emit("event", { type: "validation", alertId: Number(req.params.id), offerId: al?.offer_id, status });
  res.json({ ok: true });
});

/** Dispara a validação manualmente (botão no alarme). */
app.post("/api/alerts/:id/validate", (req, res) => {
  res.json(enqueueValidation(Number(req.params.id)));
});

/** A skill marca cada cupom testado como válido/inválido. */
app.post("/api/coupons/check", (req, res) => {
  const { store, code, status, message, minOrder, discount } = req.body ?? {};
  if (!store || !code || !["valido", "invalido"].includes(status)) return res.status(400).json({ error: "informe store, code e status (valido|invalido)" });
  db.prepare(
    `INSERT INTO coupons (store, code, source, status, check_message, checked_at, min_order, discount) VALUES (?, ?, 'claude', ?, ?, datetime('now'), ?, ?)
     ON CONFLICT(store, code) DO UPDATE SET status = excluded.status, check_message = excluded.check_message, checked_at = excluded.checked_at,
       last_seen = datetime('now'), min_order = COALESCE(excluded.min_order, min_order), discount = COALESCE(excluded.discount, discount)`,
  ).run(baseStore(store), code, status, message ?? null, typeof minOrder === "number" ? minOrder : null, typeof discount === "number" ? discount : null);
  bus.emit("event", { type: "coupons" });
  res.json({ ok: true });
});

/** Ofertas encontradas pela skill /cacar-oferta. Passam pela mesma lógica de recorde/alarme. */
app.post("/api/products/:id/offers", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id) as ProductRow | undefined;
  if (!p) return res.status(404).json({ error: "produto não encontrado" });
  const list = Array.isArray(req.body?.offers) ? req.body.offers : [];
  const offers: RawOffer[] = list
    .filter((o: any) => o && o.title && o.url && Number(o.finalPrice ?? o.price) > 0)
    .map((o: any) => ({
      source: "claude",
      store: String(o.store ?? "loja"),
      title: String(o.title),
      url: String(o.url),
      price: Number(o.price ?? o.finalPrice),
      finalPrice: Number(o.finalPrice ?? o.price),
      coupon: o.coupon ?? null,
      note: o.note ?? "encontrado pelo Claude",
    }));
  if (!offers.length) return res.status(400).json({ error: "nenhuma oferta válida (title, url, finalPrice)" });
  const r = ingestOffers(p, offers);
  bus.emit("event", { type: "scan", productId: p.id, status: "done" });
  res.json({ ok: true, received: offers.length, ...r });
});

app.get("/api/settings", (_req, res) => res.json({ autoValidate: autoValidateEnabled() }));
app.post("/api/settings", (req, res) => {
  if (typeof req.body?.autoValidate === "boolean") setSetting("auto_validate", req.body.autoValidate ? "1" : "0");
  res.json({ autoValidate: autoValidateEnabled() });
});

app.get("/api/coupons", (_req, res) => {
  res.json(db.prepare("SELECT * FROM coupons ORDER BY last_seen DESC LIMIT 60").all());
});

app.get("/api/status", (_req, res) => {
  const statuses = db.prepare("SELECT * FROM source_status").all() as { source: string }[];
  const active = new Set(activeSources().map((s) => s.id));
  res.json({
    ...state,
    sources: SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      active: active.has(s.id),
      disabledReason: active.has(s.id) ? null : s.disabledReason ?? "desligada",
      status: statuses.find((x) => x.source === s.id) ?? null,
    })),
  });
});

app.post("/api/scan", (_req, res) => {
  runCycle().catch((e) => console.error(e));
  res.json({ ok: true });
});

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  bus.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
});

// Integração com o alarme: todo alerta novo vai para a fila de validação do Claude (se ligado).
bus.on("event", (e: { type: string; alertId?: number; kind?: string }) => {
  if (e.type === "alert" && e.alertId && e.kind !== "checkout" && autoValidateEnabled()) enqueueValidation(e.alertId);
});

const PORT = Number(process.env.PORT ?? 4321);
app.listen(PORT, () => {
  console.log(`Promo Radar em http://localhost:${PORT}`);
  console.log(`Fontes ativas: ${activeSources().map((s) => s.label).join(", ")} · ciclo a cada ${state.intervalMin} min`);
  startScheduler();
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopScheduler().finally(() => process.exit(0)));
