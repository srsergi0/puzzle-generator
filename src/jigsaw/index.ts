/**
 * Motor de puzzles — fachada pública.
 *
 * Reúne y reexporta los módulos de `src/jigsaw/` conservando exactamente la
 * API que antes exponía `src/jigsaw.ts`, de modo que los consumidores solo
 * necesitan importar desde `./jigsaw/index.ts`.
 *
 * Módulos:
 * - `types.ts`      tipos geométricos básicos (Point, Seg, Rng, Warp).
 * - `rng.ts`        PRNG determinista (mulberry32).
 * - `format.ts`     redondeo y formateo numérico para SVG.
 * - `path.ts`       SubPath, suavizado y muestreo de paths.
 * - `warp.ts`       campo de ondulación global.
 * - `edge.ts`       generación de bordes con pestaña/ranura.
 * - `polygon.ts`    geometría de polígonos (área, distancias, convexidad).
 * - `clip.ts`       recorte de polígonos y de líneas abiertas.
 * - `shapes.ts`     registro de formas de lámina (rect, círculo, …).
 * - `cut-style.ts`  registro de estilos de corte.
 * - `generate.ts`   construcción del puzzle (filas × columnas).
 * - `svg.ts`        paleta y serialización a SVG.
 * - `build.ts`      reparto de la cuadrícula según piezas objetivo.
 */

export type { Point, Seg, Rng, Warp } from "./types.ts";

export { mulberry32 } from "./rng.ts";

export { SubPath, smooth, samplePolygon } from "./path.ts";

export { type EdgeContext } from "./edge.ts";

export {
  polygonArea,
  signedDistToPoly,
  closestPointOnPoly,
  clampPolyToClip,
  isPolygonConvex,
} from "./polygon.ts";

export { clipPolygon, polygonPath, smoothClosedPath } from "./clip.ts";

export { SHAPES, registerShape, getShape, type Shape } from "./shapes.ts";

export { CUT_STYLES, registerCutStyle, getCutStyle, type CutStyle } from "./cut-style.ts";

export {
  generate,
  type Piece,
  type Puzzle,
  type GenerateOptions,
} from "./generate.ts";

export { palette, toSvg, type SvgOptions } from "./svg.ts";

export { buildPuzzle } from "./build.ts";
