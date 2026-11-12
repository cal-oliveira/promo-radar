const $ = (s) => document.querySelector(s);
const brl = (v) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (iso) => {
  if (!iso) return "nunca";
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
};
const minutesSince = (iso) => (iso ? (Date.now() - new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z")) / 60000 : Infinity);
/** "11:16" se for hoje; "12/11 11:16" se for outro dia (hora local). */
const clock = (iso) => {
  if (!iso) return "";
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const hm = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return t.toDateString() === new Date().toDateString() ? hm : `${t.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
};
/** Teste no checkout vale como "funcionando agora" por 1 h; depois pede novo teste. */
const FRESH_MIN = 60;
/** Etiqueta de preço: "R$" pequeno, reais condensados, centavos sobrescritos. */
const priceTag = (v, extra = "") => {
  if (v == null) return `<span class="tag tag-none ${extra}"><span class="int">aguardando</span></span>`;
  const [int, cents] = v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(",");
  return `<span class="tag ${extra}" aria-label="${brl(v)}"><span class="cur">R$</span><span class="int">${int}</span><span class="cents">${cents}</span></span>`;
};
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};

/* ---------------- Tema claro/escuro ---------------- */
const themeMedia = matchMedia("(prefers-color-scheme: dark)");
const savedTheme = () => { try { return localStorage.getItem("theme"); } catch { return null; } };
const currentTheme = () => document.documentElement.dataset.theme || (themeMedia.matches ? "dark" : "light");
function paintThemeToggle() {
  const dark = currentTheme() === "dark";
  const b = $("#theme-toggle");
  b.setAttribute("aria-checked", String(dark));
  b.setAttribute("aria-label", dark ? "Modo escuro ativo — mudar para claro" : "Modo claro ativo — mudar para escuro");
}
$("#theme-toggle").onclick = () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  paintThemeToggle();
};
// Sem escolha salva, acompanha o tema do sistema em tempo real.
themeMedia.addEventListener("change", () => { if (!savedTheme()) paintThemeToggle(); });
paintThemeToggle();

/* ---------------- Validação com Claude ---------------- */
const VLABEL = {
  na_fila: "Na fila para o Claude validar no checkout",
  validando: "Claude está testando no checkout do seu Chrome",
  valido: "Funcionou no checkout",
  sem_cupom: "Preço confirmado, cupom não aplicou",
  invalido: "Não vale mais",
  bloqueado: "Claude parou: a loja pediu login ou captcha",
  erro: "Validação falhou",
  pausado: "Na espera: limite de uso do Claude",
};
const vBadge = (a) => (a.validation_status ? `<span class="vstatus ${a.validation_status}">${VLABEL[a.validation_status] ?? a.validation_status}${a.validation_total ? `, ${brl(a.validation_total)}` : ""}</span>` : "");
function paintValidation(a) {
  const el = $("#alarm-validation");
  if (!a?.validation_status) { el.textContent = ""; return; }
  const busy = ["na_fila", "validando"].includes(a.validation_status);
  el.textContent = busy
    ? VLABEL[a.validation_status]
    : `${VLABEL[a.validation_status] ?? a.validation_status}${a.validation_total ? `: total ${brl(a.validation_total)}` : ""}${a.validation_message ? `. ${a.validation_message}` : ""}`;
  $("#alarm-validate").hidden = ["na_fila", "validando"].includes(a.validation_status);
}
$("#alarm-validate").onclick = async () => {
  if (!alarm.current) return;
  await api(`/api/alerts/${alarm.current.id}/validate`, { method: "POST" });
  refreshCurrentAlert();
};
async function refreshCurrentAlert() {
  if (!alarm.current) return;
  alarm.current = await api(`/api/alerts/${alarm.current.id}`);
  paintValidation(alarm.current);
}
async function loadSettings() {
  const s = await api("/api/settings");
  $("#auto-validate").checked = s.autoValidate;
}
$("#auto-validate").onchange = (e) => api("/api/settings", { method: "POST", body: { autoValidate: e.target.checked } });

/* ---------------- Alarme sonoro ---------------- */
const alarm = {
  ctx: null,
  timer: null,
  current: null,
  unlocked: false,
  async unlock() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.unlocked = this.ctx.state === "running";
    const b = $("#sound");
    b.textContent = this.unlocked ? "Som do alarme ligado" : "Ligar som do alarme";
    b.classList.toggle("on", this.unlocked);
  },
  beep() {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    // sirene de duas notas, alta o suficiente para ouvir de outro cômodo
    [[880, 0], [1320, 0.18], [880, 0.36], [1320, 0.54]].forEach(([f, d]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "square";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.17);
    });
  },
  /** "Plim" suave de duas notas, uma vez só: aviso de queda no anúncio. */
  chime() {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    [[659.25, 0], [987.77, 0.14]].forEach(([f, d]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.95);
    });
  },
  start(a) {
    this.current = a;
    $("#alarm-title").textContent = a.product_name;
    $("#alarm-tag").outerHTML = priceTag(a.new_price, a.kind === "checkout" ? "tag-alarm tag-ok" : "tag-alarm").replace('class="tag', 'id="alarm-tag" class="tag');
    const isCheckout = a.kind === "checkout";
    $(".alarm-kicker").textContent = isCheckout ? `Checkout abaixo do menor preço, testado às ${clock(a.tested_at ?? a.created_at)}` : "Preço abaixo do recorde";
    $("#alarm-detail").textContent = (isCheckout
      ? [
          `Na ${a.store.replace(/\s*\(via [^)]+\)/, "")}`,
          a.via ? `com ${a.via}` : null,
          a.old_price ? `${brl(a.old_price - a.new_price)} abaixo do menor preço visto (${brl(a.old_price)})` : null,
          "total com frete. Corra: cupom muda rápido",
        ]
      : [
          `Na ${a.store}`,
          a.old_price ? `${brl(a.old_price - a.new_price)} abaixo do recorde anterior (${brl(a.old_price)})` : null,
          a.coupon ? `com o cupom ${a.coupon}` : null,
        ]
    ).filter(Boolean).join(", ") + "." + (this.unlocked ? "" : " Clique em qualquer lugar para ouvir o alarme.");
    $("#alarm-open").href = a.url;
    $("#alarm-validate").hidden = isCheckout;
    if (isCheckout) $("#alarm-validation").textContent = "";
    else paintValidation(a);
    $("#alarm").hidden = false;
    clearInterval(this.timer);
    this.beep();
    this.timer = setInterval(() => this.beep(), 1500);
    flashTitle(true);
  },
  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    $("#alarm").hidden = true;
    flashTitle(false);
    if (this.current) await api("/api/alerts/ack", { method: "POST", body: { id: this.current.id } });
    this.current = null;
    checkAlerts(); // se houver outro alerta pendente, ele toca em seguida
    loadAlerts();
  },
};
let titleTimer;
function flashTitle(on) {
  clearInterval(titleTimer);
  document.title = "Promo Radar";
  if (on) titleTimer = setInterval(() => (document.title = document.title === "Preço caiu!" ? "Promo Radar" : "Preço caiu!"), 800);
}
$("#sound").onclick = () => alarm.unlock();
document.addEventListener("pointerdown", () => !alarm.unlocked && alarm.unlock(), { once: false });
$("#alarm-stop").onclick = () => alarm.stop();
$("#alarm-open").onclick = () => setTimeout(() => alarm.stop(), 300);

/* ---------------- Aviso discreto: queda no anúncio, teste no checkout em andamento ---------------- */
const notice = {
  current: null,
  show(a, { sound = false } = {}) {
    const changed = this.current?.id !== a.id;
    this.current = a;
    $("#notice-title").textContent = a.product_name;
    $("#notice-tag").innerHTML = priceTag(a.new_price, "tag-sm");
    $("#notice-detail").textContent = a.old_price ? `${brl(a.old_price - a.new_price)} abaixo do recorde (${brl(a.old_price)}). Preço da página, sem frete e impostos.` : "Preço da página, sem frete e impostos.";
    $("#notice-open").href = a.url;
    this.paint();
    $("#notice").hidden = false;
    if (sound && changed) alarm.chime();
  },
  paint() {
    const a = this.current;
    if (!a) return;
    const st = a.validation_status;
    const busy = ["na_fila", "validando"].includes(st);
    let text;
    if (!st) text = $("#auto-validate").checked ? "Iniciando o teste no checkout…" : "Teste automático desligado.";
    else if (busy) text = `${VLABEL[st]}. Se o checkout confirmar o preço, a sirene toca.`;
    else if (st === "valido" || st === "sem_cupom")
      text = a.validation_total != null
        ? a.validation_total <= a.new_price + 0.005
          ? `Checkout confirmou: ${brl(a.validation_total)}.`
          : `No checkout ficou ${brl(a.validation_total)}, com frete e impostos (o anúncio mostra ${brl(a.new_price)}).`
        : VLABEL[st];
    else text = `${VLABEL[st] ?? st}${a.validation_message ? `. ${a.validation_message}` : ""}`;
    $("#notice-status").textContent = text;
    $("#notice-status").className = `n-status vstatus ${st ?? "na_fila"}`;
    $("#notice-test").hidden = busy || st === "valido" || st === "sem_cupom" || (!st && $("#auto-validate").checked);
  },
  async refresh() {
    if (!this.current) return;
    this.current = { ...this.current, ...(await api(`/api/alerts/${this.current.id}`)) };
    this.paint();
  },
  async close() {
    $("#notice").hidden = true;
    const open = await api("/api/alerts?open=1");
    for (const a of open.filter((x) => x.kind !== "checkout")) await api("/api/alerts/ack", { method: "POST", body: { id: a.id } });
    this.current = null;
    loadAlerts();
  },
};
$("#notice-close").onclick = () => notice.close();
$("#notice-test").onclick = async () => {
  if (!notice.current) return;
  await api(`/api/alerts/${notice.current.id}/validate`, { method: "POST" });
  notice.refresh();
};

/**
 * Alertas em aberto: sirene (faixa vermelha) só para checkout confirmado;
 * queda no anúncio vira o aviso discreto. `sound` só quando chega um alerta novo ao vivo.
 */
async function checkAlerts({ sound = false } = {}) {
  const open = await api("/api/alerts?open=1");
  const price = open.filter((a) => a.kind !== "checkout");
  if (price.length) notice.show(price[0], { sound });
  const loud = open.filter((a) => a.kind === "checkout");
  if (!alarm.current && loud.length) alarm.start(loud[loud.length - 1]);
}

/* ---------------- Busca e sugestões ---------------- */
let categories = [];
let activeCat = null;
let suggestions = [];
let sel = -1;

async function loadCategories() {
  categories = await api("/api/categories");
  $("#cats").innerHTML = categories
    .map((c) => `<button class="chip" data-cat="${c.id}">${esc(c.label)}</button>`)
    .join("");
  $("#cats").onclick = (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    activeCat = activeCat === b.dataset.cat ? null : b.dataset.cat;
    renderBrands();
    const cat = categories.find((c) => c.id === activeCat);
    $("#q").value = cat ? cat.label : "";
    $("#q").focus();
    runSuggest();
  };
}
function renderBrands() {
  document.querySelectorAll("#cats .chip").forEach((b) => b.classList.toggle("active", b.dataset.cat === activeCat));
  const cat = categories.find((c) => c.id === activeCat);
  $("#brands").innerHTML = cat ? `<span class="lead">Marcas</span>` + cat.brands.map((b) => `<button class="chip" data-brand="${esc(b)}">${esc(b)}</button>`).join("") : "";
}
$("#brands").onclick = (e) => {
  const b = e.target.closest("[data-brand]");
  if (!b) return;
  const cat = categories.find((c) => c.id === activeCat);
  $("#q").value = `${cat.label} ${b.dataset.brand}`;
  $("#q").focus();
  runSuggest();
};

/* Texto normalizado igual ao do servidor (src/text.ts), para prever o filtro no navegador. */
const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[®™]/g, "").replace(/(\d)[.,](?=\d)/g, "$1_").replace(/[^a-z0-9_]+/g, " ").trim();
const hasPhrase = (text, phrase) => ` ${text} `.includes(` ${phrase} `);

// Lista unificada do autocomplete: catálogo, texto livre e anúncios reais (com foto).
let entries = [];
let live = { q: "", fast: null, slow: null };
let liveTimer;

let debounce;
$("#q").addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(runSuggest, 120);
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runLive, 450);
});
$("#q").addEventListener("focus", () => { if ($("#q").value.trim()) renderSugg(); });
$("#q").addEventListener("keydown", (e) => {
  const n = entries.length;
  if (!n) return;
  if (e.key === "ArrowDown") { sel = (sel + 1) % n; paintSel(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel = (sel - 1 + n) % n; paintSel(); e.preventDefault(); }
  else if (e.key === "Enter") { e.preventDefault(); choose(sel < 0 ? 0 : sel); }
  else if (e.key === "Escape") closeSugg();
});
$("#q").addEventListener("blur", () => setTimeout(closeSugg, 150));

async function runSuggest() {
  const q = $("#q").value.trim();
  if (!q) { suggestions = []; return closeSugg(); }
  suggestions = await api(`/api/suggest?q=${encodeURIComponent(q)}`);
  renderSugg();
}

async function runLive() {
  const q = $("#q").value.trim();
  if (q.length < 3) { live = { q, fast: [], slow: [] }; return renderSugg(); }
  if (live.q === q && live.fast) return;
  live = { q, fast: null, slow: null };
  renderSugg();
  const enc = encodeURIComponent(q);
  api(`/api/lookup?q=${enc}&speed=fast`).then((r) => { if (live.q === q) { live.fast = r; renderSugg(); refreshPickPreview(); } });
  api(`/api/lookup?q=${enc}&speed=slow`).then((r) => { if (live.q === q) { live.slow = r; renderSugg(); refreshPickPreview(); } });
}
const liveItems = () => [...(live.fast ?? []), ...(live.slow ?? [])];

/** Quantas palavras digitadas o título tem ("16" vale para "16,1"). */
function relevance(title, qWords) {
  const t = norm(title);
  return qWords.filter((w) => hasPhrase(t, w) || (/^\d+$/.test(w) && new RegExp(`(^| )${w}_\\d`).test(t))).length;
}
/** As lojas devolvem muito item solto: mostra primeiro quem tem todas as palavras, e corta quem não tem nenhuma. */
function rankLive(q) {
  const qWords = norm(q).split(" ").filter((w) => w && !STOPWORDS.has(w));
  const scored = liveItems().map((a, i) => ({ a, i, r: relevance(a.title, qWords) }));
  const strong = scored.filter((x) => x.r > 0);
  return (strong.length >= 3 ? strong : scored)
    .sort((x, y) => y.r - x.r || x.a.price - y.a.price)
    .map((x) => x.a);
}

function renderSugg() {
  const q = $("#q").value.trim();
  if (!q) return closeSugg();
  const cat = suggestions.slice(0, 5);
  const ads = rankLive(q).slice(0, 15);
  entries = [
    ...ads.map((a) => ({ type: "live", data: a })),
    ...cat.map((c) => ({ type: "catalog", data: c })),
    { type: "free", data: q },
  ];
  const loading = q.length >= 3 && (live.fast == null || live.slow == null);
  let idx = 0;
  const li = (inner, cls = "") => `<li role="option" class="${cls}" data-i="${idx++}">${inner}</li>`;
  const adsHtml = ads
    .map((a) =>
      li(
        `${a.image ? `<img class="s-img" src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : `<span class="s-img"></span>`}
         <span class="s-body"><span class="s-title">${esc(a.title)}</span><span class="s-meta">${esc(a.store.replace(/\s*\(via [^)]+\)/, ""))}</span></span>
         <span class="s-price">${brl(a.price)}</span>`,
        "ad",
      ),
    )
    .join("");
  const catHtml = cat.map((c) => li(`<span class="s-name">${esc(c.name)}</span><span class="s-meta">filtro pronto, ignora anúncios abaixo de ${brl(c.min)}</span>`)).join("");
  const freeHtml = li(`<span class="s-name">Monitorar <strong>${esc(q)}</strong> como digitado</span><span class="s-meta">sem filtros prontos</span>`, "free");
  $("#sugg").innerHTML =
    (q.length >= 3
      ? `<li class="s-group" role="presentation">Anúncios agora${loading ? `<span class="s-loading">buscando nas lojas…</span>` : ""}</li>` +
        (adsHtml || (loading ? "" : `<li class="s-empty" role="presentation">Nenhum anúncio encontrado para “${esc(q)}”.</li>`))
      : "") +
    (catHtml ? `<li class="s-group" role="presentation">Catálogo</li>${catHtml}` : "") +
    freeHtml;
  sel = Math.min(sel, entries.length - 1);
  paintSel();
  $("#sugg").hidden = false;
  $("#q").setAttribute("aria-expanded", "true");
  $("#sugg").onmousedown = (e) => {
    const el = e.target.closest("li[data-i]");
    if (el) { e.preventDefault(); choose(Number(el.dataset.i)); }
  };
}
function paintSel() {
  document.querySelectorAll("#sugg li[data-i]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.i) === sel)));
}
function closeSugg() {
  $("#sugg").hidden = true;
  $("#q").setAttribute("aria-expanded", "false");
  sel = -1;
}
async function choose(i) {
  const en = entries[i];
  if (!en) return;
  closeSugg();
  if (en.type === "live") return openPick(en.data);
  const body = en.type === "catalog" ? { name: en.data.name, catalog: true } : { name: en.data, category: activeCat };
  await api("/api/products", { method: "POST", body });
  $("#q").value = "";
  loadProducts();
}

/* ---------------- Confirmar o anúncio escolhido ---------------- */
const STOPWORDS = new Set("de da do das dos com sem e para o a os as em no na por ou the and for with new novo original oficial produto".split(" "));
const SPEC = /^\d+(?:_\d+)?(p|k|hz|gb|tb|mah|w|mm|cm|ms|cd|nits|v|g|m|x|pcs)$/;
let pick = null;

/** Palavras do título viram opções de filtro; já marca as que identificam o modelo. */
/** Palavras genéricas: não identificam modelo ("controle", "sem fio", "monitor"...). */
const GENERIC = new Set(
  ("controle controlador controller gamepad joystick sem fio wireless bluetooth monitor portatil smart tv celular smartphone " +
   "fone ouvido headset jogo jogos gamer game games tela display notebook tablet relogio smartwatch kit preto branco cinza azul " +
   "vermelho verde rosa cor edicao edition versao version modelo pc android ios iphone switch nintendo xbox playstation ps4 ps5 usb tipo type").split(" "),
);

/**
 * Palavras do título viram opções de filtro. Já marca:
 * - as palavras digitadas (e "16,1" quando se digitou "16");
 * - códigos de modelo com letras e números (Z1C, 50UN85);
 * - o nome do modelo logo depois da marca, como uma expressão só ("nova lite" em "GameSir Nova Lite").
 */
function pickTerms(title, q) {
  const words = String(title).match(/[\p{L}\p{N}]+(?:[.,]\p{N}+)*\p{L}*/gu) ?? [];
  const seen = new Set();
  const terms = [];
  const qWords = norm(q).split(" ").filter((w) => w && !STOPWORDS.has(w));
  const toks = norm(title).split(" ");
  // Nome do modelo: depois da marca (palavra digitada que não é genérica), até 3 palavras não genéricas.
  const brand = qWords.find((w) => !GENERIC.has(w) && !/^\d+$/.test(w) && toks.includes(w));
  let phrase = null;
  if (brand) {
    const k = toks.indexOf(brand);
    const tail = [];
    for (let i = k + 1; i < toks.length && tail.length < 3; i++) {
      const t = toks[i];
      if (STOPWORDS.has(t) || GENERIC.has(t) || SPEC.test(t)) break;
      tail.push(t);
    }
    if (tail.length) phrase = tail.join(" ");
  }
  if (phrase && phrase.includes(" ")) {
    terms.push({ label: phrase.replace(/\b\w/g, (c) => c.toUpperCase()), n: phrase, on: true, phrase: true });
    seen.add(phrase);
  }
  for (const w of words) {
    const n = norm(w);
    if (!n || (n.length < 2 && !/\d/.test(n)) || STOPWORDS.has(n) || seen.has(n)) continue;
    seen.add(n);
    terms.push({ label: w, n, on: false });
    if (terms.length >= 30) break;
  }
  for (const t of terms) {
    if (t.phrase) continue;
    const isModel = /[a-z]/.test(t.n) && /\d/.test(t.n) && !t.n.includes(" ") && !t.n.includes("_") && !SPEC.test(t.n) && t.n.length <= 12;
    const fromQuery = qWords.some((w) => w === t.n || (/^\d+$/.test(w) && t.n.startsWith(`${w}_`)));
    // Nome de modelo de uma palavra só (ex.: "GameSir Cyclone") também conta.
    const isPhrase = phrase === t.n;
    // Palavras já cobertas pela expressão do modelo não precisam ser marcadas de novo.
    const inPhrase = phrase && phrase.includes(" ") && phrase.split(" ").includes(t.n);
    // Com nome de modelo identificado, palavra genérica digitada ("gamepad", "controle") não é exigida:
    // muitos anúncios do mesmo modelo usam outra palavra.
    const genericQuery = fromQuery && GENERIC.has(t.n) && !!phrase;
    t.on = !inPhrase && !genericQuery && (fromQuery || isModel || isPhrase);
  }
  for (const w of qWords) {
    if (/^\d+$/.test(w)) {
      const exact = terms.find((t) => t.n === w);
      if (exact && terms.some((t) => t.on && t.n.startsWith(`${w}_`))) exact.on = false;
    }
  }
  return terms;
}

/**
 * Sugere exclusões para variações vizinhas: se o modelo escolhido é "nova lite" e há anúncios
 * de "nova lite 2" ou "nova lite pro", propõe ignorar essas expressões.
 */
function suggestExclusions(refTitle, terms, pool) {
  // Tokens com decimais juntos ("2.4g" vira "24g"), para "Nova Lite 2.4G" não parecer "Nova Lite 2".
  const toks = (title) => norm(title).split(" ");
  const ref = toks(refTitle);
  const out = new Map();
  // Só nomes/códigos de modelo geram sugestão ("nova lite" -> "nova lite 2"); palavras genéricas não.
  for (const t of terms.filter((x) => x.on && (x.phrase || (/[a-z]/.test(x.n) && /\d/.test(x.n))))) {
    const parts = t.n.split(" ");
    const after = (toks) => {
      for (let i = 0; i + parts.length <= toks.length; i++) {
        if (parts.every((p, j) => toks[i + j] === p)) return toks[i + parts.length] ?? null;
      }
      return undefined;
    };
    const refNext = after(ref);
    for (const a of pool) {
      const nx = after(toks(a.title));
      if (!nx || nx === refNext) continue;
      if (/^\d{1,2}$/.test(nx) || /^(pro|max|plus|ultra|mini|se|lite|elite|s|x|e|neo|air)$/.test(nx)) {
        const ex = `${t.n} ${nx}`;
        if (!ref.join(" ").includes(ex)) out.set(ex, true);
      }
    }
  }
  return [...out.keys()].slice(0, 8);
}

/**
 * Painel de filtro. Modo "novo" (anúncio escolhido na busca) ou "editar" (produto já monitorado,
 * com os anúncios que ele já coletou como prévia).
 */
function openPick(item, edit = null) {
  const q = edit ? edit.query : $("#q").value.trim();
  const terms = pickTerms(item.title, q);
  if (edit) {
    // Mantém o filtro atual e ainda sugere o nome do modelo, se ele não estava no filtro.
    const hasPhrase = terms.some((t) => t.phrase && t.on);
    for (const t of terms) t.on = (edit.must.includes(t.n) && !(hasPhrase && GENERIC.has(t.n))) || (t.phrase && t.on);
    for (const m of edit.must) if (!terms.some((t) => t.n === m)) terms.unshift({ label: m, n: m, on: true, phrase: m.includes(" ") });
  }
  pick = { item, q, edit, terms, min: edit ? edit.min ?? 0 : Math.floor(item.price * 0.6), excl: (edit?.exclude ?? []).map((n) => ({ n, on: true })) };
  for (const n of suggestExclusions(item.title, terms, pickPool())) if (!pick.excl.some((x) => x.n === n)) pick.excl.push({ n, on: true, auto: true });
  const short = edit ? edit.name : item.title.length > 60 ? item.title.slice(0, 60).replace(/\s+\S*$/, "") : item.title;
  const el = $("#pick");
  el.innerHTML = `
    <div class="pick-head">
      ${item.image ? `<img class="pick-img" src="${esc(item.image)}" alt="" referrerpolicy="no-referrer" />` : ""}
      <div class="pick-info">
        <p class="pick-mode">${edit ? "Editando o filtro de um produto monitorado" : "Anúncio escolhido"}</p>
        <a class="pick-title" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
        <p class="pick-sub">${brl(item.price)} no ${esc(item.store.replace(/\s*\(via [^)]+\)/, ""))}</p>
      </div>
      <button class="link-btn" id="pick-cancel">Cancelar</button>
    </div>
    <div class="pick-form">
      <label class="pick-field">Nome no painel <input id="pick-name" value="${esc(short)}" /></label>
      <div class="pick-field">
        <span id="pick-terms-label">Todo anúncio monitorado precisa ter estas palavras</span>
        <div class="terms" id="pick-terms" role="group" aria-labelledby="pick-terms-label"></div>
      </div>
      <div class="pick-field">
        <span id="pick-excl-label">Ignorar anúncios com</span>
        <div class="terms excl" id="pick-excl" role="group" aria-labelledby="pick-excl-label"></div>
        <form id="pick-excl-form" class="excl-add"><input id="pick-excl-input" placeholder="ex.: lite 2, pro, 17,3" aria-label="Adicionar palavra ou expressão para ignorar" /><button class="btn btn-quiet" type="submit">Adicionar</button></form>
      </div>
      <label class="pick-field pick-min">Ignorar anúncios abaixo de <span class="money">R$ <input id="pick-min" type="number" min="0" step="1" value="${pick.min}" /></span></label>
    </div>
    <div class="pick-preview">
      <p id="pick-count" class="pick-count"></p>
      <ul id="pick-list" class="pick-list"></ul>
    </div>
    <div class="pick-actions">
      <button class="btn btn-ink" id="pick-go">${edit ? "Salvar filtro" : "Monitorar este produto"}</button>
    </div>`;
  el.hidden = false;
  paintPickChips();
  refreshPickPreview();
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: edit ? "start" : "nearest" });
  $("#pick-cancel").onclick = closePick;
  $("#pick-terms").onclick = (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    const t = pick.terms[Number(b.dataset.t)];
    t.on = !t.on;
    paintPickChips();
    refreshPickPreview();
  };
  $("#pick-excl").onclick = (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    const x = pick.excl[Number(b.dataset.x)];
    x.on = !x.on;
    paintPickChips();
    refreshPickPreview();
  };
  $("#pick-excl-form").onsubmit = (e) => {
    e.preventDefault();
    for (const part of $("#pick-excl-input").value.split(",")) {
      const n = norm(part);
      if (n && !pick.excl.some((x) => x.n === n)) pick.excl.push({ n, on: true });
    }
    $("#pick-excl-input").value = "";
    paintPickChips();
    refreshPickPreview();
  };
  $("#pick-min").oninput = (e) => { pick.min = Number(e.target.value) || 0; refreshPickPreview(); };
  $("#pick-go").onclick = submitPick;
}
function paintPickChips() {
  $("#pick-terms").innerHTML = pick.terms
    .map((t, i) => `<button type="button" class="term${t.phrase ? " phrase" : ""}" data-t="${i}" aria-pressed="${t.on}">${esc(t.label)}</button>`)
    .join("");
  $("#pick-excl").innerHTML = pick.excl.length
    ? pick.excl.map((x, i) => `<button type="button" class="term" data-x="${i}" aria-pressed="${x.on}" title="${x.auto ? "Sugerido: variação parecida encontrada na busca" : ""}">${esc(x.n)}</button>`).join("")
    : `<span class="muted">nada por enquanto</span>`;
}
function closePick() {
  pick = null;
  $("#pick").hidden = true;
  $("#pick").innerHTML = "";
}
const pickPool = () => (pick?.edit ? pick.edit.pool : liveItems().length ? liveItems() : pick ? [pick.item] : []);
const pickMatches = (a) => {
  const t = norm(a.title);
  return (
    pick.terms.every((x) => !x.on || hasPhrase(t, x.n)) &&
    pick.excl.every((x) => !x.on || !hasPhrase(t, x.n)) &&
    a.price >= pick.min
  );
};
function refreshPickPreview() {
  if (!pick) return;
  const all = pickPool();
  const ok = all.filter(pickMatches).sort((a, b) => a.price - b.price);
  const out = all.filter((a) => !pickMatches(a)).sort((a, b) => a.price - b.price);
  const chosen = pick.terms.filter((t) => t.on).length;
  $("#pick-count").innerHTML = !chosen
    ? `Marque ao menos uma palavra. Sem isso, qualquer anúncio da busca entraria no monitoramento.`
    : pick.edit
      ? `<strong>${ok.length} de ${all.length}</strong> anúncios já coletados batem com o filtro. Os riscados saem do histórico ao salvar, e o recorde é recalculado.`
      : `<strong>${ok.length} de ${all.length}</strong> anúncios desta busca batem com o filtro${live.slow == null ? " (KaBuM ainda carregando)" : ""}. Os riscados ficam de fora.`;
  const row = (a, inside) => `<li class="${inside ? "in" : "out"}">
      ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : `<span class="noimg"></span>`}
      <a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.title)}">${esc(a.title)}</a>
      <span class="pl-price">${brl(a.price)}</span></li>`;
  $("#pick-list").innerHTML = ok.map((a) => row(a, true)).join("") + out.slice(0, 20).map((a) => row(a, false)).join("");
  $("#pick-go").disabled = !chosen;
}
async function submitPick() {
  const must = pick.terms.filter((t) => t.on).map((t) => t.n);
  if (!must.length) return;
  const exclude = pick.excl.filter((x) => x.on).map((x) => x.n);
  const name = $("#pick-name").value.trim() || pick.item.title;
  if (pick.edit) {
    await api(`/api/products/${pick.edit.id}`, { method: "PATCH", body: { name, must, exclude, minPrice: pick.min || null } });
  } else {
    await api("/api/products", {
      method: "POST",
      body: { name, query: pick.q, must, exclude, minPrice: pick.min || null, category: activeCat, image: pick.item.image, refUrl: pick.item.url },
    });
    $("#q").value = "";
  }
  closePick();
  loadProducts();
}

