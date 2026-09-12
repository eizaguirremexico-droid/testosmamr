# Inky Strut — visor 3D

Sitio estático de una sola página con un visor 3D interactivo. Mobile first,
sin dependencias de CDN externos y pensado para cargar rápido en 4G.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
npm run preview  # sirve dist/
```

## Despliegue en Vercel

El proyecto es estático; Vercel detecta Vite automáticamente.

- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

Desde la CLI:

```bash
npx vercel --prod
```

`vercel.json` fija cabeceras de caché inmutable para el `.glb` y para `/assets/*`.

## Peso de la página

| Recurso            | Transferido (gzip) |
| ------------------ | ------------------ |
| `inky-strut.glb`   | ~293 KB            |
| JS (three.js)      | ~168 KB            |
| CSS + HTML         | ~3 KB              |
| **Total 1ª carga** | **~464 KB**        |

En visitas siguientes el `.glb` y el bundle salen de caché inmutable.

## Cómo se optimizó el modelo

El STL original pesa 152 MB (3 056 724 triángulos), inservible en web. El
pipeline, en `convert.py` (en la carpeta padre), hace:

1. Lectura del STL binario y **soldado de vértices** (1,53 M vértices únicos).
2. **Decimación cuádrica** a 90 000 triángulos con `fast-simplification`.
3. Recentrado, normalización de escala y **normales suaves** por área.
4. Exportación a glTF binario.
5. `gltf-transform optimize --compress meshopt`: cuantización de vértices +
   compresión Meshopt → **379 KB** (293 KB al vuelo con gzip).

Se descartó Draco (242 KB) porque su decodificador añade ~180 KB extra y
descomprime bastante más lento que Meshopt, cuyo decodificador ronda los 25 KB.

Para regenerar el modelo con otra densidad de malla:

```bash
python convert.py raw.glb 60000
npx gltf-transform optimize raw.glb public/inky-strut.glb --compress meshopt --texture-compress false --simplify false
```

## Decisiones de rendimiento

- **Render bajo demanda**: el bucle no dibuja nada si la escena está quieta y se
  detiene por completo con la pestaña en segundo plano. Sin giro automático, el
  consumo de GPU en reposo es cero.
- **Tope de `devicePixelRatio` en 2**: evita renderizar a 3x en móviles de gama
  alta, donde es la principal causa de caída de FPS.
- **Sin mapas de sombra**: la sombra de contacto es un degradado radial dibujado
  en un canvas de 128×128, generado en el cliente.
- **Entorno PBR procedural** (`RoomEnvironment`): reflejos creíbles sin
  descargar ningún HDR.
- **Sin texturas**: el STL no las lleva, así que el material es PBR por
  parámetros y se puede cambiar en caliente.

## Accesibilidad y responsive

- Etiquetas ARIA en todos los controles, estados `aria-pressed` / `aria-expanded`
  y foco visible por teclado.
- `env(safe-area-inset-*)` para el notch y la barra de gestos en iOS.
- En pantallas de menos de 400 px los botones colapsan a solo icono.
- Se respeta `prefers-reduced-motion`.
