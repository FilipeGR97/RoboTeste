// Naves: definições e modelos procedurais
import * as THREE from 'three';
import { exhaustMaterial } from './shaders.js';
import { mulberry32 } from './util.js';

export const SHIPS = [
  {
    id: 'andorinha', nome: 'Andorinha', classe: 'Cápsula de fuga · Classe I', reg: 'UH-07',
    desc: 'Pequena, ágil e frágil. Foi feita para tirar uma tripulação de quatro pessoas da órbita — não para cruzar estrelas. O motor de salto é um protótipo.',
    jump: 15, maxC: 800, turn: 1.7, charge: 9, exhaust: '#ff8a3c', stats: { velocidade: 1, salto: 1, manobra: 5, autonomia: 1 },
  },
  {
    id: 'odisseia', nome: 'Odisseia', classe: 'Fragata de exploração · Classe II', reg: 'UNE-2194',
    desc: 'Nave científica de longo alcance com sensores de espectro completo. Equilíbrio entre agilidade e alcance.',
    jump: 35, maxC: 6000, turn: 1.15, charge: 7, exhaust: '#4aa0ff', stats: { velocidade: 2, salto: 2, manobra: 4, autonomia: 3 },
  },
  {
    id: 'leviata', nome: 'Leviatã', classe: 'Cruzador pesado · Classe III', reg: 'CV-330',
    desc: 'Um cruzador militar de 330 metros reaproveitado como nave de refugiados. Lento para manobrar, mas o motor de salto é colossal.',
    jump: 90, maxC: 40000, turn: 0.55, charge: 5, exhaust: '#8a7aff', stats: { velocidade: 4, salto: 4, manobra: 2, autonomia: 4 },
  },
  {
    id: 'exodo', nome: 'Êxodo', classe: 'Arca estelar · Motor de dobra · Classe IV', reg: 'ARCA-01',
    desc: 'A última arca da humanidade: 900 metros, anéis habitacionais giratórios e um motor de dobra que curva o próprio espaço. Ninguém achou que ela voaria a tempo.',
    jump: 300, maxC: 250000, turn: 0.32, charge: 3, exhaust: '#7fe8ff', stats: { velocidade: 5, salto: 5, manobra: 1, autonomia: 5 },
  },
];

// ---------------------------------------------------------------------------------------------
// Texturas de casco geradas em canvas (cor, rugosidade, relevo e luzes)
// ---------------------------------------------------------------------------------------------
function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return '#' + c.getHexString();
}

