import { polygonArea, registerShape, type Point, type Shape } from "./jigsaw/index.ts";

export interface ImageMask {
  width: number;
  height: number;
  data: Uint8Array; // 1 = silueta (foreground), 0 = fondo (background)
}

export interface ImageShapeOptions {
  id?: string;
  label?: string;
  epsilon?: number;
  threshold?: number;
  dataUrl?: string;
  origW?: number;
  origH?: number;
  /** MIME type del archivo de origen (p. ej. image/jpeg) para elegir el decodificador. */
  mime?: string;
}

/**
 * Descomprime un buffer zlib DEFLATE usando DecompressionStream("deflate-raw") nativo estándar,
 * retirando la cabecera zlib (2 bytes) y el checksum Adler-32 (4 bytes finales).
 * Se utiliza pipeThrough para evitar interbloqueos de contrapresión (deadlock).
 */
async function decompressDeflate(compressed: Uint8Array): Promise<Uint8Array> {
  if (compressed.length < 6) throw new Error("Datos PNG comprimidos demasiado cortos");
  const raw = compressed.subarray(2, compressed.length - 4);
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Response(raw as unknown as BodyInit).body!.pipeThrough(ds);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Decodifica un archivo PNG básico (IHDR + IDAT + IEND) y devuelve píxeles RGBA 8-bit.
 */
export async function decodePng(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array; origW: number; origH: number }> {
  if (bytes.length < 8) throw new Error("Archivo PNG demasiado corto");
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== signature[i]) throw new Error("Firma de archivo PNG no válida");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) break;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = dv.getUint32(0);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    offset += 8;

    if (offset + length > bytes.length) throw new Error("Chunk PNG corrupto o truncado");
    const chunkData = bytes.subarray(offset, offset + length);
    offset += length + 4; // Salta payload + 4 bytes de CRC

    if (type === "IHDR") {
      const ihdrDv = new DataView(chunkData.buffer, chunkData.byteOffset, 13);
      width = ihdrDv.getUint32(0);
      height = ihdrDv.getUint32(4);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
    } else if (type === "PLTE") {
      palette = chunkData;
    } else if (type === "tRNS") {
      trns = chunkData;
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0) throw new Error("Cabecera IHDR de PNG no encontrada");
  if (idatChunks.length === 0) throw new Error("Datos de imagen IDAT no encontrados");

  let totalIdat = 0;
  for (const c of idatChunks) totalIdat += c.length;
  const idatCombined = new Uint8Array(totalIdat);
  let idatPos = 0;
  for (const c of idatChunks) {
    idatCombined.set(c, idatPos);
    idatPos += c.length;
  }

  const decompressed = await decompressDeflate(idatCombined);

  // Determinar bytes por píxel según colorType
  let bpp = 4;
  if (colorType === 0) bpp = 1; // Grayscale
  else if (colorType === 2) bpp = 3; // RGB
  else if (colorType === 3) bpp = 1; // Indexed
  else if (colorType === 4) bpp = 2; // Grayscale + Alpha
  else if (colorType === 6) bpp = 4; // RGBA

  if (bitDepth !== 8) {
    throw new Error(`Profundidad de bits ${bitDepth} no soportada (se requiere 8 bits)`);
  }

  const stride = width * bpp;
  const unfiltered = new Uint8Array(height * stride);
  let srcPos = 0;

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const filter = decompressed[srcPos++];
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = decompressed[srcPos++];
      const left = x >= bpp ? unfiltered[rowStart + x - bpp]! : 0;
      const above = y > 0 ? unfiltered[prevRowStart + x]! : 0;
      const upperLeft = y > 0 && x >= bpp ? unfiltered[prevRowStart + x - bpp]! : 0;

      let val = rawByte!;
      if (filter === 1) {
        val = (val + left) & 0xff;
      } else if (filter === 2) {
        val = (val + above) & 0xff;
      } else if (filter === 3) {
        val = (val + Math.floor((left + above) / 2)) & 0xff;
      } else if (filter === 4) {
        val = (val + paeth(left, above, upperLeft)) & 0xff;
      }
      unfiltered[rowStart + x] = val;
    }
  }

  // Convertir a RGBA de 8 bits estándar
  const rgba = new Uint8Array(width * height * 4);
  let dstIdx = 0;

  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      // RGBA
      const srcIdx = i * 4;
      rgba[dstIdx++] = unfiltered[srcIdx]!;
      rgba[dstIdx++] = unfiltered[srcIdx + 1]!;
      rgba[dstIdx++] = unfiltered[srcIdx + 2]!;
      rgba[dstIdx++] = unfiltered[srcIdx + 3]!;
    } else if (colorType === 2) {
      // RGB
      const srcIdx = i * 3;
      rgba[dstIdx++] = unfiltered[srcIdx]!;
      rgba[dstIdx++] = unfiltered[srcIdx + 1]!;
      rgba[dstIdx++] = unfiltered[srcIdx + 2]!;
      rgba[dstIdx++] = 255;
    } else if (colorType === 0) {
      // Grayscale
      const g = unfiltered[i]!;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = 255;
    } else if (colorType === 4) {
      // Grayscale + Alpha
      const srcIdx = i * 2;
      const g = unfiltered[srcIdx]!;
      const a = unfiltered[srcIdx + 1]!;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = g;
      rgba[dstIdx++] = a;
    } else if (colorType === 3 && palette) {
      // Indexed
      const pIdx = unfiltered[i]! * 3;
      rgba[dstIdx++] = palette[pIdx] ?? 0;
      rgba[dstIdx++] = palette[pIdx + 1] ?? 0;
      rgba[dstIdx++] = palette[pIdx + 2] ?? 0;
      rgba[dstIdx++] = trns && unfiltered[i]! < trns.length ? trns[unfiltered[i]!]! : 255;
    }
  }

  return { width, height, rgba, origW: width, origH: height };
}

