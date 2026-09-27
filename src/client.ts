import { buildPuzzle, toSvg, type Puzzle } from "./jigsaw.ts";

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

/** Slider y campo numérico espejados; devuelve cómo leer el valor actual. */
function wirePair(kind: string): () => number {
  const inputs = pairInputs(kind);
  const range = inputs.find((el) => el.type === "range")!;
  const number = inputs.find((el) => el.type === "number")!;
  const lo = Number(range.min);
  const hi = Number(range.max);

  range.addEventListener("input", () => {
    number.value = range.value;
    schedule();
  });

  number.addEventListener("input", () => {
    const v = Number(number.value);
    if (number.value === "" || !Number.isFinite(v)) return;
    if (v >= lo && v <= hi) {
      range.value = String(v);
      schedule();
    }
  });

  number.addEventListener("change", () => {
    const raw = Number(number.value);
    const v = Number.isFinite(raw) ? clamp(raw, lo, hi) : Number(range.value);
    number.value = String(v);
    range.value = String(v);
    schedule();
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
      minArea: state.minArea,
      maxArea: state.maxArea,
    });
    const svg = toSvg(puzzle, { color: state.color, numbers: state.numbers });
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

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render();
  });
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
  window.open(`/api/puzzle.svg?${query(readState())}`, "_blank");
});
$<HTMLButtonElement>("#variant").addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  schedule();
});

seedInput.addEventListener("input", schedule);
colorInput.addEventListener("change", schedule);
numbersInput.addEventListener("change", schedule);
shapeSelect.addEventListener("change", schedule);

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
  if (p.has("seed")) seedInput.value = String(Math.trunc(Number(p.get("seed"))));
  colorInput.checked = p.get("color") === "1";
  numbersInput.checked = p.get("numbers") === "1";
}

applyHash();
render();
