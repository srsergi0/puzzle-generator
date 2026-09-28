import { pt } from "./format.ts";
import type { Point, Seg } from "./types.ts";

/** Tramo de path: un punto inicial más segmentos L/C. */
export class SubPath {
  constructor(
    public readonly start: Point,
    public readonly segs: Seg[],
  ) {}

  static of(start: Point): SubPath {
    return new SubPath(start, []);
  }

  get end(): Point {
    const last = this.segs.at(-1);
    if (!last) return this.start;
    return last.p;
  }

  reversed(): SubPath {
    if (this.segs.length === 0) return new SubPath(this.start, []);
    const starts: Point[] = [this.start];
    for (let i = 0; i < this.segs.length - 1; i++) starts.push(this.segs[i]!.p);
    const segs: Seg[] = [];
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const seg = this.segs[i]!;
      const p = starts[i]!;
      segs.push(seg.t === "L" ? { t: "L", p } : { t: "C", c1: seg.c2, c2: seg.c1, p });
    }
    return new SubPath(this.end, segs);
  }

  toD(): string {
    const parts = [`M ${pt(this.start)}`];
    for (const seg of this.segs) {
      if (seg.t === "L") parts.push(`L ${pt(seg.p)}`);
      else parts.push(`C ${pt(seg.c1)} ${pt(seg.c2)} ${pt(seg.p)}`);
    }
    return parts.join(" ");
  }
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Catmull-Rom -> cúbicas, para que la pestaña salga redonda. */
export function smooth(points: Point[]): Seg[] {
  const n = points.length;
  if (n < 2) return [];
  const segs: Seg[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, n - 1)]!;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segs.push({ t: "C", c1, c2, p: p2 });
  }
  return segs;
}

/** Muestrea un path a un polígono denso (para recortar contra una forma). */
export function samplePolygon(path: SubPath, perSeg: number): Point[] {
  const pts: Point[] = [path.start];
  let cur = path.start;
  for (const seg of path.segs) {
    if (seg.t === "L") {
      const [x0, y0] = cur;
      const [x1, y1] = seg.p;
      for (let i = 1; i <= perSeg; i++) {
        const t = i / perSeg;
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    } else {
      const [x0, y0] = cur;
      const { c1, c2, p } = seg;
      for (let i = 1; i <= perSeg; i++) {
        const t = i / perSeg;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const d = t * t * t;
        pts.push([
          a * x0 + b * c1[0] + c * c2[0] + d * p[0],
          a * y0 + b * c1[1] + c * c2[1] + d * p[1],
        ]);
      }
    }
    cur = seg.p;
  }
  return pts;
}

/** Recorta anclas y puntos de control a la lámina (una Bézier nunca sale de
 * su envolvente, así la curva tampoco se sale del rectángulo). */
export function clampSubPath(path: SubPath, width: number, height: number): SubPath {
  const cl = (p: Point): Point => [
    Math.max(0, Math.min(width, p[0])),
    Math.max(0, Math.min(height, p[1])),
  ];
  const segs = path.segs.map((s): Seg =>
    s.t === "L" ? { t: "L", p: cl(s.p) } : { t: "C", c1: cl(s.c1), c2: cl(s.c2), p: cl(s.p) },
  );
  return new SubPath(cl(path.start), segs);
}