/**
 * Convierte un buffer de píxeles RGBA en una máscara binaria (1 = figura, 0 = fondo).
 * Si hay transparencia, se usa el canal alfa.
 * Si es opaca, detecta el color de fondo por las esquinas y binariza por luminancia.
 */
export function maskFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  threshold = 128,
): ImageMask {
  const count = width * height;
  const mask = new Uint8Array(count);

  let hasTransparency = false;
  for (let i = 0; i < count; i++) {
    if (rgba[i * 4 + 3]! < 240) {
      hasTransparency = true;
      break;
    }
  }

  if (hasTransparency) {
    for (let i = 0; i < count; i++) {
      mask[i] = rgba[i * 4 + 3]! >= threshold ? 1 : 0;
    }
  } else {
    // Imagen opaca: calcular luminancia de las esquinas para determinar si el fondo es claro u oscuro
    const lumAt = (x: number, y: number): number => {
      const idx = (y * width + x) * 4;
      return 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!;
    };
    const cornerLums = [
      lumAt(0, 0),
      lumAt(Math.max(0, width - 1), 0),
      lumAt(0, Math.max(0, height - 1)),
      lumAt(Math.max(0, width - 1), Math.max(0, height - 1)),
    ];
    const avgCornerLum = cornerLums.reduce((s, v) => s + v, 0) / cornerLums.length;
    const isLightBg = avgCornerLum > 128;

    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      const lum = 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!;
      mask[i] = isLightBg ? (lum < 128 ? 1 : 0) : lum >= 128 ? 1 : 0;
    }
  }

  // Reducción con votación mayoritaria para no destruir siluetas finas
  const maxDim = Math.max(width, height);
  if (maxDim > 400) {
    const step = Math.ceil(maxDim / 400);
    const sw = Math.floor(width / step);
    const sh = Math.floor(height / step);
    const sdata = new Uint8Array(sw * sh);
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        let ones = 0;
        let total = 0;
        for (let dy = 0; dy < step && sy * step + dy < height; dy++) {
          for (let dx = 0; dx < step && sx * step + dx < width; dx++) {
            ones += mask[(sy * step + dy) * width + (sx * step + dx)]!;
            total++;
          }
        }
        sdata[sy * sw + sx] = ones > total / 2 ? 1 : (ones > 0 && ones >= total * 0.2 ? 1 : 0);
      }
    }
    return { width: sw, height: sh, data: sdata };
  }

  return { width, height, data: mask };
}

/**
 * Filtra los componentes conexos (islas) y conserva únicamente la isla con mayor área (número de píxeles).
 * Descarta todas las demás.
 */
