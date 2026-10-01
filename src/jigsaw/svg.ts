import { num } from "./format.ts";
import type { Puzzle } from "./generate.ts";

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  return table[i % 6]!;
}

/** Paleta de colores distribuidos por el círculo cromático (ángulo áureo). */
export function palette(count: number): string[] {
  const hex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, "0");
  return Array.from({ length: count }, (_, i) => {
    const hue = (i * 0.618033988749895) % 1;
    const [r, g, b] = hsvToRgb(hue, 0.42, 0.96);
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  });
}

export interface SvgOptions {
  color?: boolean;
  numbers?: boolean;
  stroke?: string;
  strokeWidth?: number;
  imageOverlay?: {
    href: string;
    opacity: number;
    x: number;
    y: number;
    width: number;
    height: number;
    clipPathD?: string;
  };
}

/** Serializa el puzzle a un SVG a escala real (1 unidad = 1 mm). */
export function toSvg(puzzle: Puzzle, opts: SvgOptions = {}): string {
  const { color = false, numbers = false, stroke = "#111111", strokeWidth = 0.3 } = opts;
  const width = puzzle.widthCm * 10;
  const height = puzzle.heightCm * 10;
  const fills = color ? palette(puzzle.pieces.length) : null;
  const font = Math.min(width / puzzle.cols, height / puzzle.rows) * 0.28;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(puzzle.widthCm)}cm"` +
      ` height="${num(puzzle.heightCm)}cm" viewBox="0 0 ${num(width)} ${num(height)}">`,
  ];
  // Sin color no se dibuja nada más que los cortes: ni rectángulo de fondo ni
  // rellenos de pieza (que repetirían cada contorno ya trazado como corte).
  // Rellenos sin trazo, para no duplicar las caras compartidas.
  if (fills) {
    out.push(`<g fill-rule="nonzero" stroke="none">`);
    puzzle.pieces.forEach((piece, i) => {
      out.push(`<path d="${piece.path.toD()}" fill="${fills[i]!}"/>`);
    });
    out.push("</g>");
  }

  if (opts.imageOverlay && opts.imageOverlay.opacity > 0) {
    const { href, opacity, x, y, width: imgW, height: imgH, clipPathD } = opts.imageOverlay;
    if (clipPathD) {
      out.push(
        `<defs><clipPath id="svg-image-clip"><path d="${clipPathD}"/></clipPath></defs>`,
        `<g id="svg-image-overlay" clip-path="url(#svg-image-clip)" opacity="${num(opacity)}" pointer-events="none" style="mix-blend-mode: multiply;">`,
        `<image href="${href}" x="${num(x)}" y="${num(y)}" width="${num(imgW)}" height="${num(imgH)}" preserveAspectRatio="none"/>`,
        `</g>`,
      );
    } else {
      out.push(
        `<g id="svg-image-overlay" opacity="${num(opacity)}" pointer-events="none" style="mix-blend-mode: multiply;">`,
        `<image href="${href}" x="${num(x)}" y="${num(y)}" width="${num(imgW)}" height="${num(imgH)}" preserveAspectRatio="none"/>`,
        `</g>`,
      );
    }
  }

  // Cortes: cada tramo exactamente una vez (para láser / impresión).
  out.push(`<g fill="none" stroke="${stroke}" stroke-width="${num(strokeWidth)}" stroke-linejoin="round">`);
  for (const cut of puzzle.cuts) {
    out.push(`<path d="${cut.toD()}"/>`);
  }
  out.push("</g>");
  if (numbers) {
    out.push(
      `<g fill="#333333" font-family="sans-serif" font-size="${num(font)}"` +
        ` text-anchor="middle" dominant-baseline="central">`,
    );
    for (const piece of puzzle.pieces) {
      out.push(`<text x="${num(piece.center[0])}" y="${num(piece.center[1])}">${piece.index}</text>`);
    }
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n");
}
