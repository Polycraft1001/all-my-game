// =====================================================
//  MODE EN LIGNE : jouer à plusieurs dans la même ville
//  - un joueur CRÉE une partie et reçoit un code (ex. K7P2Q)
//  - les autres REJOIGNENT avec ce code (8 joueurs max)
//  - connexion directe entre navigateurs avec PeerJS (WebRTC) :
//    aucun serveur à installer, ça marche sur GitHub Pages
//  - l'hôte relaie les messages de tout le monde (réseau « en étoile »)
//  Chaque joueur garde SA ville (circulation, police, piétons) :
//  on partage seulement les joueurs (position, voiture, perso, pseudo).
//
//  PvP (joueur contre joueur) :
//  - tirs et coups de poing : le tireur dit « je t'ai touché »,
//    c'est la victime qui retire ses points de vie (message 'hit')
//  - roquettes et voitures qui explosent : chaque joueur rejoue
//    l'explosion chez lui (message 'boom'), elle fait des dégâts normaux
//  - collisions : chacun gère les chocs de SON côté
//    (driving.js et onfoot.js regardent G.online.targets())
//  - K.O. et voitures détruites par un joueur sont annoncés (message 'ko')
//  - 4 s d'invincibilité aux balles après un K.O.
//  Les autres fichiers utilisent G.online (pas d'import : pas de boucle)
// =====================================================
import * as THREE from 'three';
import { $, lerp, damp, angleDiff, clamp } from '../core/utils.js';
import { G } from '../core/ctx.js';
import { scene } from '../render/engine.js';
import { player, damageCar } from '../vehicles/driving.js';
import { buildCar, buildFerrari, hasFerrari, charMesh } from '../vehicles/models.js';
import { hero, hurtHero } from '../gameplay/onfoot.js';
import { makeCharacter, charactersReady } from '../npc/characters.js';
import { explode } from '../fx/destruction.js';
import { showMessage } from '../ui/hud.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'turbocity3d-v1-';   // préfixe des codes sur le serveur PeerJS
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ni O/0 ni I/1 (on les confond)
const CODE_LEN = 5;
const MAX_PLAYERS = 8;
const SEND_EVERY = 1 / 15;          // 15 envois par seconde
const TIMEOUT = 10000;              // joueur muet depuis 10 s = parti
const JOIN_TIMEOUT = 12000;         // délai max pour rejoindre
const MAX_EXTRA = 0.25;             // on « prédit » le mouvement 0,25 s max entre deux messages
const NAME_KEY = 'turboCity3dName';
const TINTS = ['#ff4d5e', '#4fc3ff', '#3ddc84', '#ffd23a', '#b79bff', '#ff9f6e', '#ff7eb6', '#7df9ff'];
const MAX_HIT = 150;                // dégâts max acceptés pour un seul coup
const HIT_MEMORY = 6000;            // un K.O. compte pour le dernier joueur qui nous a touché (6 s)
const SPAWN_SAFE = 4000;            // invincible aux balles 4 s après un K.O.

// role : 'off' | 'connecting' | 'host' | 'guest'
export const net = { role: 'off', code: '', myId: '', name: '', ko: 0 };
// les autres joueurs : id -> { name, tint, x, y, z, h, mode, car, char, label... }
export const remotes = new Map();

let peer = null;          // notre connexion au serveur PeerJS
let hostConn = null;      // (invité) la connexion vers l'hôte
const guests = new Map(); // (hôte) id -> connexion de chaque invité
let sendT = 0;
let joinTimer = null;
const targetList = [];    // joueurs visibles qu'on peut toucher / percuter (refait à chaque image)
const PVP = { lastBy: '', lastT: 0, safeUntil: 0, wasKO: false, wasWreck: false, burn: 0 };