export function keepLargestIsland(mask: ImageMask): ImageMask {
  const { width, height, data } = mask;
  const visited = new Uint8Array(width * height);
  let bestPixels: number[] = [];
  const queue = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx] === 0 || visited[idx] === 1) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;

      while (head < tail) {
        const cur = queue[head++]!;
        const cx = cur % width;
        const cy = Math.floor(cur / width);

        const neighbors = [
          cy > 0 ? cur - width : -1,
          cy < height - 1 ? cur + width : -1,
          cx > 0 ? cur - 1 : -1,
          cx < width - 1 ? cur + 1 : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && data[n] === 1 && visited[n] === 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
      }

      if (tail > bestPixels.length) {
        bestPixels = Array.from(queue.subarray(0, tail));
      }
    }
  }

  if (bestPixels.length === 0) {
    throw new Error("La imagen está vacía o no contiene ninguna silueta reconocible");
  }

  const island = new Uint8Array(width * height);
  for (const idx of bestPixels) {
    island[idx] = 1;
  }

  return { width, height, data: island };
}

/**
 * Traza el contorno exterior de la isla recorriendo las aristas duales del grid en sentido horario (CW).
 */
export function maskToContour(mask: ImageMask): Point[] {
  const { width, height, data } = mask;
  type Edge = { from: number; to: number; fromPt: Point; toPt: Point };
  const edges: Edge[] = [];
  const key = (x: number, y: number): number => y * (width + 1) + x;
  const isInside = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && data[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue;
      // Arista superior (izq -> der)
      if (!isInside(x, y - 1)) {
        edges.push({ from: key(x, y), to: key(x + 1, y), fromPt: [x, y], toPt: [x + 1, y] });
      }
      // Arista derecha (arriba -> abajo)
      if (!isInside(x + 1, y)) {
        edges.push({ from: key(x + 1, y), to: key(x + 1, y + 1), fromPt: [x + 1, y], toPt: [x + 1, y + 1] });
      }
      // Arista inferior (der -> izq)
      if (!isInside(x, y + 1)) {
        edges.push({ from: key(x + 1, y + 1), to: key(x, y + 1), fromPt: [x + 1, y + 1], toPt: [x, y + 1] });
      }
      // Arista izquierda (abajo -> arriba)
      if (!isInside(x - 1, y)) {
        edges.push({ from: key(x, y + 1), to: key(x, y), fromPt: [x, y + 1], toPt: [x, y] });
      }
    }
  }

  if (edges.length === 0) {
    throw new Error("No se pudo extraer el contorno de la imagen");
  }

  const byFrom = new Map<number, Edge[]>();
  for (const e of edges) {
    const list = byFrom.get(e.from);
    if (list) list.push(e);
    else byFrom.set(e.from, [e]);
  }

  // Empezar en la arista más alta y más a la izquierda (garantiza estar en el contorno exterior)
  let startEdge = edges[0]!;
  for (const e of edges) {
    if (
      e.fromPt[1] < startEdge.fromPt[1] ||
      (e.fromPt[1] === startEdge.fromPt[1] && e.fromPt[0] < startEdge.fromPt[0])
    ) {
      startEdge = e;
    }
  }

  const usedEdges = new Set<string>();
  const edgeKey = (e: Edge): string => `${e.from}->${e.to}`;

  const loop: Point[] = [startEdge.fromPt];
  let cur = startEdge;
  usedEdges.add(edgeKey(cur));
  const startKey = startEdge.from;

  for (let step = 0; step <= edges.length; step++) {
    loop.push(cur.toPt);
    if (cur.to === startKey) break;

    const nextList = byFrom.get(cur.to);
    if (!nextList || nextList.length === 0) break;

    const available = nextList.filter((e) => !usedEdges.has(edgeKey(e)));
    if (available.length === 0) break;

    if (available.length === 1) {
      cur = available[0]!;
    } else {
      // Desempate en vértices de cruce: elegir el giro más cerrado a la derecha en coords de pantalla (y hacia abajo)
      const curDx = cur.toPt[0] - cur.fromPt[0];
      const curDy = cur.toPt[1] - cur.fromPt[1];
      const curAngle = Math.atan2(curDy, curDx);

      let bestIdx = 0;
      let bestDiff = -Infinity;
      for (let i = 0; i < available.length; i++) {
        const cand = available[i]!;
        const candDx = cand.toPt[0] - cand.fromPt[0];
        const candDy = cand.toPt[1] - cand.fromPt[1];
        let diff = Math.atan2(candDy, candDx) - curAngle;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff > bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      cur = available[bestIdx]!;
    }
    usedEdges.add(edgeKey(cur));
  }

  if (loop.length > 1 && loop[0]![0] === loop.at(-1)![0] && loop[0]![1] === loop.at(-1)![1]) {
    loop.pop();
  }

  return loop;
}

