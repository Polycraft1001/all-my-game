// =====================================================
//  ♾️ LA VILLE INFINIE (comme les chunks de Minecraft)
//  Le monde est découpé en carrés de 4 × 4 pâtés de maisons
//  (= 320 m). Autour de la caméra, on fabrique les carrés
//  qui manquent (un seul par image, pour ne pas ramer) et on
//  efface ceux qui sont trop loin.
//  Chaque pâté est toujours le même (sa graine = sa position) :
//  si tu reviens au même endroit, tu retrouves les mêmes immeubles !
//  Quartiers : centre d'affaires (tours), quartier mixte,
//  pavillons, zone industrielle, parcs et places.
//  ⛰️ Le sol suit les collines (world/terrain.js) : routes et
//  trottoirs sont « drapés » sur le relief (maillage de 10 m),
//  les bâtiments sont posés au point le plus bas de leur terrain.
//  🛍️ Boutiques : des devantures avec auvents un peu partout,
//  et de VRAIES boutiques où entrer (cercle devant la porte).
//  ⚡ Pour aller vite : chaque carré = quelques gros objets
//  (toutes les façades d'un même type sont fusionnées) et les
//  carrés trop loin sont cachés.
//  🌫️ Le brouillard (FOG_MAX) cache le bout des carrés chargés.
//  🖼️ Asphalte photo : Poly Haven « asphalt_02 » (CC0)
// =====================================================
import * as THREE from 'three';
import { scene, envMats, getEnvMap } from '../render/engine.js';
import { makeRng, isMobile, dummy } from '../core/utils.js';
import * as TX from './textures.js';
import { N, BLOCK, ROAD, CELL, CITY, HALF, rc, blockCenter, addCollider, colliders, windowMats, cellBuilt, propParts, lampHeadMat, roadMat } from './city.js';
import { terrainHeight as TH } from './terrain.js';
import { shops } from '../gameplay/shops.js';

const CH = 4;                          // pâtés par côté dans un chunk
const SIZE = CH * CELL;                // 320 m
const RADIUS = isMobile ? 1 : 2;       // chunks affichés autour de la caméra
const KEEP = RADIUS + 1;               // plus loin que ça : on efface
const SH = !isMobile;                  // ombres des immeubles (PC seulement)
const SEED = 7331;
const HB = BLOCK / 2, IN = HB - 4;     // demi-pâté, demi-intérieur (sans le trottoir)
const SIDE = 0.24;                     // hauteur des trottoirs
const STEP = 10;                       // le sol épouse le relief tous les 10 m
const SHOP_P = 0.25;                   // chance qu'un pâté commerçant ait une vraie boutique
const SHOP_VIEW = isMobile ? 120 : 200; // cercles + icônes des boutiques visibles jusqu'à… (m)
// brouillard max : cache le bout de la ville chargée (400 m sur téléphone, 720 m sur PC)
// (le bord des carrés chargés peut être à RADIUS × 320 m seulement : avec + 0,5 on le voyait)
const FOG_MAX = (RADIUS + 0.25) * SIZE;
const isCentral = (i, j) => i >= 0 && i < N && j >= 0 && j < N;

// ----- Hasard « fixe » (toujours le même pour une position) -----
function h2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// bruit doux : les quartiers forment de grandes zones
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function cellType(i, j, r) {
  const dens = noise(i * 0.14 + 31.7, j * 0.14 - 12.3), ind = noise(i * 0.09 - 7.1, j * 0.09 + 44.4);
  const q = r();
  if (q < 0.06) return 'park';
  if (ind > 0.7 && dens < 0.6) return 'ind';
  if (q < 0.085) return 'plaza';
  if (dens > 0.64) return 'down';
  if (dens > 0.44) return 'mid';
  return 'res';
}

// ----- Couleurs (teintes naturelles) -----
const C3 = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const WHITE = [1, 1, 1];
const FT = ['#ffffff', '#f1ebe1', '#e3ddd3', '#d5d1cb', '#ebdfcb', '#dfe4e8', '#cbd2d8'].map(C3);
const GT = ['#ffffff', '#dde9f1', '#c9dbe7', '#e9eff3'].map(C3);
const WALLS = ['#f4efe6', '#e9dcc5', '#d8cfc0', '#f1e3c8', '#e4e4de', '#cdbfae', '#efe9df', '#e6d3bf'].map(C3);
const TILES = ['#9a4a35', '#8a3b2a', '#5d5f63', '#7a4232', '#4b4f55', '#a35a3e'].map(C3);
const METALS = ['#b9bcbf', '#a2a7ab', '#cfd2d4'].map(C3);
const SHED = ['#c9c6bf', '#b7bcc0', '#d6cdbd', '#a9b0a8'].map(C3);
const AWN = ['#a83232', '#2f6e4f', '#2d5d8a', '#c47a2c', '#6b3f7a', '#3d4248', '#b5485a', '#1f7a7a'].map(C3);
const LEDGE = C3('#cfc9bf'), STEEL = C3('#8c9196'), DARK = C3('#30373d'), WOOD = C3('#7a5a3c');
const BRICK = C3('#8c5546'), PATH = C3('#d8cfbf'), WALK = C3('#d2cec8');
const LEAF = ['#4f7a35', '#5d8a3c', '#3f6b2e', '#6b9142', '#567d3a', '#7a9a48', '#b0702c'].map((h) => new THREE.Color(h));

