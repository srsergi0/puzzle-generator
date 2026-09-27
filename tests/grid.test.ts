import { describe, expect, test } from "bun:test";
import { planGrid } from "../src/grid.ts";

describe("planGrid", () => {
  test("cuadrícula perfecta en hoja cuadrada", () => {
    expect(planGrid(100, 1)).toEqual({ rows: 10, cols: 10 });
    expect(planGrid(4, 1)).toEqual({ rows: 2, cols: 2 });
    expect(planGrid(9, 1)).toEqual({ rows: 3, cols: 3 });
  });

  test("se acerca al objetivo", () => {
    for (const target of [6, 17, 50, 137, 400]) {
      const { rows, cols } = planGrid(target, 1.5);
      expect(Math.abs(rows * cols - target)).toBeLessThanOrEqual(Math.max(2, target * 0.1));
    }
  });

  test("las celdas salen cuadradas", () => {
    for (const aspect of [0.5, 1, 2, 3]) {
      const { rows, cols } = planGrid(200, aspect);
      const cellAspect = aspect * (rows / cols);
      expect(Math.abs(cellAspect - 1)).toBeLessThan(0.15);
    }
  });

  test("mínimos", () => {
    expect(planGrid(1, 1)).toEqual({ rows: 1, cols: 1 });
    expect(planGrid(0, 1)).toEqual({ rows: 1, cols: 1 });
  });
});