/** "Editar filtro" de um produto: usa o anúncio de referência e o histórico de anúncios como prévia. */
async function editFilter(p) {
  const offers = await api(`/api/products/${p.id}/offers`);
  const pool = offers.map((o) => ({ title: o.title, url: o.url, store: o.store, price: o.final_price, image: o.image }));
  const ref = pool.find((o) => o.url === p.ref_url) ?? pool.find((o) => o.url === p.best?.url) ?? pool[0];
  if (!ref) return;
  openPick(ref, { id: p.id, name: p.name, query: p.query, must: p.must, exclude: p.exclude_extra ?? [], min: p.min_price, pool });
}

/* ---------------- Produtos ---------------- */
const scanning = new Set();

let productsById = new Map();
async function loadProducts() {
  const items = await api("/api/products");
  $("#count").textContent = items.length ? `${items.length} produto${items.length > 1 ? "s" : ""}` : "";
  $("#empty").hidden = items.length > 0;
  productsById = new Map(items.map((p) => [p.id, p]));
  $("#products").innerHTML = items.map(cardHtml).join("");
}
/** Selo verde: menor total que o Claude conseguiu de fato no checkout, com o que gerou o desconto e a hora do teste. */
function checkoutFlag(co, pid) {
  if (!co) return "";
  const fresh = minutesSince(co.at) < FRESH_MIN;
  const saving = co.listed - co.total;
  const how = co.code
    ? `com o cupom <button class="code" data-code="${esc(co.code)}" title="Copiar código">${esc(co.code)}</button>`
    : esc(co.via ?? "desconto aplicado pela própria loja");
  const detail = [co.code && co.via && co.via !== `cupom ${co.code}` ? co.via : null, saving >= 1 ? `${brl(saving)} a menos que o anúncio, já com frete` : "total com frete"]
    .filter(Boolean)
    .join(". ");
  return `<div class="price-col checkout${fresh ? "" : " stale"}">
    <p class="pc-head co-head">${fresh ? "Funcionando agora" : `Funcionou às ${clock(co.at)}`}</p>
    ${priceTag(co.total, "tag-ok")}
    <p class="tag-caption">Testado às <strong>${clock(co.at)}</strong>, ${ago(co.at)}${fresh ? "" : ". Teste de novo antes de comprar"}</p>
    <p class="tag-caption co-how" title="${esc(detail)}">${how}</p>
    <p class="co-actions">
      <button class="btn btn-ok" data-recipe="${pid}" aria-expanded="${openRecipes.has(pid)}">Ver como chegar</button>
      <button class="link-btn" data-test="${co.offer_id}">Testar de novo</button>
    </p>
  </div>`;
}

