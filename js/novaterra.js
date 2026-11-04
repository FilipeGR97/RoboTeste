// Nova Terra viva: fauna (saltitantes, planadores, titãs), noite com vaga-lumes, chuva com trovões
// e os lugares da história (a sonda Vigia-7, o Santuário dos Guardiões, o sinalizador e a Aurora pousada).
// Tudo fica pendurado no grupo que gira com o planeta, em coordenadas do planeta (km).
import * as THREE from 'three';
import { heightAt, vegAt } from './terrain.js';
import { SHIPS, buildShip } from './ships.js';
import { clamp, smoothstep } from './util.js';

// ---------------------------------------------------------------- catálogo de espécies
export const SPECIES = {
  pastador: { nome: 'Pastador-de-crista', tipo: 'fauna', desc: 'Herbívoro de manada, ~2,5 m. Pasta em grupos de nove e foge de tudo que anda em duas pernas.' },
  saltitante: { nome: 'Saltitante', tipo: 'fauna', desc: 'Pequeno e curioso, se move aos pulos. As orelhas longas giram para os lados como antenas.' },
  planador: { nome: 'Planador-véu', tipo: 'fauna', desc: 'Dez metros de asa feita de membrana fina. Plana horas nas correntes de ar quente sem bater as asas.' },
  titan: { nome: 'Titã-das-planícies', tipo: 'fauna', desc: 'O maior animal já visto: 25 m de altura. Caminha devagar pelos campos; o chão treme a cada passo.' },
  ave: { nome: 'Andorinha-azul', tipo: 'fauna', desc: 'Ave pequena que voa em bando e canta ao amanhecer. Parecida demais com as da Terra.' },
  copa: { nome: 'Copa-larga', tipo: 'flora', desc: 'Árvore de folhas largas das baixadas úmidas. Forma florestas fechadas e escuras.' },
  agulha: { nome: 'Agulheiro', tipo: 'flora', desc: 'Conífera das encostas e regiões frias. Pode passar de 30 m.' },
  lanterna: { nome: 'Árvore-lanterna', tipo: 'flora', desc: 'Tronco fino e curvo, folhas pendentes e frutos que acumulam luz de dia e brilham à noite.' },
  flor: { nome: 'Flor-estrela', tipo: 'flora', desc: 'Flores bioluminescentes dos campos. À noite, os prados parecem um céu caído.' },
};
export const CATALOG_GOAL = 6;

// ---------------------------------------------------------------- utilidades
const Y = new THREE.Vector3(0, 1, 0);
function frameAt(up) {
  const e1 = new THREE.Vector3(0, 1, 0).cross(up); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
  return { up, e1, e2: up.clone().cross(e1) };
}
const offsetDir = (up, f, x, z, R) => up.clone().addScaledVector(f.e1, x / R).addScaledVector(f.e2, z / R).normalize();

// procura um ponto em terra firme entre minKm e maxKm de "from" (direção no planeta)
export function pickSite(P, from, minKm, maxKm, hsMin, hsMax, seed, avoid = []) {
  const f = frameAt(from.clone().normalize());
  let r = (seed * 9301 + 49297) % 233280;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 0; i < 600; i++) {
    const a = rnd() * Math.PI * 2, d = minKm + rnd() * (maxKm - minKm);
    const dir = offsetDir(f.up, f, Math.cos(a) * d, Math.sin(a) * d, P.R);
    if (Math.abs(dir.y) > 0.7) continue;
    if (avoid.some((v) => v.distanceTo(dir) * P.R < 8)) continue;
    const h = heightAt(P, dir.x, dir.y, dir.z);
    if (h.water || h.hs < hsMin || h.hs > hsMax) continue;
    // terreno razoavelmente plano em volta (cabe um pouso)
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) {
      const q = offsetDir(dir, frameAt(dir), Math.cos(k) * 0.06, Math.sin(k) * 0.06, P.R);
      const hq = heightAt(P, q.x, q.y, q.z);
      if (hq.water || Math.abs(hq.e - h.e) > 0.012) ok = false;
    }
    if (ok) return dir.toArray();
  }
  return from.clone().normalize().toArray();
}

