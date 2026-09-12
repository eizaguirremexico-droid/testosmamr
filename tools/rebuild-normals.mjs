/**
 * Recalcula las normales de vértice de un GLB, soldando por posición.
 *
 * Por qué hace falta: tras simplificar la malla, los vértices que sobreviven
 * conservan la normal del sculpt original, que ya no describe la superficie
 * nueva. Sobre un material metálico y pulido eso aparece como púas oscuras en
 * los reflejos, sobre todo en los bordes elevados de los ojos.
 *
 * Por qué aquí y no en el navegador: `gltf-transform optimize` cuantiza las
 * posiciones a i16, y calcular normales a partir de posiciones cuantizadas
 * hereda ese ruido y deja la superficie mate y picada. Este paso va antes de
 * la cuantización, con las posiciones aún en f32.
 *
 * El soldado por posición importa: las costuras de UV duplican vértices, y sin
 * unificarlos cada isla recibe normales distintas y la costura se ve como una
 * arista dura justo en el contorno de los ojos.
 *
 * Uso: node tools/rebuild-normals.mjs entrada.glb salida.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Uso: node tools/rebuild-normals.mjs <entrada.glb> <salida.glb>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

/** Clave de soldado: posición redondeada a 1e-5. */
function key(x, y, z) {
  return `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
}

for (const mesh of document.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    const indices = prim.getIndices();
    if (!position || !indices) continue;

    const pos = position.getArray();
    const idx = indices.getArray();
    const count = position.getCount();

    // Vértices distintos que comparten posición comparten normal acumulada.
    const welded = new Int32Array(count);
    const groups = new Map();
    for (let i = 0; i < count; i++) {
      const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let g = groups.get(k);
      if (g === undefined) {
        g = groups.size;
        groups.set(k, g);
      }
      welded[i] = g;
    }

    // Suma de normales de cara sin normalizar: su módulo es proporcional al
    // doble del área, así que las caras grandes pesan más. Es lo que se quiere
    // en una malla simplificada, donde quedan slivers que no deben mandar.
    const acc = new Float64Array(groups.size * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;

      const abx = pos[b] - pos[a];
      const aby = pos[b + 1] - pos[a + 1];
      const abz = pos[b + 2] - pos[a + 2];
      const acx = pos[c] - pos[a];
      const acy = pos[c + 1] - pos[a + 1];
      const acz = pos[c + 2] - pos[a + 2];

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      for (const v of [idx[t], idx[t + 1], idx[t + 2]]) {
        const g = welded[v] * 3;
        acc[g] += nx;
        acc[g + 1] += ny;
        acc[g + 2] += nz;
      }
    }

    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const g = welded[i] * 3;
      const x = acc[g];
      const y = acc[g + 1];
      const z = acc[g + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    }

    const accessor = document
      .createAccessor()
      .setType('VEC3')
      .setArray(normals)
      .setBuffer(document.getRoot().listBuffers()[0]);

    prim.setAttribute('NORMAL', accessor);
    console.log(`${count} vértices → ${groups.size} posiciones únicas`);
  }
}

await io.write(output, document);
console.log(`normales recalculadas → ${output}`);
