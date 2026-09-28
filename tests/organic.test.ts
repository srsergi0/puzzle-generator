import { describe, expect, test } from "bun:test";
import { buildPuzzle, getShape, samplePolygon, toSvg, type Point, type Puzzle } from "../src/jigsaw.ts";
import { organicShape, serpentine } from "../src/organic.ts";

type Poly = Point[];

const area = (poly: Poly): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
};

/** Punto dentro del polígono (par-impar). */
const inside = (p: Point, poly: Poly): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
};

/** Distancia de un punto a una polilínea abierta/cerrada. */
const distToPoly = (p: Point, poly: Poly): number => {
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
};

const segCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const o = (p: Point, q: Point, r: Point): number => {
    const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(v) < 1e-11 ? 0 : Math.sign(v);
  };
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
};

/** ¿El polígono muestreado es simple (sin segmentos que se crucen)? */
const isSimple = (poly0: Poly): boolean => {
  // Muestra puntos de cierre duplicados (± ULP): se eliminan para no
  // confundirlos con cruces reales.
  const poly: Poly = [];
  for (const q of poly0) {
    const last = poly.at(-1);
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-7) poly.push(q);
  }
  while (
    poly.length > 2 &&
    Math.hypot(poly[0]![0] - poly.at(-1)![0], poly[0]![1] - poly.at(-1)![1]) < 1e-7
  ) {
    poly.pop();
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      const c = poly[j]!;
      const d = poly[(j + 1) % poly.length]!;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
};

const outlineOf = (p: Puzzle): Poly => samplePolygon(p.cuts.at(-1)!, 2);

describe("forma orgánica", () => {
  test("registrada y con recorte convexo (el rectángulo)", () => {
    expect(organicShape.id).toBe("organic");
    expect(organicShape.coverage(30, 20)).toBe(1);
    const clip = organicShape.clip(300, 200);
    expect(clip.length).toBe(4);
    expect(getShape("organic").label).toBe("Orgánico");
  });

  test("estilo serpiente registrado", () => {
    expect(serpentine.id).toBe("organic");
    expect(typeof serpentine.edge).toBe("function");
  });

  test("genera el puzzle sin piezas descartadas", () => {
    const p = buildPuzzle(30, 20, 48, { seed: 42, shape: "organic", style: "organic" });
    expect(p.dropped).toBe(0);
    expect(p.pieces.length).toBeGreaterThanOrEqual(44);
    expect(p.pieces.length).toBeLessThanOrEqual(52);
    expect(p.cuts.length).toBeGreaterThan(p.pieces.length);
  });

  test("las piezas cubren exactamente el contorno ondulado", () => {
    const p = buildPuzzle(30, 20, 48, { seed: 42, shape: "organic", style: "organic" });
    const out = area(outlineOf(p));
    let sum = 0;
    for (const piece of p.pieces) sum += area(samplePolygon(piece.path, 2));
    expect(Math.abs(sum - out) / out).toBeLessThan(0.01);
  });

  test("nada sale del contorno ondulado (piezas y cortes)", () => {
    const p = buildPuzzle(20, 15, 36, { seed: 7, shape: "organic", style: "organic" });
    const out = outlineOf(p);
    for (const piece of p.pieces) {
      for (const q of samplePolygon(piece.path, 2)) {
        if (!inside(q, out)) expect(distToPoly(q, out)).toBeLessThan(0.35);
      }
    }
    for (const cut of p.cuts) {
      for (const q of samplePolygon(cut, 3)) {
        if (!inside(q, out)) expect(distToPoly(q, out)).toBeLessThan(0.35);
      }
    }
  });

  test("cada corte interior lo comparten dos piezas (sin huecos)", () => {
    const p = buildPuzzle(20, 15, 36, { seed: 7, shape: "organic", style: "organic" });
    const bounds = p.pieces.map((piece) => samplePolygon(piece.path, 2));
    const cuts = p.cuts.slice(0, -1);
    let revisados = 0;
    for (const cut of cuts) {
      const pts = samplePolygon(cut, 4);
      for (let i = 1; i < pts.length - 1; i += 3) {
        const q = pts[i]!;
        let pegadas = 0;
        for (const poly of bounds) if (distToPoly(q, poly) < 0.15) pegadas++;
        expect(pegadas).toBeGreaterThanOrEqual(2);
        if (++revisados > 250) break;
      }
      if (revisados > 250) break;
    }
    expect(revisados).toBeGreaterThan(100);
  });

  test("contorno y piezas son polígonos simples (sin autointersección)", () => {
    const p = buildPuzzle(20, 15, 36, { seed: 11, shape: "organic", style: "organic" });
    expect(isSimple(outlineOf(p))).toBe(true);
    for (const piece of p.pieces) expect(isSimple(samplePolygon(piece.path, 2))).toBe(true);
  });

  test("es determinista con la misma semilla", () => {
    const a = buildPuzzle(30, 20, 48, { seed: 5, shape: "organic", style: "organic" });
    const b = buildPuzzle(30, 20, 48, { seed: 5, shape: "organic", style: "organic" });
    expect(toSvg(a)).toBe(toSvg(b));
    const c = buildPuzzle(30, 20, 48, { seed: 6, shape: "organic", style: "organic" });
    expect(toSvg(c)).not.toBe(toSvg(a));
  });
});

describe("estilo serpiente", () => {
  test("sobre rectángulo: todo dentro de la lámina", () => {
    const p = buildPuzzle(30, 20, 48, { seed: 42, style: "organic" });
    expect(p.dropped).toBe(0);
    for (const piece of p.pieces) {
      for (const [x, y] of samplePolygon(piece.path, 2)) {
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(300.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeLessThanOrEqual(200.01);
      }
    }
  });

  test("sobre círculo: sin geometría fuera del disco", () => {
    const p = buildPuzzle(30, 20, 48, { seed: 42, shape: "circle", style: "organic" });
    for (const piece of p.pieces) {
      for (const [x, y] of samplePolygon(piece.path, 2)) {
        expect(Math.hypot(x - 150, y - 100)).toBeLessThan(150.1);
      }
    }
  });

  test("combina con las ondas globales", () => {
    const p = buildPuzzle(30, 20, 48, { seed: 42, shape: "organic", style: "organic", wave: 0.6 });
    expect(p.dropped).toBe(0);
    expect(p.pieces.length).toBeGreaterThan(40);
  });

  test('style "classic" es idéntico a no indicar estilo', () => {
    const a = buildPuzzle(30, 20, 48, { seed: 9, style: "classic" });
    const b = buildPuzzle(30, 20, 48, { seed: 9 });
    expect(toSvg(a)).toBe(toSvg(b));
  });
});
