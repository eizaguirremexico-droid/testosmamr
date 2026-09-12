import './style.css';
import {
  ACESFilmicToneMapping, AmbientLight, Box3, CanvasTexture, Color, DirectionalLight,
  FrontSide, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = '/inky-waver.glb';
const MODEL_TILT_X = 0; // el GLB ya viene en Y-up (convencion glTF)

// El primer acabado es el material PBR original del GLB (con sus texturas).
// Los demas lo sustituyen por un material liso, util para leer la silueta.
const MATERIALS = [
  null,
  { color: 0xdadae2, metalness: 0.05, roughness: 0.55 },
  { color: 0xc9a227, metalness: 1.0,  roughness: 0.28 },
  { color: 0x6ea8fe, metalness: 1.0,  roughness: 0.14 },
];

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const loaderEl = $('#loader');
const barEl = $('#bar');
const loaderTxt = $('#loader-txt');
const hintEl = $('#hint');

// --------------------------------------------------------------------
// Renderer y escena
// --------------------------------------------------------------------
let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (err) {
  fail('Tu navegador no soporta WebGL.');
  throw err;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // techo de DPR: clave en pantallas retina
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, 0.1, 100);

// Entorno PBR procedural: reflejos creíbles con 0 bytes de descarga (sin HDR externo)
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;

scene.add(new AmbientLight(0xffffff, 0.35));
const key = new DirectionalLight(0xffffff, 2.1);
key.position.set(3, 5, 2.5);
scene.add(key);
const rim = new DirectionalLight(0x9ec5ff, 1.1);
rim.position.set(-3, 1.5, -3);
scene.add(rim);

// Sombra de contacto falsa: un degradado radial dibujado en canvas. Mucho más
// barato que un shadow map y visualmente suficiente para un solo objeto.
const shadow = new Mesh(
  new PlaneGeometry(1, 1),
  new MeshStandardMaterial({
    color: 0x000000, transparent: true, opacity: 0.5,
    alphaMap: radialTexture(), depthWrite: false,
  })
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

// --------------------------------------------------------------------
// Controles
// --------------------------------------------------------------------
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;          // en tactil el pan se dispara sin querer
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.9;
controls.maxPolarAngle = Math.PI * 0.86;
controls.minPolarAngle = Math.PI * 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.9;
controls.addEventListener('change', () => { needsRender = true; });

// --------------------------------------------------------------------
// Carga del modelo
// --------------------------------------------------------------------
let model = null;
let textured = null;   // material original del GLB
let solid = null;      // material liso, se crea al vuelo
const meshes = [];
let home = { pos: new Vector3(2.2, 1.4, 2.6), target: new Vector3() };
camera.position.copy(home.pos);

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
gltfLoader.load(MODEL_URL, onLoaded, onProgress, () => fail('No se pudo cargar el modelo 3D.'));

function onProgress(e) {
  // Con Content-Length conocido usamos el valor real; si no, avance estimado.
  const pct = e.lengthComputable && e.total
    ? (e.loaded / e.total) * 100
    : Math.min(90, (e.loaded / 780000) * 100);
  barEl.style.width = pct.toFixed(0) + '%';
  loaderTxt.textContent = 'Cargando modelo… ' + pct.toFixed(0) + '%';
}

function onLoaded(gltf) {
  model = gltf.scene;
  model.rotation.x = MODEL_TILT_X;

  let tris = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    if (!textured) {
      textured = o.material;               // material PBR original del GLB
      textured.envMapIntensity = 1.0;
      textured.side = FrontSide;           // el GLB viene doubleSided: culling = la mitad de fragmentos
    }
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  applyMaterial(0);

  frame();
  scene.add(model);

  $('#stat-tris').textContent = Math.round(tris).toLocaleString('es') + ' triángulos';
  // En glTF metalness y roughness comparten imagen, asi que contamos texturas
  // unicas y no slots del material.
  const maps = new Set(
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap']
      .map((k) => textured[k])
      .filter(Boolean)
  );
  const px = textured.map?.image?.width;
  $('#stat-tex').textContent = maps.size + ' texturas PBR' + (px ? ' · ' + px + ' px' : '');
  fetch(MODEL_URL, { method: 'HEAD' })
    .then((r) => {
      const b = Number(r.headers.get('content-length'));
      if (b) $('#stat-size').textContent = (b / 1024).toFixed(0) + ' KB';
    })
    .catch(() => {});

  barEl.style.width = '100%';
  loaderTxt.textContent = 'Listo';
  loaderEl.classList.add('is-gone');
  setTimeout(() => loaderEl.remove(), 600);
  setTimeout(() => hintEl.classList.add('is-gone'), 6000);
  needsRender = true;
}

const size = new Vector3(1, 1, 1);

// Centra el modelo sobre el suelo y prepara el encuadre inicial.
function frame() {
  const box = new Box3().setFromObject(model);
  box.getSize(size);
  const center = box.getCenter(new Vector3());

  model.position.sub(center);     // centrar en el origen
  model.position.y += size.y / 2; // y apoyarlo sobre y = 0

  const radius = size.length() / 2;
  controls.target.set(0, size.y * 0.52, 0);
  controls.minDistance = radius * 0.9;
  controls.maxDistance = radius * 6;
  camera.near = radius / 200;
  camera.far = radius * 80;

  // vista 3/4, ligeramente por encima del centro
  camera.position.set(0.40, 0.40, 1).normalize().multiplyScalar(fitDistance()).add(controls.target);
  camera.updateProjectionMatrix();
  controls.update();

  const s = Math.max(size.x, size.z) * 1.2;
  shadow.scale.set(s, s, 1);
  shadow.position.y = 0.001;

  home = { pos: camera.position.clone(), target: controls.target.clone() };
}

/**
 * Distancia a la que el modelo entra entero en pantalla. Contempla el FOV
 * horizontal ademas del vertical: en movil en vertical el limite es el ancho,
 * asi que encuadrar solo por altura recortaria el modelo.
 */
function fitDistance() {
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const byHeight = size.y / 2 / Math.tan(vFov / 2);
  const byWidth = Math.max(size.x, size.z) / 2 / Math.tan(hFov / 2);
  return Math.max(byHeight, byWidth) * 1.12;
}

// Reencuadra manteniendo el angulo de orbita actual.
function refit() {
  if (!model) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, fitDistance());
  home = { pos: camera.position.clone(), target: controls.target.clone() };
  controls.update();
  needsRender = true;
}

// --------------------------------------------------------------------
// Interfaz
// --------------------------------------------------------------------
function applyMaterial(i) {
  const preset = MATERIALS[i];
  if (preset) {
    if (!solid) solid = new MeshStandardMaterial({ envMapIntensity: 1.1, side: FrontSide });
    solid.color = new Color(preset.color);
    solid.metalness = preset.metalness;
    solid.roughness = preset.roughness;
    solid.needsUpdate = true;
  }
  const next = preset ? solid : textured;
  for (const mesh of meshes) mesh.material = next;
  needsRender = true;
}

document.querySelectorAll('.sw').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    applyMaterial(Number(btn.dataset.mat));
  });
});