function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / Math.sqrt(len2);
}

function rdpOpen(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const a = points[0]!;
  const b = points.at(-1)!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i]!, a, b);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpOpen(points.slice(0, index + 1), epsilon);
    const right = rdpOpen(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

/**
 * Simplifica un polígono cerrado con Ramer-Douglas-Peucker eliminando vértices colineales y redundantes.
 */
export function simplifyPolygon(points: Point[], epsilon?: number): Point[] {
  if (points.length <= 4) return points;

  // 1) Eliminar vértices estrictamente colineales
  const nonCollinear: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (Math.abs(cross) > 1e-6) nonCollinear.push(cur);
  }

  if (nonCollinear.length <= 4) return nonCollinear;

  // Si no se especifica epsilon, calcular un valor proporcional al diámetro de la silueta
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of nonCollinear) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const eps = epsilon !== undefined ? epsilon : Math.max(1.2, diag * 0.015);

  // 2) Partir el polígono cerrado por los dos vértices más lejanos en O(n) y aplicar RDP en cada mitad
  const cx = nonCollinear.reduce((s, p) => s + p[0], 0) / nonCollinear.length;
  const cy = nonCollinear.reduce((s, p) => s + p[1], 0) / nonCollinear.length;

  let idxA = 0;
  let maxDistSqA = -1;
  for (let i = 0; i < nonCollinear.length; i++) {
    const p = nonCollinear[i]!;
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d > maxDistSqA) {
      maxDistSqA = d;
      idxA = i;
    }
  }

  let idxB = 0;
  let maxDistSqB = -1;
  const ptA = nonCollinear[idxA]!;
  for (let i = 0; i < nonCollinear.length; i++) {
    const p = nonCollinear[i]!;
    const d = (p[0] - ptA[0]) ** 2 + (p[1] - ptA[1]) ** 2;
    if (d > maxDistSqB) {
      maxDistSqB = d;
      idxB = i;
    }
  }

  const half1: Point[] = [];
  for (let i = idxA; ; i = (i + 1) % nonCollinear.length) {
    half1.push(nonCollinear[i]!);
    if (i === idxB) break;
  }
  const half2: Point[] = [];
  for (let i = idxB; ; i = (i + 1) % nonCollinear.length) {
    half2.push(nonCollinear[i]!);
    if (i === idxA) break;
  }

  const simp1 = rdpOpen(half1, eps);
  const simp2 = rdpOpen(half2, eps);
  const result = simp1.slice(0, -1).concat(simp2.slice(0, -1));
  return result.length >= 3 ? result : nonCollinear;
}

/**
 * Construye una Shape a partir de un polígono 2D normalizado.
 * Reutiliza el motor de corte y profundidad de `jigsaw/`.
 */
export function shapeFromPolygon(polygon: Point[], options: ImageShapeOptions = {}): Shape {
  if (polygon.length < 3) {
    throw new Error("El polígono de la forma debe tener al menos 3 vértices");
  }

  // Asegurar orientación horaria (área con signo positiva en coordenadas de pantalla SVG)
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  const cw = sum >= 0 ? polygon : [...polygon].reverse();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of cw) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const boxW = Math.max(1e-6, maxX - minX);
  const boxH = Math.max(1e-6, maxY - minY);
  const baseArea = polygonArea(cw);

  const id = options.id ?? "image";
  const label = options.label ?? "Imagen (PNG)";
  const origW = options.origW ?? Math.max(boxW, maxX);
  const origH = options.origH ?? Math.max(boxH, maxY);

  return {
    id,
    label,
    imageMeta: options.dataUrl
      ? {
          dataUrl: options.dataUrl,
          origW,
          origH,
          minX,
          minY,
          boxW,
          boxH,
        }
      : undefined,
    coverage(width: number, height: number): number {
      const scale = Math.min(width / boxW, height / boxH);
      const scaledArea = baseArea * scale * scale;
      const sheetArea = width * height;
      return Math.max(0.05, Math.min(1, scaledArea / sheetArea));
    },
    clip(width: number, height: number): Point[] {
      const scale = Math.min(width / boxW, height / boxH);
      const scaledW = boxW * scale;
      const scaledH = boxH * scale;
      const offsetX = (width - scaledW) / 2;
      const offsetY = (height - scaledH) / 2;

      return cw.map(([x, y]): Point => [
        (x - minX) * scale + offsetX,
        (y - minY) * scale + offsetY,
      ]);
    },
  };
}