// ----- Matériaux (partagés par tous les chunks) -----
const M = {};
const NO_SHADOW = new Set(['road', 'mark', 'walk', 'grass', 'plaza', 'sign', 'door']);
function tex(t, rep = 1) {
  if (!t) return null;
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rep, rep); c.offset.set(0, 0); c.needsUpdate = true;
  return c;
}
const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9 }, o));
const FRONT = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }; // gagne contre le trottoir dessous
function makeMats() {
  M.road = std({ map: tex(TX.asphaltTex, 0.5), roughness: 0.92, vertexColors: false });
  M.mark = std({ color: 0xeeeeee, roughness: 0.6, vertexColors: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  M.walk = std({ map: tex(TX.sidewalkTex), roughness: 0.95 });
  M.grass = std(Object.assign({ map: tex(TX.grassTex), roughness: 1 }, FRONT));
  M.plaza = std(Object.assign({ map: tex(TX.concreteTex) }, FRONT));
  M.roof = std({ map: tex(TX.roofTex) });
  M.ledge = std({ map: tex(TX.concreteTex), roughness: 0.85 });
  M.tile = std({ map: tex(TX.roofTileTex || TX.roofTex), roughness: 0.8, side: THREE.DoubleSide });
  M.metal = std({ roughness: 0.45, metalness: 0.4 });
  M.wood = std({ roughness: 0.9 });
  M.awn = std({ roughness: 0.8, side: THREE.DoubleSide });      // toiles des auvents
  M.shopc = std({ roughness: 0.5 });                             // cadres des boutiques
  M.door = std({ color: 0x4a2f5c, emissive: 0xffc46b, emissiveIntensity: 0.25, roughness: 0.4 });
  const ei = windowMats.length ? windowMats[0].emissiveIntensity : 0;
  M.dark = std({ roughness: 0.15, metalness: 0.5, envMap: getEnvMap(), emissive: 0x6a5232, emissiveIntensity: ei });
  M.house = std({ map: tex(TX.houseTex), emissiveMap: tex(TX.houseEm), emissive: 0xffffff, emissiveIntensity: ei, roughness: 0.8 });
  windowMats.push(M.dark, M.house); envMats.push(M.dark);
  TX.FACADES.forEach((f, i) => {
    const m = std({
      map: tex(TX.facadeTex[i].map), emissiveMap: tex(TX.facadeTex[i].em), emissive: 0xffffff, emissiveIntensity: ei,
      roughness: f.glassy ? 0.25 : 0.75, metalness: f.glassy ? 0.3 : 0.02, envMap: f.glassy ? getEnvMap() : null,
    });
    windowMats.push(m);
    if (f.glassy) envMats.push(m);
    M['f' + i] = m;
  });
}

// ----- Fabrication de la géométrie fusionnée -----
class Bk { constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; } }
const bucket = (K, name) => K.b[name] || (K.b[name] = new Bk());

// Hauteur ajoutée à chaque point : soit le relief (sol « drapé »),
// soit une hauteur fixe OY (bâtiment posé sur le relief)
let OY = 0, DRAPE = false;
const ground = () => { DRAPE = true; OY = 0; };
const at = (y) => { DRAPE = false; OY = y; };
// base d'un bâtiment : un peu sous le trottoir, au point le plus bas de son terrain
function baseY(x, z, w, d) {
  const a = w / 2, b = d / 2;
  return Math.min(TH(x, z), TH(x - a, z - b), TH(x + a, z - b), TH(x - a, z + b), TH(x + a, z + b)) + SIDE - 0.12;
}

// polygone convexe (3 ou 4 points, dans le sens inverse des aiguilles vu de devant)
function poly(B, pts, uvs, c) {
  const P = B.p, k = P.length / 3, n = pts.length;
  for (let q = 0; q < n; q++) {
    const p = pts[q];
    P.push(p[0], p[1] + (DRAPE ? TH(p[0], p[2]) : OY), p[2]);
  }
  const o = k * 3;
  const e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2];
  const e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (let q = 0; q < n; q++) {
    B.n.push(nx, ny, nz);
    B.u.push(uvs[q * 2], uvs[q * 2 + 1]);
    B.c.push(c[0], c[1], c[2]);
  }
  for (let q = 1; q < n - 1; q++) B.i.push(k, k + q, k + q + 1);
}
// découpe [a, b] sur la grille du monde (tous les STEP m) : les voisins tombent juste
function cuts(a, b) {
  const o = [a];
  for (let t = (Math.floor(a / STEP) + 1) * STEP; t < b - 0.05; t += STEP) if (t > a + 0.05) o.push(t);
  o.push(b);
  return o;
}
// rectangle horizontal à la hauteur y (s = taille d'une répétition de texture)
// sur le relief (DRAPE) : découpé en petits carreaux qui suivent les collines
function flat(B, x0, z0, x1, z1, y, c, s = 4) {
  const q = (xa, za, xb, zb) => poly(B, [[xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za]], [xa / s, -zb / s, xb / s, -zb / s, xb / s, -za / s, xa / s, -za / s], c);
  if (!DRAPE) { q(x0, z0, x1, z1); return; }
  const xs = cuts(x0, x1), zs = cuts(z0, z1);
  for (let a = 0; a < xs.length - 1; a++) for (let b = 0; b < zs.length - 1; b++) q(xs[a], zs[b], xs[a + 1], zs[b + 1]);
}
// bordure verticale le long d'un bord A → B (la face regarde à droite du trajet)
function curb(B, ax, az, bx, bz, y0, y1, c) {
  const alongX = az === bz, a = alongX ? ax : az, b = alongX ? bx : bz;
  const ts = a < b ? cuts(a, b) : cuts(b, a).reverse();
  for (let k = 0; k < ts.length - 1; k++) {
    const p = ts[k], q = ts[k + 1];
    const px = alongX ? p : ax, pz = alongX ? az : p, qx = alongX ? q : ax, qz = alongX ? az : q;
    poly(B, [[px, y0, pz], [qx, y0, qz], [qx, y1, qz], [px, y1, pz]], [p / 4, y0 / 4, q / 4, y0 / 4, q / 4, y1 / 4, p / 4, y1 / 4], c);
  }
}
// dalle de trottoir drapée : dessus + 4 bordures qui descendent sous la route
function slab(B, x0, z0, x1, z1, y, c) {
  flat(B, x0, z0, x1, z1, y, c, 4);
  curb(B, x0, z1, x1, z1, -0.15, y, c);   // côté +z
  curb(B, x1, z1, x1, z0, -0.15, y, c);   // côté +x
  curb(B, x1, z0, x0, z0, -0.15, y, c);   // côté -z
  curb(B, x0, z0, x0, z1, -0.15, y, c);   // côté -x
}
// boîte posée au sol y0 : côtés → S, dessus → T (null = pas de dessus)
// su > 0 : façade (fenêtres alignées, su m par fenêtre, 3,5 m par étage)
// su = -1 : texture entière sur chaque face · sinon 1 répétition = uvs mètres
function boxB(S, T, x, y0, z, w, h, d, c, su = 0, uvs = 4) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
  let uw, ud, v0, v1;
  if (su > 0) {
    uw = Math.max(1, Math.round(w / su)) / 8; ud = Math.max(1, Math.round(d / su)) / 8;
    v0 = Math.round(y0 / 3.5) / 8; v1 = v0 + Math.max(1, Math.round(h / 3.5)) / 8;
  } else if (su < 0) { uw = ud = 1; v0 = 0; v1 = 1; }
  else { uw = w / uvs; ud = d / uvs; v0 = y0 / uvs; v1 = y1 / uvs; }
  if (S) {
    poly(S, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, v0, uw, v0, uw, v1, 0, v1], c);
    poly(S, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, v0, uw, v0, uw, v1, 0, v1], c);
    poly(S, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [0, v0, ud, v0, ud, v1, 0, v1], c);
    poly(S, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [0, v0, ud, v0, ud, v1, 0, v1], c);
  }
  if (T) flat(T, x0, z0, x1, z1, y1, c, su > 0 ? 8 : uvs);
}
// cylindre à n côtés (réservoir, cheminée, obélisque) + toit pointu ou plat
function prism(S, T, x, y0, z, r, h, n, c, cone) {
  const y1 = y0 + h, top = [], tuv = [];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const xa = x + Math.cos(a0) * r, za = z - Math.sin(a0) * r, xb = x + Math.cos(a1) * r, zb = z - Math.sin(a1) * r;
    poly(S, [[xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y1, za]], [k / n, 0, (k + 1) / n, 0, (k + 1) / n, h / 4, k / n, h / 4], c);
    if (cone) poly(T, [[xa, y1, za], [xb, y1, zb], [x, y1 + r * 0.9, z]], [0, 0, 1, 0, 0.5, 0.5], c);
    top.push([xa, y1, za]); tuv.push(xa / 4, -za / 4);
  }
  if (!cone) poly(T, top, tuv, c);
}
// toit à quatre pans (tuiles), faîtage le long du grand côté
function hipRoof(B, x, y, z, w, d, rh, c) {
  const al = w >= d, o = 0.5;
  const A = (al ? w : d) / 2 + o, W = (al ? d : w) / 2 + o, g = Math.max(0, A - W);
  const P = al ? (a, yy, b) => [x + a, yy, z + b] : (a, yy, b) => [x + b, yy, z - a];
  const yt = y + rh, s = Math.hypot(W, rh) / 3, uvT = [0, 0, (2 * A) / 3, 0, (A + g) / 3, s, (A - g) / 3, s], uvE = [0, 0, (2 * W) / 3, 0, W / 3, s];
  poly(B, [P(-A, y, W), P(A, y, W), P(g, yt, 0), P(-g, yt, 0)], uvT, c);
  poly(B, [P(A, y, -W), P(-A, y, -W), P(-g, yt, 0), P(g, yt, 0)], uvT, c);
  poly(B, [P(A, y, W), P(A, y, -W), P(g, yt, 0)], uvE, c);
  poly(B, [P(-A, y, -W), P(-A, y, W), P(-g, yt, 0)], uvE, c);
}
// acrotère (petit muret autour du toit)
function parapet(L, x, y, z, w, d, c) {
  const t = 0.35;
  boxB(L, L, x, y, z - d / 2 + t / 2, w, 1, t, c);
  boxB(L, L, x, y, z + d / 2 - t / 2, w, 1, t, c);
  boxB(L, L, x - w / 2 + t / 2, y, z, t, 1, d - 2 * t, c);
  boxB(L, L, x + w / 2 - t / 2, y, z, t, 1, d - 2 * t, c);
}
// la partie de route qui n'est PAS sur la ville du centre (sinon ça clignote)
function minusCenter(q) {
  const [x0, z0, x1, z1] = q, H = HALF;
  if (x1 <= -H || x0 >= H || z1 <= -H || z0 >= H) return [q];
  const out = [];
  if (x0 < -H) out.push([x0, z0, -H, z1]);
  if (x1 > H) out.push([H, z0, x1, z1]);
  const ax = Math.max(x0, -H), bx = Math.min(x1, H);
  if (z0 < -H) out.push([ax, z0, bx, -H]);
  if (z1 > H) out.push([ax, H, bx, z1]);
  return out;
}

