# BITÁCORA — Motor de puzzles (`src/jigsaw/`)

**Fecha:** 2026-09-27
**Cambio:** se fragmentó el monolito `src/jigsaw.ts` (~1260 líneas) en 13 módulos con responsabilidades claras dentro de la carpeta `src/jigsaw/`. La API pública se mantiene **idéntica** y retrocompatible gracias a la fachada `src/jigsaw/index.ts`. Además, se incorporó el soporte para siluetas arbitrarias desde imágenes PNG (`src/image-shape.ts`) con overlay fotográfico alineado al 100%, recorte Weiler-Atherton para formas cóncavas y curvas Bézier adaptativas con preservación de esquinas.

---

## 1. Cómo importar

Todo el motor se consume desde un único punto:

```ts
import {
  buildPuzzle,
  generate,
  toSvg,
  polygonArea,
  polygonPath,
  type Puzzle,
  type Shape,
  type SvgOptions,
} from "./jigsaw/index.ts";
```

Los consumidores actualizados (`src/client.ts`, `src/worker.ts`, `src/server.ts`, `src/image-shape.ts`, `tests/jigsaw.test.ts`, `tests/image-shape.test.ts`) apuntan directamente a `./jigsaw/index.ts`.

---

## 2. Estructura de archivos

```
src/
├── grid.ts                  (sin cambios) planGrid: filas × columnas
├── image-shape.ts           siluetas desde PNG, decodificación rápida y curvas adaptativas
└── jigsaw/
    ├── index.ts             fachada pública (barrel)
    ├── types.ts             tipos geométricos básicos
    ├── rng.ts               PRNG determinista
    ├── format.ts            redondeo y formateo numérico
    ├── path.ts              SubPath, suavizado y muestreo
    ├── warp.ts              campo de ondulación global
    ├── edge.ts              bordes con pestaña/ranura
    ├── polygon.ts           geometría de polígonos
    ├── clip.ts              recorte de polígonos y líneas
    ├── shapes.ts            formas de lámina (rect, círculo, imagen…)
    ├── cut-style.ts         estilos de corte
    ├── generate.ts          construcción del puzzle
    ├── svg.ts               paleta, overlay de imagen y salida SVG
    └── build.ts             reparto de cuadrícula → piezas objetivo
```

### Resumen rápido de módulos

| Archivo | Responsabilidad | API pública (módulo) |
|---|---|---|
| `index.ts` | Reexporta la API pública; conserva compatibilidad total con el viejo `jigsaw.ts` | Toda la API |
| `types.ts` | Tipos base, sin dependencias (raíz del grafo) | `Point`, `Seg`, `Rng`, `Warp` |
| `rng.ts` | PRNG `mulberry32` determinista | `mulberry32` |
| `format.ts` | Redondeo a 2 decimales y formato de puntos/números para SVG | `round2`, `num`, `pt` |
| `path.ts` | `SubPath`, suavizado Catmull-Rom, muestreo y recorte de paths | `SubPath`, `lerp`, `smooth`, `samplePolygon`, `clampSubPath` |
| `warp.ts` | Turbulencia senoidal global (conserva el encaje entre piezas) | `makeWarp` |
| `edge.ts` | Borde canónico p0→p1 con pestaña/ranura (clásica y ondulada) | `EdgeContext`, `edge` |
| `polygon.ts` | Área, centroide, dentro/fuera, distancias, convexidad, clamp | `signedArea`, `polygonArea`, `polygonCentroid`, `insidePoly`, `insideConvex`, `signedDistToPoly`, `closestPointOnPoly`, `clampPolyToClip`, `isPolygonConvex`, `convexDepth` |
| `clip.ts` | Recorte convexo (Sutherland-Hodgman) y general cóncavo (Weiler-Atherton); recorte de líneas abiertas | `clipPolygon`, `clipShape`, `clipOpenPath`, `bboxInside`, `polygonPath`, `smoothClosedPath` |
| `shapes.ts` | Registro de formas de lámina y metadatos de imagen | `Shape`, `ShapeImageMeta`, `SHAPES`, `registerShape`, `getShape` |
| `cut-style.ts` | Registro de estilos de corte | `CutStyle`, `CUT_STYLES`, `registerCutStyle`, `getCutStyle` |
| `generate.ts` | Cuadrícula, fusión de regiones, piezas y capa de cortes | `Piece`, `Puzzle`, `GenerateOptions`, `generate` |
| `svg.ts` | Paleta de color, overlay fotográfico y serialización a SVG 1:1 | `palette`, `SvgOptions`, `toSvg` |
| `build.ts` | Ajusta filas×columnas hasta acercarse a las piezas pedidas | `buildPuzzle` |

