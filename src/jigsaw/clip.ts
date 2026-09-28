import { SubPath, samplePolygon } from "./path.ts";
import {
  clampPolyToClip,
  insideConvex,
  insidePoly,
  isPolygonConvex,
  signedArea,
  signedDistToPoly,
} from "./polygon.ts";
import type { Point, Seg } from "./types.ts";

/** Intersección de la recta pq con la recta ab (q si son paralelas). */
function lineIntersect(p: Point, q: Point, a: Point, b: Point): Point {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return q;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / denom;
  return [p[0] + t * rx, p[1] + t * ry];
}

/** Recorta un polígono contra otro convexo (Sutherland-Hodgman). */
function clipConvex(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const cw = signedArea(clip) >= 0 ? clip : [...clip].reverse();
  let output = subject;
  for (let i = 0; i < cw.length; i++) {
    const a = cw[i]!;
    const b = cw[(i + 1) % cw.length]!;
    const input = output;
    output = [];
    const inside = (p: Point): boolean =>
      (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j - 1 + input.length) % input.length]!;
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(lineIntersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(lineIntersect(prev, cur, a, b));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

/**
 * Recorta una línea ABIERTA contra un polígono convexo y devuelve los tramos
 * que quedan dentro, también abiertos y con el extremo exacto sobre el borde.
 * Nunca se cierra: cerrarla añadiría una recta de corte que con las ondas no
 * coincide con la línea base y se ve como una línea de guía sobre las muescas.
 */
export function clipOpenPath(path: SubPath, clip: Point[], perSeg: number): SubPath[] {
  const pts = samplePolygon(path, perSeg);
  if (pts.length < 2) return [];
  const inside = (p: Point): boolean => insidePoly(p, clip);
  /** Punto exacto de cruce, siempre devuelto por el lado de dentro. */
  const crossing = (inP: Point, outP: Point): Point => {
    let lo = outP;
    let hi = inP;
    for (let i = 0; i < 20; i++) {
      const m: Point = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (inside(m)) hi = m;
      else lo = m;
    }
    return hi;
  };
  const runs: Point[][] = [];
  let run: Point[] | null = inside(pts[0]!) ? [pts[0]!] : null;
  let prevIn = run !== null;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const pin = inside(p);
    if (pin && !prevIn) run = [crossing(p, pts[i - 1]!), p];
    else if (!pin && prevIn && run) {
      run.push(crossing(pts[i - 1]!, p));
      runs.push(run);
      run = null;
    } else if (pin && run) run.push(p);
    prevIn = pin;
  }
  if (run) runs.push(run);
  return runs
    .filter((r) => {
      if (r.length < 2) return false;
      let len = 0;
      for (let i = 1; i < r.length; i++) {
        len += Math.hypot(r[i]![0] - r[i - 1]![0], r[i]![1] - r[i - 1]![1]);
        if (len > 0.8) return true;
      }
      return false;
    })
    .map((r) => new SubPath(r[0]!, r.slice(1).map((q): Seg => ({ t: "L", p: q }))));
}

/** Intersección de dos segmentos (null si no cruzan). */
function segInt(p1: Point, p2: Point, p3: Point, p4: Point): [Point, number, number] | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  if (t >= 1e-6 && t <= 1 - 1e-6 && u >= 1e-6 && u <= 1 - 1e-6) {
    return [[p1[0] + t * d1x, p1[1] + t * d1y], t, u];
  }
  return null;
}