// ----- Les éléments d'un pâté -----
function tree(K, x, z, s) {
  const r = K.r;
  s = s || 0.8 + r() * 0.5;
  const y = TH(x, z) + SIDE;
  K.trees.push([x, y, z, s, r() * 6, LEAF[(r() * LEAF.length) | 0]]);
  K.cols.push(addCollider(x, z, 1.1, 1.1, y + 8 * s));
}
// auvent de magasin (toile colorée penchée) au rez-de-chaussée d'une façade
// f : 0 = côté +z, 1 = côté -z, 2 = côté +x, 3 = côté -x
function awning(K, x, z, w, d, f, c) {
  const L = Math.min(7, (f < 2 ? w : d) * 0.36), o = 1.7, y1 = 3.7, y0 = 3.05;
  const P = f === 0 ? (u, y, e) => [x + u, y, z + d / 2 + e]
    : f === 1 ? (u, y, e) => [x - u, y, z - d / 2 - e]
      : f === 2 ? (u, y, e) => [x + w / 2 + e, y, z - u]
        : (u, y, e) => [x - w / 2 - e, y, z + u];
  const m = P(0, 0, 0.6);
  at(TH(m[0], m[2]) + SIDE);
  const A = bucket(K, 'awn');
  poly(A, [P(-L, y0, o), P(L, y0, o), P(L, y1, 0.05), P(-L, y1, 0.05)], [0, 0, 1, 0, 1, 1, 0, 1], c);
  poly(A, [P(-L, y0 - 0.35, o), P(L, y0 - 0.35, o), P(L, y0, o), P(-L, y0, o)], [0, 0, 1, 0, 1, 0.2, 0, 0.2], c);
}
// faces : façades côté rue (pour les auvents) · shopFace : façade d'une vraie boutique
function tower(K, x, z, w, d, h, fi, faces, shopFace = -1) {
  const r = K.r, glassy = !!(TX.FACADES[fi] && TX.FACADES[fi].glassy);
  const F = bucket(K, 'f' + fi), R = bucket(K, 'roof'), L = bucket(K, 'ledge'), Me = bucket(K, 'metal');
  const tint = glassy ? GT[(r() * GT.length) | 0] : FT[(r() * FT.length) | 0], su = glassy ? 3 : 4;
  at(baseY(x, z, w, d));
  const base = OY;
  boxB(F, R, x, 0, z, w, h, d, tint, su);
  K.cols.push(addCollider(x, z, w, d, base + h));
  let top = h, tw = w, td = d;
  if (!glassy) {
    if (r() < 0.6) boxB(bucket(K, 'dark'), L, x, 0, z, w + 0.3, 4, d + 0.3, DARK);   // vitrines
    boxB(L, L, x, top - 0.9, z, w + 0.7, 0.6, d + 0.7, LEDGE);                    // corniche
  }
  parapet(L, x, top, z, w, d, glassy ? STEEL : LEDGE);
  if (h > 55 && r() < 0.55) {   // étage en retrait
    const cw = w * (0.55 + r() * 0.2), cd = d * (0.55 + r() * 0.2), ch = h * (0.1 + r() * 0.12);
    boxB(F, R, x, top, z, cw, ch, cd, tint, su);
    top += ch; tw = cw; td = cd;
    parapet(L, x, top, z, cw, cd, glassy ? STEEL : LEDGE);
  }
  const n = 1 + ((r() * 3) | 0);   // climatiseurs
  for (let k = 0; k < n; k++) boxB(Me, Me, x + (r() - 0.5) * tw * 0.5, top, z + (r() - 0.5) * td * 0.5, 1.5 + r() * 2.5, 1.2 + r(), 1.5 + r() * 2.5, METALS[(r() * METALS.length) | 0], 0, 2);
  if (!glassy && h < 50 && r() < 0.3) {   // château d'eau en bois (style New York)
    const tx = x + (r() - 0.5) * tw * 0.4, tz = z + (r() - 0.5) * td * 0.4;
    boxB(Me, Me, tx, top, tz, 3, 2, 3, STEEL, 0, 2);
    prism(bucket(K, 'wood'), bucket(K, 'wood'), tx, top + 2, tz, 1.7, 3.4, 10, WOOD, true);
  }
  if (h > 80 && r() < 0.5) boxB(Me, Me, x, top, z, 0.4, 10 + r() * 8, 0.4, STEEL, 0, 2);   // antenne
  // petits commerces au rez-de-chaussée : auvents colorés côté rue
  if (!glassy && faces && r() < 0.55) {
    for (const f of faces) if (f !== shopFace && r() < 0.75) awning(K, x, z, w, d, f, AWN[(r() * AWN.length) | 0]);
  }
}
function house(K, x, z, w, d, h) {
  const r = K.r, rh = 2.5 + r() * 1.5;
  at(baseY(x, z, w, d));
  boxB(bucket(K, 'house'), null, x, 0, z, w, h, d, WALLS[(r() * WALLS.length) | 0], -1);
  hipRoof(bucket(K, 'tile'), x, h, z, w, d, rh, TILES[(r() * TILES.length) | 0]);
  if (r() < 0.5) { const L = bucket(K, 'ledge'); boxB(L, L, x + w * 0.22, h + rh * 0.2, z + (r() - 0.5) * d * 0.3, 0.8, rh * 0.9, 0.8, BRICK, 0, 2); }
  K.cols.push(addCollider(x, z, w, d, OY + h + 3));
}
function industry(K, bx, bz) {
  const r = K.r, L = bucket(K, 'ledge'), R = bucket(K, 'roof'), Me = bucket(K, 'metal');
  ground();
  flat(bucket(K, 'plaza'), bx - IN, bz - IN, bx + IN, bz + IN, SIDE + 0.03, WHITE, 8);
  const two = r() < 0.5;
  const sheds = two ? [[bx, bz - 13, 50, 22], [bx, bz + 14, 50, 20]] : [[bx - 4, bz, 40, 48]];
  for (const [x, z, w, d] of sheds) {
    const h = 8 + r() * 7;
    at(baseY(x, z, w, d));
    boxB(L, R, x, 0, z, w, h, d, SHED[(r() * SHED.length) | 0]);
    boxB(bucket(K, 'dark'), null, x, h - 3, z, w + 0.1, 1.4, d + 0.1, DARK);   // bande de fenêtres
    K.cols.push(addCollider(x, z, w, d, OY + h));
    for (let k = 0; k < 3; k++) boxB(Me, Me, x + (r() - 0.5) * w * 0.6, h, z + (r() - 0.5) * d * 0.6, 2 + r() * 2, 1.5, 2 + r() * 2, STEEL, 0, 2);
  }
  if (!two) {   // cheminée d'usine en briques
    const ch = 26 + r() * 14;
    at(baseY(bx + 22, bz - 18, 3.2, 3.2));
    prism(L, L, bx + 22, 0, bz - 18, 1.6, ch, 10, BRICK, false);
    K.cols.push(addCollider(bx + 22, bz - 18, 3.2, 3.2, OY + ch));
  }
}
function park(K, bx, bz) {
  const r = K.r, G = bucket(K, 'grass'), P = bucket(K, 'plaza'), y = SIDE + 0.03;
  ground();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const xa = sx < 0 ? bx - IN : bx + 1.5, xb = sx < 0 ? bx - 1.5 : bx + IN;
    const za = sz < 0 ? bz - IN : bz + 1.5, zb = sz < 0 ? bz - 1.5 : bz + IN;
    flat(G, xa, za, xb, zb, y, WHITE, 6);
    for (let k = 0; k < 5; k++) tree(K, xa + 3 + r() * (xb - xa - 6), za + 3 + r() * (zb - za - 6), 0.9 + r() * 0.6);
  }
  flat(P, bx - IN, bz - 1.5, bx + IN, bz + 1.5, y, PATH);   // allées
  flat(P, bx - 1.5, bz - IN, bx + 1.5, bz - 1.5, y, PATH);
  flat(P, bx - 1.5, bz + 1.5, bx + 1.5, bz + IN, y, PATH);
}
function plaza(K, bx, bz) {
  const L = bucket(K, 'ledge');
  ground();
  flat(bucket(K, 'plaza'), bx - IN, bz - IN, bx + IN, bz + IN, SIDE + 0.03, PATH, 8);
  for (const a of [-20, -8, 8, 20]) for (const b of [-20, 20]) tree(K, bx + a, bz + b, 0.9);
  at(baseY(bx, bz, 4, 4));
  boxB(L, L, bx, 0, bz, 4, 2.12, 4, LEDGE, 0, 2);                  // monument : socle
  prism(L, L, bx, 2.12, bz, 1, 12, 4, LEDGE, true);                // + obélisque
  K.cols.push(addCollider(bx, bz, 4, 4, OY + 14.12));
}

