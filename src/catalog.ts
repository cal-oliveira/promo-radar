import { norm } from "./text.js";

export type CatalogItem = {
  category: string;
  brand: string;
  name: string;
  /** Texto usado na busca das lojas. */
  query: string;
  /** Grupos obrigatórios: cada grupo precisa aparecer no título; "a|b" = a OU b. */
  must: string[];
  /** Preço mínimo plausível: abaixo disso é acessório/peça e é descartado. */
  min: number;
};

export const CATEGORIES = [
  { id: "celular", label: "Celular", icon: "📱" },
  { id: "tv", label: "TV", icon: "📺" },
  { id: "notebook", label: "Notebook", icon: "💻" },
  { id: "console", label: "Console", icon: "🎮" },
  { id: "controle", label: "Controle", icon: "🕹️" },
  { id: "fone", label: "Fone", icon: "🎧" },
  { id: "tablet", label: "Tablet", icon: "📲" },
  { id: "smartwatch", label: "Smartwatch", icon: "⌚" },
  { id: "monitor", label: "Monitor", icon: "🖥️" },
  { id: "placa-de-video", label: "Placa de vídeo", icon: "🧩" },
  { id: "casa", label: "Casa", icon: "🏠" },
] as const;

/** Termos que descartam anúncios por categoria (acessórios, peças, usados). */
export const EXCLUDE_BY_CATEGORY: Record<string, string[]> = {
  _all: ["usado", "seminovo", "recondicionado", "vitrine", "refurbished", "reembalado"],
  celular: ["capa", "capinha", "pelicula", "case", "carregador", "cabo", "suporte", "lente", "tela para", "bateria para", "kit pelicula"],
  tv: ["suporte", "controle remoto", "cabo", "antena", "conversor", "tela para", "placa", "painel", "rack", "estante", "home theater", "tv box", "projetor", "capa para tv", "para tv", "receptor", "monitor"],
  notebook: ["capa", "mochila", "case", "suporte", "carregador", "fonte", "bateria", "teclado para", "pelicula", "tela para", "para notebook"],
  console: ["capa", "skin", "adesivo", "suporte", "base de carregamento", "cabo", "pelicula", "case", "volante", "cooler", "para playstation", "para ps5", "para xbox", "para nintendo", "compativel"],
  controle: ["capa", "case", "skin", "adesivo", "suporte", "base de carregamento", "carregador", "dock", "cabo", "pelicula", "grip", "thumb", "bateria", "para controle", "controle remoto", "estojo", "bolsa", "botoes de reposicao", "reposicao", "reparo", "peca", "kit de botoes", "volante"],
  fone: ["capa", "case", "espuma", "almofada", "cabo", "estojo"],
  tablet: ["capa", "case", "pelicula", "teclado para", "caneta para", "suporte"],
  smartwatch: ["pulseira", "pelicula", "case", "carregador", "capa"],
  monitor: ["suporte", "cabo", "braco"],
  "placa-de-video": ["suporte", "cabo", "backplate", "cooler para"],
  casa: ["peca", "filtro para", "acessorio", "cesto para", "forma para"],
};

const c = (
  category: string,
  brand: string,
  name: string,
  must: string[],
  min: number,
  query = name,
): CatalogItem => ({ category, brand, name, query, must, min });