// avalia um ponto para o pouso da Aurora: plano, perto da água, fora da floresta
export function rateColonySite(P, dir) {
  const h = heightAt(P, dir.x, dir.y, dir.z);
  if (h.water) return { ok: false, why: 'Aqui é água. Precisamos de chão firme.' };
  const f = frameAt(dir);
  let maxDiff = 0;
  for (let k = 0; k < 12; k++) {
    for (const rad of [0.25, 0.6, 1.0]) {
      const q = offsetDir(dir, f, Math.cos(k * 0.52) * rad, Math.sin(k * 0.52) * rad, P.R);
      const hq = heightAt(P, q.x, q.y, q.z);
      maxDiff = Math.max(maxDiff, Math.abs((hq.water ? 0 : hq.e) - h.e));
    }
  }
  if (maxDiff > 0.06) return { ok: false, why: `O terreno varia ${Math.round(maxDiff * 1000)} m num raio de 1 km. A Aurora tem 2 km de comprimento: precisamos de um vale bem plano.` };
  const v = vegAt(P, dir.x, dir.y, dir.z, h);
  if (v.forest > 0.35) return { ok: false, why: 'Floresta fechada. Não vamos derrubar uma mata inteira para pousar — procure um campo aberto.' };
  let water = Infinity;
  for (let k = 0; k < 16; k++) for (const rad of [0.6, 1.2, 2, 3, 4.5]) {
    const q = offsetDir(dir, f, Math.cos(k * 0.39) * rad, Math.sin(k * 0.39) * rad, P.R);
    if (heightAt(P, q.x, q.y, q.z).water) water = Math.min(water, rad);
  }
  if (water > 5) return { ok: false, why: 'Plano e aberto, mas sem água a menos de 5 km. Quarenta mil pessoas vão precisar de um rio ou de um lago.' };
  if (Math.abs(dir.y) > 0.55) return { ok: false, why: 'Perto demais do polo: invernos longos e escuros. Procure mais perto do equador.' };
  return { ok: true, why: `Plano, campo aberto, água a ${water.toFixed(1).replace('.', ',')} km. É um bom lugar.` };
}