/**
 * Construye una forma rectangular con las proporciones naturales de la imagen,
 * sin recortar la silueta: la lámina adopta la relación de aspecto de la imagen
 * (la forma se centra y se inscribe dentro de la lámina).
 */
export function rectShapeFromImage(origW: number, origH: number, options: ImageShapeOptions = {}): Shape {
  const w = Math.max(1e-6, origW);
  const h = Math.max(1e-6, origH);
  return shapeFromPolygon(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    { ...options, origW: w, origH: h },
  );
}

function turnAngle(pPrev: Point, pCur: Point, pNext: Point): number {
  const d1x = pCur[0] - pPrev[0];
  const d1y = pCur[1] - pPrev[1];
  const d2x = pNext[0] - pCur[0];
  const d2y = pNext[1] - pCur[1];
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  if (l1 === 0 || l2 === 0) return 0;
  const dot = (d1x * d2x + d1y * d2y) / (l1 * l2);
  const cross = (d1x * d2y - d1y * d2x) / (l1 * l2);
  return Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
}

/**
 * Suaviza un polígono aplicando curvas Bézier sólo en las zonas curvas,
 * preservando de forma exacta esquinas afiladas (puntas exteriores y esquinas invertidas como
 * la hendidura superior del corazón) y tramos rectos.
 */
export function smoothBezierPolygon(
  pts: Point[],
  iterations = 2,
  cornerThresholdDeg = 42,
): Point[] {
  if (pts.length < 3) return pts;

  const n0 = pts.length;
  const isCorner = new Uint8Array(n0);
  for (let i = 0; i < n0; i++) {
    const prev = pts[(i - 1 + n0) % n0]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n0]!;
    if (turnAngle(prev, cur, next) >= cornerThresholdDeg) {
      isCorner[i] = 1;
    }
  }

  let current = pts;
  let corners = isCorner;

  for (let it = 0; it < iterations; it++) {
    const n = current.length;
    const nextPts: Point[] = [];
    const nextCorners: number[] = [];

    for (let i = 0; i < n; i++) {
      const p1 = current[i]!;
      const p2 = current[(i + 1) % n]!;
      const c1 = corners[i] === 1;
      const c2 = corners[(i + 1) % n] === 1;

      if (c1 && c2) {
        // Tramo recto entre dos esquinas afiladas: se mantiene exactamente recto
        nextPts.push(p1);
        nextCorners.push(1);
      } else if (c1 && !c2) {
        // Vértice en esquina afilada (exterior o invertida): ancla fija y subdivide hacia la curva
        nextPts.push(p1);
        nextCorners.push(1);
        nextPts.push([0.4 * p1[0] + 0.6 * p2[0], 0.4 * p1[1] + 0.6 * p2[1]]);
        nextCorners.push(0);
      } else if (!c1 && c2) {
        // Curva que llega a una esquina afilada
        nextPts.push([0.6 * p1[0] + 0.4 * p2[0], 0.6 * p1[1] + 0.4 * p2[1]]);
        nextCorners.push(0);
      } else {
        // Zona curva continua: subdivisión Bézier suave
        nextPts.push([0.75 * p1[0] + 0.25 * p2[0], 0.75 * p1[1] + 0.25 * p2[1]]);
        nextCorners.push(0);
        nextPts.push([0.25 * p1[0] + 0.75 * p2[0], 0.25 * p1[1] + 0.75 * p2[1]]);
        nextCorners.push(0);
      }
    }
    current = nextPts;
    corners = new Uint8Array(nextCorners);
  }

  return current;
}

/**
 * Flujo completo a partir de una máscara:
 * máscara → isla más grande → contorno simplificado → curvas Bézier suaves → Shape
 */
export function shapeFromMask(mask: ImageMask, options: ImageShapeOptions = {}): Shape {
  const singleIsland = keepLargestIsland(mask);
  const rawContour = maskToContour(singleIsland);

  // Escalar los vértices del contorno (en coords de la máscara) a las dimensiones naturales de la imagen
  const origW = options.origW ?? mask.width;
  const origH = options.origH ?? mask.height;
  const scaleX = origW / mask.width;
  const scaleY = origH / mask.height;

  const naturalContour =
    scaleX !== 1 || scaleY !== 1
      ? rawContour.map(([x, y]): Point => [x * scaleX, y * scaleY])
      : rawContour;

  const simplified = simplifyPolygon(naturalContour, options.epsilon);
  const curved = smoothBezierPolygon(simplified, 2);
  return shapeFromPolygon(curved, {
    ...options,
    origW,
    origH,
  });
}