function hullTextures(base, accent, seed, windowDensity = 0, label = '') {
  const S = 1024, rng = mulberry32(seed);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cv = mk(), rv = mk(), ev = mk(), bv = mk();
  const g = cv.getContext('2d'), r = rv.getContext('2d'), e = ev.getContext('2d'), b = bv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  r.fillStyle = '#9a9a9a'; r.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
  // grade de painéis (com juntas em baixo-relevo)
  const cols = 8, rows = 8;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i * S) / cols, y = (j * S) / rows;
    const sub = rng() < 0.5 ? 2 : 1;
    for (let a = 0; a < sub; a++) for (let c = 0; c < sub; c++) {
      const w = S / cols / sub, h = S / rows / sub;
      const px = x + a * w, py = y + c * h;
      g.fillStyle = shade(base, (rng() - 0.5) * 0.09);
      g.fillRect(px, py, w, h);
      r.fillStyle = `rgb(${120 + rng() * 90 | 0},${120 + rng() * 90 | 0},${120 + rng() * 90 | 0})`;
      r.fillRect(px, py, w, h);
      const lift = 118 + rng() * 30 | 0;
      b.fillStyle = `rgb(${lift},${lift},${lift})`; b.fillRect(px, py, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, w - 2, h - 2);
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.strokeRect(px + 3, py + 3, w - 6, h - 6);
      b.strokeStyle = '#303030'; b.lineWidth = 3; b.strokeRect(px + 1, py + 1, w - 2, h - 2);
      // rebites nas bordas
      b.fillStyle = '#c0c0c0'; g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let k = 6; k < w - 4; k += 14) { b.fillRect(px + k, py + 5, 2, 2); b.fillRect(px + k, py + h - 7, 2, 2); g.fillRect(px + k, py + 5, 2, 2); }
    }
  }
  // escotilhas, placas e tampas de inspeção
  for (let i = 0; i < 170; i++) {
    const x = rng() * S, y = rng() * S, w = 10 + rng() * 60, h = 6 + rng() * 30;
    g.fillStyle = shade(base, -0.06 - rng() * 0.08); g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(x, y, w, h);
    const up = rng() < 0.5;
    b.fillStyle = up ? '#a8a8a8' : '#5a5a5a'; b.fillRect(x, y, w, h);
    b.strokeStyle = '#2a2a2a'; b.lineWidth = 2; b.strokeRect(x, y, w, h);
  }
  // faixas de cor e faixas de advertência
  g.fillStyle = accent;
  for (let i = 0; i < 5; i++) { const y = rng() * S; g.fillRect(0, y, S, 6 + rng() * 10); }
  for (let i = 0; i < 5; i++) {
    const x = rng() * S, y = rng() * S, n = 6 + Math.floor(rng() * 6);
    for (let k = 0; k < n; k++) {
      g.fillStyle = k % 2 ? '#1a1a1a' : '#e0b020';
      g.beginPath(); g.moveTo(x + k * 10, y); g.lineTo(x + k * 10 + 10, y); g.lineTo(x + k * 10, y + 12); g.lineTo(x + k * 10 - 10, y + 12); g.fill();
    }
  }
  g.fillStyle = 'rgba(240,240,240,0.5)';
  for (let i = 0; i < 6; i++) {
    const x = rng() * S, y = rng() * S;
    for (let k = 0; k < 5; k++) g.fillRect(x + k * 14, y, 8, 20);
  }
  // matrícula e símbolos
  if (label) {
    g.font = `800 ${Math.round(S / 14)}px Orbitron, Segoe UI, sans-serif`;
    g.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) {
      const x = 40 + rng() * S * 0.4, y = S * (0.25 + k * 0.5);
      g.fillStyle = 'rgba(20,20,22,0.85)'; g.fillText(label, x + 3, y + 3);
      g.fillStyle = 'rgba(236,238,240,0.92)'; g.fillText(label, x, y);
    }
    g.font = `600 ${Math.round(S / 40)}px Rajdhani, Segoe UI, sans-serif`;
    g.fillStyle = 'rgba(230,230,230,0.7)';
    g.fillText('HUMANIDADE · ÚLTIMA PARTIDA · 2194', 40, S * 0.33);
  }
  // sujeira / desgaste / marcas de calor
  for (let i = 0; i < 320; i++) {
    const x = rng() * S, y = rng() * S, rad = 5 + rng() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(20,15,10,${0.05 + rng() * 0.12})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S, l = 30 + rng() * 120;
    g.strokeStyle = `rgba(30,25,20,${0.08 + rng() * 0.1})`; g.lineWidth = 2 + rng() * 5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (rng() - 0.5) * 8); g.stroke();
  }
  // janelas iluminadas
  for (let i = 0; i < windowDensity; i++) {
    const x = rng() * S, y = rng() * S, n = 3 + Math.floor(rng() * 12);
    const warm = rng() < 0.7;
    for (let k = 0; k < n; k++) {
      if (rng() < 0.25) continue;
      const col = warm ? `rgb(255,${200 + rng() * 40 | 0},${130 + rng() * 60 | 0})` : 'rgb(170,220,255)';
      e.fillStyle = col; e.fillRect(x + k * 9, y, 5, 4);
      g.fillStyle = '#111'; g.fillRect(x + k * 9, y, 5, 4);
      b.fillStyle = '#404040'; b.fillRect(x + k * 9, y, 5, 4);
    }
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(cv, true), roughnessMap: tex(rv, false), emissiveMap: tex(ev, true), bumpMap: tex(bv, false) };
}

function hullMaterial(base, accent, seed, windows = 0, metal = 0.6, repeat = 1, label = '') {
  const t = hullTextures(base, accent, seed, windows, label);
  for (const k in t) t[k].repeat.set(repeat, repeat);
  return new THREE.MeshStandardMaterial({
    map: t.map, roughnessMap: t.roughnessMap, roughness: 0.85, metalness: metal, bumpMap: t.bumpMap, bumpScale: 1,
    emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: windows ? 2.2 : 0, side: THREE.DoubleSide,
  });
}

let SOLAR_TEX = null;
function solarMaterial() {
  if (!SOLAR_TEX) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c8ccd2'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const gr = g.createLinearGradient(i * 32, j * 32, i * 32 + 32, j * 32 + 32);
      gr.addColorStop(0, '#0c1c48'); gr.addColorStop(1, '#16306a');
      g.fillStyle = gr; g.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29);
      g.strokeStyle = 'rgba(160,190,255,0.18)'; g.lineWidth = 1;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(i * 32 + k * 8, j * 32 + 2); g.lineTo(i * 32 + k * 8, j * 32 + 30); g.stroke(); }
    }
    SOLAR_TEX = new THREE.CanvasTexture(c);
    SOLAR_TEX.colorSpace = THREE.SRGBColorSpace;
    SOLAR_TEX.wrapS = SOLAR_TEX.wrapT = THREE.RepeatWrapping;
    SOLAR_TEX.anisotropy = 8;
  }
  return new THREE.MeshStandardMaterial({ map: SOLAR_TEX, metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide });
}

const glassMat = () => new THREE.MeshStandardMaterial({ color: 0x0b1622, metalness: 0.95, roughness: 0.06, emissive: 0x1a3a5a, emissiveIntensity: 0.7 });
const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.45 });
const greyMat = () => new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.7, roughness: 0.5 });
const lightMat = (c, i = 6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) });

