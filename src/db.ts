import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/promo-radar.db");

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category TEXT,
  must TEXT NOT NULL DEFAULT '[]',      -- JSON: grupos de termos obrigatórios ("ps5|playstation 5")
  exclude TEXT NOT NULL DEFAULT '[]',   -- JSON: termos que descartam o anúncio
  min_price REAL,
  max_price REAL,
  best_price REAL,
  best_offer_id INTEGER,
  baseline_done INTEGER NOT NULL DEFAULT 0,
  last_scan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  store TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price REAL NOT NULL,
  final_price REAL NOT NULL,
  coupon TEXT,
  note TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, url)
);

CREATE TABLE IF NOT EXISTS price_history (
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  final_price REAL NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  old_price REAL,
  new_price REAL NOT NULL,
  acked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT,
  url TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nao_verificado',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store, code)
);

CREATE TABLE IF NOT EXISTS source_status (
  source TEXT PRIMARY KEY,
  last_run TEXT,
  ok INTEGER,
  count INTEGER,
  message TEXT
);
`);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

// Migrações simples: adiciona colunas que não existiam na primeira versão.
function addColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn("alerts", "validation_status", "TEXT");   // validando | valido | invalido | sem_cupom | bloqueado | erro
addColumn("alerts", "validation_total", "REAL");
addColumn("alerts", "validation_message", "TEXT");
addColumn("alerts", "validation_at", "TEXT");
addColumn("coupons", "check_message", "TEXT");
addColumn("coupons", "checked_at", "TEXT");
addColumn("coupons", "min_order", "REAL");   // compra mínima para o cupom valer (ex.: AEMEGA3 a partir de R$ 290)
addColumn("coupons", "discount", "REAL");    // desconto em R$
// Validação por oferta (botão "Testar cupons" e alarmes).
addColumn("offers", "image", "TEXT");
addColumn("products", "image", "TEXT");     // foto do anúncio escolhido na busca
addColumn("products", "ref_url", "TEXT");   // anúncio de referência escolhido pelo usuário
addColumn("offers", "validation_status", "TEXT");
addColumn("offers", "validation_total", "REAL");
addColumn("offers", "validation_code", "TEXT");
addColumn("offers", "validation_message", "TEXT");
addColumn("offers", "validation_at", "TEXT");
addColumn("offers", "validation_via", "TEXT");
addColumn("offers", "validation_steps", "TEXT");      // JSON: passos para o usuário chegar no mesmo total
addColumn("offers", "validation_breakdown", "TEXT");  // JSON: linhas do resumo do checkout [{label, amount}]
addColumn("alerts", "kind", "TEXT NOT NULL DEFAULT 'preco'");  // preco: anúncio bateu o recorde | checkout: teste no checkout bateu
addColumn("products", "best_checkout", "REAL");                // menor total já confirmado no checkout
// Produtos já testados antes desta coluna existir: parte do menor total confirmado.
db.exec(`UPDATE products SET best_checkout = (SELECT MIN(validation_total) FROM offers
  WHERE offers.product_id = products.id AND validation_status = 'valido') WHERE best_checkout IS NULL`);      // de onde veio o desconto: "cupom AEMEGA3", "cupom automático da loja + moedas"

export function getSetting(key: string, fallback: string): string {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? fallback;
}
export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export type ProductRow = {
  id: number;
  name: string;
  query: string;
  category: string | null;
  must: string;
  exclude: string;
  min_price: number | null;
  max_price: number | null;
  best_price: number | null;
  best_offer_id: number | null;
  baseline_done: number;
  last_scan: string | null;
  created_at: string;
  image: string | null;
  ref_url: string | null;
  best_checkout: number | null;
};