// ----- Petits outils -----
const live = () => net.role === 'host' || net.role === 'guest';
const cleanName = (s) => String(s || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const r3 = (v) => Math.round((v || 0) * 1000) / 1000;
const nums = (d, n) => Array.isArray(d) && d.length >= n && d.slice(0, n).every((v) => Number.isFinite(v));
function tintOf(id) {
  if (!id || id === 'host') return TINTS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TINTS[1 + (Math.abs(h) % (TINTS.length - 1))];
}
function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function safeSend(conn, msg) {
  if (!conn || !conn.open) return;
  try { conn.send(msg); } catch (e) { /* connexion en train de se fermer */ }
}
function broadcast(msg, except) {
  for (const [id, c] of guests) if (id !== except) safeSend(c, msg);
}
// envoyer un message à tous les autres joueurs
function sendAll(msg) {
  if (net.role === 'guest') safeSend(hostConn, msg);
  else if (net.role === 'host') broadcast({ ...msg, id: 'host' });
}

// pseudo (gardé dans le navigateur)
try { net.name = cleanName(localStorage.getItem(NAME_KEY)); } catch (e) { /* rien */ }
if (!net.name) net.name = 'Pilote' + Math.floor(100 + Math.random() * 900);

// ----- PeerJS est chargé seulement quand on en a besoin -----
let peerLib = null;
const findPeer = () => window.Peer || (window.peerjs && (window.peerjs.Peer || window.peerjs.default)) || null;
function loadPeerJS() {
  if (findPeer()) return Promise.resolve(findPeer());
  if (peerLib) return peerLib;
  peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.onload = () => (findPeer() ? resolve(findPeer()) : reject(new Error('PeerJS introuvable.')));
    s.onerror = () => { peerLib = null; reject(new Error('Impossible de charger PeerJS (connexion internet ?).')); };
    document.head.appendChild(s);
  });
  return peerLib;
}

// =====================================================
//  LES AUTRES JOUEURS (affichage dans la ville)
// =====================================================
function makeLabel(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = "800 30px 'Exo 2', 'Segoe UI', sans-serif";
  const w = Math.min(248, x.measureText(name).width + 34);
  x.fillStyle = 'rgba(5, 8, 20, 0.75)';
  if (x.roundRect) { x.beginPath(); x.roundRect(128 - w / 2, 8, w, 48, 16); x.fill(); }
  else x.fillRect(128 - w / 2, 8, w, 48);
  x.strokeStyle = color; x.lineWidth = 4;
  if (x.roundRect) x.stroke(); else x.strokeRect(128 - w / 2, 8, w, 48);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(4, 1, 1);
  s.renderOrder = 5;
  s.visible = false;
  return s;
}
function setLabel(r) {
  if (r.label) { scene.remove(r.label); r.label.material.map.dispose(); r.label.material.dispose(); }
  r.label = makeLabel(r.name, r.tint);
  scene.add(r.label);
}

function getRemote(id, name) {
  let r = remotes.get(id);
  if (!r) {
    r = {
      id, name: 'Joueur', tint: tintOf(id), seen: false, active: false, mode: -1,
      x: 0, y: 0, z: 0, h: 0, tx: 0, ty: 0, tz: 0, th: 0, speed: 0, extra: 0,
      style: '', col: 'ffffff', wrecked: 0, carKey: '', car: null, char: null, rigged: false,
      label: null, last: performance.now(), ko: 0,
    };
    remotes.set(id, r);
  }
  const n = cleanName(name);
  if (n && n !== r.name) { r.name = n; setLabel(r); }
  else if (!r.label) setLabel(r);
  return r;
}

function dropCar(r) {
  if (!r.car) return;
  scene.remove(r.car.root);
  r.car = null; r.carKey = '';
}
function dropChar(r) {
  if (!r.char) return;
  scene.remove(r.char.root);
  try { r.char.dispose(); } catch (e) { /* rien */ }
  r.char = null;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  dropCar(r); dropChar(r);
  if (r.label) { scene.remove(r.label); r.label.material.map.dispose(); r.label.material.dispose(); }
  remotes.delete(id);
  const i = targetList.indexOf(r);
  if (i >= 0) targetList.splice(i, 1);
}

