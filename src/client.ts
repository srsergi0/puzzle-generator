import { decodeRaster, maskFromRgba, rectShapeFromImage, shapeFromMask, shapeFromSvg } from "./image-shape.ts";
import {
  buildPuzzle,
  getShape,
  polygonPath,
  registerShape,
  toSvg,
  type Puzzle,
  type Shape,
} from "./jigsaw/index.ts";

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`falta el elemento ${sel}`);
  return el;
};

const preview = $<HTMLDivElement>("#preview");
const errorEl = $<HTMLPreElement>("#error");
const seedInput = $<HTMLInputElement>("#seed");
const colorInput = $<HTMLInputElement>("#color");
const numbersInput = $<HTMLInputElement>("#numbers");
const shapeSelect = $<HTMLSelectElement>("#shape");
const styleSelect = $<HTMLSelectElement>("#style");
const imageInput = $<HTMLInputElement>("#image-shape-input");
const uploadBtn = $<HTMLButtonElement>("#upload-image-btn");
const imageInfo = $<HTMLElement>("#image-shape-info");
const imageModeBox = $<HTMLDivElement>("#image-mode-box");
const silhouetteInput = $<HTMLInputElement>("#use-silhouette");
const fitSheetBtn = $<HTMLButtonElement>("#fit-sheet-btn");
const imageOpacityBox = $<HTMLDivElement>("#image-opacity-box");
const imgThumb = $<HTMLImageElement>("#img-thumb");
const imgOpacityRange = $<HTMLInputElement>("#img-opacity");
const imgOpacityNum = $<HTMLInputElement>("#img-opacity-num");
const imgOpacityOut = $<HTMLElement>("#img-opacity-out");

let currentImageUrl: string | null = null;

/** Imagen ya procesada: guarda ambas variantes para alternar sin volver a decodificar. */
interface LoadedImage {
  label: string;
  kind: string;
  isSvg: boolean;
  origW: number;
  origH: number;
  silhouette: Shape | null;
  rect: Shape | null;
  silhouetteError: string | null;
}

let loadedImage: LoadedImage | null = null;

