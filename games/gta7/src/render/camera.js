// =====================================================
//  CAMÉRA : derrière la voiture, derrière le héros,
//  ou qui tourne autour de la voiture dans le menu.
//  C / V / 🎥 = changer de vue (3 vues)
//  À pied avec la souris capturée : la caméra suit la souris
//  (gauche / droite ET haut / bas), par-dessus l'épaule.
//  🧱 Elle ne traverse pas les immeubles (elle se rapproche)
//  ni le sol des collines (elle reste au-dessus).
// =====================================================
import { camera } from './engine.js';
import { G } from '../core/ctx.js';
import { clamp, lerp, damp, angleDiff } from '../core/utils.js';
import { colliders, floorY } from '../world/city.js';
import { player, drive } from '../vehicles/driving.js';
import { hero } from '../gameplay/onfoot.js';
import { mouseLook, aim } from '../gameplay/aim.js';

// d = distance derrière · h = hauteur · look = hauteur du regard · side = décalage épaule
const CAR_VIEWS = [{ d: 8.5, h: 3.4, look: 1.2 }, { d: 14, h: 6, look: 1.6 }]; // 3e vue = capot
const FOOT_VIEWS = [
  { d: 4.6, h: 2.3, look: 1.5, side: 0 },
  { d: 8, h: 4, look: 1.4, side: 0 },
  { d: 2.6, h: 1.9, look: 1.65, side: 0.7 },
];
let menuAngle = 0;
let pitchS = 0; // visée haut / bas (adoucie)
let carK = 1;   // recul de la caméra voiture (1 = normal, moins = un mur derrière)

// rapproche la caméra si un mur est entre elle et le point visé (0..1)
// (on garde d'abord les immeubles autour du trajet : bien plus rapide)
const near = [];
function unblock(ax, ay, az, bx, by, bz) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz), y0 = Math.min(ay, by);
  near.length = 0;
  for (const b of colliders) {
    if (b.prop || y0 > b.h || b.maxX - b.minX < 3) continue;   // pas les arbres ni les lampadaires
    if (b.maxX < x0 || b.minX > x1 || b.maxZ < z0 || b.minZ > z1) continue;
    near.push(b);
  }
  if (!near.length) return 1;
  const STEPS = 8;
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    for (const b of near) {
      if (y <= b.h && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return Math.max(0.15, (k - 1) / STEPS - 0.04);
    }
  }
  return 1;
}
// la caméra reste au-dessus du sol (collines, trottoirs)
function keepAboveGround(min) {
  const g = floorY(camera.position.x, camera.position.z) + min;
  if (camera.position.y < g) camera.position.y = g;
}

function carCamera(dt) {
  const p = player.pos;
  if (G.camMode < 2) {
    const V = CAR_VIEWS[G.camMode];
    const target = player.vh + player.slip * 0.35;
    G.camHeading += angleDiff(G.camHeading, target) * damp(4, dt);
    const s = Math.sin(G.camHeading), c = Math.cos(G.camHeading);
    // point visé (la voiture) puis position voulue derrière
    const ax = p.x, ay = player.y + V.look, az = p.z;
    const bx = p.x + s * V.d, by = player.y + V.h, bz = p.z + c * V.d;
    // un mur derrière : la caméra se rapproche tout de suite, puis recule doucement
    const k = unblock(ax, ay, az, bx, by, bz);
    carK = k < carK ? k : lerp(carK, k, damp(3, dt));
    camera.position.x = ax + (bx - ax) * carK;
    camera.position.z = az + (bz - az) * carK;
    camera.position.y = lerp(camera.position.y, ay + (by - ay) * carK, damp(6, dt));
    keepAboveGround(0.6);
    camera.lookAt(p.x - s * 3, player.y + V.look, p.z - c * 3);
  } else {
    carK = 1;
    G.camHeading = player.h;
    const fx = -Math.sin(player.h), fz = -Math.cos(player.h);
    camera.position.set(p.x + fx * 0.3, player.y + 1.3, p.z + fz * 0.3);
    camera.lookAt(p.x + fx * 12, player.y + 1.0, p.z + fz * 12);
  }
  const fovT = 65 + clamp(Math.abs(player.speed) / player.def.maxSpeed, 0, 1.3) * 12 + (drive.turboTime > 0 ? 8 : 0);
  camera.fov = lerp(camera.fov, fovT, damp(3, dt));
}

function footCamera(dt) {
  const V = FOOT_VIEWS[G.camMode % FOOT_VIEWS.length];
  const p = hero.pos;
  const look = mouseLook();
  // souris : la caméra suit tout de suite · sinon : elle suit doucement
  if (look && hero.state === 'ok') G.camHeading = hero.h;
  else G.camHeading += angleDiff(G.camHeading, hero.h) * damp(hero.state === 'ok' ? 5 : 1.5, dt);
  pitchS = lerp(pitchS, look ? aim.pitch : 0, damp(14, dt));
  const side = look ? Math.max(V.side, 0.6) : V.side; // par-dessus l'épaule pour bien voir le viseur
  const s = Math.sin(G.camHeading), c = Math.cos(G.camHeading);
  // point visé (épaule) puis position voulue derrière
  const ax = p.x + c * side, ay = p.y + V.look, az = p.z - s * side;
  const bx = ax + s * V.d, by = Math.max(p.y + 0.5, p.y + V.h - pitchS * 2.4), bz = az + c * V.d;
  const k = unblock(ax, ay, az, bx, by, bz);
  camera.position.x = ax + (bx - ax) * k;
  camera.position.z = az + (bz - az) * k;
  camera.position.y = lerp(camera.position.y, ay + (by - ay) * k, damp(8, dt));
  keepAboveGround(0.3);
  camera.lookAt(ax - s * 6, ay + pitchS * 6, az - c * 6);
  const fovT = 62 + (Math.abs(hero.speed) > 6 ? 5 : 0);
  camera.fov = lerp(camera.fov, fovT, damp(3, dt));
}

export function updateCamera(dt) {
  if (G.mode === 'foot') footCamera(dt); else carCamera(dt);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake;
    camera.position.y += (Math.random() - 0.5) * G.shake;
    G.shake *= Math.exp(-5 * dt);
  }
  camera.updateProjectionMatrix();
}

// menu : la caméra tourne autour de la voiture, à SA hauteur (collines comprises)
export function updateMenuCamera(dt) {
  menuAngle += dt * 0.15;
  const p = player.pos;
  const ax = p.x, ay = player.y + 1, az = p.z;
  const bx = p.x + Math.cos(menuAngle) * 11, bz = p.z + Math.sin(menuAngle) * 11;
  const by = Math.max(player.y, floorY(bx, bz)) + 3.5;
  const k = unblock(ax, ay, az, bx, by, bz);
  camera.position.set(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k);
  camera.lookAt(ax, ay, az);
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
}
