import type { Point } from "./types.ts";

/** Área con signo (positiva = sentido horario en pantalla, y hacia abajo). */
export function signedArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Área absoluta de un polígono. */
export function polygonArea(poly: Point[]): number {
  return Math.abs(signedArea(poly));
}

/** Centroide de un polígono (cae en el primer vértice si es degenerado). */
export function polygonCentroid(poly: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p[0] * q[1] - q[0] * p[1];
    area += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(area) < 1e-9) return poly[0]!;
  return [cx / (3 * area), cy / (3 * area)];
}

/** Punto dentro de un polígono simple (par-impar, ray casting). */
export function insidePoly(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

/** Punto dentro de un polígono convexo en sentido horario. */
export function insideConvex(p: Point, poly: Point[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
}

/** Distancia mínima de un punto a los bordes de un polígono. */
function distToPolyBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const qx = a[0] + dx * t - p[0];
    const qy = a[1] + dy * t - p[1];
    const d = Math.hypot(qx, qy);
    if (d < best) best = d;
  }
  return best;
}

/** Distancia con signo al borde (positiva = dentro). */
export function signedDistToPoly(p: Point, poly: Point[]): number {
  const d = distToPolyBoundary(p, poly);
  return insidePoly(p, poly) ? d : -d;
}

/** Punto más cercano sobre el borde de un polígono. */
export function closestPointOnPoly(p: Point, poly: Point[]): Point {
  let best = Infinity;
  let bestPt: Point = p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const qx = a[0] + dx * t;
    const qy = a[1] + dy * t;
    const d = Math.hypot(qx - p[0], qy - p[1]);
    if (d < best) {
      best = d;
      bestPt = [qx, qy];
    }
  }
  return bestPt;
}

/** Proyecta los puntos que puedan sobresalir del contorno exactamente sobre su borde. */
export function clampPolyToClip(subject: Point[], clip: Point[]): Point[] {
  return subject.map((p) => {
    if (signedDistToPoly(p, clip) < -1e-4) {
      return closestPointOnPoly(p, clip);
    }
    return p;
  });
}

/** Comprueba si un polígono es estrictamente convexo (útil para optimizar cortes). */
export function isPolygonConvex(poly: Point[]): boolean {
  const n = poly.length;
  if (n <= 3) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const c = poly[(i + 2) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-7) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}

/** Distancia con signo al borde de un polígono convexo (positiva = dentro). */
export function convexDepth(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const cross = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / len;
    if (cross < best) best = cross;
  }
  return best;
}
