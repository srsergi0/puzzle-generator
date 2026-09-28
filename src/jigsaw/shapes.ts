import type { Point } from "./types.ts";

/** Forma de la lámina: define el contorno y cuánto del rectángulo cubre. */
export interface Shape {
  id: string;
  label: string;
  /** Fracción del rectángulo que cubre la forma (para calcular la cuadrícula). */
  coverage(width: number, height: number): number;
  /** Polígono de recorte, en mm y en sentido horario. */
  clip(width: number, height: number): Point[];
  /** Metadatos opcionales de la imagen de origen para overlay. */
  imageMeta?: {
    dataUrl: string;
    origW: number;
    origH: number;
    minX: number;
    minY: number;
    boxW: number;
    boxH: number;
  };
}

const CIRCLE_STEPS = 72;

export const SHAPES: Record<string, Shape> = {
  rect: {
    id: "rect",
    label: "Rectángulo",
    coverage: () => 1,
    clip: (width, height) => [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
  },
  circle: {
    id: "circle",
    label: "Círculo",
    coverage: () => Math.PI / 4,
    clip: (width, height) => {
      const r = Math.min(width, height) / 2;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: CIRCLE_STEPS }, (_, i) => {
        const a = (i / CIRCLE_STEPS) * Math.PI * 2;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
      });
    },
  },
};

/** Permite añadir formas nuevas (p. ej. cargadas de un SVG) sin tocar el core. */
export function registerShape(shape: Shape): void {
  SHAPES[shape.id] = shape;
}

export function getShape(id: string | undefined): Shape {
  return (id && SHAPES[id]) || SHAPES.rect!;
}