// ---------------------------------------------------------------- modelos
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
function hopperModel() {
  const g = new THREE.Group(), fur = mat(0xc9a36a), dark = mat(0x3a2a1e);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8).scale(1, 0.85, 1.2), fur); body.position.y = 0.24; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), fur); head.position.set(0, 0.42, 0.2); g.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.32, 5).translate(0, 0.16, 0), fur);
    ear.position.set(0.05 * s, 0.5, 0.18); ear.rotation.z = -0.5 * s; g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), dark); eye.position.set(0.06 * s, 0.45, 0.31); g.add(eye);
  }
  return g;
}
function gliderModel() {
  const g = new THREE.Group(), skin = mat(0x4a5a6a), memb = new THREE.MeshStandardMaterial({ color: 0x9ab8c8, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6).scale(0.35, 0.3, 2.2), skin); g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 2.5, 6).rotateX(Math.PI / 2).translate(0, 0, -3.2), skin); g.add(tail);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.2, 0, 0, -1.4, 5.2, 0.3, -0.6, 0, 0, 1.2, 5.2, 0.3, -0.6, 4.6, 0.25, 0.6], 3));
  wing.computeVertexNormals();
  const l = new THREE.Mesh(wing, memb), r = new THREE.Mesh(wing, memb); r.scale.x = -1;
  g.add(l, r);
  g.userData.wings = [l, r];
  return g;
}
function titanModel() {
  const g = new THREE.Group(), hide = mat(0x5f6a72), belly = mat(0xb9b2a0), dark = mat(0x2d3236);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12).scale(4.2, 3.6, 7.5), hide); body.position.y = 11; g.add(body);
  const bel = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(3.6, 2.4, 6.2), belly); bel.position.y = 9.6; g.add(bel);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.9, 13, 10).translate(0, 6.5, 0), hide); neck.position.set(0, 12.5, 5.5); neck.rotation.x = 0.55; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).scale(1.2, 1.1, 2.2), hide); head.position.set(0, 23.6, 11.8); g.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.6, 14, 8).rotateX(-Math.PI / 2 - 0.25).translate(0, 9.5, -13), hide); g.add(tail);
  g.userData.legs = [];
  for (const [x, z] of [[-2.6, 4], [2.6, 4], [-2.6, -4], [2.6, -4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.85, 10, 8).translate(0, -5, 0), hide);
    leg.position.set(x, 10, z); g.add(leg); g.userData.legs.push(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.6, 8).translate(0, -10, 0), dark); leg.add(foot);
  }
  g.userData.head = head; g.userData.neck = neck;
  return g;
}
function probeModel() {
  const g = new THREE.Group(), hull = mat(0xc8ccd0, { metalness: 0.6, roughness: 0.4 }), gold = mat(0xc9a040, { metalness: 0.8, roughness: 0.35 }), burnt = mat(0x2a2522);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 2.6, 12), gold); body.position.y = 1.1; body.rotation.z = 0.45; g.add(body);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 8, 0, Math.PI * 2, 0, 0.9), hull); dish.position.set(-1.1, 2.4, 0.3); dish.rotation.set(0.4, 0, 1.2); g.add(dish);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4, 0.06, 1.3), mat(0x1c2c5a, { metalness: 0.3, roughness: 0.3 })); panel.position.set(2.6, 0.5, -0.4); panel.rotation.set(0.2, 0.4, -0.35); g.add(panel);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 5), hull); mast.position.set(0.4, 2.4, 0); mast.rotation.z = -0.2; g.add(mast);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 })); lamp.position.set(0.7, 3.85, 0); g.add(lamp);
  g.userData.lamp = lamp;
  // destroços e terra revirada
  let s = 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 16; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 + rnd() * 0.7, 0.05 + rnd() * 0.2, 0.2 + rnd() * 0.6), k % 3 ? burnt : hull);
    const a = rnd() * 6.28, d = 3 + rnd() * 14;
    m.position.set(Math.cos(a) * d, 0.05, Math.sin(a) * d); m.rotation.set(rnd(), rnd() * 6, rnd()); g.add(m);
  }
  const scar = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 0.4, 16), burnt); scar.position.y = -0.1; g.add(scar);
  return g;
}
function sanctuaryModel() {
  const g = new THREE.Group();
  const stone = mat(0x0c0b12, { metalness: 0.5, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8a5cff });
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const mono = new THREE.Group();
    const h = 30 + (k % 3) * 6;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4, h, 2), stone); slab.position.y = h / 2 - 2; mono.add(slab);
    for (let j = 0; j < 4; j++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3 + j * 1.5, 2.05), glow); line.position.set(-1.2 + j * 0.8, 6 + j * 5, 0); mono.add(line);
    }
    mono.position.set(Math.cos(a) * 42, 0, Math.sin(a) * 42);
    mono.rotation.y = -a + Math.PI / 2; mono.rotateX(0.1);
    g.add(mono);
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(6, 0), new THREE.MeshStandardMaterial({ color: 0x15102a, emissive: 0x6a3cff, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.2 }));
  core.position.y = 24; g.add(core);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(50, 52, 1.2, 36), stone); floor.position.y = -0.8; g.add(floor);
  const ringLine = new THREE.Mesh(new THREE.TorusGeometry(30, 0.3, 6, 64).rotateX(Math.PI / 2), glow); ringLine.position.y = 0; g.add(ringLine);
  g.userData.core = core; g.userData.glow = glow;
  return g;
}
function beaconModel() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3, 6), mat(0xdddddd, { metalness: 0.6 })); pole.position.y = 1.5; g.add(pole);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x40ff90 })); lamp.position.y = 3.1; g.add(lamp);
  g.userData.lamp = lamp;
  return g;
}
function colonyModel() {
  const g = new THREE.Group(), white = mat(0xe8ecef, { metalness: 0.2, roughness: 0.5 }), grey = mat(0x8a9196), lightM = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  let s = 21;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const lights = [];
  for (let k = 0; k < 14; k++) {
    const a = rnd() * 6.28, d = 1300 + rnd() * 500, r = 8 + rnd() * 10;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
    dome.position.set(Math.cos(a) * d, -0.5, Math.sin(a) * d); g.add(dome);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 4), lightM); l.position.set(dome.position.x + r, 2, dome.position.z); g.add(l); lights.push(l);
  }
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 10), k % 2 ? white : grey);
    const a = rnd() * 6.28, d = 1250 + rnd() * 400;
    m.position.set(Math.cos(a) * d, 2.5, Math.sin(a) * d); m.rotation.y = rnd() * 3; g.add(m);
  }
  g.userData.lightM = lightM;
  return g;
}