// ----- 🛍️ Vraies boutiques (mêmes types que celles du centre) -----
let KINDS = null, RING_GEO = null, DISC_GEO = null;
const SHOPM = new Map();
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// on récupère les types de boutiques (habits, armes, snack) déjà créés au centre
function shopKinds() {
  if (KINDS) return KINDS;
  const list = [];
  for (const s of shops) if (s.kind && s.kind.name && s.icon && !list.includes(s.kind)) list.push(s.kind);
  if (!list.length) return null;   // les boutiques du centre ne sont pas encore prêtes
  KINDS = list;
  // toutes les enseignes dans une seule image (une ligne par type) = 1 seul objet par chunk
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128 * list.length;
  const g = cv.getContext('2d');
  list.forEach((k, n) => {
    const y = n * 128;
    g.fillStyle = '#ffffff'; rrect(g, 0, y, 512, 128, 44); g.fill();
    g.fillStyle = k.color || '#888888'; rrect(g, 8, y + 8, 496, 112, 38); g.fill();
    const text = (k.icon ? k.icon + ' ' : '') + k.name;
    let size = 56;
    do { g.font = 'bold ' + size + 'px system-ui, sans-serif'; size -= 2; } while (g.measureText(text).width > 462 && size > 20);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, y + 67);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  M.sign = new THREE.MeshBasicMaterial({ map: t, transparent: true });
  RING_GEO = new THREE.RingGeometry(1.0, 1.35, 32);
  DISC_GEO = new THREE.CircleGeometry(1.0, 32);
  for (const k of list) {
    const proto = shops.find((s) => s.kind === k);
    SHOPM.set(k, {
      col: C3(k.color || '#888888'),
      ring: new THREE.MeshBasicMaterial({ color: k.color || '#888888', transparent: true, opacity: 0.9, depthWrite: false }),
      disc: new THREE.MeshBasicMaterial({ color: k.color || '#888888', transparent: true, opacity: 0.25, depthWrite: false }),
      icon: proto.icon.material,
    });
  }
  return KINDS;
}
// devanture sur la façade +z d'un immeuble (face = z de la façade)
function addShop(K, x, face) {
  const ks = shopKinds();
  if (!ks) return;
  const kind = ks[(K.r() * ks.length) | 0], S = SHOPM.get(kind);
  at(TH(x, face + 1) + SIDE);   // au niveau du trottoir devant la porte
  const C = bucket(K, 'shopc'), D = bucket(K, 'door');
  boxB(C, C, x, -1, face + 0.15, 4.4, 5.8, 0.5, S.col);        // cadre coloré
  boxB(D, D, x, 0, face + 0.35, 2.6, 3.5, 0.4, WHITE);          // porte éclairée
  boxB(C, C, x, 4.75, face + 0.9, 6.6, 0.4, 1.8, WHITE);        // auvent
  const n = ks.length, row = ks.indexOf(kind), v0 = 1 - (row + 1) / n, v1 = 1 - row / n, zf = face + 0.45;
  poly(bucket(K, 'sign'), [[x - 3, 5.35, zf], [x + 3, 5.35, zf], [x + 3, 6.85, zf], [x - 3, 6.85, zf]], [0, v0, 1, v0, 1, v1, 0, v1], WHITE);
  // cercle d'entrée + icône qui flotte (comme au centre : shops.js les anime)
  const mx = x, mz = face + 2.9;
  let gr = 0;
  for (const [a, b] of [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) gr = Math.max(gr, TH(mx + a, mz + b));
  const ring = new THREE.Mesh(RING_GEO, S.ring);
  ring.rotation.x = -Math.PI / 2; ring.position.set(mx, gr + SIDE + 0.05, mz);
  const disc = new THREE.Mesh(DISC_GEO, S.disc);
  disc.rotation.x = -Math.PI / 2; disc.position.set(mx, gr + SIDE + 0.04, mz);
  const holder = new THREE.Group();
  holder.position.y = gr;   // l'icône garde sa hauteur « 2,3 m » au-dessus du sol
  const icon = new THREE.Sprite(S.icon);
  icon.scale.set(1.3, 1.3, 1); icon.position.set(mx, 2.3, mz);
  holder.add(icon);
  ring.userData.keep = disc.userData.keep = icon.userData.keep = true;   // géométries partagées
  K.extra.push(ring, disc, holder);
  K.shops.push({ kind, mx, mz, ring, icon, disc, ready: true });
}

function fillCell(K, i, j) {
  const r = (K.r = makeRng((h2(i, j) * 4294967296) | 0));
  const X0 = rc(i), X1 = rc(i + 1), Z0 = rc(j), Z1 = rc(j + 1);
  const bx = blockCenter(i), bz = blockCenter(j);
  const empty = (a, b) => !isCentral(a, b) && !cellBuilt(a, b);
  const eE = empty(i + 1, j), eS = empty(i, j + 1);
  ground();
  // route (+ la moitié qui manque si le voisin est vide)
  const rects = [[X0, Z0, X1, Z1]];
  if (empty(i - 1, j)) rects.push([X0 - ROAD / 2, Z0, X0, Z1]);
  if (eE) rects.push([X1, Z0, X1 + ROAD / 2, Z1]);
  if (empty(i, j - 1)) rects.push([X0, Z0 - ROAD / 2, X1, Z0]);
  if (eS) rects.push([X0, Z1, X1, Z1 + ROAD / 2]);
  const RD = bucket(K, 'road'), MK = bucket(K, 'mark');
  for (const q of rects) for (const p of minusCenter(q)) flat(RD, p[0], p[1], p[2], p[3], 0, WHITE, 4);
  // lignes blanches pointillées
  const dashZ = (xr) => { for (let t = Z0 + 13; t < Z1 - 15; t += 6) flat(MK, xr - 0.15, t, xr + 0.15, t + 3, 0.05, WHITE); };
  const dashX = (zr) => { for (let t = X0 + 13; t < X1 - 15; t += 6) flat(MK, t, zr - 0.15, t + 3, zr + 0.15, 0.05, WHITE); };
  if (!isCentral(i - 1, j)) dashZ(X0);
  if (eE) dashZ(X1);
  if (!isCentral(i, j - 1)) dashX(Z0);
  if (eS) dashX(Z1);
  // passages piétons (la moitié qui est dans ce pâté)
  const off = ROAD / 2 + 2.2;
  for (const [cx, cz, dx, dz] of [[X0, Z0, 1, 1], [X1, Z0, -1, 1], [X0, Z1, 1, -1], [X1, Z1, -1, -1]]) {
    for (const s of [1.2, 3.6, 6]) {
      const ax = cx + dx * s, az = cz + dz * off, hx = cx + dx * off, hz = cz + dz * s;
      flat(MK, ax - 0.6, az - 1.8, ax + 0.6, az + 1.8, 0.05, WHITE);
      flat(MK, hx - 1.8, hz - 0.6, hx + 1.8, hz + 0.6, 0.05, WHITE);
    }
  }
  // lampadaires au bord du trottoir (le bras pointe vers la route)
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const t of [-18, 18]) {
    const x = bx + nx * (HB - 0.8) - nz * t, z = bz + nz * (HB - 0.8) + nx * t;
    K.lamps.push([x, TH(x, z) + SIDE, z, Math.atan2(nx, nz)]);
  }
  // le trottoir (dalle qui suit le relief, avec ses bordures)
  const type = cellType(i, j, r);
  slab(bucket(K, 'walk'), bx - HB, bz - HB, bx + HB, bz + HB, SIDE, WALK);
  // le contenu du pâté selon le quartier
  if (type === 'down') {
    if (r() < 0.3) tower(K, bx, bz, 34 + r() * 14, 34 + r() * 14, 70 + r() * 110, r() < 0.6 ? 0 : 1, [0, 1, 2, 3]);
    else {
      const sq = r() < SHOP_P ? (r() < 0.5 ? -1 : 1) : 0;   // quelle tour a une vraie boutique
      for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
        const x = bx + qx * 14, z = bz + qz * 14, w = 17 + r() * 7, d = 17 + r() * 7, shop = qz > 0 && qx === sq;
        tower(K, x, z, w, d, 28 + r() * 92, [0, 1, 1, 2, 4][(r() * 5) | 0], [qz > 0 ? 0 : 1, qx > 0 ? 2 : 3], shop ? 0 : -1);
        if (shop) addShop(K, x, z + d / 2);
      }
    }
  } else if (type === 'mid') {
    const sq = r() < SHOP_P ? (r() < 0.5 ? -1 : 1) : 0;
    for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
      const x = bx + qx * 14, z = bz + qz * 14;
      if (r() < 0.1) { tree(K, x - 4, z - 4); tree(K, x + 4, z + 3); tree(K, x - 2, z + 6); continue; }
      const w = 18 + r() * 7, d = Math.min(24, 18 + r() * 7), shop = qz > 0 && qx === sq;
      tower(K, x, z, w, d, 10 + r() * 28, [2, 3, 4, 1, 3][(r() * 5) | 0], [qz > 0 ? 0 : 1, qx > 0 ? 2 : 3], shop ? 0 : -1);
      if (shop) addShop(K, x, z + d / 2);
    }
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r() < 0.6) tree(K, bx + nx * (HB - 2.2), bz + nz * (HB - 2.2), 0.8);
  } else if (type === 'res') {
    ground();
    flat(bucket(K, 'grass'), bx - IN, bz - IN, bx + IN, bz + IN, SIDE + 0.03, WHITE, 6);
    for (const gx of [-1, 0, 1]) for (const gz of [-1, 0, 1]) {
      const x = bx + gx * 18, z = bz + gz * 18;
      if (!gx && !gz) { tree(K, x, z, 1.3); continue; }
      house(K, x, z, 9 + r() * 3, 9 + r() * 3, 5 + r() * 2);
      if (r() < 0.5) tree(K, x + (r() < 0.5 ? -1 : 1) * 9, z + (r() - 0.5) * 8);
    }
  } else if (type === 'ind') industry(K, bx, bz);
  else if (type === 'park') park(K, bx, bz);
  else plaza(K, bx, bz);
}