async function decodeBrowser(
  bytes: Uint8Array,
  mime = "image/png",
): Promise<{ width: number; height: number; rgba: Uint8Array | Uint8ClampedArray; origW: number; origH: number } | null> {
  if (typeof createImageBitmap === "undefined" || typeof Blob === "undefined") {
    return null;
  }
  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
    const bmp = await createImageBitmap(blob);
    const origW = bmp.width;
    const origH = bmp.height;
    let w = origW;
    let h = origH;
    const maxDim = Math.max(w, h);
    if (maxDim > 500) {
      const scale = 500 / maxDim;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    let data: Uint8ClampedArray;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } else {
      return null;
    }
    return { width: w, height: h, rgba: data, origW, origH };
  } catch {
    return null;
  }
}

/**
 * Decodifica un raster (PNG, JPG, WebP…) a píxeles RGBA 8-bit.
 * En el navegador usa createImageBitmap (soporta más formatos y da el tamaño natural);
 * fuera del navegador cae al decodificador PNG puro.
 */
export async function decodeRaster(
  bytes: Uint8Array,
  mime = "image/png",
): Promise<{ width: number; height: number; rgba: Uint8Array | Uint8ClampedArray; origW: number; origH: number }> {
  const browserDecoded = await decodeBrowser(bytes, mime);
  if (browserDecoded) return browserDecoded;
  return decodePng(bytes);
}

/**
 * Flujo completo desde bytes de un archivo raster (PNG / JPG):
 * bytes → RGBA → máscara → isla más grande → contorno simplificado → Shape (y registra la forma).
 */
export async function shapeFromPng(
  bytes: Uint8Array,
  options: ImageShapeOptions = {},
): Promise<Shape> {
  const decoded = await decodeRaster(bytes, options.mime);
  const { width, height, rgba } = decoded;
  const origW = options.origW ?? decoded.origW;
  const origH = options.origH ?? decoded.origH;
  const mask = maskFromRgba(width, height, rgba, options.threshold);
  const shape = shapeFromMask(mask, {
    ...options,
    origW,
    origH,
  });
  registerShape(shape);
  return shape;
}

/**
 * Parsea un path SVG (atributo d) y lo muestrea en una polilínea densa Point[].
 * Soporta comandos absolutos y relativos: M, m, L, l, H, h, V, v, C, c, S, s, Q, q, T, t, A, a, Z, z.
 */
