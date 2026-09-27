export interface Grid {
  rows: number;
  cols: number;
}

/**
 * Devuelve (filas, columnas) para ~`target` piezas con celdas cuadradas.
 * `aspect` es ancho/largo de la lámina; el ideal es columnas/filas ~= aspect.
 */
export function planGrid(target: number, aspect = 1): Grid {
  const wanted = Math.max(1, Math.floor(target));
  const ratio = Math.max(1e-6, aspect);

  let best: Grid = { rows: 1, cols: wanted };
  let bestCost = Infinity;
  for (let rows = 1; rows <= wanted; rows++) {
    const ideal = wanted / rows;
    const candidates = new Set([
      Math.max(1, Math.round(ideal)),
      Math.max(1, Math.trunc(ideal)),
      Math.max(1, Math.trunc(ideal) + 1),
    ]);
    for (const cols of candidates) {
      const count = rows * cols;
      const cost =
        Math.abs(count - wanted) + 0.3 * wanted * Math.abs(Math.log(cols / rows / ratio));
      if (cost < bestCost) {
        bestCost = cost;
        best = { rows, cols };
      }
    }
  }
  return best;
}
