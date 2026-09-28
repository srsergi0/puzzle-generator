import type { Point, Rng, Warp } from "./types.ts";

/**
 * Campo de desplazamiento global (turbulencia suave): un par de ondas
 * senoidales continuas sobre toda la lámina. Al depender solo de (x, y), dos
 * bordes que comparten un punto reciben el mismo desplazamiento y las piezas
 * siguen encajando perfectamente. El envelope apaga la ondulación en el borde
 * para que el rectángulo exterior y el tamaño de impresión queden intactos.
 */
export function makeWarp(
  amount: number,
  width: number,
  height: number,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
  rng: Rng,
): Warp {
  // Amplitud hasta ~1/3 de celda: se nota el flujo pero no hay plegados.
  const amp = amount * 0.32 * Math.min(cellW, cellH);
  const marginX = 0.06 * width;
  const marginY = 0.06 * height;
  // Longitud de onda ~ 3 celdas -> el flujo se lee a escala de pieza.
  const fx = Math.max(0.6, cols / 3.2) * (0.85 + rng() * 0.3);
  const fy = Math.max(0.6, rows / 3.2) * (0.85 + rng() * 0.3);
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;

  const step = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };
  const env = (x: number, y: number): number =>
    step(Math.min(x, width - x) / marginX) * step(Math.min(y, height - y) / marginY);

  return (p: Point): Point => {
    const e = env(p[0], p[1]);
    if (e <= 0) return p;
    const u = p[0] / width;
    const v = p[1] / height;
    const dx =
      (Math.sin(2 * Math.PI * (fx * u + 0.35 * v) + ph1) +
        0.5 * Math.sin(2 * Math.PI * (0.6 * fx * u - fy * v) + ph2)) /
      1.5;
    const dy =
      (Math.sin(2 * Math.PI * (fy * v + 0.35 * u) + ph2) +
        0.5 * Math.sin(2 * Math.PI * (fx * u - 0.6 * fy * v) + ph1)) /
      1.5;
    return [
      Math.max(0, Math.min(width, p[0] + amp * e * dx)),
      Math.max(0, Math.min(height, p[1] + amp * e * dy)),
    ];
  };
}
