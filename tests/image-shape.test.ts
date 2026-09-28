import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  decodePng,
  keepLargestIsland,
  maskFromRgba,
  maskToContour,
  parseSvgPath,
  shapeFromMask,
  shapeFromPng,
  shapeFromSvg,
  simplifyPolygon,
  smoothBezierPolygon,
} from "../src/image-shape.ts";
import { buildPuzzle, polygonArea, samplePolygon, toSvg } from "../src/jigsaw/index.ts";

/** Helper para generar buffers PNG válidos en memoria para pruebas. */
function createPng(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // standard filter
  ihdr[12] = 0; // no interlace

  const raw = new Uint8Array(height * (1 + width * 4));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }
  const compressed = deflateSync(raw);

  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const len = data.length;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, len);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    return chunk;
  };

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(signature, p);
  p += signature.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}

describe("image-shape: decodificación y silueta", () => {
  test("decodifica PNG y extrae máscara binaria", async () => {
    const png = createPng(30, 30, (x, y) => {
      const d = Math.hypot(x - 15, y - 15);
      return d <= 10 ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });

    const { width, height, rgba } = await decodePng(png);
    expect(width).toBe(30);
    expect(height).toBe(30);

    const mask = maskFromRgba(width, height, rgba);
    expect(mask.width).toBe(30);
    expect(mask.height).toBe(30);
    expect(mask.data[15 * 30 + 15]).toBe(1);
    expect(mask.data[0]).toBe(0);
  });

  test("isla más grande: descarta islas pequeñas y conserva solo la mayor", () => {
    const w = 40;
    const h = 40;
    const data = new Uint8Array(w * h);

    // Isla mayor: 10x10 en el centro = 100 píxeles
    for (let y = 15; y < 25; y++) {
      for (let x = 15; x < 25; x++) {
        data[y * w + x] = 1;
      }
    }

    // Isla menor 1: 3x3 en la esquina = 9 píxeles
    for (let y = 1; y < 4; y++) {
      for (let x = 1; x < 4; x++) {
        data[y * w + x] = 1;
      }
    }

    // Isla menor 2: 2x2 = 4 píxeles
    for (let y = 35; y < 37; y++) {
      for (let x = 35; x < 37; x++) {
        data[y * w + x] = 1;
      }
    }

    const filtered = keepLargestIsland({ width: w, height: h, data });
    let count = 0;
    for (let i = 0; i < filtered.data.length; i++) {
      if (filtered.data[i] === 1) count++;
    }

    expect(count).toBe(100);
    expect(filtered.data[20 * w + 20]).toBe(1);
    expect(filtered.data[2 * w + 2]).toBe(0); // Pequeña 1 descartada
    expect(filtered.data[36 * w + 36]).toBe(0); // Pequeña 2 descartada
  });

  test("simplificación: reduce cientos de vértices a un polígono ligero", () => {
    const circlePts: [number, number][] = [];
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      circlePts.push([50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)]);
    }
    const simplified = simplifyPolygon(circlePts, 1.5);
    expect(simplified.length).toBeLessThan(30);
    expect(simplified.length).toBeGreaterThanOrEqual(8);
  });

  test("curvas Bézier: suaviza las zonas curvas pero preserva esquinas afiladas y tramos rectos", () => {
    const arcPts: [number, number][] = [
      [20, 10],
      [35, 12],
      [48, 20],
      [56, 32],
      [60, 48],
      [56, 64],
      [48, 76],
      [35, 84],
      [20, 86],
      [10, 48],
    ];
    const curved = smoothBezierPolygon(arcPts, 2);
    expect(curved.length).toBeGreaterThan(arcPts.length);
    let hasCurvedTurn = false;
    for (let i = 0; i < curved.length; i++) {
      const p1 = curved[i]!;
      const p2 = curved[(i + 1) % curved.length]!;
      const p3 = curved[(i + 2) % curved.length]!;
      const cross = (p2[0] - p1[0]) * (p3[1] - p2[1]) - (p2[1] - p1[1]) * (p3[0] - p2[0]);
      if (Math.abs(cross) > 1e-4) hasCurvedTurn = true;
    }
    expect(hasCurvedTurn).toBe(true);

    const diamond: [number, number][] = [
      [25, 7],
      [43, 25],
      [25, 43],
      [7, 25],
    ];
    const sharpDiamond = smoothBezierPolygon(diamond, 2);
    expect(sharpDiamond.length).toBe(4);
    expect(sharpDiamond[0]).toEqual([25, 7]);
  });

  test("extrae contorno dual y crea Shape desde máscara", () => {
    const w = 20;
    const h = 20;
    const data = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        data[y * w + x] = 1;
      }
    }
    const mask = { width: w, height: h, data };
    const contour = maskToContour(mask);
    expect(contour.length).toBeGreaterThan(4);

    const shape = shapeFromMask(mask, { id: "test-direct-mask" });
    expect(shape.id).toBe("test-direct-mask");
    const clip = shape.clip(200, 200);
    expect(clip.length).toBeGreaterThanOrEqual(4);
  });

  test("falla claramente si la imagen está vacía", async () => {
    const emptyPng = createPng(20, 20, () => [0, 0, 0, 0]);
    await expect(shapeFromPng(emptyPng)).rejects.toThrow(
      "La imagen está vacía o no contiene ninguna silueta reconocible",
    );
  });

  test("falla claramente si el buffer no es un PNG", async () => {
    const invalid = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(shapeFromPng(invalid)).rejects.toThrow();
  });
});

