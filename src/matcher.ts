import { norm, hasPhrase } from "./text.js";
import type { RawOffer } from "./sources/index.js";

export type MatchRules = {
  must: string[];
  exclude: string[];
  minPrice: number | null;
  maxPrice: number | null;
};

export function matches(offer: RawOffer, r: MatchRules): boolean {
  const t = norm(offer.title);
  for (const group of r.must) {
    const alts = group.split("|").map(norm).filter(Boolean);
    if (alts.length && !alts.some((a) => hasPhrase(t, a))) return false;
  }
  for (const ex of r.exclude) {
    const e = norm(ex);
    if (e && hasPhrase(t, e)) return false;
  }
  if (r.minPrice != null && offer.finalPrice < r.minPrice) return false;
  if (r.maxPrice != null && offer.finalPrice > r.maxPrice) return false;
  return true;
}

/**
 * Proteção extra contra acessórios que passaram nos filtros:
 * com 4+ ofertas, descarta quem custa menos de 45% da mediana.
 */
export function dropOutliers(offers: RawOffer[]): RawOffer[] {
  if (offers.length < 4) return offers;
  const sorted = [...offers].map((o) => o.finalPrice).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return offers.filter((o) => o.finalPrice >= median * 0.45);
}