export const CATALOG: CatalogItem[] = [
  // Celular
  c("celular", "Apple", "iPhone 17 128GB", ["iphone 17", "128gb|128 gb"], 3500),
  c("celular", "Apple", "iPhone 17 256GB", ["iphone 17", "256gb|256 gb"], 3800),
  c("celular", "Apple", "iPhone 17 Pro 256GB", ["iphone 17 pro", "256gb|256 gb"], 5500),
  c("celular", "Apple", "iPhone 17 Pro Max 256GB", ["iphone 17 pro max", "256gb|256 gb"], 6000),
  c("celular", "Apple", "iPhone Air 256GB", ["iphone air", "256gb|256 gb"], 4500),
  c("celular", "Apple", "iPhone 16 128GB", ["iphone 16", "128gb|128 gb"], 3000),
  c("celular", "Apple", "iPhone 16e 128GB", ["iphone 16e", "128gb|128 gb"], 2500),
  c("celular", "Apple", "iPhone 15 128GB", ["iphone 15", "128gb|128 gb"], 2500),
  c("celular", "Samsung", "Galaxy S26 Ultra 256GB", ["s26 ultra", "256gb|256 gb"], 4500),
  c("celular", "Samsung", "Galaxy S26 256GB", ["galaxy s26", "256gb|256 gb"], 3000),
  c("celular", "Samsung", "Galaxy S25 FE 256GB", ["s25 fe", "256gb|256 gb"], 1800),
  c("celular", "Samsung", "Galaxy S25 Ultra 256GB", ["s25 ultra", "256gb|256 gb"], 3800),
  c("celular", "Samsung", "Galaxy A56 5G 256GB", ["a56", "256gb|256 gb"], 1200),
  c("celular", "Samsung", "Galaxy A36 5G 256GB", ["a36", "256gb|256 gb"], 1000),
  c("celular", "Motorola", "Motorola Edge 60 Pro 256GB", ["edge 60 pro", "256gb|256 gb"], 1500),
  c("celular", "Motorola", "Moto G86 5G 256GB", ["g86", "256gb|256 gb"], 900),
  c("celular", "Xiaomi", "Redmi Note 15 Pro 256GB", ["redmi note 15 pro", "256gb|256 gb"], 1200),
  c("celular", "Xiaomi", "Poco F7 512GB", ["poco f7", "512gb|512 gb"], 1800),
  // TV
  c("tv", "Qualquer marca", 'Smart TV 50" (qualquer marca)', ["tv", "50"], 1000, "smart tv 50 polegadas"),
  c("tv", "Qualquer marca", 'Smart TV 55" (qualquer marca)', ["tv", "55"], 1300, "smart tv 55 polegadas"),
  c("tv", "Qualquer marca", 'Smart TV 65" (qualquer marca)', ["tv", "65"], 2000, "smart tv 65 polegadas"),
  c("tv", "Samsung", 'Smart TV Samsung 55" Crystal UHD 4K', ["samsung", "55", "4k|uhd"], 1800, "smart tv samsung 55 4k"),
  c("tv", "Samsung", 'Smart TV Samsung 65" QLED 4K', ["samsung", "65", "qled"], 3000, "smart tv samsung 65 qled"),
  c("tv", "Samsung", 'Smart TV Samsung 65" OLED 4K', ["samsung", "65", "oled"], 5000, "smart tv samsung 65 oled"),
  c("tv", "LG", 'Smart TV LG 55" OLED evo 4K', ["lg", "55", "oled"], 3800, "smart tv lg oled 55"),
  c("tv", "LG", 'Smart TV LG 65" QNED 4K', ["lg", "65", "qned"], 3000, "smart tv lg 65 qned"),
  c("tv", "LG", 'Smart TV LG 50" UHD 4K', ["lg", "50", "4k|uhd"], 1600, "smart tv lg 50 4k"),
  c("tv", "TCL", 'Smart TV TCL 65" QLED 4K', ["tcl", "65", "qled"], 2200, "smart tv tcl 65 qled"),
  c("tv", "TCL", 'Smart TV TCL 55" Mini LED 4K', ["tcl", "55", "mini led"], 2500, "smart tv tcl 55 mini led"),
  c("tv", "Philips", 'Smart TV Philips 50" 4K', ["philips", "50", "4k|uhd"], 1400, "smart tv philips 50 4k"),
  // Notebook
  c("notebook", "Apple", "MacBook Air M4 13\" 16GB 256GB", ["macbook air", "m4"], 6000, "macbook air m4"),
  c("notebook", "Apple", "MacBook Air M4 15\" 16GB 512GB", ["macbook air", "m4", "15"], 8000, "macbook air m4 15"),
  c("notebook", "Apple", "MacBook Pro M5 14\"", ["macbook pro", "m5"], 10000, "macbook pro m5"),
  c("notebook", "Lenovo", "Lenovo IdeaPad Slim 3 Ryzen 7", ["ideapad", "ryzen 7"], 2500, "notebook lenovo ideapad slim 3 ryzen 7"),
  c("notebook", "Lenovo", "Lenovo LOQ RTX 4050", ["loq", "rtx 4050|rtx4050"], 4000, "notebook lenovo loq rtx 4050"),
  c("notebook", "Acer", "Acer Nitro V15 RTX 4050", ["nitro", "rtx 4050|rtx4050"], 4000, "notebook acer nitro v15 rtx 4050"),
  c("notebook", "Acer", "Acer Aspire Go 15 Core i5", ["aspire", "i5"], 2000, "notebook acer aspire go 15 i5"),
  c("notebook", "Dell", "Dell Inspiron 15 Core i7", ["inspiron", "i7"], 3500, "notebook dell inspiron 15 i7"),
  c("notebook", "Dell", "Dell G15 RTX 4060", ["g15", "rtx 4060|rtx4060"], 5000, "notebook dell g15 rtx 4060"),
  c("notebook", "ASUS", "ASUS Vivobook 15 Core i5", ["vivobook", "i5"], 2000, "notebook asus vivobook 15 i5"),
  c("notebook", "ASUS", "ASUS TUF Gaming F15 RTX 4050", ["tuf", "rtx 4050|rtx4050"], 4000, "notebook asus tuf f15 rtx 4050"),
  c("notebook", "Samsung", "Samsung Galaxy Book4 Core i5", ["galaxy book4|galaxy book 4", "i5"], 2300, "notebook samsung galaxy book4 i5"),
  // Console
  c("console", "Sony", "PlayStation 5 Slim (com leitor)", ["playstation 5|ps5", "slim"], 2800, "console playstation 5 slim"),
  c("console", "Sony", "PlayStation 5 Slim Digital", ["playstation 5|ps5", "digital"], 2500, "console playstation 5 digital"),
  c("console", "Sony", "PlayStation 5 Pro", ["playstation 5 pro|ps5 pro"], 4500, "console playstation 5 pro"),
  c("console", "Microsoft", "Xbox Series X 1TB", ["xbox series x"], 3000, "console xbox series x"),
  c("console", "Microsoft", "Xbox Series S 512GB", ["xbox series s"], 1800, "console xbox series s"),
  c("console", "Nintendo", "Nintendo Switch 2", ["switch 2"], 2800, "console nintendo switch 2"),
  c("console", "Nintendo", "Nintendo Switch OLED", ["switch", "oled"], 1700, "console nintendo switch oled"),
  // Controle
  c("controle", "Sony", "Controle DualSense PS5", ["dualsense"], 300, "controle dualsense ps5"),
  c("controle", "Sony", "Controle DualSense Edge", ["dualsense edge"], 900, "controle dualsense edge"),
  c("controle", "Microsoft", "Controle Xbox Series sem fio", ["xbox", "controle|controller"], 300, "controle xbox series sem fio"),
  c("controle", "Microsoft", "Controle Xbox Elite Series 2", ["xbox", "elite"], 800, "controle xbox elite series 2"),
  c("controle", "Nintendo", "Controle Pro Nintendo Switch 2", ["switch 2", "pro"], 350, "controle pro nintendo switch 2"),
  c("controle", "GameSir", "GameSir G7 Pro", ["gamesir", "g7 pro"], 200, "gamesir g7 pro"),
  c("controle", "GameSir", "GameSir Cyclone 2", ["gamesir", "cyclone 2"], 150, "gamesir cyclone 2"),
  c("controle", "GameSir", "GameSir Tarantula Pro", ["gamesir", "tarantula"], 150, "gamesir tarantula pro"),
  c("controle", "8BitDo", "8BitDo Ultimate 2", ["8bitdo", "ultimate 2"], 150, "8bitdo ultimate 2"),
  c("controle", "8BitDo", "8BitDo Ultimate 2C", ["8bitdo", "ultimate 2c"], 80, "8bitdo ultimate 2c"),
  c("controle", "Flydigi", "Flydigi Vader 4 Pro", ["flydigi", "vader 4"], 250, "flydigi vader 4 pro"),
  c("controle", "Flydigi", "Flydigi Vader 5 Pro", ["flydigi", "vader 5"], 300, "flydigi vader 5 pro"),
  c("controle", "Flydigi", "Flydigi Apex 4", ["flydigi", "apex 4"], 400, "flydigi apex 4"),
  c("console", "Valve", "Steam Deck OLED 512GB", ["steam deck", "oled"], 3000, "steam deck oled"),
  // Fone
  c("fone", "Apple", "AirPods Pro 3", ["airpods pro 3|airpods pro 3a geracao|airpods pro terceira"], 1500, "airpods pro 3"),
  c("fone", "Apple", "AirPods 4 com Cancelamento de Ruído", ["airpods 4"], 800, "airpods 4"),
  c("fone", "Sony", "Sony WH-1000XM6", ["1000xm6|1000 xm6"], 1800, "sony wh-1000xm6"),
  c("fone", "Sony", "Sony WH-1000XM5", ["1000xm5|1000 xm5"], 1300, "sony wh-1000xm5"),
  c("fone", "Samsung", "Galaxy Buds3 Pro", ["buds3 pro|buds 3 pro"], 700, "galaxy buds3 pro"),
  c("fone", "JBL", "JBL Tune 770NC", ["770nc|770 nc"], 300, "jbl tune 770nc"),
  // Tablet
  c("tablet", "Apple", "iPad 11ª geração 128GB", ["ipad", "128gb|128 gb"], 2200, "ipad 11 geracao 128gb"),
  c("tablet", "Apple", "iPad Air M3 11\" 128GB", ["ipad air", "m3"], 4000, "ipad air m3"),
  c("tablet", "Samsung", "Galaxy Tab S10 FE 128GB", ["tab s10 fe"], 1800, "galaxy tab s10 fe"),
  c("tablet", "Xiaomi", "Xiaomi Pad 7 256GB", ["pad 7"], 1500, "xiaomi pad 7"),
  // Smartwatch
  c("smartwatch", "Apple", "Apple Watch Series 11 GPS", ["watch series 11"], 2500, "apple watch series 11"),
  c("smartwatch", "Apple", "Apple Watch SE 3", ["watch se 3|watch se 3a"], 1500, "apple watch se 3"),
  c("smartwatch", "Samsung", "Galaxy Watch8", ["galaxy watch8|galaxy watch 8"], 1200, "galaxy watch8"),
  c("smartwatch", "Xiaomi", "Xiaomi Smart Band 10", ["band 10"], 200, "xiaomi smart band 10"),
  // Monitor
  c("monitor", "LG", 'Monitor LG UltraGear 27" 180Hz', ["lg", "ultragear", "27"], 700, "monitor lg ultragear 27"),
  c("monitor", "Samsung", 'Monitor Samsung Odyssey G5 27"', ["odyssey", "g5", "27"], 900, "monitor samsung odyssey g5 27"),
  c("monitor", "AOC", 'Monitor AOC Hero 27" 180Hz', ["aoc", "hero", "27"], 600, "monitor aoc hero 27"),
  // Placa de vídeo
  c("placa-de-video", "NVIDIA", "RTX 5060 8GB", ["rtx 5060|rtx5060"], 1600, "placa de video rtx 5060"),
  c("placa-de-video", "NVIDIA", "RTX 5070 12GB", ["rtx 5070|rtx5070"], 3000, "placa de video rtx 5070"),
  c("placa-de-video", "NVIDIA", "RTX 5070 Ti 16GB", ["rtx 5070 ti|rtx5070 ti|rtx 5070ti"], 4500, "placa de video rtx 5070 ti"),
  c("placa-de-video", "AMD", "RX 9070 XT 16GB", ["9070 xt|9070xt"], 3500, "placa de video rx 9070 xt"),
  c("placa-de-video", "AMD", "RX 9060 XT 16GB", ["9060 xt|9060xt"], 1800, "placa de video rx 9060 xt"),
  // Casa
  c("casa", "Mondial", "Air Fryer Mondial 5L", ["air fryer|fritadeira", "mondial"], 200, "air fryer mondial"),
  c("casa", "Philips Walita", "Air Fryer Philips Walita", ["air fryer|airfryer|fritadeira", "philips|walita"], 300, "air fryer philips walita"),
  c("casa", "Electrolux", "Robô Aspirador Electrolux", ["robo aspirador|aspirador robo", "electrolux"], 600, "robo aspirador electrolux"),
  c("casa", "Xiaomi", "Robô Aspirador Xiaomi", ["robo aspirador|aspirador robo|robot vacuum", "xiaomi"], 900, "robo aspirador xiaomi"),
];

const indexed = CATALOG.map((item) => ({
  item,
  words: norm(`${item.category} ${CATEGORIES.find((x) => x.id === item.category)?.label ?? ""} ${item.brand} ${item.name}`).split(" "),
}));

/** Autocomplete: todas as palavras digitadas precisam casar (por prefixo) com alguma palavra do item. */
export function suggest(q: string, limit = 10): CatalogItem[] {
  const tokens = norm(q).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const scored: { item: CatalogItem; score: number }[] = [];
  for (const { item, words } of indexed) {
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      const exact = words.includes(t);
      const prefix = !exact && words.some((w) => w.startsWith(t));
      if (!exact && !prefix) { ok = false; break; }
      score += exact ? 2 : 1;
    }
    if (ok) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}

export function brandsFor(category: string): string[] {
  return [...new Set(CATALOG.filter((i) => i.category === category).map((i) => i.brand))];
}