// ---------------------------------------------------------------------------------------------
// Primitivas de construção (coordenadas: +Z = frente, +Y = cima; medidas em metros)
// ---------------------------------------------------------------------------------------------
function lathe(profile, seg, mat) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
function wingGeo(points, thick) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.3, bevelSize: thick * 0.3, bevelSegments: 2 });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}
function wingPair(points, thick, mat, y = 0) {
  const grp = new THREE.Group();
  const right = new THREE.Mesh(wingGeo(points, thick), mat);
  const left = new THREE.Mesh(wingGeo(points.map(([x, z]) => [-x, z]).reverse(), thick), mat);
  right.position.y = y; left.position.y = y;
  grp.add(right, left);
  return grp;
}
function cyl(r1, r2, len, mat, seg = 24) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg, 1, false);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function at(m, x, y, z) { m.position.set(x, y, z); return m; }

// raio de um perfil de torno na posição z
function profileR(profile, z) {
  for (let k = 1; k < profile.length; k++) {
    const [r0, z0] = profile[k - 1], [r1, z1] = profile[k];
    if ((z >= z0 && z <= z1) || (z <= z0 && z >= z1)) return r0 + (r1 - r0) * ((z - z0) / ((z1 - z0) || 1));
  }
  return 0;
}

// "Greebles": centenas de pequenos módulos sobre o casco, num único InstancedMesh
function greebles(ship, mat, rng, count, place, size) {
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), roll = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const { p, n } = place(rng);
    const k = Math.pow(rng(), 2.5);
    const w = size[0] + k * (size[1] - size[0]);
    s.set(w * (0.5 + rng()), w * (0.25 + rng() * 0.6), w * (0.6 + rng() * 1.6));
    q.setFromUnitVectors(up, n);
    roll.setFromAxisAngle(up, Math.round(rng()) * Math.PI / 2);
    q.multiply(roll);
    p.addScaledVector(n, s.y * 0.35);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
  }
  ship.add(inst);
  return inst;
}
// posição sobre um casco de torno (com escala opcional em x/y)
const onLathe = (profile, z0, z1, sx = 1, sy = 1, aMin = 0, aMax = Math.PI * 2) => (rng) => {
  const z = z0 + rng() * (z1 - z0), a = aMin + rng() * (aMax - aMin);
  const r = profileR(profile, z) * 0.97;
  const n = new THREE.Vector3(Math.cos(a) / sx, Math.sin(a) / sy, 0).normalize();
  return { p: new THREE.Vector3(Math.cos(a) * r * sx, Math.sin(a) * r * sy, z), n };
};

// Motor: bocal + núcleo brilhante + jato (cones aditivos)
function engine(ship, x, y, z, r, color, nozzleMat) {
  const bell = lathe([[r * 0.55, 0], [r * 0.8, -r * 0.6], [r, -r * 1.4], [r * 0.92, -r * 1.42], [r * 0.5, -r * 0.3]], 32, nozzleMat);
  bell.material.side = THREE.DoubleSide;
  at(bell, x, y, z);
  ship.add(bell);
  // anéis de refrigeração do bocal
  for (let k = 1; k <= 3; k++) {
    const rr = r * (0.6 + k * 0.12);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, r * 0.035, 6, 32), nozzleMat);
    at(ring, x, y, z - r * k * 0.33);
    ship.add(ring);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 32), lightMat(color, 4));
  disc.rotation.y = Math.PI;
  at(disc, x, y, z - r * 0.5);
  ship.add(disc);
  const mk = (rad, len, c, core) => {
    const g = new THREE.ConeGeometry(rad, len, 32, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, exhaustMaterial(c, core));
    at(m, x, y, z - r * 1.35);
    m.frustumCulled = false;
    return m;
  };
  const outer = mk(r * 0.95, r * 9, color, 0.6);
  const inner = mk(r * 0.5, r * 4.5, '#ffffff', 1.0);
  ship.add(outer, inner);
  ship.userData.exhausts.push(outer, inner);
  ship.userData.discs.push(disc);
}

function navLight(ship, x, y, z, color, size, blink = 0, phase = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), lightMat(color, 1.6));
  at(m, x, y, z);
  ship.add(m);
  if (blink) ship.userData.blinkers.push({ m, blink, phase });
  return m;
}

// Bloco de propulsores de manobra (RCS): 4 bocais em cruz
function rcs(ship, x, y, z, s, mat, nozzle) {
  ship.add(at(box(s, s, s, mat), x, y, z));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.12, s * 0.2, s * 0.35, 8, 1, true), nozzle);
    n.material.side = THREE.DoubleSide;
    n.rotation.z = dx ? -dx * Math.PI / 2 : dy < 0 ? Math.PI : 0;
    at(n, x + dx * s * 0.62, y + dy * s * 0.62, z);
    ship.add(n);
  }
}

// Mastro de antena com luz piscante na ponta
function antenna(ship, x, y, z, len, r, mat, blink = 0.9, phase = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r, len, 6), mat);
  at(m, x, y + len / 2, z);
  ship.add(m);
  ship.add(at(new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 8, 6), mat), x, y + len, z));
  navLight(ship, x, y + len + r * 2, z, '#ff3030', r * 1.2, blink, phase);
}