// ----- Un chunk entier -----
function buildChunk(ci, cj) {
  const K = { b: {}, cols: [], trees: [], lamps: [], shops: [], extra: [], r: null };
  for (let a = 0; a < CH; a++) for (let b = 0; b < CH; b++) {
    const i = ci * CH + a, j = cj * CH + b;
    if (isCentral(i, j) || !cellBuilt(i, j)) continue;   // ville du centre, aéroport, autres villes...
    fillCell(K, i, j);
  }
  const g = new THREE.Group();
  for (const name in K.b) {
    const B = K.b[name];
    if (!B.i.length || !M[name]) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    geo.setIndex(B.i);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, M[name]);
    m.receiveShadow = true;
    m.castShadow = SH && !NO_SHADOW.has(name);
    m.matrixAutoUpdate = false;   // rien ne bouge : on évite des calculs à chaque image
    g.add(m);
  }
  if (K.trees.length) {   // arbres
    const n = K.trees.length;
    const tr = new THREE.InstancedMesh(propParts.trunkGeo, propParts.trunkMat, n);
    const lf = new THREE.InstancedMesh(propParts.leafGeo, propParts.leafMat, n);
    K.trees.forEach(([x, y, z, s, rot, c], k) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      tr.setMatrixAt(k, dummy.matrix); lf.setMatrixAt(k, dummy.matrix); lf.setColorAt(k, c);
    });
    tr.castShadow = lf.castShadow = SH; tr.receiveShadow = lf.receiveShadow = true;
    tr.matrixAutoUpdate = lf.matrixAutoUpdate = false;
    g.add(tr, lf);
  }
  if (K.lamps.length) {   // lampadaires
    const n = K.lamps.length;
    const po = new THREE.InstancedMesh(propParts.poleGeo, propParts.poleMat, n);
    const he = new THREE.InstancedMesh(propParts.headGeo, lampHeadMat, n);
    K.lamps.forEach(([x, y, z, ry], k) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      po.setMatrixAt(k, dummy.matrix); he.setMatrixAt(k, dummy.matrix);
    });
    po.castShadow = SH;
    po.matrixAutoUpdate = he.matrixAutoUpdate = false;
    g.add(po, he);
  }
  dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
  for (const o of K.extra) g.add(o);
  g.matrixAutoUpdate = false;
  scene.add(g);
  for (const s of K.shops) shops.push(s);
  return { g, cols: K.cols, shops: K.shops, ci, cj };
}
function dropChunk(ch, dead) {
  scene.remove(ch.g);
  ch.g.traverse((o) => {
    if (o.userData.keep) return;                    // (géométries partagées : on les garde)
    if (o.isInstancedMesh) o.dispose();
    else if (o.isMesh) o.geometry.dispose();
  });
  for (const c of ch.cols) dead.add(c);
  for (const s of ch.shops) { const k = shops.indexOf(s); if (k >= 0) shops.splice(k, 1); }
}