export function parseSvgPath(d: string, perSeg = 6): Point[] {
  const tokens = d.match(/([a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi);
  if (!tokens) return [];

  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  let lastC2X = 0, lastC2Y = 0;
  let lastQ1X = 0, lastQ1Y = 0;
  let lastCmd = "";

  const points: Point[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (/^[a-df-z]$/i.test(token)) {
      lastCmd = token;
      i++;
      if (i >= tokens.length) break;
    }

    const isRel = lastCmd === lastCmd.toLowerCase();
    const cmd = lastCmd.toUpperCase();

    if (cmd === "M") {
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      curX = x; curY = y;
      startX = x; startY = y;
      lastC2X = x; lastC2Y = y;
      lastQ1X = x; lastQ1Y = y;
      points.push([curX, curY]);
      lastCmd = isRel ? "l" : "L";
    } else if (cmd === "L") {
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      curX = x; curY = y;
      lastC2X = x; lastC2Y = y;
      lastQ1X = x; lastQ1Y = y;
      points.push([curX, curY]);
    } else if (cmd === "H") {
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      curX = x;
      lastC2X = x; lastC2Y = curY;
      lastQ1X = x; lastQ1Y = curY;
      points.push([curX, curY]);
    } else if (cmd === "V") {
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      curY = y;
      lastC2X = curX; lastC2Y = y;
      lastQ1X = curX; lastQ1Y = y;
      points.push([curX, curY]);
    } else if (cmd === "C") {
      const x1 = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y1 = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      const x2 = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y2 = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);

      const p0x = curX, p0y = curY;
      for (let step = 1; step <= perSeg; step++) {
        const t = step / perSeg;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const e = t * t * t;
        points.push([
          a * p0x + b * x1 + c * x2 + e * x,
          a * p0y + b * y1 + c * y2 + e * y,
        ]);
      }
      lastC2X = x2; lastC2Y = y2;
      curX = x; curY = y;
    } else if (cmd === "S") {
      const isPrevC = /^[CS]$/i.test(tokens[i - 1] ?? "");
      const x1 = isPrevC ? 2 * curX - lastC2X : curX;
      const y1 = isPrevC ? 2 * curY - lastC2Y : curY;
      const x2 = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y2 = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);

      const p0x = curX, p0y = curY;
      for (let step = 1; step <= perSeg; step++) {
        const t = step / perSeg;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const e = t * t * t;
        points.push([
          a * p0x + b * x1 + c * x2 + e * x,
          a * p0y + b * y1 + c * y2 + e * y,
        ]);
      }
      lastC2X = x2; lastC2Y = y2;
      curX = x; curY = y;
    } else if (cmd === "Q") {
      const x1 = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y1 = parseFloat(tokens[i++]!) + (isRel ? curY : 0);
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);

      const p0x = curX, p0y = curY;
      for (let step = 1; step <= perSeg; step++) {
        const t = step / perSeg;
        const mt = 1 - t;
        const a = mt * mt;
        const b = 2 * mt * t;
        const c = t * t;
        points.push([
          a * p0x + b * x1 + c * x,
          a * p0y + b * y1 + c * y,
        ]);
      }
      lastQ1X = x1; lastQ1Y = y1;
      curX = x; curY = y;
    } else if (cmd === "T") {
      const isPrevQ = /^[QT]$/i.test(tokens[i - 1] ?? "");
      const x1 = isPrevQ ? 2 * curX - lastQ1X : curX;
      const y1 = isPrevQ ? 2 * curY - lastQ1Y : curY;
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);

      const p0x = curX, p0y = curY;
      for (let step = 1; step <= perSeg; step++) {
        const t = step / perSeg;
        const mt = 1 - t;
        const a = mt * mt;
        const b = 2 * mt * t;
        const c = t * t;
        points.push([
          a * p0x + b * x1 + c * x,
          a * p0y + b * y1 + c * y,
        ]);
      }
      lastQ1X = x1; lastQ1Y = y1;
      curX = x; curY = y;
    } else if (cmd === "A") {
      let rx = Math.abs(parseFloat(tokens[i++]!));
      let ry = Math.abs(parseFloat(tokens[i++]!));
      const rotDeg = parseFloat(tokens[i++]!);
      const largeArc = parseFloat(tokens[i++]!) !== 0;
      const sweep = parseFloat(tokens[i++]!) !== 0;
      const x = parseFloat(tokens[i++]!) + (isRel ? curX : 0);
      const y = parseFloat(tokens[i++]!) + (isRel ? curY : 0);

      if (rx === 0 || ry === 0) {
        curX = x; curY = y;
        points.push([curX, curY]);
      } else {
        const phi = (rotDeg * Math.PI) / 180;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const dx2 = (curX - x) / 2;
        const dy2 = (curY - y) / 2;
        const x1p = cosPhi * dx2 + sinPhi * dy2;
        const y1p = -sinPhi * dx2 + cosPhi * dy2;

        let rxSq = rx * rx;
        let rySq = ry * ry;
        const x1pSq = x1p * x1p;
        const y1pSq = y1p * y1p;

        const radCheck = x1pSq / rxSq + y1pSq / rySq;
        if (radCheck > 1) {
          const s = Math.sqrt(radCheck);
          rx *= s; ry *= s;
          rxSq = rx * rx; rySq = ry * ry;
        }

        const sign = largeArc === sweep ? -1 : 1;
        const num = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
        const den = rxSq * y1pSq + rySq * x1pSq;
        const coef = sign * Math.sqrt(num / den);
        const cxp = (coef * (rx * y1p)) / ry;
        const cyp = (coef * -(ry * x1p)) / rx;

        const cx = cosPhi * cxp - sinPhi * cyp + (curX + x) / 2;
        const cy = sinPhi * cxp + cosPhi * cyp + (curY + y) / 2;

        const ux = (x1p - cxp) / rx;
        const uy = (y1p - cyp) / ry;
        const vx = (-x1p - cxp) / rx;
        const vy = (-y1p - cyp) / ry;

        const angleBetween = (v1x: number, v1y: number, v2x: number, v2y: number): number => {
          const dot = v1x * v2x + v1y * v2y;
          const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
          const ang = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
          return v1x * v2y - v1y * v2x < 0 ? -ang : ang;
        };

        const theta1 = angleBetween(1, 0, ux, uy);
        let dTheta = angleBetween(ux, uy, vx, vy);
        if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
        else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

        const arcSteps = Math.max(perSeg, Math.ceil(Math.abs(dTheta) / (Math.PI / 6)));
        for (let step = 1; step <= arcSteps; step++) {
          const t = step / arcSteps;
          const theta = theta1 + dTheta * t;
          const px = rx * Math.cos(theta);
          const py = ry * Math.sin(theta);
          points.push([
            cosPhi * px - sinPhi * py + cx,
            sinPhi * px + cosPhi * py + cy,
          ]);
        }
        curX = x; curY = y;
      }
    } else if (cmd === "Z") {
      curX = startX; curY = startY;
      lastC2X = curX; lastC2Y = curY;
      points.push([curX, curY]);
    } else {
      i++;
    }
  }

  return points;
}