// Painel solar com estrutura
function solarPanel(ship, x, y, z, w, l, tiltZ, frameMat) {
  const g = new THREE.Group();
  const p = box(w, 0.06 * Math.min(w, l) / 4 + 0.02, l, solarMaterial());
  p.material.map = p.material.map.clone();
  p.material.map.repeat.set(Math.max(1, Math.round(w / l * 2)), 2);
  p.material.map.needsUpdate = true;
  g.add(p);
  g.add(at(box(w * 1.02, 0.08 * Math.min(w, l) / 4 + 0.02, l * 0.02, frameMat), 0, 0, l / 2));
  g.add(at(box(w * 1.02, 0.08 * Math.min(w, l) / 4 + 0.02, l * 0.02, frameMat), 0, 0, -l / 2));
  g.rotation.z = tiltZ;
  at(g, x, y, z);
  ship.add(g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------------------------
function newShip() {
  const g = new THREE.Group();
  g.userData = { exhausts: [], blinkers: [], discs: [] };
  return g;
}

function buildAndorinha(def) {
  const s = newShip();
  const rng = mulberry32(101);
  const hull = hullMaterial('#c9ccd1', '#d26a2a', 11, 0, 0.45, 1, def.reg);
  const hullD = hullMaterial('#3a3d42', '#d26a2a', 12, 0, 0.5, 2);
  const prof = [[0, -6.5], [1.2, -6.5], [1.5, -5.6], [1.75, -3], [1.8, 0], [1.7, 2.5], [1.45, 4.5], [1.0, 6.0], [0.5, 6.9], [0, 7.2]];
  s.add(lathe(prof, 40, hull));
  // ventre com placas térmicas escuras
  const belly = lathe(prof.map(([r, z]) => [r * 1.015, z]), 40, hullD);
  belly.geometry = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r * 1.015, z)), 40, Math.PI * 0.6, Math.PI * 0.8).rotateX(Math.PI / 2);
  s.add(belly);
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat());
  can.scale.set(0.95, 0.7, 2.1);
  at(can, 0, 1.2, 3.0);
  s.add(can);
  // estrutura do canopy
  const frame = greyMat();
  for (const z of [1.6, 3.0, 4.4]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 24, Math.PI), frame);
    arc.scale.set(0.96 * Math.sqrt(1 - Math.pow((z - 3) / 2.1, 2)), 0.71 * Math.sqrt(1 - Math.pow((z - 3) / 2.1, 2)), 1);
    at(arc, 0, 1.2, z);
    s.add(arc);
  }
  s.add(at(box(0.06, 0.06, 4.2, frame), 0, 1.9, 3.0));
  const wing = wingPair([[1.4, 1.5], [5.6, -2.6], [5.9, -4.2], [1.4, -4.8]], 0.22, hull, -0.4);
  s.add(wing);
  // pontas das asas com casulos de sensores
  for (const sx of [-1, 1]) {
    const pod = lathe([[0, -1.6], [0.22, -1.5], [0.25, 0.6], [0.12, 1.2], [0, 1.4]], 12, hullD);
    at(pod, sx * 5.9, -0.3, -3.0);
    s.add(pod);
  }
  const fin = new THREE.Mesh(wingGeo([[0, -2.6], [2.3, -5.4], [2.3, -6.2], [0, -6.4]], 0.2), hull);
  fin.geometry.rotateZ(Math.PI / 2);
  at(fin, 0.1, 1.3, 0);
  s.add(fin);
  const nm = darkMat();
  engine(s, 0, 0, -6.5, 0.95, def.exhaust, nm);
  for (const sx of [-1, 1]) engine(s, sx * 1.35, -0.55, -6.0, 0.32, def.exhaust, nm);
  for (const sx of [-1, 1]) {
    s.add(at(box(0.5, 0.35, 0.8, nm), sx * 1.75, 0.2, 4.0));
    s.add(at(box(0.5, 0.35, 0.8, nm), sx * 1.6, 0.2, -5.0));
    rcs(s, sx * 1.7, 0.6, 5.0, 0.28, frame, nm);
    rcs(s, sx * 1.85, 0.4, -4.4, 0.3, frame, nm);
  }
  // escotilha de acoplamento e antenas
  const dock = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 24), frame);
  dock.rotation.x = Math.PI / 2;
  at(dock, 0, 1.78, -1.8);
  s.add(dock);
  antenna(s, 0.5, 1.6, -3.4, 1.4, 0.03, frame, 1.1);
  antenna(s, -0.4, 1.65, -2.6, 0.9, 0.025, frame, 0.7, 0.4);
  greebles(s, greyMat(), rng, 70, onLathe(prof, -5.8, 5.2, 1, 1, -0.4, Math.PI + 0.4), [0.08, 0.35]);
  navLight(s, 5.9, -0.3, -1.4, '#ff2020', 0.12, 0);
  navLight(s, -5.9, -0.3, -1.4, '#20ff40', 0.12, 0);
  navLight(s, 0, 3.6, -6.2, '#ffffff', 0.1, 1.2);
  navLight(s, 0, -1.6, -2, '#ff3030', 0.08, 1.4, 0.5);
  return { group: s, cockpit: new THREE.Vector3(0, 1.45, 3.6), length: 15 };
}

