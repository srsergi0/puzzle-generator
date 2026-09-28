import type { Point } from "./types.ts";

/** Redondeo a dos decimales: evita ruido en la salida SVG. */
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Número redondeado listo para el atributo `d` de un path. */
export const num = (v: number): string => String(round2(v));

/** Punto formateado como `"x y"` para un path SVG. */
export const pt = (p: Point): string => `${num(p[0])} ${num(p[1])}`;