/** Receitas abertas sobrevivem ao re-render dos cards (que acontece a cada varredura). */
const openRecipes = new Set();
/** Passo a passo + resumo do checkout: como o usuário chega no mesmo total que o Claude. */
function recipeHtml(p) {
  const co = p.checkout;
  if (!co || !openRecipes.has(p.id)) return "";
  const steps = co.steps?.length
    ? `<ol class="r-steps">${co.steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`
    : `<p class="r-old">Este teste foi feito antes de o app guardar o passo a passo, então só há o resumo abaixo. Clique em <button class="link-btn" data-test="${co.offer_id}">Testar de novo</button> para gerar a receita completa.</p>
       ${co.message ? `<p class="r-msg">${esc(co.message)}</p>` : ""}`;
  const rows = (co.breakdown ?? [])
    .map((l) => `<tr class="${/total/i.test(l.label) ? "r-total" : l.amount < 0 ? "r-off" : ""}"><td>${esc(l.label)}</td><td class="num">${l.amount < 0 ? "−" + brl(-l.amount) : brl(l.amount)}</td></tr>`)
    .join("");
  return `<section class="recipe" aria-label="Como chegar no preço do checkout">
    <div class="r-col">
      <h4>Como chegar em ${brl(co.total)}</h4>
      ${co.code ? `<p class="r-code">Código: <button class="code" data-code="${esc(co.code)}" title="Copiar código">${esc(co.code)}</button></p>` : `<p class="r-code">Sem código: o desconto entrou sozinho.</p>`}
      ${steps}
      <p class="r-foot">Testado às ${clock(co.at)} na sua conta. Se o total for outro, confira se só este item está marcado no carrinho e se a variação e o frete são os mesmos. <a href="${esc(co.url)}" target="_blank" rel="noopener">Abrir o anúncio</a></p>
    </div>
    ${rows ? `<div class="r-col"><h4>Resumo do checkout no teste</h4><table class="r-sum">${rows}</table></div>` : ""}
  </section>`;
}