function fileKind(file: File, isSvg: boolean): string {
  if (isSvg) return "SVG";
  const ext = (file.name.toLowerCase().split(".").pop() ?? "") as string;
  if (ext === "jpg" || ext === "jpeg" || file.type === "image/jpeg") return "JPG";
  if (ext === "png" || file.type === "image/png") return "PNG";
  if (ext === "webp" || file.type === "image/webp") return "WEBP";
  return file.type.replace(/^image\//, "").toUpperCase() || "Imagen";
}

function imageOption(): HTMLOptionElement {
  let opt = shapeSelect.querySelector<HTMLOptionElement>('option[value="image"]');
  if (!opt) {
    opt = document.createElement("option");
    opt.value = "image";
    shapeSelect.appendChild(opt);
  }
  return opt;
}

/** Muestra/oculta los controles dependientes de la imagen cargada. */
function syncImageBoxes(): void {
  const img = loadedImage;
  const active = shapeSelect.value === "image" && img !== null;
  imageModeBox.style.display = active && img !== null && !img.isSvg ? "block" : "none";
  imageOpacityBox.style.display = active && currentImageUrl ? "block" : "none";
  fitSheetBtn.style.display =
    active && img !== null && img.rect !== null && !silhouetteInput.checked ? "block" : "none";
}

/**
 * Registra y activa la variante de forma elegida (silueta o rectángulo con las
 * proporciones de la imagen) y actualiza la UI asociada.
 */
function applyImageShape(): void {
  const img = loadedImage;
  if (!img) return;

  const useSilhouette = img.silhouette !== null && (img.rect === null || silhouetteInput.checked);
  const shape = (useSilhouette ? img.silhouette : img.rect) ?? img.silhouette;
  if (!shape) return;

  registerShape(shape);
  const opt = imageOption();
  opt.textContent = useSilhouette ? `🖼️ ${img.label}` : `🖼️ ${img.label} (rectángulo)`;
  shapeSelect.value = "image";

  const dims = `${Math.round(img.origW)}×${Math.round(img.origH)}`;
  if (useSilhouette) {
    imageInfo.textContent = `Silueta: ${img.label} (${img.kind} · ${dims} px)`;
  } else if (img.silhouetteError) {
    imageInfo.textContent = `Sin silueta extraíble → rectángulo ${dims} · ${img.kind}`;
  } else {
    imageInfo.textContent = `Rectángulo con proporciones de la imagen: ${img.label} (${img.kind} · ${dims} px)`;
  }
  imageInfo.style.display = "block";

  syncImageBoxes();
  schedule(0);
}

function setPair(kind: string, value: number): void {
  const raw = String(value);
  for (const el of pairInputs(kind)) el.value = raw;
}

/**
 * Ajusta la lámina (ancho × largo) a la proporción de la imagen cargada,
 * encajándola dentro de las medidas actuales ("contain": nunca agranda la lámina).
 */
function fitSheetToImage(): void {
  const img = loadedImage;
  if (!img || img.origW <= 0 || img.origH <= 0) return;

  const aspect = img.origW / img.origH;
  const wInputs = pairInputs("w");
  const hInputs = pairInputs("h");
  const lo = Number(wInputs[0]!.min);
  const hi = Number(wInputs[0]!.max);
  const step = Number(wInputs[0]!.step) || 0.5;
  const round = (v: number): number => clamp(Math.round(v / step) * step, lo, hi);

  const w0 = Number(wInputs[0]!.value);
  const h0 = Number(hInputs[0]!.value);
  const w = round(Math.min(w0, h0 * aspect));
  const h = round(w / aspect);

  setPair("w", w);
  setPair("h", h);
  updateOutBadge("w", w);
  updateOutBadge("h", h);
  schedule(0);
}

const out: Record<"w" | "h" | "n" | "wave" | "minArea" | "maxArea", HTMLElement> = {
  w: $<HTMLElement>("#w-out"),
  h: $<HTMLElement>("#h-out"),
  n: $<HTMLElement>("#n-out"),
  wave: $<HTMLElement>("#wave-out"),
  minArea: $<HTMLElement>("#minArea-out"),
  maxArea: $<HTMLElement>("#maxArea-out"),
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function pairInputs(kind: string): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-pair="${kind}"]`));
}

function updateOutBadge(kind: string, val: number): void {
  if (kind === "w") out.w.textContent = `${val} cm`;
  else if (kind === "h") out.h.textContent = `${val} cm`;
  else if (kind === "n") out.n.textContent = `${val} solicitadas`;
  else if (kind === "wave") out.wave.textContent = `${Math.round(val)} %`;
  else if (kind === "minArea") out.minArea.textContent = `${Math.round(val)} %`;
  else if (kind === "maxArea") out.maxArea.textContent = `${Math.round(val)} %`;
}

/** Slider y campo numérico espejados; devuelve cómo leer el valor actual. */
function wirePair(kind: string): () => number {
  const inputs = pairInputs(kind);
  const range = inputs.find((el) => el.type === "range")!;
  const number = inputs.find((el) => el.type === "number")!;
  const lo = Number(range.min);
  const hi = Number(range.max);

  range.addEventListener("input", () => {
    number.value = range.value;
    updateOutBadge(kind, Number(range.value));
    schedule(160);
  });

  range.addEventListener("change", () => {
    updateOutBadge(kind, Number(range.value));
    schedule(0);
  });

  number.addEventListener("input", () => {
    const v = Number(number.value);
    if (number.value === "" || !Number.isFinite(v)) return;
    if (v >= lo && v <= hi) {
      range.value = String(v);
      updateOutBadge(kind, v);
      schedule(220);
    }
  });

  number.addEventListener("change", () => {
    const raw = Number(number.value);
    const v = Number.isFinite(raw) ? clamp(raw, lo, hi) : Number(range.value);
    number.value = String(v);
    range.value = String(v);
    updateOutBadge(kind, v);
    schedule(0);
  });

  return () => Number(range.value);
}

const readW = wirePair("w");
const readH = wirePair("h");
const readN = wirePair("n");
const readWave = wirePair("wave");
const readMinArea = wirePair("minArea");
const readMaxArea = wirePair("maxArea");

interface State {
  w: number;
  h: number;
  n: number;
  wave: number;
  minArea: number;
  maxArea: number;
  shape: string;
  style: string;
  seed: number;
  color: boolean;
  numbers: boolean;
}

function readState(): State {
  return {
    w: readW(),
    h: readH(),
    n: readN(),
    wave: readWave() / 100,
    minArea: readMinArea() / 100,
    maxArea: readMaxArea() / 100,
    shape: shapeSelect.value,
    style: styleSelect.value,
    seed: Math.max(0, Math.trunc(Number(seedInput.value) || 0)),
    color: colorInput.checked,
    numbers: numbersInput.checked,
  };
}

function query(state: State): string {
  return new URLSearchParams({
    w: String(state.w),
    h: String(state.h),
    n: String(state.n),
    wave: String(state.wave),
    minArea: String(state.minArea),
    maxArea: String(state.maxArea),
    shape: state.shape,
    seed: String(state.seed),
    color: state.color ? "1" : "0",
    numbers: state.numbers ? "1" : "0",
  }).toString();
}

let current: { puzzle: Puzzle; svg: string } | null = null;

function render(): void {
  const state = readState();
  let puzzle: Puzzle;
  try {
    puzzle = buildPuzzle(state.w, state.h, state.n, {
      seed: state.seed,
      wave: state.wave,
      shape: state.shape,
      style: state.style,
      minArea: state.minArea,
      maxArea: state.maxArea,
    });
    const shapeObj = getShape(state.shape);
    let imageOverlay = undefined;
    const opacityPct = Number(imgOpacityRange.value);
    if (state.shape === "image" && shapeObj.imageMeta && opacityPct > 0) {
      const { dataUrl, minX, minY, boxW, boxH, origW, origH } = shapeObj.imageMeta;
      const sheetW = state.w * 10;
      const sheetH = state.h * 10;
      const scale = Math.min(sheetW / boxW, sheetH / boxH);
      const scaledW = boxW * scale;
      const scaledH = boxH * scale;
      const offsetX = (sheetW - scaledW) / 2;
      const offsetY = (sheetH - scaledH) / 2;
      const clipPts = shapeObj.clip(sheetW, sheetH);
      const clipPathD = polygonPath(clipPts).toD();
      imageOverlay = {
        href: dataUrl,
        opacity: opacityPct / 100,
        x: offsetX - minX * scale,
        y: offsetY - minY * scale,
        width: origW * scale,
        height: origH * scale,
        clipPathD,
      };
    }
    const svg = toSvg(puzzle, { color: state.color, numbers: state.numbers, imageOverlay });
    preview.innerHTML = svg;
    current = { puzzle, svg };
    errorEl.style.display = "none";
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.style.display = "block";
    return;
  }

  const { rows, cols } = puzzle;
  out.w.textContent = `${state.w} cm`;
  out.h.textContent = `${state.h} cm`;
  out.n.textContent = `${state.n} solicitadas`;
  out.wave.textContent = `${Math.round(state.wave * 100)} %`;
  out.minArea.textContent = `${Math.round(state.minArea * 100)} %`;
  out.maxArea.textContent = `${Math.round(state.maxArea * 100)} %`;
  $<HTMLElement>("#m-count").textContent = String(puzzle.pieces.length);
  $<HTMLElement>("#m-grid").textContent = `${rows} × ${cols}`;
  $<HTMLElement>("#m-size").textContent =
    `${(state.w / cols).toFixed(1)} × ${(state.h / rows).toFixed(1)} cm`;
  $<HTMLElement>("#m-sheet").textContent = `${state.w} × ${state.h} cm`;
  $<HTMLElement>("#m-drop").textContent = String(puzzle.dropped);

  const noCut = state.shape === "rect";
  for (const el of [...pairInputs("minArea"), ...pairInputs("maxArea")]) el.disabled = noCut;

  preview.style.aspectRatio = `${state.w} / ${state.h}`;
  preview.style.width = `min(100%, calc(72vh * ${state.w / state.h}))`;

  const params = query(state);
  history.replaceState(null, "", `#${params}`);
  seedInput.value = String(state.seed);
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let animFrame: number | null = null;

function schedule(delayMs = 160): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  if (delayMs <= 0) {
    animFrame = requestAnimationFrame(() => {
      animFrame = null;
      render();
    });
  } else {
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      animFrame = requestAnimationFrame(() => {
        animFrame = null;
        render();
      });
    }, delayMs);
  }
}

