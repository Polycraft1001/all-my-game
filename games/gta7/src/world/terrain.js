// =====================================================
//  RELIEF : la grande ville du centre est toute plate.
//  Autour, la ville infinie (world/infinite.js) suit de
//  DOUCES COLLINES : des montées et des descentes en voiture,
//  mais plus aucune montagne ni bord du monde.
//  Au sud de la ville : l'AÉROPORT, une grande zone plate ✈️
//  Autour : 3 AUTRES VILLES (TOWNS) reliées par des routes 🗺️
//  terrainHeight(x, z) = hauteur du sol (en mètres, jamais < 0)
//  ➜ Régler le relief : HILL (0 = tout plat, 1 = ~18 m max, 2 = ~36 m)
// =====================================================
import * as THREE from 'three';

const HILL = 1;          // taille des collines
let FLAT = 440;          // jusqu'ici : plat (la ville du centre)
const RISE = 260;        // distance pour que les collines montent (doucement)
const SOFT = 160;        // les collines redescendent en douceur vers les zones plates
const TOWN_DIST = 900;   // distance entre le centre de la grande ville et les autres villes

// L'aéroport : rectangle tout plat (hw, hd = demi-largeur, demi-profondeur)
// m = distance sur laquelle les collines redescendent doucement autour
export const AIRPORT = { x: 0, z: 0, hw: 300, hd: 55, m: 90 };

// Les autres villes (construites dans world/towns.js)
// dx, dz = direction depuis la grande ville · tint = couleur du sol autour
export const TOWNS = [
  { id: 'candy', name: 'SUCREVILLE', dx: 1, dz: 0, x: 0, z: 0, hw: 150, hd: 150, tint: null },
  { id: 'west', name: 'CACTUS CITY', dx: -1, dz: 0, x: 0, z: 0, hw: 150, hd: 150, tint: 'sand' },
  { id: 'snow', name: 'NEIGEVILLE', dx: 0, dz: -1, x: 0, z: 0, hw: 150, hd: 150, tint: 'snow' },
];

// zones toutes plates : aéroport, villes, routes entre les villes
const ZONES = [AIRPORT];

export function initTerrain(half) {
  FLAT = half + 30;
  AIRPORT.z = half + 87; // juste au sud de la ville
  ZONES.length = 0;
  ZONES.push(AIRPORT);
  for (const t of TOWNS) {
    t.x = t.dx * TOWN_DIST; t.z = t.dz * TOWN_DIST;
    ZONES.push({ x: t.x, z: t.z, hw: t.hw + 30, hd: t.hd + 30, m: 110 });
    // la route part du bord de la grande ville (sur la route du milieu, x=0 ou z=0)
    const edge = TOWN_DIST - t.hw, mid = (half + edge) / 2, len = (edge - half) / 2 + 12;
    t.road = t.dx
      ? { x: t.dx * mid, z: 0, hw: len, hd: 10, m: 60, alongX: true, from: half, to: edge }
      : { x: 0, z: t.dz * mid, hw: 10, hd: len, m: 60, alongX: false, from: half, to: edge };
    ZONES.push(t.road);
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

// distance (en mètres) jusqu'à une zone rectangulaire (0 = dedans)
function zoneDist(Z, x, z) {
  return Math.max(Math.abs(x - Z.x) - Z.hw, Math.abs(z - Z.z) - Z.hd, 0);
}
export const inAirport = (x, z, extra = 0) => zoneDist(AIRPORT, x, z) <= extra;
export const inFlatZone = (x, z, extra = 0) => ZONES.some((Z) => zoneDist(Z, x, z) <= extra);
// près d'une ville qui a sa propre végétation (cactus, sapins) ?
export const wildTown = (x, z) => TOWNS.some((t) => t.tint && Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < t.hw + 420);

// collines douces (sans les zones plates) : 0 à ~18 m, pente max ~12 %
// (deux grandes vagues mélangées, plus de montagnes au bord du monde)
function hills(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z)) - FLAT;
  if (d <= 0 || HILL <= 0) return 0;
  const t = d >= RISE ? 1 : smooth(d / RISE);
  const n = 6.5 * (1 + Math.sin(x * 0.0095 + 1.3) * Math.cos(z * 0.008 - 0.7))
    + 2.5 * (1 + Math.sin(x * 0.017 + z * 0.013));
  return t * n * HILL;
}

export function terrainHeight(x, z) {
  const h = hills(x, z);
  if (h <= 0) return 0;
  let f = 1;
  for (let i = 0; i < ZONES.length; i++) {
    const Z = ZONES[i], m = Z.m > SOFT ? Z.m : SOFT, a = zoneDist(Z, x, z);
    if (a < m) { const s = smooth(a / m); if (s < f) f = s; }
  }
  return h * f; // aplati autour des zones plates
}

// Pente sous un objet (voiture) : tangage (avant/arrière) et roulis (gauche/droite)
export function slopeTilt(x, z, h, L, W, out) {
  const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
  const a = L / 2, b = W / 2;
  out.pitch = Math.atan2(terrainHeight(x + fx * a, z + fz * a) - terrainHeight(x - fx * a, z - fz * a), L);
  out.roll = Math.atan2(terrainHeight(x + rx * b, z + rz * b) - terrainHeight(x - rx * b, z - rz * b), W);
  return out;
}

// Le grand sol en relief (herbe, sable ou neige près des villes)
const SNOW = new THREE.Color(1.6, 1.6, 1.7), SAND = new THREE.Color(1.75, 1.42, 0.78);
export function buildTerrain(mat, limit) {
  const size = (limit + 700) * 2, seg = 400;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = terrainHeight(x, z);
    // un peu sous les routes de la ville infinie (qui épousent le relief)
    p.setY(i, h - 0.05 - 0.07 * Math.min(1, h));
    c.setRGB(1, 1, 1);
    for (const t of TOWNS) {
      if (!t.tint) continue;
      const dd = Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) - t.hw;
      const w = 1 - THREE.MathUtils.smoothstep(dd, 60, 420);
      if (w > 0) c.lerp(t.tint === 'snow' ? SNOW : SAND, w);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  mat.vertexColors = true;
  // toujours « derrière » les routes et trottoirs posés dessus (pas de clignotement)
  mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}
