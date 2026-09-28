import { bboxInside, clipOpenPath, clipShape, polygonPath } from "./clip.ts";
import { getCutStyle } from "./cut-style.ts";
import { edge, type EdgeContext } from "./edge.ts";
import { SubPath, samplePolygon } from "./path.ts";
import {
  clampPolyToClip,
  convexDepth,
  isPolygonConvex,
  polygonCentroid,
  signedArea,
  signedDistToPoly,
} from "./polygon.ts";
import { mulberry32 } from "./rng.ts";
import { getShape } from "./shapes.ts";
import type { Point, Seg } from "./types.ts";
import { makeWarp } from "./warp.ts";

export interface Piece {
  index: number;
  row: number;
  col: number;
  path: SubPath;
  center: Point;
}

export interface Puzzle {
  widthCm: number;
  heightCm: number;
  rows: number;
  cols: number;
  seed: number;
  pieces: Piece[];
  /** Líneas de corte, cada tramo una sola vez (apto para corte por láser). */
  cuts: SubPath[];
  /** Piezas por debajo del área mínima que no se pudieron fusionar. */
  dropped: number;
}

export interface GenerateOptions {
  seed?: number;
  tabRate?: number;
  wave?: number;
  shape?: string;
  style?: string;
  minArea?: number;
  maxArea?: number;
}