// sa voiture (reconstruite si elle change : autre modèle, couleur, épave)
function ensureCar(r) {
  const key = r.style + '|' + r.col + '|' + r.wrecked + '|' + (hasFerrari() ? 1 : 0);
  if (r.car && r.carKey === key) return;
  dropCar(r);
  const col = '#' + r.col;
  let car;
  try { car = (r.style === 'ferrari' && hasFerrari()) ? buildFerrari(col) : buildCar(r.style || 'gt', col); }
  catch (e) { car = buildCar('gt', col); }
  if (car.spot) { car.spot.intensity = 0; car.spot.visible = false; } // pas de phare : trop de lumières sinon
  if (r.wrecked) charMesh(car.root);
  scene.add(car.root);
  r.car = car; r.carKey = key;
}
// son perso (refait en vrai perso 3D dès que le modèle est chargé)
function ensureChar(r) {
  if (r.char && (r.rigged || !charactersReady())) return;
  dropChar(r);
  r.char = makeCharacter({ tint: r.tint });
  r.rigged = charactersReady();
  scene.add(r.char.root);
}

// d = [mode, x, y, z, h, vitesse, style, couleur, épave, en jeu]
function applyState(r, d) {
  if (!Array.isArray(d) || d.length < 10) return;
  const m = d[0] | 0, x = +d[1], y = +d[2], z = +d[3], h = +d[4], s = +d[5];
  if (![x, y, z, h, s].every(Number.isFinite)) return;
  // premier message, changement de mode ou téléportation : on place directement
  if (!r.seen || r.mode !== m || Math.hypot(x - r.x, z - r.z) > 40) { r.x = x; r.y = y; r.z = z; r.h = h; }
  r.tx = x; r.ty = y; r.tz = z; r.th = h; r.speed = s; r.extra = 0;
  r.mode = m;
  r.style = String(d[6] || 'gt').slice(0, 20);
  r.col = /^[0-9a-f]{6}$/i.test(d[7]) ? d[7] : 'ffffff';
  r.wrecked = d[8] ? 1 : 0;
  r.active = !!d[9];
  r.seen = true;
  r.last = performance.now();
}

function hideRemote(r) {
  if (r.car) r.car.root.visible = false;
  if (r.char) r.char.root.visible = false;
  if (r.label) r.label.visible = false;
}

function updateRemote(r, dt) {
  if (!r.seen || !r.active) { hideRemote(r); return; }
  // entre deux messages, on continue le mouvement (un peu), puis on glisse doucement
  if (r.extra < MAX_EXTRA) {
    r.extra += dt;
    r.tx += -Math.sin(r.th) * r.speed * dt;
    r.tz += -Math.cos(r.th) * r.speed * dt;
  }
  const k = damp(12, dt);
  r.x = lerp(r.x, r.tx, k); r.y = lerp(r.y, r.ty, k); r.z = lerp(r.z, r.tz, k);
  r.h += angleDiff(r.h, r.th) * k;

  let top = 4;
  if (r.mode === 0) {            // en voiture
    ensureCar(r);
    if (r.char) r.char.root.visible = false;
    const c = r.car;
    c.root.visible = true;
    c.root.position.set(r.x, r.y, r.z);
    c.root.rotation.y = r.h;
    if (!r.wrecked) for (const w of c.wheels) w.rotation.x += c.spin * r.speed * dt / 0.42;
    top = (c.top || 1.6) + 1.1;
  } else if (r.mode === 1) {     // à pied
    ensureChar(r);
    if (r.car) r.car.root.visible = false;
    const ch = r.char;
    ch.root.visible = true;
    ch.root.position.set(r.x, r.y, r.z);
    ch.root.rotation.y = r.h;
    ch.update(dt, r.speed, null, false);
    top = 2.6;
  } else {                       // en avion : on montre juste son nom
    if (r.car) r.car.root.visible = false;
    if (r.char) r.char.root.visible = false;
  }
  r.label.visible = true;
  r.label.position.set(r.x, r.y + top, r.z);
}