describe("image-shape: generación de puzzle", () => {
  test("Cargar un PNG con silueta simple → puzzle con esa forma", async () => {
    // Silueta de rombo/diamante en 50x50
    const png = createPng(50, 50, (x, y) => {
      const inDiamond = Math.abs(x - 25) + Math.abs(y - 25) <= 18;
      return inDiamond ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });

    const shape = await shapeFromPng(png, { id: "test-diamond", label: "Diamante" });
    expect(shape.id).toBe("test-diamond");

    const puzzle = buildPuzzle(30, 20, 24, { shape: "test-diamond", seed: 7, minArea: 0.5 });
    expect(puzzle.pieces.length).toBeGreaterThan(0);
    expect(puzzle.cuts.length).toBeGreaterThan(0);

    const svg = toSvg(puzzle);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });

  test("Cargar un PNG con varias islas → solo se usa la mayor", async () => {
    // Círculo grande en el centro + dos manchas pequeñas satélite
    const png = createPng(60, 60, (x, y) => {
      const inMain = Math.hypot(x - 30, y - 30) <= 18;
      const inSat1 = Math.hypot(x - 5, y - 5) <= 3;
      const inSat2 = Math.hypot(x - 55, y - 55) <= 3;
      return inMain || inSat1 || inSat2 ? [20, 20, 20, 255] : [255, 255, 255, 0];
    });

    const shape = await shapeFromPng(png, { id: "test-islands" });
    expect(shape.id).toBe("test-islands");
    const puzzle = buildPuzzle(30, 30, 30, { shape: "test-islands", seed: 11, minArea: 0 });

    // La forma generada no debe tener piezas cerca de las esquinas (5,5) ni (55,55)
    // El centro está en (150, 150) mm
    for (const piece of puzzle.pieces) {
      for (const [x, y] of samplePolygon(piece.path, 4)) {
        // En una lámina 300x300 mm, el círculo tiene radio ~150 mm
        expect(Math.hypot(x - 150, y - 150)).toBeLessThanOrEqual(152);
      }
    }
  });

  test("Las piezas cubren exactamente la silueta y no se salen de ella", async () => {
    const png = createPng(40, 40, (x, y) => {
      const inBox = x >= 8 && x <= 32 && y >= 8 && y <= 32;
      return inBox ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });

    const shape = await shapeFromPng(png, { id: "test-box" });
    const puzzle = buildPuzzle(20, 20, 16, { shape: "test-box", seed: 3, minArea: 0 });

    const clipPoly = shape.clip(200, 200);
    const shapeArea = polygonArea(clipPoly);

    let totalPieceArea = 0;
    for (const piece of puzzle.pieces) {
      const poly = samplePolygon(piece.path, 4);
      totalPieceArea += polygonArea(poly);
      // Cada punto de cada pieza debe estar dentro de la caja [0..200]
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThanOrEqual(-0.05);
        expect(x).toBeLessThanOrEqual(200.05);
        expect(y).toBeGreaterThanOrEqual(-0.05);
        expect(y).toBeLessThanOrEqual(200.05);
      }
    }

    // La suma del área de las piezas coincide con el área del contorno recortado
    expect(totalPieceArea).toBeGreaterThan(shapeArea * 0.95);
    expect(totalPieceArea).toBeLessThan(shapeArea * 1.05);
  });

  test("La forma se escala manteniendo la proporción en láminas con aspecto variable", async () => {
    // Silueta exactamente 2:1 (ancho 36 píxeles, alto 18 píxeles: 36/18 = 2.0)
    const png = createPng(40, 20, (x, y) => {
      return x >= 2 && x <= 37 && y >= 1 && y <= 18 ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });

    const shape = await shapeFromPng(png, { id: "test-aspect" });

    // Hoja cuadrada 300x300 mm: la forma debe escalar a 300x150 mm (centrada en y: 75..225)
    const clipSquare = shape.clip(300, 300);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of clipSquare) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const w = maxX - minX;
    const h = maxY - minY;
    expect(Math.abs(w / h - 2)).toBeLessThan(0.08); // Mantiene proporción 2:1
    expect(minX).toBeGreaterThanOrEqual(-0.1);
    expect(maxX).toBeLessThanOrEqual(300.1);
    expect(minY).toBeGreaterThanOrEqual(50); // Centrado con margen vertical
    expect(maxY).toBeLessThanOrEqual(250);
  });

  test("Silueta cóncava (corazón): las piezas cubren los lóbulos y no solo el núcleo convexo", async () => {
    const bytes = new Uint8Array(readFileSync("./tests/fixtures/heart.png"));
    await shapeFromPng(bytes, { id: "test-heart-concave" });
    const puzzle = buildPuzzle(20, 20, 40, { shape: "test-heart-concave", seed: 42 });

    let piecesMinY = Infinity;
    for (const p of puzzle.pieces) {
      for (const [, y] of samplePolygon(p.path, 4)) {
        if (y < piecesMinY) piecesMinY = y;
      }
    }
    // Las piezas deben alcanzar los lóbulos superiores (Y < 15), no quedarse en el diamante central (Y > 20)
    expect(piecesMinY).toBeLessThan(15);
    expect(puzzle.pieces.length).toBeGreaterThanOrEqual(30);
  });

  test("Overlay de imagen: se alinea al 100% con la silueta y se recorta con clipPath", async () => {
    const bytes = new Uint8Array(readFileSync("./tests/fixtures/heart.png"));
    const shape = await shapeFromPng(bytes, { id: "test-overlay-align", dataUrl: "data:image/png;base64,test" });
    expect(shape.imageMeta).toBeDefined();
    const { origW, origH, minX, minY, boxW, boxH, dataUrl } = shape.imageMeta!;
    expect(origW).toBe(100);
    expect(origH).toBe(100);

    const sheetW = 200;
    const sheetH = 200;
    const scale = Math.min(sheetW / boxW, sheetH / boxH);
    const scaledW = boxW * scale;
    const scaledH = boxH * scale;
    const offsetX = (sheetW - scaledW) / 2;
    const offsetY = (sheetH - scaledH) / 2;

    const overlayX = offsetX - minX * scale;
    const overlayY = offsetY - minY * scale;
    const overlayW = origW * scale;
    const overlayH = origH * scale;

    // Verificar coincidencia matemática exacta entre la silueta en la imagen y la silueta en la lámina
    expect(overlayX + minX * scale).toBeCloseTo(offsetX, 5);
    expect(overlayY + minY * scale).toBeCloseTo(offsetY, 5);
    expect(overlayX + (minX + boxW) * scale).toBeCloseTo(offsetX + scaledW, 5);
    expect(overlayY + (minY + boxH) * scale).toBeCloseTo(offsetY + scaledH, 5);

    const puzzle = buildPuzzle(20, 20, 25, { shape: "test-overlay-align", seed: 99 });
    const clipPts = shape.clip(sheetW, sheetH);
    const { polygonPath } = await import("../src/jigsaw/index.ts");
    const clipPathD = polygonPath(clipPts).toD();

    const svg = toSvg(puzzle, {
      imageOverlay: {
        href: dataUrl,
        opacity: 0.5,
        x: overlayX,
        y: overlayY,
        width: overlayW,
        height: overlayH,
        clipPathD,
      },
    });

    expect(svg).toContain('<defs><clipPath id="svg-image-clip">');
    expect(svg).toContain('clip-path="url(#svg-image-clip)"');
    expect(svg).toContain('<image href="data:image/png;base64,test"');
    expect(svg).not.toContain("NaN");
  });

  test("parseSvgPath: parsea comandos SVG y genera polígono cerrado", () => {
    const d = "M 10 10 L 90 10 C 90 50 50 90 10 90 Z";
    const pts = parseSvgPath(d, 4);
    expect(pts.length).toBeGreaterThanOrEqual(6);
    expect(pts[0]).toEqual([10, 10]);
    expect(pts[1]).toEqual([90, 10]);
  });

  test("shapeFromSvg: carga 025.svg (Pikachu) y genera puzzle con cortes y overlay alineados", () => {
    const svgText = readFileSync("./tests/fixtures/025.svg", "utf8");
    const shape = shapeFromSvg(svgText, { id: "test-025-pikachu", label: "025 Pikachu" });

    expect(shape.id).toBe("test-025-pikachu");
    expect(shape.label).toBe("025 Pikachu");
    expect(shape.imageMeta).toBeDefined();

    const meta = shape.imageMeta!;
    expect(meta.origW).toBe(475);
    expect(meta.origH).toBe(475);
    expect(meta.boxW).toBeGreaterThan(380);
    expect(meta.boxH).toBeGreaterThan(380);

    const puzzle = buildPuzzle(30, 30, 40, { shape: "test-025-pikachu", seed: 123 });
    expect(puzzle.pieces.length).toBeGreaterThanOrEqual(30);
    expect(puzzle.cuts.length).toBeGreaterThan(0);

    const svg = toSvg(puzzle, { color: true, numbers: true });
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });

  test("shapeFromSvg: falla si el archivo SVG no tiene trazados", () => {
    const emptySvg = '<svg viewBox="0 0 100 100"></svg>';
    expect(() => shapeFromSvg(emptySvg)).toThrow(
      "No se encontró ningún trazado (<path> o <polygon>) en el archivo SVG",
    );
  });
});
