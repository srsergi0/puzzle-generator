/**
 * Forma "orgánica" y estilo de corte "serpiente".
 *
 * Todo vive aquí: el core solo expone dos ganchos (registerShape /
 * registerCutStyle) y una deformación final (Shape.postWarp).
 *
 * - Serpiente: cada borde lleva lóbulos irregulares alternando lado a lado.
 *   El mismo path lo comparten las dos piezas vecinas, así que encajan.
 * - Orgánica: la lámina se calcula dentro del rectángulo (recorte convexo,
 *   áreas, clearance…) y solo al final un campo de desplazamiento ondula el
 *   borde. Como se aplica una sola vez por punto y de forma biyectiva, las
 *   piezas siguen cubriendo exactamente el contorno ondulado.
 */
import {
  mulberry32,
  registerCutStyle,
  registerShape,
  samplePolygon,
  smooth,
  type CutStyle,
  type EdgeContext,
  type Point,
  type Shape,
  SubPath,
} from "./jigsaw.ts";

const lerpP = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Recorta la altura de un lóbulo si se acerca demasiado al borde de la forma. */
function trimLobe(
  h: number,
  probe: (v: number) => number,
  margin: (v: number) => number,
): number {
  let v = h;
  for (let i = 0; i < 8 && probe(v) < margin(v); i++) v *= 0.72;
  return probe(v) >= margin(v) ? v : 0;
}

/** ¿Se cruzan los segmentos abiertos [a,b] y [c,d]? */
function cruzan(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => {
    const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(v) < 1e-11 ? 0 : Math.sign(v);
  };
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** ¿La polilínea abierta se cruza a sí misma? (adyacentes excluidos) */
function seCruza(poly: Point[]): boolean {
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    for (let j = i + 2; j + 1 < poly.length; j++) {
      if (cruzan(a, b, poly[j]!, poly[j + 1]!)) return true;
    }
  }
  return false;
}

