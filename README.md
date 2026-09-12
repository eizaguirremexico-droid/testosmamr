# Inky Waver — visor 3D

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
| `inky-waver.glb`   | ~1,93 MB    |
| JS (three.js)      | ~168 KB gz  |
| CSS + HTML         | ~3 KB gz    |
| **Total 1ª carga** | **~2,1 MB** |

En visitas siguientes el `.glb` y el bundle salen de caché inmutable.

## Cómo se optimizó el modelo

El GLB de Meshy pesa 95 MB: 3 038 886 triángulos y tres texturas
(baseColor 4096², normal 4096², metallicRoughness 2048²), unos 200 MB de VRAM.
Inservible en móvil.

El pipeline:

```bash
IN="Meshy_AI_Inky_Waver_0912200829_texture.glb"

# 1. Simplificar la malla, conservando las UVs
npx @gltf-transform/cli simplify "$IN" s1.glb --ratio 0.10 --error 0.0004

# 2. Reescalar las tres texturas a 1024 px
npx @gltf-transform/cli resize s1.glb s2.glb --width 1024 --height 1024

# 3. Pasarlas a WebP
npx @gltf-transform/cli webp s2.glb s3.glb --quality 82

# 4. Recalcular las normales (imprescindible, ver abajo)
node tools/rebuild-normals.mjs s3.glb s4.glb

# 5. Cuantizar y comprimir la geometria con Meshopt
npx @gltf-transform/cli optimize s4.glb public/inky-waver.glb   --compress meshopt --texture-compress false --simplify false
```

Resultado: **95 MB → 1,93 MB** con las tres texturas PBR intactas.

| Paso                   | Peso    |
| ---------------------- | ------- |
| GLB original           | 95 MB   |
| Tras simplificar malla | 18,4 MB |
| Tras reescalar texturas| 3,4 MB  |
| Tras WebP              | 3,3 MB  |
| Tras recalcular normales | 11,6 MB |
| Tras Meshopt           | 1,93 MB |

### El paso de las normales

Es el que más cuesta descubrir. Al simplificar, los vértices que sobreviven
conservan la normal del sculpt original, que ya no describe la superficie
nueva. Sobre este material —negro, metálico y de roughness baja— cada
desviación se amplifica en el reflejo, y aparece como púas oscuras dentadas
en los bordes elevados de los ojos. No son las texturas ni la compresión: se
reproduce igual con el normal map desactivado y con las normales sin cuantizar.

`tools/rebuild-normals.mjs` las recalcula, con dos detalles que importan:

- **Va antes de la cuantización.** `optimize` deja las posiciones en i16, y
  calcular normales a partir de posiciones cuantizadas hereda ese ruido: la
  superficie sale mate y picada. Hay que hacerlo con las posiciones aún en f32,
  lo que también descarta hacerlo en el navegador al cargar.
- **Suelda por posición.** Las costuras de UV duplican vértices; si cada isla
  recibe su propia normal, la costura se ve como una arista dura justo en el
  contorno de los ojos.

### Por qué 303 884 triángulos

A 91 000 triángulos (el 3 % del original) el modelo ya pierde el filo de los
bordes de los ojos aunque las normales sean correctas: queda liso pero blando.
A 303 884 (el 10 %) se sostiene la silueta. La diferencia son 777 KB frente a
1,93 MB, así que si el peso importa más que el detalle basta con bajar el
`--ratio` del paso 1 y repetir el pipeline.

Un par de decisiones que importan:

- La simplificación **tiene que ser la de meshoptimizer**, no una decimación
  cuádrica cualquiera: hay que preservar las UVs o las texturas se destruyen.
- Se descartó **Draco**: comprime algo más que Meshopt, pero su decodificador
  añade ~180 KB al bundle y descomprime bastante más lento. El de Meshopt ronda
  los 25 KB.
- Las texturas en WebP a 1024 px pesan 132 KB entre las tres, frente a los
  9 MB de los JPEG originales.

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