/** Sem teste ainda: o lugar da etiqueta verde explica que o total real só sai no checkout. */
function checkoutInvite(p) {
  if (!p.best) return "";
  const busy = ["na_fila", "validando"].includes(p.best.validation_status);
  return `<div class="price-col checkout invite">
    <p class="pc-head">Quanto fica de verdade</p>
    <p class="invite-box">${busy ? "Testando no checkout…" : "Frete, impostos e cupons só aparecem no checkout."}</p>
    ${busy ? "" : `<p class="co-actions"><button class="btn btn-ok" data-test="${p.best.id}">Testar no checkout</button></p>
    <p class="tag-caption">O Claude leva o menor anúncio até a tela de confirmação, sem comprar.</p>`}
  </div>`;
}

/** Cards com a lista de anúncios aberta (sobrevive ao re-render). */
const openOffers = new Set();
const OFFERS_SHOWN = 3;

function cardHtml(p) {
  const cat = categories.find((c) => c.id === p.category);
  const isScanning = scanning.has(p.id) || !p.baseline_done;
  const expanded = openOffers.has(p.id);
  const hiddenCount = Math.max(0, p.current.length - OFFERS_SHOWN);
  const rows = (expanded ? p.current : p.current.slice(0, OFFERS_SHOWN))
    .map((o) => {
      // "Amazon (via Promobit)" e "KaBuM! (GAZIN)": loja em destaque, origem/vendedor embaixo.
      const m = o.store.match(/^(.*?)\s*\(([^)]+)\)$/);
      const store = m ? m[1] : o.store;
      const sub = m ? (/^via /i.test(m[2]) ? m[2] : `vendido por ${m[2]}`) : "";
      const delta = p.best_price != null ? o.final_price - p.best_price : null;
      const extra = o.coupon ? `<span class="coupon-mark">cupom ${esc(o.coupon)}</span>` : o.note && !/^postado|^pre/.test(o.note) ? `<span class="note-mark">${esc(o.note.split(" · ")[0].slice(0, 30))}</span>` : "";
      const h = o.coupon_hint;
      // Oferta já testada: o resultado do checkout vale mais que o palpite.
      const hint = h && h.code !== o.coupon && !o.validation_status
        ? `<span class="coupon-mark hint" title="${h.min_order ? `vale a partir de ${brl(h.min_order)}` : "sem compra mínima conhecida"}">${esc(h.code)} −${brl(h.discount)}${h.status === "valido" ? ", aceito em outro teste" : ", não testado"}</span>`
        : "";
      const busy = ["na_fila", "validando"].includes(o.validation_status);
      const testBtn = busy
        ? `<span class="vstatus ${o.validation_status}">${o.validation_status === "na_fila" ? "Na fila" : "Testando…"}</span>`
        : `<button class="link-btn o-test" data-test="${o.id}" title="O Claude abre no seu Chrome, põe no carrinho, testa os cupons e tira do carrinho. Nunca finaliza a compra.">${o.validation_status ? "Testar de novo" : "Testar cupons"}</button>`;
      const result = o.validation_status && !busy
        ? `<tr class="o-result"><td colspan="4"><span class="vstatus ${o.validation_status}">${VLABEL[o.validation_status] ?? o.validation_status} às ${clock(o.validation_at)}${o.validation_total ? `: ${brl(o.validation_total)}` : ""}${o.validation_via ? ` (${esc(o.validation_via)})` : ""}.</span> <span class="o-when">${ago(o.validation_at)}</span>${o.validation_message ? `<details class="o-details"><summary>Ver cada cupom testado</summary><p class="o-msg">${esc(o.validation_message)}</p></details>` : ""}</td></tr>`
        : "";
      return `<tr class="o-row">
        <td class="o-store"><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(store)}</a>${sub ? `<small>${esc(sub)}</small>` : ""}${testBtn}</td>
        <td class="o-title">${o.image ? `<img class="o-img" src="${esc(o.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}<span class="t" title="${esc(o.title)}">${esc(o.title)}</span>${extra}${hint}</td>
        <td class="num o-price">${brl(o.final_price)}${o.validation_status === "valido" && o.validation_total && minutesSince(o.validation_at) < 24 * 60 ? `<span class="co-mini${minutesSince(o.validation_at) < FRESH_MIN ? "" : " stale"}">${brl(o.validation_total)} no checkout às ${clock(o.validation_at)}</span>` : ""}<span class="m-delta ${delta != null && delta < 0.01 ? "is-record" : "delta"}">${delta == null ? "" : delta < 0.01 ? "recorde" : `+${brl(delta)}`}</span></td>
        <td class="num ${delta != null && delta < 0.01 ? "is-record" : "delta"}">${delta == null ? "" : delta < 0.01 ? "recorde" : `+${brl(delta)}`}</td>
      </tr>${result}`;
    })
    .join("");
  const status = isScanning
    ? `<span class="scan-now">Varrendo as lojas agora.</span>`
    : `Varrido ${ago(p.last_scan)}, ${p.offerCount} ${p.offerCount === 1 ? "anúncio" : "anúncios"} no histórico`;
  return `<article class="product${isScanning ? " scanning" : ""}" data-id="${p.id}">
    <div class="p-head">
      ${(p.image || p.best?.image) ? `<img class="p-img" src="${esc(p.image || p.best.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}
      <div class="p-main">
        <h3 class="p-name">${p.ref_url ? `<a href="${esc(p.ref_url)}" target="_blank" rel="noopener" title="Abrir o anúncio que você escolheu">${esc(p.name)}</a>` : esc(p.name)}</h3>
        <p class="p-status">${cat ? `<span class="p-cat">${esc(cat.label)}</span>` : ""}${status}</p>
        <p class="p-filter">Precisa ter ${p.must.map((m) => `<span>${esc(m.replace(/\|/g, " ou ").replace(/_/g, ","))}</span>`).join("")}${p.min_price ? `<em>ignora abaixo de ${brl(p.min_price)}</em>` : ""}</p>
      </div>
      <div class="prices${p.checkout ? " has-checkout" : ""}">
        <div class="price-col">
          <p class="pc-head">Menor anúncio</p>
          ${priceTag(p.best_price)}
          <p class="tag-caption">${p.best ? `na <a href="${esc(p.best.url)}" target="_blank" rel="noopener">${esc(p.best.store.replace(/^null\s*\(via (.+)\)$/, "$1"))}</a>. Preço da página, sem frete e impostos` : "aparece após a primeira varredura"}</p>
        </div>
        ${p.checkout ? checkoutFlag(p.checkout, p.id) : checkoutInvite(p)}
      </div>
    </div>
    ${recipeHtml(p)}
    ${rows
      ? `<table class="offers"><thead><tr><th>Loja</th><th>Anúncio</th><th class="num">Preço do anúncio</th><th class="num">Contra o recorde</th></tr></thead><tbody>${rows}</tbody></table>
        ${hiddenCount ? `<button class="more-btn" data-more="${p.id}" aria-expanded="${expanded}">${expanded ? "Mostrar só os 3 mais baratos" : `Mostrar mais ${hiddenCount} ${hiddenCount === 1 ? "anúncio" : "anúncios"}`}</button>` : ""}`
      : p.baseline_done ? `<p class="no-offers">Nenhum anúncio bateu com este produto na última varredura.</p>` : `<p class="no-offers">Buscando anúncios…</p>`}
    <footer class="p-foot">
      <label>Avisar só até <span class="money-in"><span>R$</span><input type="number" min="0" step="1" placeholder="sem teto" value="${p.max_price ?? ""}" data-max="${p.id}" data-min="${p.min_price ?? ""}" aria-label="Preço máximo em reais" /></span></label>
      <button class="link-btn" data-edit="${p.id}">Editar filtro</button>
      <button class="link-btn danger" data-del="${p.id}">Parar de monitorar</button>
    </footer>
  </article>`;
}
$("#products").addEventListener("click", async (e) => {
  const code = e.target.closest("[data-code]");
  if (code) {
    navigator.clipboard?.writeText(code.dataset.code);
    code.textContent = "Copiado";
    setTimeout(() => (code.textContent = code.dataset.code), 1000);
    return;
  }
  const ed = e.target.closest("[data-edit]");
  if (ed) {
    const p = productsById.get(Number(ed.dataset.edit));
    if (p) editFilter(p);
    return;
  }
  const more = e.target.closest("[data-more]");
  if (more) {
    const id = Number(more.dataset.more);
    openOffers.has(id) ? openOffers.delete(id) : openOffers.add(id);
    loadProducts();
    return;
  }
  const rec = e.target.closest("[data-recipe]");
  if (rec) {
    const id = Number(rec.dataset.recipe);
    openRecipes.has(id) ? openRecipes.delete(id) : openRecipes.add(id);
    loadProducts();
    return;
  }
  const test = e.target.closest("[data-test]");
  if (test) {
    test.disabled = true;
    test.textContent = "Na fila";
    const r = await api(`/api/offers/${test.dataset.test}/validate`, { method: "POST" });
    if (!r.queued) test.textContent = r.reason ?? "Não deu para testar";
    loadProducts();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    await api(`/api/products/${del.dataset.del}`, { method: "DELETE" });
    loadProducts();
  }
});
$("#products").addEventListener("change", async (e) => {
  const inp = e.target.closest("[data-max]");
  if (!inp) return;
  await api(`/api/products/${inp.dataset.max}`, {
    method: "PATCH",
    body: { maxPrice: inp.value ? Number(inp.value) : null, minPrice: inp.dataset.min ? Number(inp.dataset.min) : null },
  });
});

/* ---------------- Cupons, fontes, alertas ---------------- */
let allCoupons = [];
let showAllCoupons = false;
const COUPONS_SHOWN = 6;
/** Que funcionaram primeiro, depois os com desconto conhecido (maior primeiro), recusados no fim. */
const couponRank = (c) => (c.status === "valido" ? 0 : c.status === "invalido" ? 3 : c.discount ? 1 : 2);
async function loadCoupons() {
  allCoupons = (await api("/api/coupons")).sort((a, b) => couponRank(a) - couponRank(b) || (b.discount ?? 0) - (a.discount ?? 0));
  renderCoupons();
}
function renderCoupons() {
  const cs = showAllCoupons ? allCoupons : allCoupons.slice(0, COUPONS_SHOWN);
  const status = (c) =>
    c.status === "valido" ? '<span class="vstatus valido">funcionou no checkout</span>'
    : c.status === "invalido" ? '<span class="vstatus invalido">recusado no checkout</span>'
    : `<span class="vstatus">visto ${ago(c.last_seen)}</span>`;
  $("#coupons").innerHTML = cs.length
    ? cs
        .map(
          (c) => `<li class="${c.status === "invalido" ? "is-dead" : ""}" title="${esc([c.title, c.check_message].filter(Boolean).join("\n\n"))}">
          <button class="code" data-code="${esc(c.code)}" title="Copiar código">${esc(c.code)}</button>
          <span class="c-what">${c.discount ? `<strong>−${brl(c.discount)}</strong>${c.min_order ? ` acima de ${brl(c.min_order)}` : ""}` : `<a href="${esc(c.url ?? "#")}" target="_blank" rel="noopener">${esc((c.title ?? "ver a oferta").slice(0, 60))}</a>`}</span>
          <span class="c-store">${esc(c.store)} ${status(c)}</span></li>`,
        )
        .join("") +
      (allCoupons.length > COUPONS_SHOWN
        ? `<li class="more-li"><button class="more-btn" data-allcoupons aria-expanded="${showAllCoupons}">${showAllCoupons ? "Mostrar menos" : `Ver todos os ${allCoupons.length} cupons`}</button></li>`
        : "")
    : `<li class="none">Nenhum cupom ainda. Eles aparecem aqui conforme as varreduras encontram.</li>`;
}
$("#coupons").addEventListener("click", (e) => {
  if (e.target.closest("[data-allcoupons]")) { showAllCoupons = !showAllCoupons; renderCoupons(); return; }
  const b = e.target.closest("[data-code]");
  if (!b) return;
  navigator.clipboard?.writeText(b.dataset.code);
  b.textContent = "Copiado";
  b.classList.add("copied");
  setTimeout(() => { b.textContent = b.dataset.code; b.classList.remove("copied"); }, 1000);
});

async function loadStatus() {
  const s = await api("/api/status");
  const pill = $("#cycle");
  pill.classList.toggle("live", s.running);
  document.body.classList.toggle("is-scanning", !!s.running);
  pill.textContent = s.running ? "Varrendo agora" : s.nextCycle ? `Próxima varredura às ${new Date(s.nextCycle).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "—";
  const off = s.sources.filter((x) => !x.active);
  $("#sources").innerHTML = s.sources
    .filter((x) => x.active)
    .map((x) => {
      const cls = !x.active ? "off" : !x.status ? "" : x.status.ok ? "ok" : "err";
      const msg = !x.active ? `Desligada: ${x.disabledReason}.` : x.status ? `${x.status.ok ? "" : "Falhou: "}${x.status.message}, ${ago(x.status.last_run)}.` : "Aguardando a primeira varredura.";
      return `<li><span class="dot ${cls}"></span><span class="src-name">${esc(x.label)}<span class="src-kind">${x.kind}</span></span><span class="src-msg">${esc(msg)}</span></li>`;
    })
    .join("") +
    (off.length ? `<li class="off-group">Desligadas porque bloqueiam navegador automatizado: ${off.map((x) => esc(x.label)).join(", ")}. A skill /cacar-oferta cobre essas lojas pelo seu Chrome.</li>` : "");
}
async function loadAlerts() {
  const as = await api("/api/alerts");
  $("#alerts").innerHTML = as.length
    ? as
        .slice(0, 5)
        .map((a) => a.kind === "checkout"
          ? `<li class="is-checkout"><span class="a-price">${brl(a.new_price)}</span><span>${esc(a.product_name)} no checkout da <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.store.replace(/\s*\(via [^)]+\)/, ""))}</a></span>
          <span class="a-sub">${ago(a.created_at)} <span class="vstatus valido">testado às ${clock(a.tested_at ?? a.created_at)}${a.via ? `, ${esc(a.via)}` : ""}</span></span></li>`
          : `<li><span class="a-price">${brl(a.new_price)}</span><span>${esc(a.product_name)} na <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.store)}</a></span>
          <span class="a-sub">${ago(a.created_at)} ${vBadge(a)}</span>${a.validation_message ? `<span class="a-msg" title="${esc(a.validation_message)}">${esc(a.validation_message)}</span>` : ""}</li>`)
        .join("")
    : `<li class="none">Nenhuma queda ainda. A primeira varredura de cada produto só registra o preço de referência.</li>`;
}

$("#scan-now").onclick = async () => {
  await api("/api/scan", { method: "POST" });
  loadStatus();
};

/* ---------------- Tempo real ---------------- */
function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "alert") { checkAlerts({ sound: true }); loadAlerts(); }
    if (e.type === "scan") {
      e.status === "start" ? scanning.add(e.productId) : scanning.delete(e.productId);
      loadProducts();
      if (e.status === "done") { loadCoupons(); loadStatus(); }
    }
    if (e.type === "cycle") loadStatus();
    if (e.type === "validation") { loadAlerts(); loadProducts(); if (alarm.current?.id === e.alertId) refreshCurrentAlert(); if (notice.current && notice.current.id === e.alertId) notice.refresh(); }
    if (e.type === "coupons") loadCoupons();
  };
  es.onerror = () => { es.close(); setTimeout(connect, 3000); };
}

await loadCategories();
await Promise.all([loadProducts(), loadCoupons(), loadStatus(), loadAlerts(), loadSettings()]);
checkAlerts();
connect();
setInterval(loadStatus, 30_000);
setInterval(loadProducts, 60_000); // atualiza os "há X min"
