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

| Recurso            | Transferido |
| ------------------ | ----------- |
| `inky-strut.glb`   | ~790 KB     |
| JS (three.js)      | ~168 KB gz  |
| CSS + HTML         | ~3 KB gz    |
| **Total 1ª carga** | **~960 KB** |

En visitas siguientes el `.glb` y el bundle salen de caché inmutable.

## Cómo se optimizó el modelo

El GLB de Meshy pesa 97 MB: 3 056 724 triángulos y tres texturas
(baseColor 4096², normal 4096², metallicRoughness 2048²), unos 200 MB de VRAM.
Inservible en móvil.

El pipeline es todo `gltf-transform`, sin scripts propios:

```bash
IN="Meshy_AI_Inky_Strut_0912160536_texture.glb"

# 1. Simplificar la malla a ~3 % de triángulos, conservando las UVs
npx @gltf-transform/cli simplify "$IN" s1.glb --ratio 0.03 --error 0.002

# 2. Reescalar las tres texturas a 1024 px
npx @gltf-transform/cli resize s1.glb s2.glb --width 1024 --height 1024

# 3. Pasarlas a WebP
npx @gltf-transform/cli webp s2.glb s3.glb --quality 82

# 4. Cuantizar y comprimir la geometría con Meshopt
npx @gltf-transform/cli optimize s3.glb public/inky-strut.glb \
  --compress meshopt --texture-compress false --simplify false
```

Resultado: **97 MB → 790 KB** con las tres texturas PBR intactas.

| Paso                   | Peso    |
| ---------------------- | ------- |
| GLB original           | 97 MB   |
| Tras simplificar malla | 12,9 MB |
| Tras reescalar texturas| 2,8 MB  |
| Tras WebP              | 2,67 MB |
| Tras Meshopt           | 790 KB  |

Un par de decisiones que importan:

- La simplificación **tiene que ser la de meshoptimizer**, no una decimación
  cuádrica cualquiera: hay que preservar las UVs o las texturas se destruyen.
- Se descartó **Draco**: comprime algo más que Meshopt, pero su decodificador
  añade ~180 KB al bundle y descomprime bastante más lento. El de Meshopt ronda
  los 25 KB.
- Las texturas en WebP a 1024 px pesan 167 KB entre las tres, frente a los
  10,4 MB de los JPEG originales.

> Ojo: un STL **no puede llevar texturas** — es solo una lista de triángulos, ni
> siquiera tiene UVs. Aunque Meshy nombre el archivo `..._texture.stl`, hay que
> exportar en GLB para conservar el material.

## Decisiones de rendimiento

- **Render bajo demanda**: el bucle no dibuja nada si la escena está quieta y se
  detiene por completo con la pestaña en segundo plano. Sin giro automático, el
  consumo de GPU en reposo es cero.
- **Tope de `devicePixelRatio` en 2**: evita renderizar a 3x en móviles de gama
  alta, donde es la principal causa de caída de FPS.
- **Backface culling**: el GLB viene `doubleSided`; forzar `FrontSide` ahorra la
  mitad del trabajo de fragmentos.
- **Sin mapas de sombra**: la sombra de contacto es un degradado radial dibujado
  en un canvas de 128×128, generado en el cliente.
- **Entorno PBR procedural** (`RoomEnvironment`): reflejos creíbles sin
  descargar ningún HDR.

## Accesibilidad y responsive

- Etiquetas ARIA en todos los controles, estados `aria-pressed` / `aria-expanded`
  y foco visible por teclado.
- `env(safe-area-inset-*)` para el notch y la barra de gestos en iOS.
- En pantallas de menos de 400 px los botones colapsan a solo icono.
- Se respeta `prefers-reduced-motion`.