function download(): void {
  if (!current) return;
  const { rows, cols } = current.puzzle;
  const url = URL.createObjectURL(new Blob([current.svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `puzzle-${rows}x${cols}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

$<HTMLButtonElement>("#download").addEventListener("click", download);
$<HTMLButtonElement>("#open").addEventListener("click", () => {
  if (current && current.svg) {
    const blob = new Blob([current.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } else {
    window.open(`/api/puzzle.svg?${query(readState())}`, "_blank");
  }
});
$<HTMLButtonElement>("#variant").addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  schedule(0);
});

uploadBtn.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  try {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "⏳ Procesando archivo...";
    if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = URL.createObjectURL(file);
    imgThumb.src = currentImageUrl;

    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    const label = file.name.replace(/\.[^.]+$/, "") || (isSvg ? "SVG" : "Imagen");
    const kind = fileKind(file, isSvg);
    const opts = { id: "image", label, dataUrl: currentImageUrl };

    let silhouette: Shape | null = null;
    let rect: Shape | null = null;
    let silhouetteError: string | null = null;
    let origW = 0;
    let origH = 0;

    if (isSvg) {
      // El SVG ya ES su propio trazado: no hay variante "rectángulo".
      silhouette = shapeFromSvg(await file.text(), opts);
      origW = silhouette.imageMeta?.origW ?? 0;
      origH = silhouette.imageMeta?.origH ?? 0;
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await decodeRaster(bytes, file.type || "image/png");
      origW = decoded.origW;
      origH = decoded.origH;
      try {
        silhouette = shapeFromMask(maskFromRgba(decoded.width, decoded.height, decoded.rgba), {
          ...opts,
          origW,
          origH,
        });
      } catch (err) {
        // JPG sin silueta reconocible (fondo uniforme, etc.): se sigue pudiendo usar el rectángulo.
        silhouetteError = err instanceof Error ? err.message : String(err);
      }
      rect = rectShapeFromImage(origW, origH, { ...opts, origW, origH });
    }

    loadedImage = { label, kind, isSvg, origW, origH, silhouette, rect, silhouetteError };
    silhouetteInput.disabled = silhouette === null || rect === null;
    if (silhouette === null) silhouetteInput.checked = false;

    applyImageShape();
    errorEl.style.display = "none";
  } catch (err) {
    errorEl.textContent = `Error al procesar el archivo: ${err instanceof Error ? err.message : String(err)}`;
    errorEl.style.display = "block";
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "🖼️ Cargar imagen (PNG / JPG / SVG)";
    imageInput.value = "";
  }
});

silhouetteInput.addEventListener("change", () => applyImageShape());
fitSheetBtn.addEventListener("click", () => fitSheetToImage());

function onOpacityChange(valStr: string): void {
  const val = clamp(Number(valStr) || 0, 0, 100);
  imgOpacityRange.value = String(val);
  imgOpacityNum.value = String(val);
  imgOpacityOut.textContent = `${val}%`;
  const overlay = preview.querySelector<SVGGElement>("#svg-image-overlay");
  if (overlay) {
    overlay.setAttribute("opacity", String(val / 100));
    overlay.style.display = val === 0 ? "none" : "block";
  } else {
    schedule();
  }
}

imgOpacityRange.addEventListener("input", () => onOpacityChange(imgOpacityRange.value));
imgOpacityNum.addEventListener("input", () => onOpacityChange(imgOpacityNum.value));

seedInput.addEventListener("input", () => schedule(200));
seedInput.addEventListener("change", () => schedule(0));
colorInput.addEventListener("change", () => schedule(0));
numbersInput.addEventListener("change", () => schedule(0));
shapeSelect.addEventListener("change", () => {
  syncImageBoxes();
  schedule(0);
});
styleSelect.addEventListener("change", () => schedule(0));

function setPercentPair(kind: string, fraction: number): void {
  const inputs = pairInputs(kind);
  const lo = Number(inputs[0]!.min);
  const hi = Number(inputs[0]!.max);
  const v = clamp(fraction * 100, lo, hi);
  for (const el of inputs) {
    el.value = String(Number.isFinite(v) ? Math.round(v / Number(inputs[0]!.step)) * Number(inputs[0]!.step) : el.value);
  }
}

function applyHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.size === 0) return;
  for (const kind of ["w", "h", "n"] as const) {
    const raw = p.get(kind);
    if (raw === null) continue;
    const inputs = pairInputs(kind);
    const v = clamp(Number(raw), Number(inputs[0]!.min), Number(inputs[0]!.max));
    for (const el of inputs) el.value = String(Number.isFinite(v) ? v : el.value);
  }
  if (p.has("wave")) setPercentPair("wave", Number(p.get("wave")));
  if (p.has("minArea")) setPercentPair("minArea", Number(p.get("minArea")));
  if (p.has("maxArea")) setPercentPair("maxArea", Number(p.get("maxArea")));
  if (p.has("shape") && shapeSelect.querySelector(`option[value="${p.get("shape")}"]`)) {
    shapeSelect.value = p.get("shape")!;
  }
  if (p.has("style") && styleSelect.querySelector(`option[value="${p.get("style")}"]`)) {
    styleSelect.value = p.get("style")!;
  }
  if (p.has("seed")) seedInput.value = String(Math.trunc(Number(p.get("seed"))));
  colorInput.checked = p.get("color") === "1";
  numbersInput.checked = p.get("numbers") === "1";
}

applyHash();
render();
