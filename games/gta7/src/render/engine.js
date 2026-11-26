// =====================================================
//  MOTEUR 3D : rendu, caméra, lumières, ciel, reflets
//  ⚡ QUALITÉ AUTOMATIQUE : si le jeu rame, la résolution
//  baisse toute seule (puis le bloom, les ombres fines,
//  les effets), et elle remonte quand ça redevient fluide.
// =====================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { $, rr, isMobile } from '../core/utils.js';
import { G } from '../core/ctx.js';
import { loadHDR } from '../assets.js';

// Résolution de rendu (pixel ratio) : plafonnée pour rester fluide
const PR_MIN = isMobile ? 0.7 : 0.75;
let prMax = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5);
let pr = prMax;

export const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(pr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
// brouillard (world/infinite.js le rapproche un peu pour cacher le bout de la ville chargée)
scene.fog = new THREE.Fog(0xcddff0, 180, 1100);
export const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 1700);

// ----- Étalonnage des couleurs (comme au cinéma) : saturation, contraste, teinte -----
// + un très léger « bruit » qui supprime les bandes visibles dans les dégradés du ciel
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform vec3 tint;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = c.rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, saturation);
  col = (col - 0.5) * contrast + 0.5;
  col *= tint;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
}`,
};

export let composer = null;
export let bloom = null;
export let grade = null;
if (!isMobile) {
  // Rendu avec anticrénelage MSAA : sans ça, le bloom rendait les bords en escalier
  const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0,
  });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.4, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  // tailles justes dès le départ (avant, le bloom calculait en résolution ×4 jusqu'au 1er redimensionnement)
  composer.setPixelRatio(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
}
let useComposer = !!composer;

function applyPR(v) {
  pr = v;
  renderer.setPixelRatio(v);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) { composer.setPixelRatio(v); composer.setSize(window.innerWidth, window.innerHeight); }
}

// ----- Qualité automatique : on mesure le temps moyen d'une image toutes les 2 s -----
let qLast = 0, qSum = 0, qN = 0, qGood = 0;
function autoQuality() {
  const now = performance.now(), f = now - qLast;
  qLast = now;
  if (f <= 0 || f > 250) return;             // onglet caché, chargement…
  qSum += f; qN++;
  if (qSum < 2000) return;
  const ms = qSum / qN;
  qSum = 0; qN = 0;
  if (ms > 24) {                             // moins de ~40 images/s : on allège
    qGood = 0;
    if (pr > PR_MIN + 0.01) {
      prMax = Math.max(PR_MIN, pr - 0.05);   // on ne remontera plus aussi haut
      applyPR(Math.max(PR_MIN, pr - 0.15));
    } else if (bloom && bloom.enabled) bloom.enabled = false;
    else if (sun.shadow.mapSize.x > 1024) {
      sun.shadow.mapSize.set(1024, 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    } else if (useComposer) useComposer = false;
    else return;
    console.info('⚡ Qualité auto : résolution ×' + pr.toFixed(2)
      + (bloom && !bloom.enabled ? ' · bloom coupé' : '') + (composer && !useComposer ? ' · effets coupés' : ''));
  } else if (ms < 17.5) {                    // fluide : on remonte doucement
    if (++qGood >= 3 && pr < prMax - 0.01) { qGood = 0; applyPR(Math.min(prMax, pr + 0.1)); }
  } else qGood = 0;
}

export function render() {
  autoQuality();
  if (useComposer) composer.render(); else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ----- Reflets : studio de base, puis vrais ciels HDR chargés en ligne -----
const pmrem = new THREE.PMREMGenerator(renderer);
export const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
let envMap = roomEnv;
export const getEnvMap = () => envMap;
export const envMats = []; // matériaux qui reflètent le ciel
const HDR_FILES = {
  day: 'textures/equirectangular/royal_esplanade_1k.hdr',
  sunset: 'textures/equirectangular/venice_sunset_1k.hdr',
};
const hdrCache = {};
let envToken = 0;
export function setEnvMap(t) {
  if (envMap === t) return;
  envMap = t;
  const list = G.car ? envMats.concat(G.car.envList) : envMats;
  for (const m of list) { m.envMap = t; m.needsUpdate = true; }
}
export function refreshEnv(id) {
  const tok = ++envToken;
  const file = HDR_FILES[id];
  if (!file) { setEnvMap(roomEnv); return Promise.resolve(true); }
  if (!hdrCache[id]) {
    hdrCache[id] = loadHDR(file).then((t) => {
      if (!t) return null;
      const e = pmrem.fromEquirectangular(t).texture;
      t.dispose();
      return e;
    });
  }
  return hdrCache[id].then((e) => {
    if (tok === envToken) setEnvMap(e || roomEnv);
    return !!e;
  });
}

// ----- Lumières -----
export const hemi = new THREE.HemisphereLight(0xdcecff, 0x5b6a4c, 1.0);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 450 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
export const sunOffset = new THREE.Vector3(90, 160, 60);

// ----- Ciel : dégradé + bande lumineuse à l'horizon + disque du soleil (ou de la lune) -----
// Les couleurs sont réglées par world/time.js selon le moment de la journée
export const skyUniforms = {
  top: { value: new THREE.Color() },
  bottom: { value: new THREE.Color() },
  horizon: { value: new THREE.Color(0xffffff) },
  sunDir: { value: new THREE.Vector3(0.45, 0.8, 0.3).normalize() },
  sunColor: { value: new THREE.Color(0xffffff) },
  sunSize: { value: 0.9994 },
  glow: { value: 0.6 },
};
export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 48, 24),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float glow;
varying vec3 vP;
void main(){
  vec3 d = normalize(vP);
  float t = clamp(d.y * 1.5 + 0.08, 0.0, 1.0);
  vec3 col = mix(bottom, top, pow(t, 0.75));
  col = mix(col, horizon, exp(-abs(d.y - 0.02) * 10.0) * 0.6);
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 6.0) * 0.25 + pow(s, 60.0) * 0.5) * glow;
  col += sunColor * smoothstep(sunSize - 0.0004, sunSize, s) * 2.0;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

const starGeo = new THREE.BufferGeometry();
{
  const sp = [];
  for (let i = 0; i < 1500; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.4, r = 1400;
    sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
}
export const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
scene.add(stars);

// Nuages : boules plus rondes (plus de facettes) pour un rendu plus doux
export const clouds = new THREE.Group();
export const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
{
  const cg = new THREE.IcosahedronGeometry(1, 2);
  for (let i = 0; i < 25; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const m = new THREE.Mesh(cg, cloudMat);
      m.scale.set(rr(25, 45), rr(12, 20), rr(20, 35));
      m.position.set(j * 28 - 56 + rr(-10, 10), rr(-5, 5), rr(-15, 15));
      c.add(m);
    }
    c.position.set(rr(-1200, 1200), rr(280, 380), rr(-1200, 1200));
    clouds.add(c);
  }
}
scene.add(clouds);

// Les montagnes lointaines ont été retirées : le monde n'a plus de bord,
// la ville continue sur des collines douces (voir world/terrain.js).
// (mountainMat reste là car l'heure du jour règle encore sa couleur)
export const mountainMat = new THREE.MeshLambertMaterial({ color: 0x7f93a3, flatShading: true });