/** Clipping Weiler-Atherton: sujeto ∩ clip para polígonos arbitrarios (convexos y cóncavos). */
export function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const S = signedArea(subject) >= 0 ? subject : [...subject].reverse();
  const C = signedArea(clip) >= 0 ? clip : [...clip].reverse();

  type IntData = {
    pt: Point;
    sEdge: number;
    sT: number;
    cEdge: number;
    cT: number;
    entry: boolean;
  };
  const ints: IntData[] = [];

  for (let i = 0; i < S.length; i++) {
    const s1 = S[i]!;
    const s2 = S[(i + 1) % S.length]!;
    for (let j = 0; j < C.length; j++) {
      const c1 = C[j]!;
      const c2 = C[(j + 1) % C.length]!;
      const hit = segInt(s1, s2, c1, c2);
      if (hit) {
        const [pt, t, u] = hit;
        const cdx = c2[0] - c1[0];
        const cdy = c2[1] - c1[1];
        const sdx = s2[0] - s1[0];
        const sdy = s2[1] - s1[1];
        const cross = cdx * sdy - cdy * sdx;
        ints.push({
          pt,
          sEdge: i,
          sT: t,
          cEdge: j,
          cT: u,
          entry: cross > 0,
        });
      }
    }
  }

  if (ints.length === 0) {
    const allInside = S.every((p) => insidePoly(p, C));
    if (allInside) return S;
    const allClipInside = C.every((p) => insidePoly(p, S));
    if (allClipInside) return C;
    return clampPolyToClip(S.filter((p) => insidePoly(p, C)), C);
  }

  type VNode = {
    pt: Point;
    isIntersection: boolean;
    entry: boolean;
    next: VNode;
    twin?: VNode;
    visited: boolean;
  };

  const sNodes: VNode[] = [];
  const cNodes: VNode[] = [];

  for (let i = 0; i < S.length; i++) {
    sNodes.push({ pt: S[i]!, isIntersection: false, entry: false, next: null as unknown as VNode, visited: false });
    const edgeInts = ints.filter((x) => x.sEdge === i).sort((a, b) => a.sT - b.sT);
    for (const ei of edgeInts) {
      sNodes.push({ pt: ei.pt, isIntersection: true, entry: ei.entry, next: null as unknown as VNode, visited: false });
    }
  }
  for (let i = 0; i < sNodes.length; i++) {
    sNodes[i]!.next = sNodes[(i + 1) % sNodes.length]!;
  }

  for (let j = 0; j < C.length; j++) {
    cNodes.push({ pt: C[j]!, isIntersection: false, entry: false, next: null as unknown as VNode, visited: false });
    const edgeInts = ints.filter((x) => x.cEdge === j).sort((a, b) => a.cT - b.cT);
    for (const ei of edgeInts) {
      cNodes.push({ pt: ei.pt, isIntersection: true, entry: ei.entry, next: null as unknown as VNode, visited: false });
    }
  }
  for (let j = 0; j < cNodes.length; j++) {
    cNodes[j]!.next = cNodes[(j + 1) % cNodes.length]!;
  }

  for (const sn of sNodes) {
    if (sn.isIntersection) {
      const match = cNodes.find(
        (cn) => cn.isIntersection && Math.hypot(cn.pt[0] - sn.pt[0], cn.pt[1] - sn.pt[1]) < 1e-4,
      );
      if (match) {
        sn.twin = match;
        match.twin = sn;
      }
    }
  }

  const results: Point[][] = [];
  for (const start of sNodes) {
    if (start.isIntersection && start.entry && !start.visited) {
      const poly: Point[] = [];
      let cur: VNode = start;
      let onSubject = true;
      let guard = 0;
      while (guard++ < 500) {
        cur.visited = true;
        poly.push(cur.pt);
        if (onSubject) {
          const next = cur.next;
          if (next.isIntersection && !next.entry) {
            cur = next.twin || next;
            onSubject = false;
          } else {
            cur = next;
          }
        } else {
          const next = cur.next;
          if (next.isIntersection && next.entry) {
            if (next === start || next.twin === start) break;
            cur = next.twin || next;
            onSubject = true;
          } else {
            cur = next;
          }
        }
        if (cur === start || cur.twin === start) break;
      }
      if (poly.length >= 3) results.push(poly);
    }
  }

  if (results.length === 0) return [];
  if (results.length === 1) return results[0]!;
  results.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return results[0]!;
}

/** Recorta un polígono según si el corte es convexo (Sutherland-Hodgman) o general (Weiler-Atherton). */
export function clipShape(subject: Point[], clip: Point[], isConvex: boolean): Point[] {
  const res = isConvex ? clipConvex(subject, clip) : clipPolygon(subject, clip);
  return clampPolyToClip(res, clip);
}

/** Polígono -> SubPath cerrado (para dibujar la pieza ya recortada). */
export function polygonPath(poly: Point[]): SubPath {
  if (poly.length === 0) return SubPath.of([0, 0]);
  const segs: Seg[] = poly.slice(1).map((p): Seg => ({ t: "L", p }));
  segs.push({ t: "L", p: poly[0]! });
  return new SubPath(poly[0]!, segs);
}

/** Polígono -> SubPath cerrado con curvas Bézier cúbicas suaves (Catmull-Rom). */
export function smoothClosedPath(poly: Point[]): SubPath {
  const n = poly.length;
  if (n < 3) return polygonPath(poly);
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n]!;
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % n]!;
    const p3 = poly[(i + 2) % n]!;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segs.push({ t: "C", c1, c2, p: p2 });
  }
  return new SubPath(poly[0]!, segs);
}

/** ¿La caja del polígono cae entera dentro del recorte? (atajo sin recortar) */
export function bboxInside(poly: Point[], clip: Point[], margin: number): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const corners: Point[] = [
    [x0 - margin, y0 - margin],
    [x1 + margin, y0 - margin],
    [x1 + margin, y1 + margin],
    [x0 - margin, y1 + margin],
  ];
  if (isPolygonConvex(clip)) {
    return (
      insideConvex(corners[0]!, clip) &&
      insideConvex(corners[1]!, clip) &&
      insideConvex(corners[2]!, clip) &&
      insideConvex(corners[3]!, clip)
    );
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  for (const c of corners) {
    if (signedDistToPoly(c, clip) < diag + margin) return false;
  }
  return true;
}
