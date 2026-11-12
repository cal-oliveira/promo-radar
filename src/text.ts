/**
 * Minúsculas, sem acento, só letras/números separados por espaço único.
 * Decimais ficam juntos com "_": "16,1" e "16.1" viram "16_1", e "2.4G" vira "2_4g"
 * (assim "Nova Lite 2.4G" não parece "Nova Lite 2").
 */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/(\d)[.,](?=\d)/g, "$1_")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

/** true se `phrase` aparece em `text` respeitando limites de palavra (ambos já normalizados). */
export function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

/** Converte "R$ 4.364,03" / "4364.03" em número. */
export function parseBRL(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const m = s.replace(/ /g, " ").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/\./g, "") + "." + (m[2] ?? "0"));
  return Number.isFinite(v) ? v : null;
}

const STOP = new Set(["de", "da", "do", "com", "e", "para", "o", "a", "em", "gb", "polegadas"]);

/** Termos obrigatórios derivados do nome livre digitado pelo usuário. */
export function mustFromName(name: string): string[] {
  return norm(name)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}