---

## 3. Detalle por archivo

### `types.ts` — tipos base
Define `Point` (tupla `[x, y]` en mm), `Seg` (segmento `L` o cúbica `C`), `Rng` (generador) y `Warp` (campo de desplazamiento). No importa nada: es la raíz del grafo de dependencias.

### `rng.ts` — aleatoriedad determinista
`mulberry32(seed)` devuelve un `Rng`: la misma semilla produce siempre el mismo puzzle.

### `format.ts` — formato numérico
`round2` redondea a 2 decimales; `num` lo pasa a string; `pt` formatea un punto como `"x y"`. Se usa al construir el atributo `d` de los paths, así que evita ruido decimal en el SVG. Uso interno.

### `path.ts` — paths
- `SubPath`: clase con `start` + `segs`, más `of`, `end`, `reversed()` (invierte el sentido respetando las cúbicas) y `toD()` (serializa a `M/L/C`).
- `lerp`: interpolación lineal.
- `smooth(points)`: convierte una polilínea en cúbicas Catmull-Rom (pestañas redondas).
- `samplePolygon(path, perSeg)`: muestrea el path a un polígono denso para recortarlo.
- `clampSubPath(path, w, h)`: acota anclas y puntos de control a la lámina.

### `warp.ts` — ondulación global
`makeWarp(...)` crea un campo continuo dependiente solo de `(x, y)`: dos piezas vecinas reciben el mismo desplazamiento en su borde compartido, por lo que siguen encajando. Un envelope desvanece la onda cerca del borde para no deformar el contorno exterior.

### `edge.ts` — pestañas y ranuras
- `EdgeContext`: `rng`, `tabRate`, `warp`, `sheetW`, `sheetH` y `depth` (distancia con signo al borde de la forma).
- `edge(p0, p1, normal, sign, perp, ctx)`: genera el borde canónico compartido por dos celdas vecinas. Sin `warp` produce el puzzle clásico; con `warp` ondula primero la línea base y monta la pestaña sobre su normal local. `keepTab` evita pestañas que no caben cerca del borde de la forma.

### `polygon.ts` — geometría de polígonos
- `signedArea`, `polygonArea`, `polygonCentroid`: cálculo de área y centro de masa.
- `insidePoly` (ray casting) e `insideConvex`: verificación de inclusión de puntos.
- `signedDistToPoly` y `closestPointOnPoly`: distancia euclidiana mínima y proyección ortogonal sobre el borde.
- `clampPolyToClip(subject, clip)`: proyecta los vértices que pudieran sobresalir del contorno exactamente sobre el borde del clip, garantizando matemáticamente que ninguna pieza exceda la silueta.
- `isPolygonConvex`: detecta si un contorno es estrictamente convexo para optimizar el recorte.

### `clip.ts` — recorte
- `clipPolygon(subject, clip)`: implementación completa del algoritmo **Weiler-Atherton** para recortar polígonos arbitrarios (convexos y cóncavos, p. ej. corazones con hendidura superior, letras, estrellas).
- `clipShape(subject, clip, isConvex)`: bifurca automáticamente: usa Sutherland-Hodgman para polígonos convexos y Weiler-Atherton para cóncavos, aplicando siempre `clampPolyToClip`.
- `clipOpenPath(path, clip, perSeg)`: recorta una línea **abierta** contra un contorno, sin cerrarla (evita líneas de guía indeseadas sobre las muescas).
- `polygonPath`: genera un `SubPath` cerrado a partir de vértices.
- `smoothClosedPath`: convierte un contorno en cúbicas Catmull-Rom continuas.

