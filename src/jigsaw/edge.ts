import { SubPath, clampSubPath, lerp, smooth } from "./path.ts";
import type { Point, Rng, Warp } from "./types.ts";

/** Contexto compartido al construir cada borde del puzzle. */
export interface EdgeContext {
  rng: Rng;
  tabRate: number;
  warp: Warp | null;
  sheetW: number;
  sheetH: number;
  /** Profundidad dentro de la forma (distancia al borde). Negativa = fuera. */
  depth?: (p: Point) => number;
}

/**
 * Borde canónico p0 -> p1 con (quizá) una pestaña hacia normal*sign.
 * `perp` es el lado de la celda perpendicular al borde: topa la altura de la
 * pestaña para que nunca invada la pieza vecina.
 * Con `ctx.warp` primero se ondula la línea base (campo global) y luego se
 * monta la pestaña sobre su normal local, así queda nítida y las dos piezas
 * vecinas comparten exactamente la misma curva.
 */
export function edge(
  p0: Point,
  p1: Point,
  normal: Point,
  sign: number,
  perp: number,
  ctx: EdgeContext,
): SubPath {
  const { rng, tabRate, warp } = ctx;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const length = Math.hypot(dx, dy);
  if (length <= 0) return SubPath.of(p0);

  const ux = dx / length;
  const uy = dy / length;

  // Pestañas al borde de la forma: solo se crean si la cabeza queda con un
  // margen dentro (si no, ese lado iría muy finito y se rompería). Si el
  // sentido original no cabe, se intenta el contrario; si tampoco, va recto.
  let dir = sign;
  const keepTab = (head: number, tall: number): boolean => {
    const depth = ctx.depth;
    if (!depth) return true;
    const map = ctx.warp ?? ((p: Point): Point => p);
    const cx = (p0[0] + p1[0]) / 2;
    const cy = (p0[1] + p1[1]) / 2;
    const clearance = (s: number): number => {
      const nx = normal[0] * s;
      const ny = normal[1] * s;
      return Math.min(
        depth(map([cx + nx * 1.06 * tall, cy + ny * 1.06 * tall])),
        depth(map([cx + ux * head * 0.6 + nx * 0.95 * tall, cy + uy * head * 0.6 + ny * 0.95 * tall])),
        depth(map([cx - ux * head * 0.6 + nx * 0.95 * tall, cy - uy * head * 0.6 + ny * 0.95 * tall])),
      );
    };
    const margin = Math.max(0.9 * tall, 0.32 * perp);
    if (clearance(sign) >= margin) return true;
    if (clearance(-sign) >= margin) {
      dir = -sign;
      return true;
    }
    return false;
  };

  // --- sin ondulación: puzzle clásico (idéntico al de siempre) ---
  const classic = (): SubPath => {
    if (rng() > tabRate) return new SubPath(p0, [{ t: "L", p: p1 }]);
    // Proporciones tipo puzzle clásico: cuello estrecho y cabeza bulbosa que se
    // ensancha (undercut), topada por el lado perpendicular de la celda.
    const head = Math.min(0.16 * length * lerp(0.95, 1.05, rng()), 0.28 * perp);
    const tall = Math.min(0.26 * length * lerp(0.92, 1.08, rng()), 0.36 * perp);
    if (head <= 1e-6 || tall <= 1e-6) return new SubPath(p0, [{ t: "L", p: p1 }]);
    if (!keepTab(head, tall)) return new SubPath(p0, [{ t: "L", p: p1 }]);
    const neck = 0.55 * head;
    const toWorld = (uv: number, vv: number): Point => {
      const v = vv * dir;
      return [p0[0] + ux * uv + normal[0] * v, p0[1] + uy * uv + normal[1] * v];
    };
    const cx = length / 2;
    const local: [number, number][] = [
      [0, 0],
      [cx - neck * 1.02, 0.06 * tall],
      [cx - neck * 1.06, 0.34 * tall],
      [cx - head * 0.99, 0.66 * tall],
      [cx - head * 0.62, 0.95 * tall],
      [cx, 1.06 * tall],
      [cx + head * 0.62, 0.95 * tall],
      [cx + head * 0.99, 0.66 * tall],
      [cx + neck * 1.06, 0.34 * tall],
      [cx + neck * 1.02, 0.06 * tall],
      [length, 0],
    ];
    const points = local.map(([uv, vv]) => toWorld(uv, vv));
    points[0] = p0;
    points[points.length - 1] = p1;
    return new SubPath(p0, smooth(points));
  };

  if (!warp) return classic();

  // --- con ondulación global ---
  // 1) línea base ondulada: el campo es global, así que las dos piezas vecinas
  //    obtienen exactamente la misma curva.
  const N = 20;
  const base: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    base.push(warp([p0[0] + dx * t, p0[1] + dy * t]));
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    cum.push(cum[i - 1]! + Math.hypot(base[i]![0] - base[i - 1]![0], base[i]![1] - base[i - 1]![1]));
  }
  const total = cum[N]! || 1;
  const posAt = (f: number): Point => {
    const target = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < N && cum[i]! < target) i++;
    const seg = cum[i]! - cum[i - 1]!;
    const r = seg > 0 ? (target - cum[i - 1]!) / seg : 0;
    const a = base[i - 1]!;
    const b = base[i]!;
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
  };
  const eps = 1 / (4 * N);
  // 2) la pestaña se apoya en la normal local de la línea base: queda nítida.
  const at = (u: number, v: number): Point => {
    const f = length > 0 ? u / length : 0;
    const P = posAt(f);
    const a = posAt(f - eps);
    const b = posAt(f + eps);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let nx = -ty;
    let ny = tx;
    if (nx * normal[0] + ny * normal[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = v * dir;
    return [
      Math.max(0, Math.min(ctx.sheetW, P[0] + nx * off)),
      Math.max(0, Math.min(ctx.sheetH, P[1] + ny * off)),
    ];
  };

  if (rng() > tabRate) {
    return clampSubPath(new SubPath(base[0]!, smooth(base)), ctx.sheetW, ctx.sheetH);
  }

  const head = Math.min(0.16 * length * lerp(0.95, 1.05, rng()), 0.28 * perp);
  const tall = Math.min(0.26 * length * lerp(0.92, 1.08, rng()), 0.36 * perp);
  if (head <= 1e-6 || tall <= 1e-6 || !keepTab(head, tall)) {
    return clampSubPath(new SubPath(base[0]!, smooth(base)), ctx.sheetW, ctx.sheetH);
  }

  const neck = 0.55 * head;
  const cx = length / 2;
  const anchors: [number, number][] = [];
  const fill = (from: number, to: number): void => {
    const count = Math.max(1, Math.round((to - from) / (0.09 * length)));
    for (let i = 1; i <= count; i++) {
      anchors.push([from + ((to - from) * i) / (count + 1), 0]);
    }
  };
  fill(0, cx - neck * 1.02);
  anchors.push(
    [cx - neck * 1.02, 0.06 * tall],
    [cx - neck * 1.06, 0.34 * tall],
    [cx - head * 0.99, 0.66 * tall],
    [cx - head * 0.62, 0.95 * tall],
    [cx, 1.06 * tall],
    [cx + head * 0.62, 0.95 * tall],
    [cx + head * 0.99, 0.66 * tall],
    [cx + neck * 1.06, 0.34 * tall],
    [cx + neck * 1.02, 0.06 * tall],
  );
  fill(cx + neck * 1.02, length);
  const pts = anchors.map(([u, v]) => at(u, v));
  pts[0] = base[0]!;
  pts[pts.length - 1] = base[N]!;
  return clampSubPath(new SubPath(base[0]!, smooth(pts)), ctx.sheetW, ctx.sheetH);
}