/** Construye el puzzle: una pestaña/ranura aleatoria por borde interno. */
export function generate(
  widthCm: number,
  heightCm: number,
  rows: number,
  cols: number,
  opts: GenerateOptions = {},
): Puzzle {
  if (rows < 1 || cols < 1) throw new Error("rows y cols deben ser >= 1");
  const seed = opts.seed === undefined ? Math.floor(Math.random() * 1e9) : Math.trunc(opts.seed);
  const tabRate = opts.tabRate ?? 0.88;
  const wave = Math.max(0, Math.min(1, opts.wave ?? 0));
  const rng = mulberry32(seed);

  const width = widthCm * 10; // milímetros, para que el SVG imprima a escala
  const height = heightCm * 10;
  const xs = Array.from({ length: cols + 1 }, (_, i) => (i * width) / cols);
  const ys = Array.from({ length: rows + 1 }, (_, i) => (i * height) / rows);
  const cellW = width / cols;
  const cellH = height / rows;

  const style = getCutStyle(opts.style);
  const shape = getShape(opts.shape);
  const warp = wave > 1e-6 ? makeWarp(wave, width, height, cellW, cellH, cols, rows, rng) : null;

  const W = (p: Point): Point => (warp ? warp(p) : p);

  const minArea = Math.max(0, Math.min(1, opts.minArea ?? 0.75));
  const maxArea = Math.max(minArea, opts.maxArea ?? 4);
  const cellArea = cellW * cellH;
  const cellCount = rows * cols;
  const clip = shape.id === "rect" ? null : shape.clip(width, height);
  const isConvex = clip ? isPolygonConvex(clip) : true;
  const depth = clip ? (p: Point): number => (isConvex ? convexDepth(p, clip) : signedDistToPoly(p, clip)) : undefined;

  const ctx: EdgeContext = { rng, tabRate, warp, sheetW: width, sheetH: height, depth };
  const buildEdge = (a: Point, b: Point, n: Point, s: number, p: number): SubPath =>
    style ? style.edge(a, b, n, s, p, ctx) : edge(a, b, n, s, p, ctx);
  const hKey = (r: number, c: number): string => `${r},${c}`;
  const hedges = new Map<string, SubPath>();
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sign = rng() < 0.5 ? 1 : -1;
      hedges.set(
        hKey(r, c),
        buildEdge([xs[c]!, ys[r]!], [xs[c + 1]!, ys[r]!], [0, 1], sign, cellH),
      );
    }
  }

  const vedges = new Map<string, SubPath>();
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const sign = rng() < 0.5 ? 1 : -1;
      vedges.set(
        hKey(r, c),
        buildEdge([xs[c]!, ys[r]!], [xs[c]!, ys[r + 1]!], [1, 0], sign, cellW),
      );
    }
  }

  const cornerW = (r: number, c: number): Point => W([xs[c]!, ys[r]!]);
  const hEdge = (r: number, c: number): SubPath =>
    r === 0 || r === rows
      ? new SubPath(cornerW(r, c), [{ t: "L", p: cornerW(r, c + 1) }])
      : hedges.get(hKey(r, c))!;
  const vEdge = (r: number, c: number): SubPath =>
    c === 0 || c === cols
      ? new SubPath(cornerW(r, c), [{ t: "L", p: cornerW(r + 1, c) }])
      : vedges.get(hKey(r, c))!;

  // Contorno de una región: las caras que dan a otra región (o al exterior) se
  // incluyen; las interiores (fusionadas) desaparecen.
  const regionPath = (cells: number[]): SubPath => {
    const members = new Set(cells);
    type Dir = { from: number; to: number; start: Point; segs: Seg[] };
    const edges: Dir[] = [];
    const key = (r: number, c: number): number => r * (cols + 1) + c;
    for (const idx of cells) {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const has = (rr: number, cc: number): boolean =>
        rr >= 0 && rr < rows && cc >= 0 && cc < cols && members.has(rr * cols + cc);
      if (!has(r - 1, c)) {
        const p = hEdge(r, c);
        edges.push({ from: key(r, c), to: key(r, c + 1), start: p.start, segs: p.segs });
      }
      if (!has(r, c + 1)) {
        const p = vEdge(r, c + 1);
        edges.push({ from: key(r, c + 1), to: key(r + 1, c + 1), start: p.start, segs: p.segs });
      }
      if (!has(r + 1, c)) {
        const p = hEdge(r + 1, c).reversed();
        edges.push({ from: key(r + 1, c + 1), to: key(r + 1, c), start: p.start, segs: p.segs });
      }
      if (!has(r, c - 1)) {
        const p = vEdge(r, c).reversed();
        edges.push({ from: key(r + 1, c), to: key(r, c), start: p.start, segs: p.segs });
      }
    }
    const byFrom = new Map<number, Dir[]>();
    for (const e of edges) {
      const list = byFrom.get(e.from);
      if (list) list.push(e);
      else byFrom.set(e.from, [e]);
    }
    const first = edges[0]!;
    const startKey = first.from;
    const segs: Seg[] = [];
    let cur = first;
    for (let guard = 0; guard <= edges.length; guard++) {
      for (const s of cur.segs) segs.push(s);
      if (cur.to === startKey) break;
      const next = byFrom.get(cur.to)?.pop();
      if (!next) break;
      cur = next;
    }
    return new SubPath(first.start, segs);
  };

  const regionOf = new Int32Array(cellCount).fill(-1);

  if (clip) {
    // Área real de cada celda (su contorno con pestañas) recortada por la
    // forma. Al fusionar, las pestañas/ranuras internas se cancelan, así que
    // la suma de estas áreas es una buena estimación de la región fusionada.
    const measured = new Float64Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      const poly = samplePolygon(regionPath([i]), 4);
      const clipped = bboxInside(poly, clip, 0.3) ? poly : clipShape(poly, clip, isConvex);
      measured[i] = clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
    }

    const parent = new Int32Array(cellCount);
    const regArea = new Float64Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      parent[i] = i;
      regArea[i] = measured[i]!;
    }
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const mergeInto = (src: number, dst: number): void => {
      const rs = find(src);
      const rd = find(dst);
      if (rs === rd) return;
      parent[rs] = rd;
      regArea[rd] = regArea[rd]! + regArea[rs]!;
    };

    const need = minArea * cellArea;
    const cap = maxArea * cellArea;
    const stuck = new Set<number>();
    for (let iter = 0; iter < cellCount * 2; iter++) {
      let target = -1;
      let targetArea = Infinity;
      for (let i = 0; i < cellCount; i++) {
        if (parent[i] !== i || regArea[i]! <= 0 || stuck.has(i)) continue;
        if (regArea[i]! < need && regArea[i]! < targetArea) {
          target = i;
          targetArea = regArea[i]!;
        }
      }
      if (target < 0) break;
      const r = Math.floor(target / cols);
      const c = target % cols;
      // Preferimos la vecina que deja la fusión por debajo del área máxima;
      // si no hay, la más grande (el mínimo manda).
      let capped = -1;
      let cappedArea = -1;
      let any = -1;
      let anyArea = -1;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        const rj = find(j);
        if (rj === find(target) || measured[j]! <= 0) continue;
        if (measured[j]! > anyArea) {
          anyArea = measured[j]!;
          any = j;
        }
        if (regArea[rj]! + regArea[find(target)]! <= cap && measured[j]! > cappedArea) {
          cappedArea = measured[j]!;
          capped = j;
        }
      }
      const dst = capped >= 0 ? capped : any;
      if (dst < 0) {
        stuck.add(find(target));
        continue;
      }
      mergeInto(target, dst);
    }

    // Pasada de verificación con el área real (la estimación de la suma puede
    // desviarse en regiones fusionadas): fusiona lo que siga por debajo.
    const regionPrecise = (cells: number[]): number => {
      const poly = samplePolygon(regionPath(cells), 4);
      const clipped = bboxInside(poly, clip, 0.3) ? poly : clipShape(poly, clip, isConvex);
      return clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
    };
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    for (let pass = 0; pass < 6; pass++) {
      const info = new Map<number, { cells: number[]; area: number }>();
      for (let i = 0; i < cellCount; i++) {
        if (measured[i]! <= 0) continue;
        const root = find(i);
        const entry = info.get(root);
        if (entry) entry.cells.push(i);
        else info.set(root, { cells: [i], area: 0 });
      }
      for (const entry of info.values()) entry.area = regionPrecise(entry.cells);

      let worstRoot = -1;
      let worstArea = Infinity;
      for (const [root, entry] of info) {
        if (entry.area < minArea * cellArea && entry.area < worstArea) {
          worstArea = entry.area;
          worstRoot = root;
        }
      }
      if (worstRoot < 0) break;

      const entry = info.get(worstRoot)!;
      let cappedJ = -1;
      let cappedArea = -1;
      let anyJ = -1;
      let anyArea = -1;
      for (const idx of entry.cells) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        for (const [dr, dc] of dirs) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          const rj = find(j);
          if (rj === worstRoot || measured[j]! <= 0) continue;
          const other = info.get(rj);
          if (!other) continue;
          if (entry.area + other.area <= cap && other.area > cappedArea) {
            cappedArea = other.area;
            cappedJ = j;
          }
          if (other.area > anyArea) {
            anyArea = other.area;
            anyJ = j;
          }
        }
      }
      const j = cappedJ >= 0 ? cappedJ : anyJ;
      if (j < 0) break;
      mergeInto(worstRoot, j);
    }

    for (let i = 0; i < cellCount; i++) {
      if (measured[i]! > 0) regionOf[i] = find(i);
    }
  } else {
    for (let i = 0; i < cellCount; i++) regionOf[i] = i;
  }

  // Agrupar celdas por región y ordenarlas en orden de lectura.
  const grouped = new Map<number, number[]>();
  for (let i = 0; i < cellCount; i++) {
    const root = regionOf[i]!;
    if (root < 0) continue;
    const list = grouped.get(root);
    if (list) list.push(i);
    else grouped.set(root, [i]);
  }
  const regions = [...grouped.values()].sort((a, b) => (a[0]! as number) - (b[0]! as number));

  // Piezas (relleno) y líneas de corte (cada tramo una sola vez).
  const pieces: Piece[] = [];
  const cutsById = new Map<string, SubPath>();
  let dropped = 0;
  for (const cells of regions) {
    const firstCell = cells[0]!;
    const row = Math.floor(firstCell / cols);
    const col = firstCell % cols;

    // Aristas de corte: solo las que separan dos regiones reales. Las que dan
    // a celdas fuera de la forma no son frontera (el contorno ya las cubre),
    // así que no se dibujan (evita las líneas fantasma).
    const regionAt = (rr: number, cc: number): number =>
      rr >= 0 && rr < rows && cc >= 0 && cc < cols ? regionOf[rr * cols + cc]! : -1;
    const root = regionOf[firstCell]!;
    const cut = (id: string, path: SubPath, nr: number, nc: number, borderOk: boolean): void => {
      if (cutsById.has(id)) return;
      const nReg = regionAt(nr, nc);
      if (nReg < 0) {
        if (borderOk) cutsById.set(id, path);
        return;
      }
      if (nReg !== root) cutsById.set(id, path);
    };
    for (const idx of cells) {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      cut(`h:${r}:${c}`, hEdge(r, c), r - 1, c, !clip);
      cut(`v:${r}:${c + 1}`, vEdge(r, c + 1), r, c + 1, !clip);
      cut(`h:${r + 1}:${c}`, hEdge(r + 1, c), r + 1, c, !clip);
      cut(`v:${r}:${c}`, vEdge(r, c), r, c - 1, !clip);
    }

    const path = regionPath(cells);
    if (!clip) {
      pieces.push({
        index: pieces.length + 1,
        row,
        col,
        path,
        center: [(xs[col]! + xs[col + 1]!) / 2, (ys[row]! + ys[row + 1]!) / 2],
      });
      continue;
    }
    const poly = samplePolygon(path, 4);
    const rawClipped = bboxInside(poly, clip, 0.3) ? poly : clipShape(poly, clip, isConvex);
    const clipped = clampPolyToClip(rawClipped, clip);
    if (clipped.length < 3) continue;
    if (Math.abs(signedArea(clipped)) < minArea * cellArea) {
      dropped++;
      continue;
    }
    pieces.push({
      index: 0,
      row,
      col,
      path: polygonPath(clipped),
      center: polygonCentroid(clipped),
    });
  }
  pieces.forEach((piece, i) => {
    piece.index = i + 1;
  });

  // Recortamos cada línea de corte a la forma y añadimos el contorno (una vez).
  const cuts: SubPath[] = [];
  const seen = new Set<string>();
  const pushCut = (path: SubPath): void => {
    const key = path.toD();
    if (seen.has(key)) return; // evita líneas repetidas tras redondear
    seen.add(key);
    cuts.push(path);
  };
  for (const path of cutsById.values()) {
    if (!clip) {
      pushCut(path);
      continue;
    }
    const poly = samplePolygon(path, 6);
    if (bboxInside(poly, clip, 0.3)) {
      pushCut(path); // entera: se conserva tal cual (con sus curvas)
      continue;
    }
    for (const run of clipOpenPath(path, clip, 6)) pushCut(run);
  }

  if (clip) pushCut(polygonPath(clip));

  return { widthCm, heightCm, rows, cols, seed, pieces, cuts, dropped };
}
