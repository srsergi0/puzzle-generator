import { planGrid } from "../grid.ts";
import { generate, type GenerateOptions, type Puzzle } from "./generate.ts";
import { getShape } from "./shapes.ts";

/** Atajo: reparte las piezas y construye el puzzle listo para dibujar. */
export function buildPuzzle(
  widthCm: number,
  heightCm: number,
  targetPieces: number,
  opts: GenerateOptions = {},
): Puzzle {
  // La forma puede cubrir menos que el rectángulo (el círculo ~78%) y las
  // celdas pequeñas se fusionan con su vecina: se ajusta la cuadrícula un par
  // de veces para que el número final de piezas se acerque al objetivo.
  const shape = getShape(opts.shape);
  const coverage = Math.max(0.05, shape.coverage(widthCm, heightCm));
  const aspect = widthCm / heightCm;

  let scale = 1;
  let best: Puzzle | null = null;
  let bestErr = Infinity;
  for (let i = 0; i < 4; i++) {
    const { rows, cols } = planGrid((targetPieces / coverage) * scale, aspect);
    const puzzle = generate(widthCm, heightCm, rows, cols, opts);
    const err = Math.abs(puzzle.pieces.length - targetPieces);
    if (err < bestErr) {
      bestErr = err;
      best = puzzle;
    }
    if (puzzle.pieces.length === 0 || err <= Math.max(2, targetPieces * 0.12)) return puzzle;
    scale *= targetPieces / puzzle.pieces.length;
    if (!Number.isFinite(scale) || scale <= 0) break;
  }
  return best!;
}
