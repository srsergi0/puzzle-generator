import { buildPuzzle, generate, toSvg } from "./jigsaw/index.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
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
  const minArea = q.get("minArea") ? Number(q.get("minArea")) : 0.75;
  const maxArea = q.get("maxArea") ? Number(q.get("maxArea")) : 4;

  const opts = { seed, wave, shape, minArea, maxArea };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/api/puzzle.svg":
        return puzzleSvg(url);
      case "/healthz":
        return new Response("ok\n");
      default:
        return env.ASSETS.fetch(request);
    }
  },
};