// =====================================================
//  PvP : TOUCHER LES AUTRES JOUEURS
// =====================================================
// lancer de rayon (mêmes calculs que dans weapons.js)
const T = [0, 0];
function slab(o, d, mn, mx) {
  if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
  let a = (mn - o) / d, b = (mx - o) / d;
  if (a > b) { const c = a; a = b; b = c; }
  if (a > T[0]) T[0] = a;
  if (b < T[1]) T[1] = b;
  return T[0] <= T[1];
}
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  T[0] = 0; T[1] = maxT;
  if (!slab(ox, dx, x0, x1) || !slab(oy, dy, y0, y1) || !slab(oz, dz, z0, z1)) return -1;
  return T[0];
}
function rayCar(o, d, x, y, z, h, S, top, maxT) {
  const qx = o.x - x, qz = o.z - z, r = maxT + 6;
  if (qx * qx + qz * qz > r * r) return -1;
  const cs = Math.cos(h), sn = Math.sin(h);
  return rayBox(qx * cs - qz * sn, o.y, qx * sn + qz * cs, d.x * cs - d.z * sn, d.y, d.x * sn + d.z * cs,
    -S.W / 2, y, -S.L / 2, S.W / 2, y + top, S.L / 2, maxT);
}
// le joueur touché en premier par un rayon (ou null)
function rayPlayers(o, d, maxT) {
  let best = maxT, hit = null;
  for (const r of targetList) {
    const t = r.mode === 0
      ? rayCar(o, d, r.x, r.y, r.z, r.h, r.car.S, r.car.top || 1.5, best)
      : rayBox(o.x, o.y, o.z, d.x, d.y, d.z, r.x - 0.4, r.y, r.z - 0.4, r.x + 0.4, r.y + 1.9, r.z + 0.4, best);
    if (t > 0 && t < best) { best = t; hit = r; }
  }
  return hit ? { t: best, r: hit } : null;
}

// ce joueur vient de nous toucher (pour savoir qui a fait le K.O.)
function touched(r) {
  if (!r) return;
  PVP.lastBy = r.id; PVP.lastT = performance.now();
}

// J'ai touché le joueur r : c'est lui qui retirera ses points de vie
function hitPlayer(r, dmg, dx, dz, force) {
  if (!live() || !r) return;
  const d = [r2(clamp(dmg, 0, MAX_HIT)), r3(dx), r3(dz), r2(force)];
  if (net.role === 'guest') safeSend(hostConn, { t: 'hit', to: r.id, d });
  else safeSend(guests.get(r.id), { t: 'hit', id: 'host', d });
}
// Un joueur m'a touché
function receiveHit(from, d) {
  const r = remotes.get(from);
  if (!r || !r.active || !nums(d, 4)) return;
  if (G.state !== 'play' || performance.now() < PVP.safeUntil) return;
  const dmg = clamp(d[0], 0, MAX_HIT), force = clamp(d[3], 0, 30);
  touched(r);
  if (G.mode === 'car') damageCar(dmg * 0.6);
  else if (G.mode === 'foot') hurtHero(dmg, d[1], d[2], force);
}

// Mon tir : les autres voient la traînée et entendent le bruit
function shot(a, b, wid) {
  if (!live()) return;
  sendAll({ t: 'fx', d: [r2(a.x), r2(a.y), r2(a.z), r2(b.x), r2(b.y), r2(b.z)], w: String(wid || '').slice(0, 12) });
}
// Une explosion chez moi : elle a lieu aussi chez les autres
function boom(x, y, z, power) {
  if (!live()) return;
  sendAll({ t: 'boom', d: [r2(x), r2(y), r2(z), r2(power)] });
}