// ----- Chargement / déchargement autour de la caméra -----
const chunks = new Map();
let lastKey = '', queue = [], far = null;
function tick(cam) {
  if (!cam || !cam.isPerspectiveCamera) return;
  const px = cam.position.x, pz = cam.position.z;
  const ci = Math.floor((px - rc(0)) / SIZE), cj = Math.floor((pz - rc(0)) / SIZE);
  const key = ci + ',' + cj;
  if (key !== lastKey) {
    lastKey = key;
    const dead = new Set();
    for (const [k, ch] of chunks) {
      if (Math.max(Math.abs(ch.ci - ci), Math.abs(ch.cj - cj)) > KEEP) { dropChunk(ch, dead); chunks.delete(k); }
    }
    if (dead.size) {   // on retire leurs murs invisibles
      let w = 0;
      for (let k = 0; k < colliders.length; k++) if (!dead.has(colliders[k])) colliders[w++] = colliders[k];
      colliders.length = w;
    }
    // les chunks gardés en réserve (hors de vue) ne sont plus dessinés
    for (const ch of chunks.values()) ch.g.visible = Math.max(Math.abs(ch.ci - ci), Math.abs(ch.cj - cj)) <= RADIUS;
    queue = [];
    for (let a = -RADIUS; a <= RADIUS; a++) for (let b = -RADIUS; b <= RADIUS; b++) {
      if (!chunks.has((ci + a) + ',' + (cj + b))) queue.push([ci + a, cj + b, a * a + b * b]);
    }
    queue.sort((p, q) => p[2] - q[2]);   // les plus proches d'abord
  }
  const next = queue.shift();
  if (next) {
    const k = next[0] + ',' + next[1];
    if (!chunks.has(k)) chunks.set(k, buildChunk(next[0], next[1]));
  }
  // cercles + icônes des boutiques : seulement celles qui sont assez près
  for (const ch of chunks.values()) for (const s of ch.shops) {
    const v = Math.abs(s.mx - px) + Math.abs(s.mz - pz) < SHOP_VIEW;
    if (s.ring.visible !== v) s.ring.visible = s.disc.visible = s.icon.visible = v;
  }
  // le brouillard cache le bout de la ville chargée
  const f = scene.fog;
  if (f && f.isFog && f.far > FOG_MAX) { f.far = FOG_MAX; if (f.near > FOG_MAX * 0.35) f.near = FOG_MAX * 0.35; }
  if (far) far.position.set(Math.round(px / 8) * 8, -0.6, Math.round(pz / 8) * 8);
}

