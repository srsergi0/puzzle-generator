import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPuzzle, generate, toSvg } from "./jigsaw.ts";

const PORT = Number(process.env.PORT ?? 4321);
const SRC = fileURLToPath(new URL("./", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const ENTRY = fileURLToPath(new URL("./client.ts", import.meta.url));
const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));

const encoder = new TextEncoder();
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function broadcast(event: string): void {
  const msg = encoder.encode(`data: ${event}\n\n`);
  for (const controller of clients) {
    try {
      controller.enqueue(msg);
    } catch {
      clients.delete(controller);
    }
  }
}

watch(SRC, { recursive: true }, () => broadcast("reload"));
watch(PUBLIC, { recursive: true }, () => broadcast("reload"));

async function bundleClient(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    sourcemap: "inline",
  });
  if (!result.success) {
    const detail = result.logs.map((l) => l.message).join("\n");
    console.error(detail);
    return new Response(`console.error(${JSON.stringify(detail)});`, {
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }
  return new Response(await result.outputs[0]!.text(), {
    headers: { "Content-Type": "application/javascript; charset=utf-8" },
  });
}

function puzzleSvg(url: URL): Response {
  const q = url.searchParams;
  const widthCm = Number(q.get("w") ?? 30);
  const heightCm = Number(q.get("h") ?? 20);
  const target = Math.max(1, Math.trunc(Number(q.get("n") ?? 100)));
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) {
    return new Response("w y h deben ser > 0\n", { status: 400 });
  }
  const rows = q.get("rows") ? Math.max(1, Math.trunc(Number(q.get("rows")))) : undefined;
  const cols = q.get("cols") ? Math.max(1, Math.trunc(Number(q.get("cols")))) : undefined;
  const seed = q.get("seed") ? Math.trunc(Number(q.get("seed"))) : undefined;
  const wave = q.get("wave") ? Number(q.get("wave")) : 0;
  const shape = q.get("shape") ?? "rect";
  const style = q.get("style") ?? undefined;
  const minArea = q.get("minArea") ? Number(q.get("minArea")) : 0.75;
  const maxArea = q.get("maxArea") ? Number(q.get("maxArea")) : 4;

  const opts = { seed, wave, shape, style, minArea, maxArea };
  const puzzle =
    rows && cols
      ? generate(widthCm, heightCm, rows, cols, opts)
      : buildPuzzle(widthCm, heightCm, target, opts);
  const svg = toSvg(puzzle, {
    color: q.get("color") === "1" || q.get("color") === "true",
    numbers: q.get("numbers") === "1" || q.get("numbers") === "true",
    strokeWidth: q.get("strokeWidth") ? Number(q.get("strokeWidth")) : 0.3,
  });

  const headers: Record<string, string> = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (q.get("download") === "1") {
    headers["Content-Disposition"] =
      `attachment; filename="puzzle-${puzzle.rows}x${puzzle.cols}.svg"`;
  }
  return new Response(svg, { headers });
}

/** El cliente se re-empaqueta en cada petición: nunca cachearlo. */
const noStore = (res: Response): Response => {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/":
      case "/index.html":
        return noStore(new Response(Bun.file(INDEX)));
      case "/app.js":
        return noStore(await bundleClient());
      case "/api/puzzle.svg":
        return puzzleSvg(url);
      case "/healthz":
        return new Response("ok\n");
      case "/__live": {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(": conectado\n\n"));
            clients.add(controller);
            req.signal.addEventListener("abort", () => clients.delete(controller));
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }
      default:
        return new Response("404\n", { status: 404 });
    }
  },
});

setInterval(() => broadcast("ping"), 20_000);

console.log(`puzzle dev → http://localhost:${server.port}  (pid ${process.pid})`);
console.log(`svg directo → http://localhost:${server.port}/api/puzzle.svg?w=30&h=20&n=100`);