function nameOf(id) {
  if (id === net.myId) return net.name;
  const r = remotes.get(id);
  return r ? r.name : 'Quelqu\'un';
}
// Annonce : « X a mis Y K.O. » (+1 au score de X)
function announceKO(victim, by, car) {
  if (by === victim) return;
  if (by === net.myId) net.ko++;
  else { const r = remotes.get(by); if (r) r.ko++; }
  let text, color = '#ff9d2e';
  if (by === net.myId) { text = car ? '💥 Tu as détruit la voiture de ' + nameOf(victim) + ' !' : '💥 Tu as mis ' + nameOf(victim) + ' K.O. !'; color = '#3ddc84'; }
  else if (victim === net.myId) { text = car ? '🔥 ' + nameOf(by) + ' a détruit ta voiture !' : '💫 ' + nameOf(by) + ' t\'a mis K.O. !'; color = '#ff5050'; }
  else text = car ? '💥 ' + nameOf(by) + ' a détruit la voiture de ' + nameOf(victim) : '💥 ' + nameOf(by) + ' a mis ' + nameOf(victim) + ' K.O.';
  if (G.state !== 'menu') showMessage(text, color, 2.5);
  refreshUI();
}
// Je viens de tomber K.O. (ou ma voiture est détruite) : était-ce un joueur ?
function onDown(car) {
  const by = PVP.lastBy;
  if (!by || performance.now() - PVP.lastT > HIT_MEMORY || !remotes.has(by)) return;
  PVP.lastBy = '';
  sendAll({ t: 'ko', by, car: car ? 1 : 0 });
  announceKO(net.myId, by, car);
}
// on surveille ce qui m'arrive (K.O., épave, explosion de ma voiture)
function watchMe() {
  const ko = hero.state === 'ko';
  if (ko && !PVP.wasKO) onDown(false);
  if (!ko && PVP.wasKO) PVP.safeUntil = performance.now() + SPAWN_SAFE;
  PVP.wasKO = ko;
  const wr = !!player.wrecked;
  if (wr && !PVP.wasWreck && G.mode === 'car') onDown(true);
  PVP.wasWreck = wr;
  // ma voiture vient d'exploser : l'explosion a lieu aussi chez les autres
  if (wr && PVP.burn > 0 && player.burn <= 0) boom(player.pos.x, player.y + 1, player.pos.z, 1.2);
  PVP.burn = wr ? player.burn : 0;
}

// Événements reçus (tir, explosion, K.O.) : renvoie le message propre à relayer
function onEvent(id, msg) {
  const r = remotes.get(id);
  if (!r) return null;
  if (msg.t === 'fx') {
    if (!nums(msg.d, 6)) return null;
    const d = msg.d.slice(0, 6), w = String(msg.w || '').slice(0, 12);
    if (r.active && G.drawShot) G.drawShot(d, w);
    return { t: 'fx', id, d, w };
  }
  if (msg.t === 'boom') {
    if (!nums(msg.d, 4)) return null;
    const d = msg.d, p = clamp(d[3], 0.3, 1.5);
    if (r.active && G.state !== 'menu') {
      const me = G.mode === 'car' ? player.pos : hero.pos;
      if (Math.hypot(me.x - d[0], me.z - d[2]) < 11 * p + 3) touched(r);
      explode(d[0], d[1], d[2], p);
    }
    return { t: 'boom', id, d: [d[0], d[1], d[2], p] };
  }
  if (msg.t === 'ko') {
    const by = String(msg.by || '');
    if (!by) return null;
    announceKO(id, by, !!msg.car);
    return { t: 'ko', id, by, car: msg.car ? 1 : 0 };
  }
  return null;
}

// Ce que les autres fichiers du jeu peuvent utiliser (weapons.js, driving.js, onfoot.js)
G.online = { targets: () => targetList, rayPlayers, hitPlayer, shot, boom, touched };

// =====================================================
//  CE QUE J'ENVOIE AUX AUTRES
// =====================================================
function myState() {
  const m = G.mode === 'car' ? 0 : G.mode === 'foot' ? 1 : 2;
  let x, y, z, h, s;
  if (m === 0) { x = player.pos.x; y = player.y; z = player.pos.z; h = player.h; s = player.speed; }
  else { x = hero.pos.x; y = hero.pos.y; z = hero.pos.z; h = hero.h; s = hero.speed; }
  const style = (player.def && player.def.style) || 'gt';
  const col = G.car && G.car.paint && G.car.paint.color ? G.car.paint.color.getHexString() : 'ffffff';
  return [m, r2(x), r2(y), r2(z), r3(h), r2(s), style, col, player.wrecked ? 1 : 0, G.state !== 'menu' ? 1 : 0];
}
function sendMyState() {
  const d = myState();
  if (net.role === 'guest') safeSend(hostConn, { t: 's', d });
  else if (net.role === 'host') broadcast({ t: 's', id: 'host', d });
}

