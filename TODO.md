# Pendiente

## Abierto: cruces restantes con `wave` + estilo Serpiente

El 90 % ya está: sin `wave`, todas las configuraciones dan **0 cruces** (~1300
piezas × 8 semillas × 3 tamaños), y con `wave` bajo (0.5) casi todos. Queda
pulir:

| Configuración | Piezas que cruzan (3 tamaños × 8 semillas) |
|---|---|
| `rect+organic wave0.7` | ~35 / 1312 |
| `rect+organic wave1` | ~161 / 1312 |
| `organic+organic wave0.7` | ~17 / 1244 |
| `organic+organic wave0.5` | ~2 / 1241 |
| `circle+organic wave0.5` | 0 ✓ |

Los cruces verificados son **del mismo borde** (la polilínea de un único
corte se cruza a sí misma). Ya está implementada una red de seguridad en
`src/organic.ts` (`serpentine.edge`): si la curva final muestreada no es
simple, se rebajan todos los lóbulos ×0.7 y se reintenta (14 veces). Falta
que dispare en todos los casos:

1. **Revisar por qué el bucle de rebajado no llega a 0 cruces** en
   `wave0.7/1`. Hipótesis: el muestreo `samplePolygon(sub, 3)` no detecta el
   hairpin, o el bucle se queda corto (línea base plegada por `makeWarp` del
   core → no se puede arreglar rebajando lóbulos).
2. **Diagnosticar `wave1`**: con amp grande el `makeWarp` del core puede
   plegar la línea base (`amp·(1.5/margin + 2π·fx·1.3/W) ≳ 1`). Es un bug
   **preexistente** (también afecta a `classic`, verificado en el commit
   `313b74e` con worktree: `classic+rect wave0.7` cruza 6/648). Opciones:
   - acotar `amp` en `makeWarp` según la distancia a los bordes, o
   - reducir `wave` máximo recomendado en la UI a 0.5, o
   - ambos.
3. **Tests que faltan**: añadir a `tests/organic.test.ts` un test de
   integridad con `wave ≥ 0.7` (hoy solo hay con `wave0.5` y `wave0.3`) para
   que el progreso sea visible en `bun test`.
4. **Render de verificación**: regenerar `/tmp/opencode/puzzle/orgc3.png`
   (seed 7, 48 piezas, solo 1 corte recto tras el fix de `trimLobe`) y
   comprobar la estética visual de la fila 0.

## Limpieza

- Borrar el worktree temporal: `git worktree remove /tmp/opencode/base`.
- `bun run typecheck && bun test` antes de cada push (37 tests hoy).

## Mejoras futuras (no urgentes)

- UI: mostrar el recuento real de filas×columnas y piezas generadas
  (`planGrid` puede dar un grid distinto al pedido).
- UI: botón de "forma = contorno de la foto" (subir imagen → trazar
  contorno). Hoy `shape=organic` es el contorno ondulado genérico.
- Export DXF además de SVG.
- Límite de piezas / previsualización rápida para puzzles grandes (>500).