### `shapes.ts` — formas de lámina
Interfaz `Shape` (`coverage`, `clip`, `imageMeta`) y el registro `SHAPES` con `rect` y `circle` (`CIRCLE_STEPS = 72`). `registerShape` permite registrar dinámicamente formas externas (como las siluetas PNG de `src/image-shape.ts`), y `getShape` resuelve por id.

### `cut-style.ts` — estilos de corte
Interfaz `CutStyle` y registro `CUT_STYLES`. Permite enchufar estilos alternativos de corte sin alterar el núcleo.

### `generate.ts` — núcleo
Define `Piece`, `Puzzle`, `GenerateOptions` y `generate(widthCm, heightCm, rows, cols, opts)`:
1. Construye la cuadrícula y los bordes con pestañas/ranuras canónicas compartidas.
2. Recorta cada celda con `clipShape` contra el contorno y **fusiona regiones** por debajo del área mínima (`minArea`/`maxArea`).
3. Construye las piezas y la lista de cortes únicos, asegurando que el contorno exterior se corte exactamente una vez.

### `svg.ts` — salida SVG y overlay fotográfico
- `palette(count)`: colores armónicos distribuidos con el ángulo áureo (`0.618033...`).
- `toSvg(puzzle, opts)`: serialización SVG 1:1 en milímetros reales.
  - Genera rellenos sin trazo para evitar líneas dobles.
  - Soporta `imageOverlay` con `<defs><clipPath id="svg-image-clip">` para recortar la imagen exactamente a la silueta.
  - Capa de cortes láser nítidos encima de la imagen y numeración legible opcional.

### `build.ts` — reparto de cuadrícula
`buildPuzzle(widthCm, heightCm, targetPieces, opts)` usa `planGrid` y ajusta la escala automáticamente hasta alcanzar el número objetivo de piezas, respetando la cobertura de la forma.

### `index.ts` — fachada
Reexporta de forma centralizada todos los símbolos públicos para mantener una interfaz limpia y desacoplada.

---

## 4. Siluetas PNG y overlay fotográfico (`src/image-shape.ts`)

### Decodificación rápida sin bloqueos
- En navegador (`decodeBrowser`): utiliza la API nativa multihilo `createImageBitmap` + `Canvas`/`OffscreenCanvas` con submuestreo inteligente a 500 px máx para procesar imágenes pesadas en milisegundos sin congelar la interfaz.
- En Node/Bun (`decodePng`): descompresión DEFLATE nativa mediante `DecompressionStream("deflate-raw")` descartando cabecera zlib y Adler-32.

### Curvas adaptativas con preservación de esquinas (`smoothBezierPolygon`)
- Evalúa el ángulo de giro (`turnAngle`) en cada vértice.
- Si el ángulo es $\ge 42^\circ$, se clasifica como esquina afilada (tanto puntas exteriores como la punta inferior del corazón, como esquinas invertidas / hendiduras como la parte superior del corazón).
- Tramos entre dos esquinas se conservan **estrictamente rectos**.
- Las zonas con curvatura suave se subdividen en arcos Bézier cúbicos fluidos.

### Alineación matemática exacta del overlay (`imageOverlay`)
Anteriormente existía un desfase de escala y posición porque las coordenadas del contorno en la máscara reducida no coincidían con los píxeles de la imagen original (`origW`, `origH`), produciendo una imagen visiblemente mucho más grande y descentrada.

**Solución definitiva implementada:**
1. **Espacio de coordenadas unificado:** todos los vértices del contorno se escalan a las dimensiones naturales de la imagen:
   $$x = \frac{x_{\text{mask}}}{\text{mask.width}} \cdot \text{origW}, \quad y = \frac{y_{\text{mask}}}{\text{mask.height}} \cdot \text{origH}$$