function buildOdisseia(def) {
  const s = newShip();
  const rng = mulberry32(202);
  const hull = hullMaterial('#b8bec6', '#2a6ad0', 22, 18, 0.55, 2, def.reg);
  const hull2 = hullMaterial('#5a626c', '#c0c4ca', 23, 0, 0.7, 2);
  const frame = greyMat();
  const prof = [[0, -25], [4, -25], [4.6, -22], [5.0, -10], [4.8, 5], [4.0, 15], [2.8, 22], [1.4, 26], [0, 28]];
  s.add(lathe(prof, 48, hull));
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat());
  can.scale.set(2.3, 1.3, 5.5);
  at(can, 0, 3.4, 15);
  s.add(can);
  s.add(wingPair([[4, 6], [22, -13], [23, -19], [4, -21]], 0.9, hull2, -0.8));
  for (const sx of [-1, 1]) {
    const pod = lathe([[0, -6], [0.9, -6], [1.0, 2], [0.5, 5], [0, 6]], 16, hull);
    at(pod, sx * 22.8, -0.4, -15);
    s.add(pod);
    const nac = cyl(2.7, 2.4, 20, hull2, 28);
    at(nac, sx * 7.5, -1.2, -16);
    s.add(nac);
    s.add(at(cyl(2.9, 2.9, 1.2, darkMat(), 28), sx * 7.5, -1.2, -7));
    s.add(at(cyl(2.85, 2.85, 0.6, frame, 28), sx * 7.5, -1.2, -12));
    s.add(at(cyl(2.85, 2.85, 0.6, frame, 28), sx * 7.5, -1.2, -20));
    engine(s, sx * 7.5, -1.2, -26, 2.2, def.exhaust, darkMat());
    const fin = new THREE.Mesh(wingGeo([[0, -10], [7, -17], [7, -20], [0, -22]], 0.5), hull2);
    fin.geometry.rotateZ(Math.PI / 2 + sx * 0.35);
    at(fin, sx * 3, 3.2, 0);
    s.add(fin);
    // painéis solares em braços dorsais
    s.add(at(box(9, 0.4, 0.4, frame), sx * 9, 5.8, 2));
    solarPanel(s, sx * 17, 6.2, 2, 12, 5, sx * 0.25, frame);
    // propulsores de manobra
    rcs(s, sx * 4.7, 1.5, 20, 0.9, frame, darkMat());
    rcs(s, sx * 4.8, 0.5, -20, 1.0, frame, darkMat());
  }
  engine(s, 0, 0, -25, 2.8, def.exhaust, darkMat());
  s.add(at(box(2.4, 2.0, 30, hull2), 0, 4.6, -6));
  // anel de laboratório em volta do casco
  const lab = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.9, 12, 48), hull2);
  at(lab, 0, 0, -2);
  s.add(lab);
  for (let k = 0; k < 4; k++) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.8, 6), frame);
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    sp.position.set(Math.cos(a) * 5.6, Math.sin(a) * 5.6, -2);
    sp.rotation.z = a - Math.PI / 2;
    s.add(sp);
  }
  // antena parabólica
  const dish = lathe([[0, 0], [1.5, 0.15], [3, 0.6], [4, 1.2], [3.9, 1.25], [0, 0.1]], 32, hull);
  dish.material = dish.material.clone(); dish.material.side = THREE.DoubleSide;
  dish.rotation.x = -0.9;
  at(dish, 0, 8.5, 3);
  s.add(dish);
  s.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 8), darkMat()), 0, 6.6, 3));
  // haste de sensores na proa
  s.add(at(cyl(0.15, 0.25, 9, frame, 8), 0, 0, 31.5));
  for (const z of [29, 31, 33]) s.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 16), frame), 0, 0, z));
  navLight(s, 0, 0, 36.2, '#ffffff', 0.2, 1.5);
  for (let k = 0; k < 3; k++) s.add(at(box(6, 2.6, 5, hull2), 0, -5.2, 8 - k * 6.5));
  antenna(s, 1.2, 5.6, -14, 4, 0.12, frame, 0.8);
  antenna(s, -1.2, 5.6, -10, 3, 0.1, frame, 1.1, 0.3);
  greebles(s, greyMat(), rng, 220, onLathe(prof, -23, 22), [0.2, 1.1]);
  greebles(s, darkMat(), rng, 60, onLathe(prof, -22, 18, 1, 1, Math.PI * 1.2, Math.PI * 1.8), [0.3, 1.4]);
  navLight(s, 23, -0.4, -9, '#ff2020', 0.4, 0);
  navLight(s, -23, -0.4, -9, '#20ff40', 0.4, 0);
  navLight(s, 0, 6, -20, '#ffffff', 0.35, 1.0);
  navLight(s, 0, -6.6, 0, '#ff3030', 0.3, 1.6, 0.5);
  return { group: s, cockpit: new THREE.Vector3(0, 4.0, 17), length: 64 };
}

