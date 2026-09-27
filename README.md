# 🧩 Puzzle Generator · Generador de puzzles para corte láser

**Genera puzzles personalizados en SVG 1:1** a partir de tres datos: ancho (cm), alto (cm) y número de piezas. Sale un vector exacto, listo para láser, plóter o imprenta.

> 🇬🇧 **English:** a TypeScript + Bun **jigsaw puzzle generator** that turns width, height and piece count into a **true-scale (1:1) SVG** with classic jigsaw tabs, optional global wavy cuts and rectangle/circle shapes — **laser-cut ready**, single-pass cuts, no duplicate lines. See [English summary](#english-summary).

---

## Características

- **Medidas en cm → SVG a escala real**: `30 cm` se dibuja como `300 mm`, sin reescalados.
- **Número de piezas exacto**: el algoritmo fusiona celdas hasta alcanzar el objetivo sin dejar huecos (`piezas descartadas = 0`).
- **Dos formas**: rectángulo o círculo, con recorte real del contorno por polígono convexo.
- **Pestañas de puzzle clásicas**: cuello estrecho y cabeza bulbosa (undercut), con altura limitada por el tamaño de la celda para que nunca invadan la pieza vecina. Cada lado alterna muesca ranura.
- **Ondas globales**: un campo de senos ondula *todos* los cortes por igual, así las dos piezas vecinas comparten exactamente la misma curva.
- **Área mínima/máxima por pieza**: controla cuánto se fusionan celdas (evita migajas).
- **Corte único**: cada trazo aparece una sola vez en el SVG — sin líneas duplicadas y sin dobles pasadas del láser.
- **Sin líneas fantasma**: solo se dibujan los cortes que separan dos piezas reales (o el contorno).
- **Vista coloreada y numerada** para ensamblar y verificar.
- **Servidor de desarrollo en vivo** (SSE) + tests con `bun test`.

## Uso rápido

```bash
bun install
bun run dev        # → http://localhost:4321
```

```bash
bun test           # 25 tests
bun run typecheck  # TypeScript estricto
```

Comandos de fondo: `bun run dev:bg`, `dev:status`, `dev:logs`, `dev:stop`.

## API

```
GET /api/puzzle.svg?w=30&h=20&n=48&shape=circle&seed=42&wave=0.5&color=1&numbers=1
```

| Parámetro | Descripción | Por defecto |
|---|---|---|
| `w`, `h` | ancho y alto en cm | `30`, `20` |
| `n` | número de piezas objetivo | `48` |
| `shape` | `rect` o `circle` | `rect` |
| `seed` | semilla (reproduce el mismo puzzle) | aleatoria |
| `wave` | intensidad de las ondas (`0`–`1`) | `0` |
| `minArea`, `maxArea` | área mín/máx de pieza en múltiplos de la celda | `0.75`, `4` |
| `color`, `numbers` | colorear / numerar piezas | `0` |
| `strokeWidth` | grosor de línea en mm (visible también a escala real) | `0.3` |
| `download=1` | fuerza descarga | — |

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `src/grid.ts` | `planGrid(target, aspect)` → filas × columnas |
| `src/jigsaw.ts` | pestañas, ondas, fusión de regiones, recorte por forma, capa de cortes |
| `src/server.ts` | `Bun.serve`, bundle del cliente al vuelo, recarga en vivo |
| `src/client.ts` | interfaz: controles, previsualización, métricas, descarga |
| `tests/` | geometría, formas, ondas, cortes, ausencia de líneas fantasma |

## Notas para corte láser

- Unidades en **mm**, escala **1:1** (1 unidad del `viewBox` = 1 mm).
- Cada línea de corte aparece **una sola vez**: no hay trazos duplicados ni cortes de más.
- Los cortes son líneas **abiertas** (no polígonos cerrados), evitando dobles pasadas.
- El contorno de la forma se corta una vez y las piezas se separan por cortes reales.

---

## English summary

**Puzzle generator / jigsaw puzzle maker** built with **Bun** and **TypeScript**. Give it a size in centimetres and a piece count, and it returns a **laser-ready SVG** at true scale:

- **Exact piece count** — cells are merged until the target is met, no dropped pieces.
- **Classic jigsaw tabs** (narrow neck + bulbous head, alternating male/female per side).
- **Optional global waves** that distort every cut consistently on both sides of a joint.
- **Rectangle or circle** sheet shapes with a true vector outline.
- **Single-pass cuts** — no duplicated lines, no guide lines, no ghost lines.
- Coloured and numbered preview, live reload dev server, strict TypeScript, 25 tests.

### Keywords

puzzle generator · jigsaw puzzle generator · puzzle SVG · laser cut puzzle · laser cutting SVG · vector puzzle · puzzle maker · generador de puzzles · puzzle para láser · corte láser SVG · Bun · TypeScript
