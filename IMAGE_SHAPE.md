# Nueva forma: desde imagen (PNG)

## Objetivo

Añadir una forma más que **use el mismo motor de recorte que el círculo** (clip
por polígono + profundidad para las pestañas), pero en lugar de un círculo fijo,
la silueta **se carga desde un PNG**.

## Flujo

1. El usuario carga un PNG (botón en la interfaz).
2. Se rasteriza y se extrae la **silueta** (los bordes de la forma).
3. Si la imagen tiene **varias islas** (trozos separados), se queda solo con la
   **más grande**; el resto se descarta.
4. Esa silueta pasa a ser el polígono de recorte de la lámina y se genera el
   puzzle con ella (como ocurre hoy con `circle`).

## Requisitos

- **Un solo archivo nuevo** de lógica (`src/image-shape.ts`): PNG → máscara →
  isla más grande → contorno simplificado → `Shape`.
- **Reutilizar el motor del círculo**: mismo `clip`, mismo cálculo de profundidad
  para que las pestañas no se salgan, mismo recorte de piezas y cortes.
- **Solo una forma**: la isla de mayor área. Las demás se ignoran.
- El contorno debe quedar **simplificado** (sin cientos de vértices) para que el
  SVG no explote y las piezas sigan encajando.
- La forma se **escala al rectángulo de la lámina** (ancho × alto en cm) manteniendo
  la proporción de la imagen.
- Si la imagen no se carga o está vacía, se comporta como un fallo claro (no se
  rompe el generador).

## Qué NO se pide

- No volver a lo "orgánico"/"serpiente" (ya eliminado).
- No estilos de corte nuevos: la forma de imagen usa el corte **clásico**.
- No DXF, no fusión de celdas, no ondas.

## Verificación

- Cargar un PNG con una silueta simple → puzzle con esa forma.
- Cargar un PNG con varias islas → solo se usa la mayor.
- Las piezas cubren exactamente la silueta y no se salen de ella.
- `bun run typecheck && bun test` siguen en verde.