// À appeler à chaque image (même en pause et au menu)
export function updateOnline(dt) {
  if (live()) {
    sendT -= dt;
    if (sendT <= 0) { sendT = SEND_EVERY; sendMyState(); }
  }
  const now = performance.now();
  targetList.length = 0;
  for (const r of remotes.values()) {
    if (now - r.last > TIMEOUT) { // plus de nouvelles : parti
      if (net.role === 'host') dropGuest(r.id);
      else { removeRemote(r.id); refreshUI(); }
      continue;
    }
    updateRemote(r, dt);
    if (r.seen && r.active && ((r.mode === 0 && r.car) || r.mode === 1)) targetList.push(r);
  }
  if (live()) watchMe();
}

// =====================================================
//  HÔTE : crée la partie et relaie les messages
// =====================================================
async function hostGame() {
  if (net.role !== 'off') return;
  net.role = 'connecting';
  setStatus('Création de la partie…');
  refreshUI();
  let Peer;
  try { Peer = await loadPeerJS(); } catch (e) { leaveGame(e.message, true); return; }
  openHost(Peer, 0);
}
function openHost(Peer, tries) {
  if (net.role !== 'connecting') return;
  const code = makeCode();
  const p = new Peer(PREFIX + code);
  peer = p;
  p.on('open', () => {
    if (peer !== p) return;
    net.role = 'host'; net.code = code; net.myId = 'host';
    setStatus('Partie créée ! Donne le code à tes amis, puis appuie sur JOUER.');
    refreshUI();
  });
  p.on('connection', (c) => {
    if (peer === p && net.role === 'host') onGuest(c);
    else try { c.close(); } catch (e) { /* rien */ }
  });
  p.on('error', (e) => {
    if (peer !== p) return;
    if (e && e.type === 'unavailable-id' && tries < 4) { // code déjà pris : on en tire un autre
      peer = null;
      try { p.destroy(); } catch (err) { /* rien */ }
      openHost(Peer, tries + 1);
      return;
    }
    onPeerError(e);
  });
  p.on('disconnected', () => { if (peer === p && !p.destroyed) try { p.reconnect(); } catch (e) { /* rien */ } });
}

function onGuest(conn) {
  conn.on('open', () => {
    if (guests.size >= MAX_PLAYERS - 1) {
      safeSend(conn, { t: 'full' });
      setTimeout(() => { try { conn.close(); } catch (e) { /* rien */ } }, 500);
      return;
    }
    guests.set(conn.peer, conn);
  });
  conn.on('data', (msg) => hostData(conn, msg));
  conn.on('close', () => dropGuest(conn.peer));
  conn.on('error', () => dropGuest(conn.peer));
}

function hostData(conn, msg) {
  const id = conn.peer;
  if (!guests.has(id) || !msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const r = getRemote(id, msg.name);
    r.last = performance.now();
    const list = [{ id: 'host', name: net.name }];
    for (const o of remotes.values()) if (o.id !== id) list.push({ id: o.id, name: o.name });
    safeSend(conn, { t: 'welcome', id, players: list });
    broadcast({ t: 'join', id, name: r.name }, id);
    showMessage(r.name + ' a rejoint la partie', r.tint, 2);
    refreshUI();
  } else if (msg.t === 's') {
    const r = remotes.get(id);
    if (!r) return;
    applyState(r, msg.d);
    broadcast({ t: 's', id, d: msg.d }, id); // on relaie aux autres
  } else if (msg.t === 'hit') {           // un invité en touche un autre (ou moi)
    if (!remotes.has(id)) return;
    const to = String(msg.to || '');
    if (to === 'host') receiveHit(id, msg.d);
    else if (to !== id && guests.has(to)) safeSend(guests.get(to), { t: 'hit', id, d: msg.d });
  } else if (msg.t === 'fx' || msg.t === 'boom' || msg.t === 'ko') {
    const out = onEvent(id, msg);
    if (out) broadcast(out, id);
  }
}