function buildLeviata(def) {
  const s = newShip();
  const rng = mulberry32(303);
  const hull = hullMaterial('#7d838c', '#b33a2a', 33, 60, 0.6, 4, def.reg);
  const hull2 = hullMaterial('#4a4f57', '#d0d0d0', 34, 25, 0.7, 4);
  const frame = greyMat();
  const prof = [[0, -150], [28, -150], [34, -130], [36, -40], [34, 40], [26, 100], [14, 150], [0, 170]];
  const main = lathe(prof, 6, hull);
  main.geometry.rotateZ(Math.PI / 6);
  main.scale.set(1.35, 0.72, 1);
  s.add(main);
  // superestrutura / ponte
  s.add(at(box(30, 12, 60, hull2), 0, 28, -40));
  s.add(at(box(20, 10, 30, hull2), 0, 38, -50));
  const bridge = at(box(26, 5, 10, glassMat()), 0, 42, -36);
  s.add(bridge);
  s.add(at(box(27, 1.2, 11, frame), 0, 45, -36));
  s.add(at(box(14, 8, 14, hull2), 0, 46, -55));
  s.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 30, 6), darkMat()), 0, 60, -58));
  for (const sx of [-1, 1]) antenna(s, sx * 5, 50, -60, 14, 0.5, frame, 0.6 + sx * 0.1, sx * 0.3);
  // pratos de comunicação
  for (const sx of [-1, 1]) {
    const dish = lathe([[0, 0], [2, 0.3], [4, 1.1], [5, 2], [4.8, 2.05], [0, 0.2]], 24, frame);
    dish.material = frame.clone(); dish.material.side = THREE.DoubleSide;
    dish.rotation.set(-1.1, 0, sx * 0.6);
    at(dish, sx * 12, 36, -68);
    s.add(dish);
  }
  // placas de blindagem
  for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) {
    const p = at(box(4, 14, 34, hull2), sx * 46, 0, 90 - k * 40);
    p.rotation.z = sx * 0.15;
    s.add(p);
  }
  // torres desativadas no dorso
  for (const [z, sx] of [[95, 0], [55, 0], [10, 1], [10, -1]]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 3, 16), hull2);
    at(base, sx * 16, 25.5, z);
    s.add(base);
    const tur = at(box(8, 4, 9, hull2), sx * 16, 29, z);
    tur.rotation.y = sx ? sx * 0.5 : 0.2;
    s.add(tur);
    for (const bx of [-1.6, 1.6]) {
      const barrel = cyl(0.6, 0.8, 14, frame, 10);
      barrel.position.set(sx * 16 + bx, 29.5, z + 10);
      s.add(barrel);
    }
  }
  // hangar ventral iluminado
  s.add(at(box(34, 10, 4, darkMat()), 0, -22, 60));
  s.add(at(box(30, 8, 1, lightMat('#ffd9a0', 1.6)), 0, -22, 58));
  for (let k = 0; k < 8; k++) navLight(s, -14 + k * 4, -27.5, 62, k % 2 ? '#ffb040' : '#ffffff', 0.5, 0);
  // radiadores
  const radMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.5, roughness: 0.6, emissive: 0xff5a1a, emissiveIntensity: 0.25 });
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    s.add(at(box(55, 1.2, 26, radMat), sx * 78, k ? 8 : -8, -95 - k * 34));
    s.add(at(box(30, 3, 4, hull2), sx * 55, k ? 8 : -8, -95 - k * 34));
    for (let j = 0; j < 6; j++) s.add(at(box(0.6, 1.8, 26, frame), sx * (56 + j * 9), k ? 8 : -8, -95 - k * 34));
  }
  // domos de sensores
  for (const z of [80, 20]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull2);
    s.add(at(d, 0, 24, z));
  }
  // motores
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    s.add(at(cyl(10, 10, 24, hull2, 32), sx * 18, sy * 10, -152));
    engine(s, sx * 18, sy * 10, -164, 8.5, def.exhaust, darkMat());
  }
  engine(s, 0, 0, -152, 10, def.exhaust, darkMat());
  for (const sx of [-1, 1]) for (const z of [140, 40, -120]) rcs(s, sx * 40, 14, z, 3, frame, darkMat());
  // faixas de luz ao longo do casco
  for (const sx of [-1, 1]) s.add(at(box(0.6, 0.6, 200, lightMat('#9fd8ff', 1.8)), sx * 44.5, 13, 20));
  greebles(s, frame, rng, 520, onLathe(prof, -140, 150, 1.25, 0.66), [0.8, 5]);
  greebles(s, hull2, rng, 140, (r) => ({ p: new THREE.Vector3((r() - 0.5) * 28, 34, -40 + (r() - 0.5) * 58), n: new THREE.Vector3(0, 1, 0) }), [0.6, 3]);
  // luzes do casco
  for (let k = 0; k < 14; k++) for (const sx of [-1, 1]) navLight(s, sx * 47, 9, 120 - k * 20, k % 3 ? '#ffd9a0' : '#ff4030', 0.8, k % 3 ? 0 : 0.7, k * 0.3);
  navLight(s, 50, 0, -130, '#ff2020', 1.6, 0);
  navLight(s, -50, 0, -130, '#20ff40', 1.6, 0);
  navLight(s, 0, 74, -58, '#ff2020', 1.2, 1.3);
  return { group: s, cockpit: new THREE.Vector3(0, 43, -30), length: 330 };
}