/**
 * Extrae todos los polígonos cerrados contenidos en un texto SVG (<path>, <polygon>, <polyline>).
 */
export function extractSvgPolygons(svgText: string): Point[][] {
  const polys: Point[][] = [];

  const pathRegex = /<path[^>]*\bd=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(svgText)) !== null) {
    const d = match[1]!;
    const subpaths = d.split(/(?=[Mm])/).filter((s) => s.trim().length > 0);
    for (const sp of subpaths) {
      const pts = parseSvgPath(sp, 6);
      if (pts.length >= 3) {
        polys.push(pts);
      }
    }
  }

  const polyRegex = /<(?:polygon|polyline)[^>]*\bpoints=["']([^"']+)["'][^>]*>/gi;
  while ((match = polyRegex.exec(svgText)) !== null) {
    const raw = match[1]!;
    const nums = raw.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const pts: Point[] = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      pts.push([nums[i]!, nums[i + 1]!]);
    }
    if (pts.length >= 3) polys.push(pts);
  }

  return polys;
}

/**
 * Flujo completo desde el contenido de un archivo SVG:
 * SVG text → extracción de polígonos → selección de la silueta mayor → normalización de viewBox → Shape.
 */
export function shapeFromSvg(svgText: string, options: ImageShapeOptions = {}): Shape {
  const polys = extractSvgPolygons(svgText);
  if (polys.length === 0) {
    throw new Error("No se encontró ningún trazado (<path> o <polygon>) en el archivo SVG");
  }

  // Conservar el polígono de mayor área (la silueta principal)
  polys.sort((a, b) => polygonArea(b) - polygonArea(a));
  const mainPoly = polys[0]!;

  // Extraer viewBox o dimensiones para determinar origW / origH y compensar desfases de origen
  let vbMinX = 0;
  let vbMinY = 0;
  let origW = options.origW;
  let origH = options.origH;

  const vbMatch = svgText.match(
    /viewBox=["']\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*["']/i,
  );
  if (vbMatch) {
    vbMinX = parseFloat(vbMatch[1]!);
    vbMinY = parseFloat(vbMatch[2]!);
    const vbW = parseFloat(vbMatch[3]!);
    const vbH = parseFloat(vbMatch[4]!);
    if (vbW > 0 && vbH > 0) {
      origW = origW ?? vbW;
      origH = origH ?? vbH;
    }
  } else {
    const wMatch = svgText.match(/\bwidth=["']\s*([-+]?\d*\.?\d+)/i);
    const hMatch = svgText.match(/\bheight=["']\s*([-+]?\d*\.?\d+)/i);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]!);
      const h = parseFloat(hMatch[1]!);
      if (w > 0 && h > 0) {
        origW = origW ?? w;
        origH = origH ?? h;
      }
    }
  }

  // Ajustar coordenadas relativas al origen del viewBox
  const normalized = (vbMinX !== 0 || vbMinY !== 0)
    ? mainPoly.map(([x, y]): Point => [x - vbMinX, y - vbMinY])
    : mainPoly;

  const simplified = simplifyPolygon(normalized, options.epsilon ?? 0.6);
  const dataUrl = options.dataUrl ?? `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
  const shape = shapeFromPolygon(simplified, {
    ...options,
    dataUrl,
    origW,
    origH,
  });

  registerShape(shape);
  return shape;
}
