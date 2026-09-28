import { describe, expect, test } from "bun:test";
import { planGrid } from "../src/grid.ts";
import {
  buildPuzzle,
  generate,
  polygonArea,
  registerShape,
  samplePolygon,
  SubPath,
  toSvg,
} from "../src/jigsaw/index.ts";

function points(path: SubPath): [number, number][] {
  const pts: [number, number][] = [[...path.start] as [number, number]];
  for (const seg of path.segs) {
    if (seg.t === "L") pts.push([...seg.p] as [number, number]);
    else {
      pts.push([...seg.c1] as [number, number], [...seg.c2] as [number, number], [...seg.p] as [number, number]);
    }
  }
  return pts;
}

describe("generate", () => {
  test("cuenta las piezas y no se sale de la lámina", () => {
    const puzzle = generate(20, 15, 4, 5, { seed: 1 });
    expect(puzzle.pieces.length).toBe(20);
    for (const piece of puzzle.pieces) {
      for (const [x, y] of points(piece.path)) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(200.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeLessThanOrEqual(150.01);
      }
    }
  });

  test("las piezas vecinas comparten el mismo borde", () => {
    const puzzle = generate(30, 20, 3, 4, { seed: 7, tabRate: 1 });
    const byPos = new Map(puzzle.pieces.map((p) => [`${p.row},${p.col}`, p]));
    const left = points(byPos.get("1,0")!.path);
    const right = points(byPos.get("1,1")!.path);
    const setRight = new Set(right.map(([x, y]) => `${x},${y}`));
    const shared = left.filter(([x, y]) => setRight.has(`${x},${y}`));
    expect(shared.length).toBeGreaterThanOrEqual(8);
  });

  test("con tabRate 0 todos los bordes internos son rectos", () => {
    const puzzle = generate(30, 20, 3, 4, { seed: 7, tabRate: 0 });
    for (const piece of puzzle.pieces) {
      expect(piece.path.segs.every((s) => s.t === "L")).toBe(true);
      expect(piece.path.segs.length).toBe(4);
    }
  });

  test("invertir el path es simétrico", () => {
    const puzzle = generate(10, 10, 2, 2, { seed: 3 });
    for (const piece of puzzle.pieces) {
      const forward = points(piece.path);
      const back = points(piece.path.reversed());
      expect(back).toEqual([...forward].reverse());
    }
  });

  test("misma semilla, mismo puzzle", () => {
    const a = toSvg(generate(21, 29.7, 4, 5, { seed: 2 }));
    const b = toSvg(generate(21, 29.7, 4, 5, { seed: 2 }));
    expect(a).toBe(b);
  });

  test("aspectos extremos no producen valores inválidos", () => {
    for (const [w, h, n] of [
      [5, 100, 300],
      [100, 5, 300],
      [10, 10, 600],
      [60, 40, 2000],
      [120, 120, 4],
    ] as const) {
      const { rows, cols } = planGrid(n, w / h);
      const puzzle = generate(w, h, rows, cols, { seed: 1 });
      const svg = toSvg(puzzle, { numbers: true });
      expect(puzzle.pieces.length).toBe(rows * cols);
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("Infinity");

      const wavy = toSvg(generate(w, h, rows, cols, { seed: 1, wave: 1 }), { numbers: true });
      expect(wavy).not.toContain("NaN");
      expect(wavy).not.toContain("Infinity");
    }
  });

  test("soporta hasta 2000 piezas sin errores ni desbordamientos", () => {
    const puzzle = buildPuzzle(60, 40, 2000, { seed: 42 });
    expect(puzzle.pieces.length).toBeGreaterThanOrEqual(1800);
    expect(puzzle.pieces.length).toBeLessThanOrEqual(2200);
    expect(puzzle.cuts.length).toBeGreaterThan(3000);
    const svg = toSvg(puzzle);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });

  test("las ondas son un campo global: deterministas y distintas de 0", () => {
    const flat = toSvg(generate(30, 20, 4, 6, { seed: 3 }));
    const wavyA = toSvg(generate(30, 20, 4, 6, { seed: 3, wave: 0.5 }));
    const wavyB = toSvg(generate(30, 20, 4, 6, { seed: 3, wave: 0.5 }));
    expect(wavyA).toBe(wavyB);
    expect(wavyA).not.toBe(flat);
  });

  test("con ondas la lámina sigue intacta y las piezas siguen encajando", () => {
    const width = 300;
    const height = 200;
    const puzzle = generate(30, 20, 4, 6, { seed: 11, wave: 0.85, tabRate: 1 });
    const all: [number, number][] = [];
    for (const piece of puzzle.pieces) all.push(...points(piece.path));

    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(width + 0.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(height + 0.01);
    }
    const set = new Set(all.map(([x, y]) => `${x},${y}`));
    for (const corner of [[0, 0], [width, 0], [0, height], [width, height]]) {
      expect(set.has(`${corner[0]},${corner[1]}`)).toBe(true);
    }

    const byPos = new Map(puzzle.pieces.map((p) => [`${p.row},${p.col}`, p]));
    for (const [a, b] of [
      ["1,1", "1,2"],
      ["2,2", "3,2"],
    ] as const) {
      const left = points(byPos.get(a)!.path);
      const right = points(byPos.get(b)!.path);
      const setRight = new Set(right.map(([x, y]) => `${x},${y}`));
      expect(left.filter(([x, y]) => setRight.has(`${x},${y}`)).length).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("formas", () => {
  test("rect es idéntico a no pedir forma", () => {
    const a = toSvg(buildPuzzle(30, 20, 48, { seed: 9 }));
    const b = toSvg(buildPuzzle(30, 20, 48, { seed: 9, shape: "rect" }));
    expect(a).toBe(b);
  });

  test("círculo: las piezas recortadas suman el área del círculo", () => {
    const width = 300;
    const height = 200;
    const radius = Math.min(width, height) / 2;
    const puzzle = buildPuzzle(30, 20, 48, { seed: 4, shape: "circle", minArea: 0 });
    let area = 0;
    for (const piece of puzzle.pieces) area += polygonArea(samplePolygon(piece.path, 8));
    const circle = Math.PI * radius * radius;
    expect(area).toBeGreaterThan(circle * 0.98);
    expect(area).toBeLessThan(circle * 1.02);
    expect(puzzle.pieces.length).toBeLessThan(puzzle.rows * puzzle.cols);
  });

  test("el umbral fusiona piezas grandes y no deja huecos", () => {
    const circle = Math.PI * 100 * 100;
    for (const minArea of [0.5, 0.75, 0.95]) {
      const puzzle = buildPuzzle(30, 20, 48, { seed: 4, shape: "circle", minArea });
      const cellArea = (300 / puzzle.cols) * (200 / puzzle.rows);
      expect(puzzle.dropped).toBe(0);
      let area = 0;
      for (const piece of puzzle.pieces) {
        const poly = samplePolygon(piece.path, 6);
        const pieceArea = polygonArea(poly);
        expect(pieceArea).toBeGreaterThanOrEqual(minArea * cellArea * 0.9);
        area += pieceArea;
      }
      // La unión tapa el círculo entero: no hay huecos ni solapes.
      expect(area).toBeGreaterThan(circle * 0.97);
      expect(area).toBeLessThan(circle * 1.03);
    }
  });

  test("el círculo deja vacías las esquinas de la lámina", () => {
    const puzzle = buildPuzzle(30, 20, 48, { seed: 4, shape: "circle", minArea: 0 });
    for (const piece of puzzle.pieces) {
      for (const [x, y] of samplePolygon(piece.path, 4)) {
        expect(Math.hypot(x - 150, y - 100)).toBeLessThanOrEqual(100.2);
      }
    }
  });

  test("registerShape permite añadir formas nuevas", () => {
    registerShape({
      id: "ron",
      label: "Rombo",
      coverage: () => 0.5,
      clip: (w, h) => [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ],
    });
    const puzzle = buildPuzzle(30, 20, 40, { shape: "ron", minArea: 0, seed: 1 });
    expect(puzzle.pieces.length).toBeGreaterThan(0);
    for (const piece of puzzle.pieces) {
      for (const [x, y] of samplePolygon(piece.path, 4)) {
        expect(Math.abs(x - 150) / 150 + Math.abs(y - 100) / 100).toBeLessThanOrEqual(1.02);
      }
    }
  });
});

describe("cortes", () => {
  test("rect: una línea por arista de la cuadrícula, sin repetir", () => {
    const puzzle = generate(30, 20, 3, 4, { seed: 1 });
    const expected = (3 + 1) * 4 + (4 + 1) * 3;
    expect(puzzle.cuts.length).toBe(expected);
    const d = puzzle.cuts.map((c) => c.toD());
    expect(new Set(d).size).toBe(d.length);
  });

  test("círculo: cortes únicos y todos dentro de la forma", () => {
    const puzzle = buildPuzzle(30, 20, 48, { seed: 4, shape: "circle", minArea: 0.75 });
    const d = puzzle.cuts.map((c) => c.toD());
    expect(new Set(d).size).toBe(d.length);
    for (const cut of puzzle.cuts) {
      for (const [x, y] of samplePolygon(cut, 3)) {
        expect(Math.hypot(x - 150, y - 100)).toBeLessThanOrEqual(100.05);
      }
    }
  });
  test("círculo: ningún corte fantasma (siempre entre dos piezas o el contorno)", () => {
    const puzzle = buildPuzzle(30, 20, 48, { seed: 4, shape: "circle", minArea: 0.75, maxArea: 2 });
    const polys = puzzle.pieces.map((pc) => samplePolygon(pc.path, 8));
    const inPoly = (pt: number[], poly: (readonly number[])[]): boolean => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (
          (a[1]! > pt[1]!) !== (b[1]! > pt[1]!) &&
          pt[0]! < ((b[0]! - a[0]!) * (pt[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
        ) {
          inside = !inside;
        }
      }
      return inside;
    };
    const which = (pt: number[]): number => {
      for (let k = 0; k < polys.length; k++) if (inPoly(pt, polys[k]!)) return k;
      return -1;
    };

    // La última línea de corte es el contorno de la forma.
    for (let ci = 0; ci < puzzle.cuts.length - 1; ci++) {
      const pts = samplePolygon(puzzle.cuts[ci]!, 4);
      for (let k = 1; k < 6; k++) {
        const i = Math.floor(((pts.length - 1) * k) / 6);
        if (i < 1 || i >= pts.length - 1) continue; // tramos cortos al borde
        const a = pts[i - 1]!;
        const b = pts[i + 1]!;
        const m = pts[i]!;
        const distC = Math.hypot(m[0] - 150, m[1] - 100);
        if (Math.abs(distC - 100) < 2.5) continue; // pegado al contorno
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        const s1 = which([m[0] - ty * 0.3, m[1] + tx * 0.3]);
        const s2 = which([m[0] + ty * 0.3, m[1] - tx * 0.3]);
        expect(s1).toBeGreaterThanOrEqual(0);
        expect(s2).toBeGreaterThanOrEqual(0);
        expect(s1).not.toBe(s2);
      }
    }
  });
});

describe("toSvg", () => {
  const puzzle = generate(21, 29.7, 4, 5, { seed: 2 });
  const svg = toSvg(puzzle, { color: true, numbers: true });

  test("escala y viewBox en cm/mm", () => {
    expect(svg).toContain('width="21cm"');
    expect(svg).toContain('height="29.7cm"');
    expect(svg).toContain('viewBox="0 0 210 297"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  test("una ruta de relleno por pieza y una de corte por tramo", () => {
    expect(svg.match(/<path d="[^"]*" fill="#/g)?.length).toBe(puzzle.pieces.length);
    expect(svg.match(/<path d="[^"]*"\/>/g)?.length).toBe(puzzle.cuts.length);
    expect(svg.match(/<text /g)?.length).toBe(puzzle.pieces.length);
  });

  test("no hay líneas dobles: las piezas no llevan trazo", () => {
    // Los rellenos no se trazan (si no, las caras compartidas irían dos veces).
    expect(svg.match(/<path [^>]*fill="#[^"]*"[^>]*stroke=/g) ?? []).toEqual([]);
    const cutD = [...svg.matchAll(/<path d="([^"]*)"\/>/g)].map((m) => m[1]);
    expect(new Set(cutD).size).toBe(cutD.length);
  });

  test("sin color todas las piezas son blancas", () => {
    const plain = toSvg(puzzle);
    expect(plain.match(/fill="#ffffff"/g)?.length).toBeGreaterThanOrEqual(puzzle.pieces.length);
  });
});

describe("buildPuzzle", () => {
  test("reparte y genera de una vez", () => {
    const puzzle = buildPuzzle(30, 20, 48, { seed: 9 });
    expect(puzzle.pieces.length).toBe(puzzle.rows * puzzle.cols);
    expect(planGrid(48, 1.5)).toEqual({ rows: puzzle.rows, cols: puzzle.cols });
  });
});
