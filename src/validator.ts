import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { db, getSetting } from "./db.js";
import { bus } from "./scanner.js";

/**
 * Dispara o Claude Code em modo não interativo para testar cupons e preço de uma oferta
 * no Chrome do usuário (extensão Claude in Chrome). Usa o login do próprio Claude Code:
 * nenhuma API key é necessária.
 *
 * Duas entradas: um alerta (alarme tocou) ou uma oferta qualquer (botão "Testar cupons").
 * O resultado fica gravado na oferta; no caso de alerta, também no alerta.
 */
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const TIMEOUT_MS = Number(process.env.VALIDATE_TIMEOUT_MIN ?? 10) * 60_000;
const ALLOWED_TOOLS = [
  "mcp__claude-in-chrome", // navegar, clicar, digitar cupom no seu Chrome
  "Bash(curl:*)",          // reportar o resultado para a API local do Promo Radar
  "Skill",
  "ToolSearch",
  "Read",
];

type Job = { kind: "alert" | "offer"; id: number };
const queue: Job[] = [];
let busy = false;

export const autoValidateEnabled = () => getSetting("auto_validate", "1") === "1";

const offerIdOf = (job: Job) =>
  job.kind === "offer" ? job.id : ((db.prepare("SELECT offer_id FROM alerts WHERE id = ?").get(job.id) as { offer_id: number } | undefined)?.offer_id ?? null);

function setStatus(job: Job, status: string, message: string | null = null) {
  const offerId = offerIdOf(job);
  if (job.kind === "alert") {
    db.prepare("UPDATE alerts SET validation_status = ?, validation_message = COALESCE(?, validation_message), validation_at = datetime('now') WHERE id = ?").run(status, message, job.id);
  }
  if (offerId != null) {
    db.prepare("UPDATE offers SET validation_status = ?, validation_message = COALESCE(?, validation_message), validation_at = datetime('now') WHERE id = ?").run(status, message, offerId);
  }
  bus.emit("event", { type: "validation", alertId: job.kind === "alert" ? job.id : undefined, offerId, status });
}

function currentStatus(job: Job): string | null {
  const offerId = offerIdOf(job);
  if (offerId == null) return null;
  const r = db.prepare("SELECT validation_status FROM offers WHERE id = ?").get(offerId) as { validation_status: string | null } | undefined;
  return r ? r.validation_status ?? "" : null;
}

/**
 * "You've hit your 5-hour limit · resets 12:30pm (America/Sao_Paulo)" -> Date do próximo 12:31.
 * Retorna null se o log não for de limite de uso.
 */
export function limitReset(log: string, now = new Date()): Date | null {
  if (!/hit your .*limit|usage limit/i.test(log)) return null;
  const m = log.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  const at = new Date(now);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3]?.toLowerCase() === "pm") h += 12;
    if (!m[3]) h = Number(m[1]);
    at.setHours(h, Number(m[2] ?? 0) + 1, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
  } else {
    at.setTime(now.getTime() + 60 * 60_000); // sem horário no log: tenta em 1 h
  }
  return at;
}

function enqueue(job: Job): { queued: boolean; reason?: string } {
  const st = currentStatus(job);
  if (st === null) return { queued: false, reason: job.kind === "alert" ? "alerta não existe" : "oferta não existe" };
  if (st === "validando" || st === "na_fila") return { queued: false, reason: "já está em teste" };
  queue.push(job);
  setStatus(job, "na_fila", "aguardando o Claude");
  void drain();
  return { queued: true };
}

export const enqueueValidation = (alertId: number) => enqueue({ kind: "alert", id: alertId });
export const enqueueOfferValidation = (offerId: number) => enqueue({ kind: "offer", id: offerId });

async function drain() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  try {
    await runClaude(job);
  } finally {
    busy = false;
    void drain();
  }
}

function runClaude(job: Job): Promise<void> {
  mkdirSync("data/validations", { recursive: true });
  const logPath = `data/validations/${job.kind === "alert" ? "alerta" : "oferta"}-${job.id}.log`;
  const log = createWriteStream(logPath);
  setStatus(job, "validando", "Claude abrindo a oferta no Chrome…");

  const arg = job.kind === "alert" ? `${job.id}` : `oferta ${job.id}`;
  const args = ["-p", `/validar-cupom ${arg}`, "--chrome", "--allowedTools", ...ALLOWED_TOOLS, "--output-format", "text"];
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PROMO_RADAR_URL: `http://localhost:${process.env.PORT ?? 4321}` } });
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("error", (e) => {
      log.write(`\n[promo-radar] falha ao iniciar o Claude Code: ${e.message}\n`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log.end();
      // A skill reporta o resultado via POST /api/(alerts|offers)/:id/validation.
      // Se terminou sem reportar, marcamos erro com o final do log.
      const st = currentStatus(job);
      if (st === "validando" || st === "na_fila") {
        let tail = "";
        try { tail = readFileSync(logPath, "utf8").trim().slice(-300); } catch {}
        const retryAt = limitReset(tail);
        if (retryAt) {
          // Limite de uso da assinatura do Claude: espera o reset e tenta sozinho.
          const hm = retryAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          setStatus(job, "pausado", `Limite de uso do Claude atingido. Nova tentativa automática às ${hm}.`);
          setTimeout(() => enqueue(job), retryAt.getTime() - Date.now());
        } else {
          setStatus(job, "erro", `Claude terminou (código ${code}) sem reportar resultado. ${tail}`);
        }
      }
      resolve();
    });
  });
}