function buildExodo(def) {
  const s = newShip();
  const rng = mulberry32(404);
  const hull = hullMaterial('#d5d8dc', '#2a8ad0', 44, 90, 0.5, 6, def.reg);
  const hull2 = hullMaterial('#60666e', '#e0e0e0', 45, 30, 0.7, 6);
  const ringMat = hullMaterial('#c8ccd2', '#3aa0e0', 46, 220, 0.45, 1, 'ÊXODO');
  const frame = greyMat();
  // espinha principal
  s.add(cyl(12, 12, 700, hull2, 24));
  for (let z = -320; z <= 300; z += 40) s.add(at(new THREE.Mesh(new THREE.TorusGeometry(14, 2.2, 8, 24), hull), 0, 0, z));
  greebles(s, frame, rng, 700, (r) => {
    const a = r() * Math.PI * 2, z = -320 + r() * 560;
    return { p: new THREE.Vector3(Math.cos(a) * 12, Math.sin(a) * 12, z), n: new THREE.Vector3(Math.cos(a), Math.sin(a), 0) };
  }, [0.8, 5]);
  // contêineres de carga (sementes, embriões, arquivos) em volta da espinha
  const cargoCols = ['#c85a2a', '#2a6ad0', '#d0c8b8', '#3a8a5a', '#8a8a92'];
  for (let z = -240; z <= 220; z += 22) {
    if (z > 0 && z < 140) continue; // espaço dos anéis
    for (let k = 0; k < 6; k++) {
      if (rng() < 0.2) continue;
      const a = (k / 6) * Math.PI * 2 + (z % 44 ? 0.26 : 0);
      const c = box(9, 9, 18, new THREE.MeshStandardMaterial({ color: cargoCols[Math.floor(rng() * cargoCols.length)], metalness: 0.4, roughness: 0.7 }));
      c.position.set(Math.cos(a) * 21, Math.sin(a) * 21, z);
      c.rotation.z = a;
      s.add(c);
    }
  }
  // escudo de proa
  const shield = lathe([[14, 330], [40, 336], [58, 345], [64, 356], [55, 368], [30, 376], [0, 380]], 48, hull);
  s.add(shield);
  s.add(lathe([[0, 250], [24, 255], [28, 280], [28, 318], [18, 332], [0, 334]], 32, hull));
  const glass = new THREE.Mesh(new THREE.TorusGeometry(26, 2.5, 8, 48), glassMat());
  s.add(at(glass, 0, 0, 300));
  // torres de acoplamento na proa
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const tw = cyl(2.5, 3.5, 40, hull2, 10);
    tw.position.set(Math.cos(a) * 36, Math.sin(a) * 36, 300);
    s.add(tw);
    navLight(s, Math.cos(a) * 36, Math.sin(a) * 36, 321, '#ffffff', 1.4, 0.9, k * 0.25);
  }
  // anéis habitacionais (giram em sentidos opostos)
  const rings = [];
  for (const [z, dir] of [[110, 1], [30, -1]]) {
    const rg = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(150, 16, 24, 160), ringMat);
    rg.add(torus);
    // janelões contínuos na face interna
    const win = new THREE.Mesh(new THREE.TorusGeometry(135.5, 1.4, 6, 160), lightMat('#ffe6c0', 1.4));
    rg.add(win);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 140, 10), hull2);
      sp.position.set(Math.cos(a) * 80, Math.sin(a) * 80, 0);
      sp.rotation.z = a - Math.PI / 2;
      rg.add(sp);
      // elevadores
      const lift = box(5, 10, 5, frame);
      lift.position.set(Math.cos(a + 0.05) * (40 + (k * 17) % 90), Math.sin(a + 0.05) * (40 + (k * 17) % 90), 0);
      lift.rotation.z = a;
      rg.add(lift);
    }
    rg.add(new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 18, 24).rotateX(Math.PI / 2), hull2));
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const lm = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), lightMat(k % 2 ? '#ffe0b0' : '#9fd8ff', 6));
      lm.position.set(Math.cos(a) * 150, Math.sin(a) * 150, 16.5);
      rg.add(lm);
    }
    // painéis solares na borda externa do anel
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.13;
      const pn = box(3, 40, 26, solarMaterial());
      pn.position.set(Math.cos(a) * 186, Math.sin(a) * 186, 0);
      pn.rotation.z = a - Math.PI / 2;
      rg.add(pn);
      const arm = box(2, 22, 2, frame);
      arm.position.set(Math.cos(a) * 167, Math.sin(a) * 167, 0);
      arm.rotation.z = a - Math.PI / 2;
      rg.add(arm);
    }
    at(rg, 0, 0, z);
    s.add(rg);
    rings.push({ g: rg, dir });
  }
  // bobinas de dobra
  const coils = [];
  for (let k = 0; k < 4; k++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.9, roughness: 0.3, emissive: new THREE.Color(def.exhaust), emissiveIntensity: 2 });
    const c = new THREE.Mesh(new THREE.TorusGeometry(58 - k * 4, 5, 16, 96), m);
    at(c, 0, 0, -140 - k * 38);
    s.add(c);
    // enrolamento visível da bobina
    const wind = new THREE.Mesh(new THREE.TorusGeometry(58 - k * 4, 5.6, 4, 96), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 1, roughness: 0.35, wireframe: true }));
    at(wind, 0, 0, -140 - k * 38);
    s.add(wind);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + Math.PI / 4;
      const st = new THREE.Mesh(new THREE.BoxGeometry(3, 46 - k * 4, 3), hull2);
      st.position.set(Math.cos(a) * (35 - k * 2), Math.sin(a) * (35 - k * 2), -140 - k * 38);
      st.rotation.z = a - Math.PI / 2;
      s.add(st);
    }
    coils.push(m);
  }
  // bloco de motores
  s.add(at(cyl(30, 38, 60, hull, 6), 0, 0, -330));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    engine(s, Math.cos(a) * 22, Math.sin(a) * 22, -362, 9, def.exhaust, darkMat());
    rcs(s, Math.cos(a) * 40, Math.sin(a) * 40, -310, 5, frame, darkMat());
  }
  engine(s, 0, 0, -362, 13, def.exhaust, darkMat());
  // painéis radiadores
  const radMat = new THREE.MeshStandardMaterial({ color: 0x1c2228, metalness: 0.6, roughness: 0.5, emissive: 0x3aa0ff, emissiveIntensity: 0.18 });
  for (const sx of [-1, 1]) {
    s.add(at(box(140, 1.5, 60, radMat), sx * 90, 0, -270));
    s.add(at(box(70, 4, 6, hull2), sx * 45, 0, -270));
    for (let j = 0; j < 10; j++) s.add(at(box(1, 2.4, 60, frame), sx * (24 + j * 14), 0, -270));
  }
  antenna(s, 0, 12, 200, 40, 1, frame, 0.7);
  antenna(s, 0, -12, 180, 30, 0.8, frame, 0.9, 0.5);
  navLight(s, 170, 0, -270, '#ff2020', 2.5, 0);
  navLight(s, -170, 0, -270, '#20ff40', 2.5, 0);
  navLight(s, 0, 66, 356, '#ffffff', 2, 1.1);
  navLight(s, 0, -66, 356, '#ffffff', 2, 1.1, 0.5);
  s.userData.rings = rings;
  s.userData.coils = coils;
  return { group: s, cockpit: new THREE.Vector3(0, 6, 318), length: 900 };
}