// ---------------------------------------------------------------- chuva
const RAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aEnd;
uniform float uTime, uH, uLen;
varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uTime * 0.009, uH) - uH * 0.5;
  p.y -= aEnd * uLen; p.x += aEnd * uLen * 0.12;
  vA = 1.0 - aEnd * 0.7;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;
const RAIN_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uI; uniform vec3 uCol;
varying float vA;
void main(){
  gl_FragColor = vec4(uCol, 0.32 * uI * vA);
  #include <logdepthbuf_fragment>
}`;
const FF_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aPh;
uniform float uTime, uI, uScale;
varying float vB;
void main(){
  vB = uI * pow(max(sin(uTime * (0.7 + fract(aPh * 7.0)) + aPh * 6.28), 0.0), 3.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 0.00012 / -mv.z, 1.5, 9.0);
  #include <logdepthbuf_vertex>
}`;
const FF_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying float vB;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 18.0) * vB;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.55, 1.0, 0.45) * a * 0.9, 1.0);
  #include <logdepthbuf_fragment>
}`;

// tempo de chuva: janelas de 12 min; em ~1/3 delas chove, com início e fim graduais
export function rainAt(t) {
  const P = 720, seg = Math.floor(t / P), u = t - seg * P;
  const h = Math.abs(Math.sin(seg * 127.1 + 311.7) * 43758.5453) % 1;
  if (h > 0.34) return 0;
  return smoothstep(0, 70, u) * (1 - smoothstep(560, 690, u)) * (0.6 + 0.4 * (h / 0.34));
}

// ---------------------------------------------------------------- mundo
export class NovaWorld {
  constructor(item, P, scene) {
    this.item = item; this.P = P; this.R = P.R; this.scene = scene;
    this.root = new THREE.Group();
    item.spin.add(this.root);
    const S1 = 0.001;
    // saltitantes perto do jogador
    this.hoppers = [];
    for (let k = 0; k < 10; k++) {
      const g = hopperModel(); g.scale.setScalar(S1 * (0.8 + (k % 3) * 0.15)); this.root.add(g);
      this.hoppers.push({ g, x: 0, z: 0, tx: 0, tz: 0, hop: 0, wait: Math.random() * 3, heading: 0 });
    }
    // planadores e titãs (vistos também do ar)
    this.gliders = [];
    for (let k = 0; k < 4; k++) {
      const g = gliderModel(); g.scale.setScalar(S1 * (0.9 + k * 0.08)); this.root.add(g);
      this.gliders.push({ g, a: (k / 4) * 6.28, rad: 0.18 + k * 0.07, h: 0.07 + k * 0.035, sp: 0.06 + (k % 2) * 0.02, dir: k % 2 ? 1 : -1 });
    }
    this.titans = [];
    for (let k = 0; k < 2; k++) {
      const g = titanModel(); g.scale.setScalar(S1 * (0.9 + k * 0.15)); this.root.add(g);
      this.titans.push({ g, x: 0, z: 0, heading: k * 2.1, phase: k * 1.7, stepT: 0 });
    }
    this.hopC = null; this.glideC = null; this.titanC = null;
    // vaga-lumes
    const NF = 260;
    this.ffP = new Float64Array(NF * 3); this.ffOk = false;
    const fg = new THREE.BufferGeometry();
    this.ffPos = new THREE.BufferAttribute(new Float32Array(NF * 3), 3); this.ffPos.setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('position', this.ffPos);
    fg.setAttribute('aPh', new THREE.BufferAttribute(Float32Array.from({ length: NF }, () => Math.random()), 1));
    this.ffU = { uTime: { value: 0 }, uI: { value: 0 }, uScale: { value: 900 } };
    this.ff = new THREE.Points(fg, new THREE.ShaderMaterial({ vertexShader: FF_VERT, fragmentShader: FF_FRAG, uniforms: this.ffU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ff.frustumCulled = false;
    scene.add(this.ff);
    // chuva (em volta da câmera, orientada pelo "para cima" do planeta)
    const NR = 2600, rp = [], re = [];
    for (let k = 0; k < NR; k++) {
      const x = (Math.random() * 2 - 1) * 0.03, y = (Math.random() * 2 - 1) * 0.02, z = (Math.random() * 2 - 1) * 0.03;
      rp.push(x, y, z, x, y, z); re.push(0, 1);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.Float32BufferAttribute(re, 1));
    this.rainU = { uTime: { value: 0 }, uH: { value: 0.04 }, uLen: { value: 0.0007 }, uI: { value: 0 }, uCol: { value: new THREE.Color(0.75, 0.8, 0.85) } };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: this.rainU, transparent: true, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
    this.rainNow = 0; this.boltT = 8;
    // lugares da história
    this.sites = {};
    this.aurora = null;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
  }

  ground(d) { const h = heightAt(this.P, d.x, d.y, d.z); return { r: this.R + (h.water ? 0 : h.e), h }; }
  // põe no chão com a frente (+z do modelo) apontando para o rumo yaw (0 = e2 do referencial local)
  place(obj, d, yaw = 0, lift = 0) {
    const g = this.ground(d);
    obj.position.copy(d).multiplyScalar(g.r + lift);
    const fr = frameAt(d), fw = fr.e1.clone().multiplyScalar(Math.sin(yaw)).addScaledVector(fr.e2, Math.cos(yaw));
    obj.quaternion.setFromRotationMatrix(this._m.makeBasis(new THREE.Vector3().crossVectors(d, fw), d, fw));
    return g;
  }

  // lugar fixo no planeta (cria o modelo na primeira vez)
  site(key, dirArr, make, yaw = 0) {
    if (!dirArr) { if (this.sites[key]) this.sites[key].g.visible = false; return null; }
    let s = this.sites[key];
    if (!s) {
      const g = make(); g.scale.setScalar(0.001);
      const d = new THREE.Vector3(...dirArr).normalize();
      this.root.add(g);
      this.place(g, d, yaw, key === 'probe' ? -0.0006 : 0);
      s = this.sites[key] = { g, d, p: g.position.clone() };
    }
    s.g.visible = true;
    return s;
  }

  // ctx: { dir (jogador/nave no planeta), alt, dt, t (elapsed), night, flags, me (posição da câmera no planeta), rainOk, near (bool: a pé ou baixo) }
  update(ctx) {
    const { dir, alt, dt, t, night, flags } = ctx;
    const R = this.R;
    const lowOk = alt < 0.15, airOk = alt < 3;
    // ---------- saltitantes: em volta do jogador, fogem quando ele chega perto
    if (!this.hopC || this.hopC.distanceTo(dir) * R > 0.09) {
      this.hopC = dir.clone(); this.hopF = frameAt(this.hopC);
      for (const h of this.hoppers) { const a = Math.random() * 6.28, d = 0.015 + Math.random() * 0.03; h.x = Math.cos(a) * d; h.z = Math.sin(a) * d; h.tx = h.x; h.tz = h.z; }
    }
    const mx = dir.dot(this.hopF.e1) * R, mz = dir.dot(this.hopF.e2) * R;
    for (const h of this.hoppers) {
      h.g.visible = lowOk;
      if (!lowOk) continue;
      const dxp = h.x - mx, dzp = h.z - mz, dp = Math.hypot(dxp, dzp);
      if (dp < 0.008 && h.hop <= 0) { h.tx = h.x + (dxp / dp) * 0.012; h.tz = h.z + (dzp / dp) * 0.012; h.wait = 0; } // fuga
      if (h.hop > 0) {
        h.hop -= dt;
        const k = Math.min(dt * 3.2, 1);
        h.x += (h.tx - h.x) * k; h.z += (h.tz - h.z) * k;
      } else if ((h.wait -= dt) <= 0) {
        if (Math.hypot(h.tx - h.x, h.tz - h.z) < 0.0005) { const a = Math.random() * 6.28; h.tx = h.x + Math.cos(a) * 0.003; h.tz = h.z + Math.sin(a) * 0.003; }
        h.heading = Math.atan2(h.tx - h.x, h.tz - h.z);
        h.hop = 0.45; h.wait = 0.4 + Math.random() * 2.5;
      }
      const d = offsetDir(this.hopC, this.hopF, h.x, h.z, R);
      const g = this.place(h.g, d, h.heading);
      h.g.position.addScaledVector(d, h.hop > 0 ? Math.sin((h.hop / 0.45) * Math.PI) * 0.0005 : 0);
      if (g.h.water) h.g.visible = false;
    }
    // ---------- planadores: círculos largos acima do jogador
    if (!this.glideC || this.glideC.distanceTo(dir) * R > 1.2) { this.glideC = dir.clone(); this.glideF = frameAt(this.glideC); this.glideG = this.ground(this.glideC).r; }
    for (const b of this.gliders) {
      b.g.visible = airOk;
      if (!airOk) continue;
      b.a += dt * b.sp * b.dir;
      const x = Math.cos(b.a) * b.rad, z = Math.sin(b.a) * b.rad;
      const d = offsetDir(this.glideC, this.glideF, x, z, R);
      b.g.position.copy(d).multiplyScalar(this.glideG + b.h + Math.sin(b.a * 2) * 0.01);
      const tng = this.glideF.e1.clone().multiplyScalar(-Math.sin(b.a) * b.dir).addScaledVector(this.glideF.e2, Math.cos(b.a) * b.dir);
      b.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), tng.negate(), d)).multiply(this._q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.25 * b.dir));
      const flap = Math.sin(t * 0.9 + b.a * 3);
      const w = flap > 0.6 ? (flap - 0.6) * 0.9 : 0; // bate as asas de vez em quando; no resto plana
      b.g.userData.wings[0].rotation.z = w; b.g.userData.wings[1].rotation.z = -w;
    }
    // ---------- titãs: caminham devagar nos campos, a algumas centenas de metros
    if (!this.titanC || this.titanC.distanceTo(dir) * R > 2.5) {
      this.titanC = dir.clone(); this.titanF = frameAt(this.titanC);
      this.titans.forEach((ti, k) => { const a = k * 2.4 + 0.7, d = 0.35 + k * 0.25; ti.x = Math.cos(a) * d; ti.z = Math.sin(a) * d; });
    }
    let thump = 0;
    for (const ti of this.titans) {
      ti.g.visible = airOk;
      if (!airOk) continue;
      const sp = 0.0011;
      ti.heading += Math.sin(t * 0.02 + ti.phase) * dt * 0.05;
      ti.x += Math.sin(ti.heading) * sp * dt; ti.z += Math.cos(ti.heading) * sp * dt;
      const d = offsetDir(this.titanC, this.titanF, ti.x, ti.z, R);
      const g = this.ground(d);
      if (g.h.water) { ti.heading += dt * 0.8; }
      this.place(ti.g, d, ti.heading, -0.0006);
      const ph = t * 1.1 + ti.phase;
      ti.g.userData.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.22; });
      ti.g.userData.neck.rotation.x = 0.55 + Math.sin(t * 0.2 + ti.phase) * 0.1;
      ti.stepT -= dt;
      if (ti.stepT <= 0) { ti.stepT = Math.PI / 1.1; const dd = d.distanceTo(dir) * R; if (dd < 0.35) thump = Math.max(thump, 1 - dd / 0.35); }
    }
    this.thump = thump;
    // ---------- vaga-lumes (noite, sem chuva, em terra com vegetação)
    const ffOn = night > 0.5 && this.rainNow < 0.3 && alt < 0.05;
    this.ff.visible = ffOn;
    if (ffOn) {
      const P = this.ffP, f = frameAt(dir), base = this.ground(dir).r;
      const N = P.length / 3;
      if (!this.ffOk || !this.ffC || this.ffC.distanceTo(dir) * R > 0.03) {
        this.ffC = dir.clone(); this.ffOk = true;
        for (let i = 0; i < N; i++) {
          const a = Math.random() * 6.28, rr = 0.003 + Math.sqrt(Math.random()) * 0.03;
          const d = offsetDir(dir, f, Math.cos(a) * rr, Math.sin(a) * rr, R);
          const g = this.ground(d);
          const r = g.h.water ? -1 : g.r + 0.0004 + Math.random() * 0.002;
          P[i * 3] = d.x * r; P[i * 3 + 1] = d.y * r; P[i * 3 + 2] = d.z * r;
        }
      }
      // referencial: o grupo do planeta; os pontos ficam em coordenadas relativas à câmera (precisão)
      const cam = ctx.me, q = ctx.q, cp = ctx.camScene;
      const a = this.ffPos.array;
      for (let i = 0; i < N; i++) {
        this._v.set(P[i * 3] - cam.x + Math.sin(t * 0.3 + i) * 0.0005, P[i * 3 + 1] - cam.y + Math.sin(t * 0.23 + i * 1.7) * 0.0003, P[i * 3 + 2] - cam.z + Math.cos(t * 0.27 + i) * 0.0005);
        if (P[i * 3] === 0 && P[i * 3 + 1] === 0) this._v.set(0, -1e6, 0);
        this._v.applyQuaternion(q).add(cp);
        a[i * 3] = this._v.x; a[i * 3 + 1] = this._v.y; a[i * 3 + 2] = this._v.z;
      }
      this.ffPos.needsUpdate = true;
      this.ffU.uTime.value = t % 1000; this.ffU.uI.value = smoothstep(0.5, 0.9, night); this.ffU.uScale.value = ctx.H || 900;
      void base;
    }
    // ---------- chuva
    const want = ctx.rainOk ? rainAt(ctx.simT) : 0;
    this.rainNow += (want - this.rainNow) * (1 - Math.exp(-dt * 0.5));
    this.rain.visible = this.rainNow > 0.02;
    if (this.rain.visible) {
      this.rain.position.copy(ctx.camScene);
      this.rain.quaternion.setFromUnitVectors(Y, ctx.upScene);
      this.rainU.uTime.value = t % 100; this.rainU.uI.value = this.rainNow;
      this.rainU.uCol.value.setRGB(0.7, 0.75, 0.8).multiplyScalar(0.25 + 0.75 * (1 - night));
    }
    this.bolt = 0;
    if (this.rainNow > 0.55) {
      this.boltT -= dt;
      if (this.boltT <= 0) { this.boltT = 7 + Math.random() * 18; this.bolt = 0.25 + Math.random() * 0.3; }
    }
    // ---------- lugares
    const pr = this.site('probe', flags.probeDir, probeModel, 0.7);
    if (pr) pr.g.userData.lamp.visible = (t % 1.6) < 0.25;
    const sa = this.site('sanct', flags.sanctDir, sanctuaryModel);
    if (sa) {
      sa.g.userData.core.rotation.y = t * 0.15;
      sa.g.userData.core.position.y = 24 + Math.sin(t * 0.5) * 1.5;
      sa.g.userData.glow.color.setRGB(0.54, 0.36, 1).multiplyScalar(0.6 + 0.4 * Math.sin(t * 0.8) + night * 0.8);
    }
    const bc = this.site('beacon', flags.beaconDir, beaconModel);
    if (bc) bc.g.userData.lamp.visible = (t % 1) < 0.5;
    this.updateAurora(ctx);
  }

  // a arca Aurora: descida de ~80 s até o ponto marcado e, depois, a colônia em volta
  updateAurora(ctx) {
    const f = ctx.flags;
    if (!f.auroraDir) return;
    if (!this.aurora) {
      const m = buildShip({ ...SHIPS[3], reg: 'AURORA' }, 2.3);
      m.group.traverse((o) => { o.frustumCulled = false; });
      const d = new THREE.Vector3(...f.auroraDir).normalize();
      const fr = frameAt(d);
      // chão mais alto sob o casco, para não afundar
      let top = -Infinity;
      for (const k of [-1, -0.5, 0, 0.5, 1]) for (const s of [-0.3, 0, 0.3]) {
        const q = offsetDir(d, fr, k * m.length * 0.5, s * m.length * 0.5, this.R);
        top = Math.max(top, this.ground(q).r);
      }
      const box = new THREE.Box3().setFromObject(m.group);
      this.aurora = { m, d, fr, rest: top - box.min.y * 0.98, colony: null };
      this.root.add(m.group);
    }
    const A = this.aurora;
    const T = f.auroraLanded ? 1 : clamp((ctx.simT - (f.auroraT0 || ctx.simT)) / 80, 0, 1);
    const k = 1 - Math.pow(1 - T, 2.2);
    const h = (1 - k) * 9; // começa a 9 km
    A.m.group.position.copy(A.d).multiplyScalar(A.rest + h);
    A.m.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(A.fr.e1, A.d, A.fr.e2.clone().negate()));
    A.m.update(ctx.t, T < 1 ? 0.6 + 0.4 * (1 - k) : 0, 0);
    this.auroraT = T;
    if (f.auroraLanded && !A.colony) {
      A.colony = colonyModel(); A.colony.scale.setScalar(0.001);
      this.root.add(A.colony);
      this.place(A.colony, A.d, 0, 0);
    }
    if (A.colony) A.colony.userData.lightM.color.setRGB(1, 0.82, 0.54).multiplyScalar(0.3 + 1.2 * ctx.night);
  }

  // alvos que o scanner a pé pode identificar: { id, p (posição no planeta), r (km) }
  targets(forest, life) {
    const out = [];
    const up = (p, k) => p.addScaledVector(p.clone().normalize(), k);
    for (const h of this.hoppers) if (h.g.visible) out.push({ id: 'saltitante', p: up(h.g.position.clone(), 0.0003), r: 0.0006 });
    for (const b of this.gliders) if (b.g.visible) out.push({ id: 'planador', p: b.g.position.clone(), r: 0.006 });
    for (const ti of this.titans) if (ti.g.visible) out.push({ id: 'titan', p: up(ti.g.position.clone(), 0.012), r: 0.016 });
    if (life) {
      const base = life.group.position;
      for (const c of life.creatures) if (c.g.visible) out.push({ id: 'pastador', p: up(c.g.position.clone().add(base), 0.0012), r: 0.0018 });
      for (const b of life.birds) out.push({ id: 'ave', p: b.g.position.clone().add(base), r: 0.0012 });
      for (const p of life.flowerPts || []) out.push({ id: 'flor', p, r: 0.0005, max: 0.008 });
    }
    if (forest) for (const t of forest.trees) out.push({ id: t.kind, p: t.p.clone().addScaledVector(t.p.clone().normalize(), t.h * 0.5), r: t.h * 0.3, max: 0.06 });
    return out;
  }

  dispose() {
    this.item.spin.remove(this.root);
    this.scene.remove(this.ff); this.scene.remove(this.rain);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.ff.geometry.dispose(); this.ff.material.dispose(); this.rain.geometry.dispose(); this.rain.material.dispose();
  }
}
