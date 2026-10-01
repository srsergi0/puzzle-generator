import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("..", import.meta.url));
const DEV_DIR = PROJECT + ".dev/";
const PID_FILE = DEV_DIR + "dev.pid";
const LOG_FILE = DEV_DIR + "dev.log";
const PORT = Number(process.env.PORT ?? 4444);
const URL_APP = `http://localhost:${PORT}`;

const cmd = process.argv[2] ?? "status";

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${URL_APP}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  mkdirSync(DEV_DIR, { recursive: true });
  const pid = readPid();
  if (pid && alive(pid)) {
    console.log(`ya está corriendo (pid ${pid}) → ${URL_APP}`);
    return;
  }
  const log = openSync(LOG_FILE, "a");
  const proc = Bun.spawn(["bun", "--hot", "src/server.ts"], {
    cwd: PROJECT,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(PORT) },
  });
  proc.unref();
  writeFileSync(PID_FILE, String(proc.pid));

  for (let i = 0; i < 20; i++) {
    if (await healthy()) break;
    await Bun.sleep(250);
  }
  console.log(`dev en background → ${URL_APP}  (pid ${proc.pid})`);
  console.log(`log → .dev/dev.log    ·    parar → bun run dev:stop`);
}

async function stop(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("no hay dev.pid");
    return;
  }
  if (!alive(pid)) {
    rmSync(PID_FILE, { force: true });
    console.log(`no estaba vivo (pid ${pid}); limpiado`);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  for (let i = 0; i < 20 && alive(pid); i++) await Bun.sleep(150);
  if (alive(pid)) process.kill(pid, "SIGKILL");
  rmSync(PID_FILE, { force: true });
  console.log(`parado (pid ${pid})`);
}

async function status(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("dev: parado (sin dev.pid)");
    return;
  }
  const up = alive(pid) && (await healthy());
  console.log(`dev: ${up ? "corriendo" : "proceso muerto"}  pid=${pid}  ${URL_APP}`);
  tail(15);
}

function tail(lines: number): void {
  if (!existsSync(LOG_FILE)) return;
  const all = readFileSync(LOG_FILE, "utf8").trimEnd().split("\n");
  console.log(`--- .dev/dev.log (últimas ${Math.min(lines, all.length)}) ---`);
  console.log(all.slice(-lines).join("\n"));
}

function logs(): void {
  if (!existsSync(LOG_FILE)) {
    console.log("todavía no hay .dev/dev.log");
    return;
  }
  const proc = Bun.spawnSync(["tail", "-n", "50", "-f", LOG_FILE], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(proc.exitCode);
}

switch (cmd) {
  case "bg":
    await start();
    break;
  case "stop":
    await stop();
    break;
  case "status":
    await status();
    break;
  case "logs":
    logs();
    break;
  default:
    console.error(`comando desconocido: ${cmd} (usa bg|stop|status|logs)`);
    process.exit(1);
}