const spinBtn = $('#btn-spin');
spinBtn.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  spinBtn.setAttribute('aria-pressed', String(controls.autoRotate));
  needsRender = true;
});

$('#btn-reset').addEventListener('click', () => {
  userMoved = false;
  controls.target.copy(home.target);
  camera.position.copy(home.pos);
  refit();
});

const infoBtn = $('#btn-info');
const panel = $('#panel');
infoBtn.addEventListener('click', () => {
  const open = panel.hidden;
  panel.hidden = !open;
  infoBtn.setAttribute('aria-expanded', String(open));
});

// La interaccion pausa el giro automatico; se reanuda al soltar.
let wasSpinning = false;
let userMoved = false;
canvas.addEventListener('pointerdown', () => {
  userMoved = true;
  wasSpinning = controls.autoRotate;
  controls.autoRotate = false;
  hintEl.classList.add('is-gone');
}, { passive: true });
addEventListener('pointerup', () => {
  if (wasSpinning) controls.autoRotate = true;
  wasSpinning = false;
}, { passive: true });

// --------------------------------------------------------------------
// Bucle de render bajo demanda: no dibuja nada si la escena esta quieta
// --------------------------------------------------------------------
let needsRender = true;
let visible = true;
document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  needsRender = true;
});

function tick() {
  requestAnimationFrame(tick);
  if (!visible) return;
  const moved = controls.update();
  if (moved || controls.autoRotate || needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }
}
tick();

// --------------------------------------------------------------------
// Resize
// --------------------------------------------------------------------
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Al rotar el movil o cambiar el tamano de ventana reencuadramos, salvo que
  // el usuario ya haya ajustado la vista a mano.
  if (!userMoved) refit();
  needsRender = true;
}
new ResizeObserver(resize).observe(canvas);
resize();

// --------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function fail(msg) {
  if (barEl) barEl.remove();
  loaderTxt.textContent = msg;
}
