/**
 * Tipos geométricos básicos compartidos por todo el motor de puzzles.
 * No dependen de ningún otro módulo (raíz del grafo de dependencias).
 */

/** Punto en milímetros (x, y) dentro de la lámina. */
export type Point = readonly [number, number];

/** Segmento de un path SVG: recta (`L`) o cúbica (`C`). */
export type Seg =
  | { t: "L"; p: Point }
  | { t: "C"; c1: Point; c2: Point; p: Point };

/** Generador pseudoaleatorio determinista. */
export type Rng = () => number;

/** Campo de desplazamiento global aplicado a un punto de la lámina. */
export type Warp = (p: Point) => Point;