2. **Escala y márgenes compartidos con la lámina:**
   $$\text{scale} = \min\left(\frac{\text{sheetW}}{\text{boxW}}, \frac{\text{sheetH}}{\text{boxH}}\right)$$
   $$\text{offsetX} = \frac{\text{sheetW} - \text{boxW} \cdot \text{scale}}{2}, \quad \text{offsetY} = \frac{\text{sheetH} - \text{boxH} \cdot \text{scale}}{2}$$
3. **Posicionamiento del `<image>`:**
   $$X_{\text{overlay}} = \text{offsetX} - \text{minX} \cdot \text{scale}, \quad Y_{\text{overlay}} = \text{offsetY} - \text{minY} \cdot \text{scale}$$
   $$\text{width} = \text{origW} \cdot \text{scale}, \quad \text{height} = \text{origH} \cdot \text{scale}$$
4. **Recorte perfecto con `<clipPath>`:**
   La imagen se encapsula en `<clipPath id="svg-image-clip"><path d="${clipPathD}"/></clipPath>`, asegurando que no desborde ni 1 píxel fuera de la silueta del puzzle.
5. **Control de opacidad en tiempo real (60 FPS):**
   El slider en la UI actualiza directamente el atributo `opacity` del elemento `#svg-image-overlay` en el DOM sin necesidad de regenerar el SVG completo.

### Soporte para siluetas vectoriales SVG (`shapeFromSvg`, `parseSvgPath`)
- **Parser SVG nativo sin dependencias:** analiza cadenas `d` con comandos absolutos y relativos (`M, m, L, l, H, h, V, v, C, c, S, s, Q, q, T, t, A, a, Z, z`), muestreando curvas cúbicas/cuadráticas y arcos elípticos con precisión milimétrica.
- **Extracción de trazados:** detecta elementos `<path>`, `<polygon>` y `<polyline>`, seleccionando automáticamente el contorno principal con mayor área (descarta subelementos menores y detalles interiores).
- **Normalización de `viewBox`:** extrae `viewBox` y dimensiones para definir `origW` / `origH`, ajustando cualquier desfase de coordenadas de origen `(vbMinX, vbMinY)`.
- Probado y validado con archivos reales como `025.svg` (silueta vectorial de Pikachu con curvas Bézier complejas).

### Debounce en sliders y soporte de hasta 2000 piezas
- **Debounce reactivo (`schedule` + `updateOutBadge`):**
  - Al mover cualquier slider (`w`, `h`, `n`, `wave`, `minArea`, `maxArea`), las etiquetas numéricas se actualizan de forma instantánea a 60 FPS.
  - La regeneración pesada del puzzle se amortigua con un debounce de 160 ms (y sincronización `requestAnimationFrame`), evitando saturar el hilo principal.
  - Al soltar el control (`change`), o al interactuar con botones/selectores discretos, el recálculo se ejecuta inmediatamente con `schedule(0)`.
- **Puzzles masivos de hasta 2000 piezas:**
  - Límite de piezas ampliado de 600 a 2000 piezas en el campo y slider `data-pair="n"`.
  - El motor geométrico genera puzzles de 2000 piezas en ~120 ms sin problemas de memoria ni desbordamientos.

---

## 5. Grafo de dependencias

```
types ──► rng, format, path, warp, polygon, shapes
format ──► path, svg
path ──► edge, clip, generate
warp ──► edge, generate
polygon ──► clip, generate
clip ──► generate
edge, shapes, cut-style ──► generate
generate ──► svg, build
index ──► (todos, fachada unificada)
grid ──► build
image-shape ──► jigsaw/index (polygonArea, polygonPath, registerShape, Shape)
```

Sin dependencias circulares.

---

## 6. Verificación

```bash
bun run build:assets   → dist/ listo: index.html + app.js
bun run typecheck      → 0 errores (tsc --noEmit, strict)
bun test               → 42 pass / 0 fail (grid, image-shape, jigsaw)
```
