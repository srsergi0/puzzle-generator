import type { EdgeContext } from "./edge.ts";
import type { SubPath } from "./path.ts";
import type { Point } from "./types.ts";

/**
 * Estilo de corte: cómo se dibuja el borde entre dos celdas. El path que
 * devuelve lo comparten las dos piezas vecinas, así que encajan siempre.
 */
export interface CutStyle {
  id: string;
  label: string;
  edge(p0: Point, p1: Point, normal: Point, sign: number, perp: number, ctx: EdgeContext): SubPath;
}

export const CUT_STYLES: Record<string, CutStyle> = {};

/** Permite añadir estilos de corte (p. ej. el serpiente) sin tocar el core. */
export function registerCutStyle(style: CutStyle): void {
  CUT_STYLES[style.id] = style;
}

export function getCutStyle(id: string | undefined): CutStyle | undefined {
  return id ? CUT_STYLES[id] : undefined;
}