const BUILDERS = { andorinha: buildAndorinha, odisseia: buildOdisseia, leviata: buildLeviata, exodo: buildExodo };

// Ajusta o relevo dos cascos à escala em que o modelo é exibido (o relevo do three.js depende da escala do mundo)
export function setShipScale(group, metersToWorld, shipMeters) {
  group.scale.setScalar(metersToWorld);
  const h = 0.03 * Math.pow(shipMeters / 15, 0.75); // profundidade das juntas (m), maior em naves com painéis maiores
  group.traverse((o) => { if (o.material && o.material.bumpMap) o.material.bumpScale = h * metersToWorld; });
}

// Retorna um objeto com o modelo já escalado para km e com frente em -Z
export function buildShip(def) {
  const built = BUILDERS[def.id](def);
  const inner = built.group;
  inner.rotation.y = Math.PI;
  const outer = new THREE.Group();
  outer.add(inner);
  setShipScale(outer, 0.001, built.length);
  const ck = built.cockpit.clone();
  const cockpit = new THREE.Vector3(-ck.x, ck.y, -ck.z).multiplyScalar(0.001);
  const ud = inner.userData;
  return {
    def, group: outer, cockpit, length: built.length * 0.001, meters: built.length,
    update(t, power, warp = 0) {
      for (const e of ud.exhausts) {
        e.material.uniforms.uPower.value = power;
        e.material.uniforms.uTime.value = t;
        e.scale.set(1, 1, 0.25 + power * 0.9);
        e.visible = power > 0.01;
      }
      for (const d of ud.discs) d.material.color.set(def.exhaust).multiplyScalar(1 + power * 6);
      for (const b of ud.blinkers) {
        const on = ((t * b.blink + b.phase) % 1) < 0.12;
        b.m.visible = on;
      }
      if (ud.rings) for (const r of ud.rings) r.g.rotation.z += 0.0015 * r.dir;
      if (ud.coils) ud.coils.forEach((m, k) => { m.emissiveIntensity = 1.2 + warp * 6 + Math.sin(t * 3 + k) * 0.6; });
    },
  };
}