function dropGuest(id) {
  const c = guests.get(id);
  if (c) { guests.delete(id); try { c.close(); } catch (e) { /* rien */ } }
  const r = remotes.get(id);
  if (!r) return;
  showMessage(r.name + ' a quitté la partie', '#ffffff', 2);
  removeRemote(id);
  broadcast({ t: 'leave', id });
  refreshUI();
}

// =====================================================
//  INVITÉ : rejoint une partie avec un code
// =====================================================
async function joinGame(raw) {
  if (net.role !== 'off') return;
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LEN) { setStatus('Le code doit faire ' + CODE_LEN + ' caractères.', true); return; }
  net.role = 'connecting'; net.code = code;
  setStatus('Connexion à la partie ' + code + '…');
  refreshUI();
  let Peer;
  try { Peer = await loadPeerJS(); } catch (e) { leaveGame(e.message, true); return; }
  if (net.role !== 'connecting') return;
  const p = new Peer();
  peer = p;
  p.on('open', () => {
    if (peer !== p) return;
    const c = p.connect(PREFIX + code, { serialization: 'json', reliable: true });
    hostConn = c;
    const lost = () => {
      if (hostConn !== c) return;
      leaveGame(net.role === 'guest' ? "L'hôte a quitté la partie." : 'Connexion impossible.', true);
    };
    c.on('open', () => safeSend(c, { t: 'hello', name: net.name }));
    c.on('data', guestData);
    c.on('close', lost);
    c.on('error', lost);
  });
  p.on('error', (e) => { if (peer === p) onPeerError(e); });
  p.on('disconnected', () => { if (peer === p && !p.destroyed) try { p.reconnect(); } catch (e) { /* rien */ } });
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (net.role === 'connecting') leaveGame('Pas de réponse. Vérifie le code.', true);
  }, JOIN_TIMEOUT);
}

function guestData(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id != null ? String(msg.id) : '';
  switch (msg.t) {
    case 'welcome':
      clearTimeout(joinTimer);
      net.role = 'guest'; net.myId = id;
      for (const o of msg.players || []) if (o && String(o.id) !== net.myId) getRemote(String(o.id), o.name);
      setStatus('Connecté ! Appuie sur JOUER pour retrouver les autres dans la ville.');
      showMessage('Connecté à la partie ' + net.code, '#3ddc84', 2);
      refreshUI();
      break;
    case 'join':
      if (id && id !== net.myId) {
        const r = getRemote(id, msg.name);
        showMessage(r.name + ' a rejoint la partie', r.tint, 2);
        refreshUI();
      }
      break;
    case 's':
      if (id && id !== net.myId) {
        const isNew = !remotes.has(id);
        applyState(getRemote(id), msg.d);
        if (isNew) refreshUI();
      }
      break;
    case 'hit':
      if (id && id !== net.myId) receiveHit(id, msg.d);
      break;
    case 'fx':
    case 'boom':
    case 'ko':
      if (id && id !== net.myId) onEvent(id, msg);
      break;
    case 'leave': {
      const r = remotes.get(id);
      if (r) showMessage(r.name + ' a quitté la partie', '#ffffff', 2);
      removeRemote(id);
      refreshUI();
      break;
    }
    case 'full':
      leaveGame('La partie est pleine (' + MAX_PLAYERS + ' joueurs max).', true);
      break;
  }
}

// =====================================================
//  ERREURS ET DÉCONNEXION
// =====================================================
function onPeerError(e) {
  const t = e && e.type;
  console.warn('[en ligne]', t, e);
  // déjà en partie : une petite erreur réseau ne coupe pas tout
  if (live() && t !== 'browser-incompatible') return;
  const msg =
    t === 'peer-unavailable' ? 'Aucune partie avec ce code.' :
    t === 'browser-incompatible' ? 'Ton navigateur ne permet pas de jouer en ligne.' :
    t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' ? 'Serveur de connexion injoignable. Réessaie.' :
    'Erreur réseau (' + (t || 'inconnue') + ').';
  leaveGame(msg, true);
}