// ----- Textures photo en ligne (si internet ne répond pas : on garde les dessinées) -----
function loadPhotos() {
  const L = new THREE.TextureLoader();
  const base = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_';
  const prep = (t, srgb) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const forCity = (t) => { const c = t.clone(); c.repeat.set(CITY / 4, CITY / 4); c.needsUpdate = true; return c; };
  L.load(base + 'diff_1k.jpg', (t) => {
    prep(t, true);
    M.road.map = t; M.road.needsUpdate = true;          // 1 photo = 4 m de route
    if (roadMat) { roadMat.map = forCity(t); roadMat.bumpMap = null; roadMat.needsUpdate = true; }
  }, undefined, () => console.warn('Photo asphalte indisponible : on garde la texture dessinée'));
  L.load(base + 'nor_gl_1k.jpg', (t) => {
    prep(t, false);
    M.road.normalMap = t; M.road.needsUpdate = true;
    if (roadMat) { roadMat.normalMap = forCity(t); roadMat.needsUpdate = true; }
  }, undefined, () => {});
}

export function initInfinite() {
  makeMats();
  // grand sol d'herbe qui suit la caméra (sous tout le reste, au cas où)
  far = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x8fae68, map: tex(TX.grassTex, 9000 / 8), roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.receiveShadow = true;
  far.position.y = -0.6;
  scene.add(far);
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, cam, ...rest) {
    if (prev) prev.call(this, renderer, sc, cam, ...rest);
    try { tick(cam); } catch (e) { console.warn('Ville infinie :', e); }
  };
  loadPhotos();
}