const serpentine: CutStyle = {
  id: "organic",
  label: "Serpiente",
  edge(p0: Point, p1: Point, normal: Point, sign: number, perp: number, ctx: EdgeContext): SubPath {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) return SubPath.of(p0);
    const { rng, tabRate, warp } = ctx;

    // Línea base (ondulada si hay turbulencia global) + marco local: los
    // lóbulos se apoyan en la normal de la línea base, como la pestaña clásica.
    const N = 24;
    const base: Point[] = [];
    for (let i = 0; i <= N; i++) {
      base.push(warp ? warp(lerpP(p0, p1, i / N)) : lerpP(p0, p1, i / N));
    }
    const cum = [0];
    for (let i = 1; i <= N; i++) {
      cum.push(
        cum[i - 1]! + Math.hypot(base[i]![0] - base[i - 1]![0], base[i]![1] - base[i - 1]![1]),
      );
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
    const at = (u: number, v: number): Point => {
      const f = u / length;
      const P = posAt(f);
      const eps = 1 / (4 * N);
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
      return [
        Math.max(0, Math.min(ctx.sheetW, P[0] + nx * v)),
        Math.max(0, Math.min(ctx.sheetH, P[1] + ny * v)),
      ];
    };

    // Casi todos los bordes ondulan (más que el estilo clásico): los tramos
    // rectos largos rompen el aspecto orgánico.
    if (rng() > Math.min(0.98, tabRate + 0.1)) {
      return warp
        ? new SubPath(base[0]!, smooth(base))
        : new SubPath(p0, [{ t: "L", p: p1 }]);
    }

    // Lóbulos irregulares: los centrales son anchos y profundos (brazos como
    // en la foto) y los de las esquinas, pequeños. Sin simetría translacional
    // las piezas no se deslizan a lo largo del borde.
    const k = Math.max(2, Math.min(5, Math.round(length / (0.38 * perp))));
    const gaps: number[] = [];
    for (let j = 0; j <= k; j++) {
      gaps.push(j === 0 || j === k ? 0.5 + rng() * 0.25 : 0.1 + rng() * 0.08);
    }
    const half = (k - 1) / 2;
    const lobes: number[] = [];
    for (let i = 0; i < k; i++) {
      const t = half > 0 ? 1 - Math.abs(i - half) / half : 0;
      lobes.push(k <= 2 ? 1 + rng() * 0.3 : 0.45 + rng() * 0.15 + t * (0.8 + rng() * 0.3));
    }
    let sum = 0;
    for (const w of gaps) sum += w;
    for (const w of lobes) sum += w;
    const scale = (length * 0.96) / sum;
    for (let i = 0; i < gaps.length; i++) gaps[i] = gaps[i]! * scale;
    for (let i = 0; i < lobes.length; i++) lobes[i] = lobes[i]! * scale;

    const depth = ctx.depth;
    const adjust = (h: number, c: number, hw: number, s: number): number => {
      if (!depth) return h;
      const probe = (v: number): number =>
        Math.min(
          depth(at(c, s * v * 1.05)),
          depth(at(c - hw * 0.6, s * v * 0.95)),
          depth(at(c + hw * 0.6, s * v * 0.95)),
        );
      const margin = (v: number): number => Math.max(0.9 * v, 2);
      return trimLobe(h, probe, margin);
    };

    const pts: [number, number][] = [[0, 0]];
    let u = 0;
    for (let i = 0; i < k; i++) {
      pts.push([u + gaps[i]! * 0.5, 0]);
      u += gaps[i]!;
      const hw = lobes[i]! / 2;
      const c = u + hw;
      const s = i % 2 === 0 ? sign : -sign;
      const neck = 0.45 * hw;
      const bias = (rng() - 0.5) * 0.3 * hw; // bombos algo asimétricos
      // Cuello estrecho y cabeza bulbosa que retrocede (undercut): la pieza
      // no puede deslizarse y se "engancha" como en el puzzle de la foto.
      const profile: [number, number][] = [
        [c - neck * 1.02, 0.06],
        [c - neck * 1.06, 0.34],
        [c - hw * 0.99 + bias * 0.3, 0.66],
        [c - hw * 0.62 + bias, 0.95],
        [c + bias * 1.2, 1.06],
        [c + hw * 0.62 + bias, 0.95],
        [c + hw * 0.99 + bias * 0.3, 0.66],
        [c + neck * 1.06, 0.34],
        [c + neck * 1.02, 0.06],
      ];
      // Regla de la diagonal: en la esquina compartida, la curva de este borde
      // debe quedar siempre del lado de f < u (esquina inicial) y f < L - u
      // (final), y la del borde perpendicular lo mismo. Si ambos lo cumplen no
      // pueden cruzarse jamás. Se exige a CADA punto del perfil, no solo al
      // pico: el hombro del bombillo sobresaliría aunque el pico no lo hiciera.
      let cap = Infinity;
      for (const [pu, pdv] of profile) {
        if (pdv > 1e-6) {
          cap = Math.min(cap, (0.85 * pu) / pdv, (0.85 * (length - pu)) / pdv);
        }
      }
      let h = Math.min(perp * (0.34 + rng() * 0.08), 2.7 * hw, cap);
      // Con `warp` la línea base deja de ser recta y `cap` (medido en espacio
      // local) ya no garantiza la diagonal en el mundo. Se reevalúa con los
      // ejes de la retícula y las esquinas ya deformadas: si la curva cumple
      // |across| < 0.85*along en ambas esquinas, no puede cruzar a la
      // perpendicular. Sin `warp` la comprobación es exactamente `cap`.
      if (warp) {
        const C0 = base[0]!;
        const C1 = base[N]!;
        const exx = dx / length;
        const exy = dy / length;
        const nxx = normal[0];
        const nyy = normal[1];
        const ok = (hh: number): boolean => {
          for (const [pu, pdv] of profile) {
            const P = at(pu, pdv * hh * s);
            const ax = P[0] - C0[0];
            const ay = P[1] - C0[1];
            const bx = C1[0] - P[0];
            const by = C1[1] - P[1];
            if (
              Math.abs(ax * nxx + ay * nyy) >= 0.85 * (ax * exx + ay * exy) ||
              Math.abs(bx * nxx + by * nyy) >= 0.85 * (bx * exx + by * exy)
            ) {
              return false;
            }
          }
          return true;
        };
        for (let i = 0; i < 24 && h > 1e-6 && !ok(h); i++) h *= 0.78;
      }
      h = adjust(h, c, hw, s);
      if (h > 1e-6) {
        for (const [du, dv] of profile) pts.push([du, dv * h * s]);
      } else {
        pts.push([u + hw, 0]);
      }
      u += lobes[i]!;
    }
    pts.push([u + gaps[k]! * 0.5, 0]);
    pts.push([length, 0]);

    // Con la línea base muy curvada (`warp`), la normal se inclina y los
    // lóbulos alternos pueden hacer "hairpins" cuya curva suavizada se cruza a
    // sí misma aunque los puntos de control no. Se muestrea la curva final y,
    // si se cruza, se rebajan todos los lóbulos y se vuelve a probar.
    let world = pts.map(([uu, vv]) => at(uu, vv));
    world[0] = base[0]!;
    world[world.length - 1] = base[N]!;
    let segs = smooth(world);
    for (let t = 0; t < 14; t++) {
      const muestreo = samplePolygon(new SubPath(world[0]!, segs), 3);
      if (!seCruza(muestreo)) break;
      for (const p of pts) p[1] *= 0.7;
      world = pts.map(([uu, vv]) => at(uu, vv));
      world[0] = base[0]!;
      world[world.length - 1] = base[N]!;
      segs = smooth(world);
    }
    return warp ? new SubPath(base[0]!, segs) : new SubPath(world[0]!, segs);
  },
};

/** Lámina con contorno ondulado (marea): ondas suaves solo en el borde. */
const organicShape: Shape = {
  id: "organic",
  label: "Orgánico",
  coverage: () => 1,
  clip: (width, height) => [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ],
  postWarp(width, height, seed) {
    const rng = mulberry32((seed ^ 0x5eed) >>> 0);
    const ph = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
    const cx = width / 2;
    const cy = height / 2;
    const m = Math.max(1, Math.min(width, height));
    const band = Math.max(4, 0.14 * m); // franja interior que se deforma
    const amp = 0.045 * m; // profundidad máxima de las ondas del borde
    const step = (t: number): number => {
      const c = Math.max(0, Math.min(1, t));
      return c * c * (3 - 2 * c);
    };
    return (p: Point): Point => {
      const x = p[0];
      const y = p[1];
      const d = Math.min(x, width - x, y, height - y);
      if (d >= band) return p;
      const env = step(1 - d / band);
      // Dirección radial normalizada por los semiejes: sale hacia fuera en los
      // puntos medios de cada lado y en diagonal en las esquinas.
      let nx = (x - cx) / (width / 2);
      let ny = (y - cy) / (height / 2);
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const th = Math.atan2(y - cy, x - cx);
      const w =
        0.5 * Math.sin(3 * th + ph[0]!) +
        0.3 * Math.sin(5 * th + ph[1]!) +
        0.18 * Math.sin(8 * th + ph[2]!) +
        0.09 * Math.sin(13 * th + ph[0]! * 2);
      return [x + nx * amp * w * env, y + ny * amp * w * env];
    };
  },
};

registerCutStyle(serpentine);
registerShape(organicShape);

export { serpentine, organicShape };