export function leaveGame(reason, isError) {
  clearTimeout(joinTimer);
  for (const c of guests.values()) try { c.close(); } catch (e) { /* rien */ }
  guests.clear();
  if (hostConn) { const c = hostConn; hostConn = null; try { c.close(); } catch (e) { /* rien */ } }
  if (peer) { const p = peer; peer = null; try { p.destroy(); } catch (e) { /* rien */ } }
  for (const id of [...remotes.keys()]) removeRemote(id);
  targetList.length = 0;
  const was = net.role;
  net.role = 'off'; net.code = ''; net.myId = ''; net.ko = 0;
  PVP.lastBy = ''; PVP.safeUntil = 0;
  setStatus(reason || '', isError);
  if (reason && was !== 'off' && G.state !== 'menu') showMessage(reason, isError ? '#ff5a3c' : '#ffffff', 2.5);
  refreshUI();
}
window.addEventListener('beforeunload', () => { if (net.role !== 'off') leaveGame(); });

// =====================================================
//  INTERFACE (menu principal + petit panneau dans le HUD)
// =====================================================
const ui = {
  name: $('netName'), host: $('netHost'), code: $('netCode'), join: $('netJoin'),
  idle: $('netIdle'), live: $('netLive'), codeShow: $('netCodeShow'), copy: $('netCopy'),
  leave: $('netLeave'), status: $('netStatus'), players: $('netPlayers'),
  hud: $('netHud'), hudText: $('netHudText'),
};

function setStatus(text, isError) {
  if (!ui.status) return;
  ui.status.textContent = text || '';
  ui.status.classList.toggle('error', !!isError);
}

function chip(text, color) {
  const s = document.createElement('span');
  s.className = 'chip';
  s.textContent = text;
  s.style.borderColor = color;
  ui.players.appendChild(s);
}
const koText = (n) => (n > 0 ? ' · 💥' + n : '');

function refreshUI() {
  const isLive = live();
  const busy = net.role === 'connecting';
  if (ui.idle) ui.idle.classList.toggle('hidden', isLive);
  if (ui.live) ui.live.classList.toggle('hidden', !isLive);
  if (ui.host) ui.host.disabled = busy;
  if (ui.join) ui.join.disabled = busy;
  if (ui.name) ui.name.disabled = isLive || busy;
  if (ui.codeShow) ui.codeShow.textContent = net.code;
  if (ui.players) {
    ui.players.innerHTML = '';
    if (isLive) {
      chip(net.name + ' (toi)' + koText(net.ko), tintOf(net.myId));
      for (const r of remotes.values()) chip(r.name + (r.id === 'host' ? ' (hôte)' : '') + koText(r.ko), r.tint);
    }
  }
  const n = isLive ? remotes.size + 1 : 0;
  if (ui.hud) ui.hud.classList.toggle('hidden', !isLive);
  if (ui.hudText) ui.hudText.textContent = isLive ? net.code + ' · ' + n + ' joueur' + (n > 1 ? 's' : '') + koText(net.ko) : '';
}

// les touches tapées dans les champs ne doivent pas piloter la voiture
function shieldKeys(el, onEnter) {
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') onEnter();
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

if (ui.name) {
  ui.name.value = net.name;
  ui.name.addEventListener('change', () => {
    const n = cleanName(ui.name.value);
    if (n) net.name = n;
    ui.name.value = net.name;
    try { localStorage.setItem(NAME_KEY, net.name); } catch (e) { /* rien */ }
  });
  shieldKeys(ui.name, () => ui.name.blur());
}
if (ui.code) {
  ui.code.addEventListener('input', () => {
    ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
  });
  shieldKeys(ui.code, () => joinGame(ui.code.value));
}
if (ui.host) ui.host.onclick = hostGame;
if (ui.join) ui.join.onclick = () => joinGame(ui.code && ui.code.value);
if (ui.leave) ui.leave.onclick = () => leaveGame('Tu as quitté la partie.');
if (ui.copy) ui.copy.onclick = () => {
  if (!net.code || !navigator.clipboard) return;
  navigator.clipboard.writeText(net.code).then(() => setStatus('Code ' + net.code + ' copié !')).catch(() => {});
};
refreshUI();
