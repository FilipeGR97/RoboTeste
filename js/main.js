// ÚLTIMO HORIZONTE — núcleo do jogo
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Galaxy, KIND_NAME, KIND_DESC } from './galaxy.js';
import { getSystem, bodyPosition, TYPE_NAME } from './system.js';
import { SystemView, spinAngle } from './bodies.js';
import { PlanetSurface, GroundDetail, LifeDetail, heightAt, terrainParams } from './terrain.js';
import { Sky } from './sky.js';
import { SHIPS, buildShip, setShipScale } from './ships.js';
import { AudioEngine } from './audio.js';
import { GalaxyMap } from './map.js';
import { CinematicShader, SanitizeShader, tunnelMaterial, streakMaterial, LensShader, dustMaterial } from './shaders.js';
import { UI, $, remarkFor } from './ui.js';
import { missionStatus } from './missions.js';
import { Fleet, FleetView, ShadowEncounter, exoCatalog, FLEET } from './fleet.js';
import { INTRO, storyTick, TUPA_LOG, EPILOGUE } from './story.js';
import { FlightFX } from './flightfx.js';
import { KM_PER_LY, KM_PER_AU, C_KMS, clamp, smoothstep, fmtDist, fmtSpeed, fmtTime, fmtNum } from './util.js';

const SAVE_KEY = 'ultimoHorizonte.save.v1';
const SET_KEY = 'ultimoHorizonte.settings.v1';
const SYS_ENTER = 0.05 * KM_PER_LY;
const SYS_EXIT = 0.065 * KM_PER_LY;
const T0 = 1.7e9;

// ------------------------------------------------------------------------------------------------
// Configurações
// ------------------------------------------------------------------------------------------------
const SET_DEF = { music: 0.7, sfx: 0.8, amb: 0.6, fov: 62, quality: 0.85, exposure: 1.0, invert: false, tick: false, steer: 1, look: 1, fps: false };
const SET_RANGE = { music: [0, 1], sfx: [0, 1], amb: [0, 1], fov: [45, 90], quality: [0.6, 1.5], exposure: [0.5, 2], steer: [0.3, 2.5], look: [0.3, 2.5] };
// ajustes salvos: um arquivo corrompido ou um valor fora da faixa volta ao padrão em vez de travar o jogo
const settings = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SET_KEY) || '{}') || {}; } catch (e) { /* ignora */ }
  const out = { ...SET_DEF };
  for (const k in SET_DEF) {
    const v = saved[k];
    if (typeof SET_DEF[k] === 'boolean') { if (typeof v === 'boolean') out[k] = v; } else if (Number.isFinite(v)) out[k] = Math.min(SET_RANGE[k][1], Math.max(SET_RANGE[k][0], v));
  }
  return out;
})();
const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* sem armazenamento */ } };

// ------------------------------------------------------------------------------------------------
// Renderização
// ------------------------------------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = settings.exposure;
let W = innerWidth, H = innerHeight;
const pixelRatio = () => Math.min(devicePixelRatio, 2) * settings.quality;
renderer.setPixelRatio(pixelRatio());
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, W / H, 1e-5, 1e14);
scene.add(camera);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
scene.add(sun, sun.target);
const ambient = new THREE.AmbientLight(0x30405a, 0.35);
scene.add(ambient);
// A nave é desenhada numa camada própria, depois da lente gravitacional, para não ser distorcida.
// Sem a lente ela reaproveita a profundidade da cena e fica escondida atrás do relevo
const SHIP_LAYER = 1;
sun.layers.enable(SHIP_LAYER); ambient.layers.enable(SHIP_LAYER);
const shipCam = new THREE.PerspectiveCamera();

const audio = new AudioEngine();
audio.vol = { music: settings.music, sfx: settings.sfx, amb: settings.amb };
audio.ticking = settings.tick;

let galaxy, sky, map, composer, bloom, cine, preview, warpFx, lens, dust, fleet, shipPass, fx;
const jumpRange = () => S.shipDef.jump * (S.flags && S.flags.iaraSaved ? 1.3 : 1);

// ------------------------------------------------------------------------------------------------
// Estado do jogo
// ------------------------------------------------------------------------------------------------
const S = {
  state: 'loading',
  shipDef: SHIPS[0], ship: null,
  anchor: 0, local: [0, 0, 0], quat: new THREE.Quaternion(),
  throttle: 0, speed: 0, angVel: new THREE.Vector3(), knock: new THREE.Vector3(), bumpShake: 0, vrise: 0, liftT: 0, gw: 0,
  sysIndex: -1, view: null,
  target: null, autopilot: false, align: false, lastStep: 0,
  frame: null, surf: null, si: null, env: null, hull: 100, dmgT: 10, landed: null, autoland: false, vdesc: 0,
  mode: 'ship', walker: null,
  cam: { mode: 'chase', yaw: 0, pitch: 0, zoom: 1, quat: new THREE.Quaternion() },
  warp: null, scan: null,
  visited: new Set(), scanned: {}, stats: { ly: 0, jumps: 0, time: 0 }, won: false,
  t: T0, flags: {},
  showLabels: true, showOrbits: true, hudHidden: false,
  prevState: null, mapSel: -1,
};
const keys = {};
const mouse = { x: 0, y: 0, steer: false, look: false, downX: 0, downY: 0, downT: 0, lastX: 0, lastY: 0 };

// ------------------------------------------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------------------------------------------
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const setLoading = (t) => { $('loading-text').textContent = t; };

async function init() {
  await nextFrame();
  galaxy = new Galaxy(2194);
  fleet = new Fleet(galaxy);
  setLoading('Pintando a Via Láctea…');
  await nextFrame();
  sky = new Sky(renderer, galaxy);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromCubemap(sky.cubeRT.texture).texture;
  scene.environmentIntensity = 6;
  setLoading('Calibrando sensores…');
  await nextFrame();
  map = new GalaxyMap(galaxy, renderer, $('maplabels'));
  setupComposer();
  setupWarpFx();
  setupDust();
  fx = new FlightFX(scene, SHIP_LAYER);
  setupPreview();
  bindUI();
  // Sistema Solar como cenário da tela de título
  loadSystem(0, false);
  placeAtEarth();
  S.view.update(S.t, S.local, camera, H);
  renderer.compile(scene, camera);
  if (localStorage.getItem(SAVE_KEY)) $('btn-continue').classList.remove('hidden');
  $('loading').classList.add('hidden');
  S.state = 'title';
  window.__UH = { S, sky, scene, camera, galaxy, map, renderer, composer, bloom, cine, audio, fleet, spawnShadow: () => spawnShadow() };
  requestAnimationFrame(loop);
}

function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio());
  composer.setSize(W, H);
  const skyPass = new RenderPass(sky.scene, sky.camera);
  const mainPass = new RenderPass(scene, camera);
  mainPass.clear = false;
  mainPass.clearDepth = true;
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.85, 0, 1.0);
  noBlockyBloom(bloom);
  cine = new ShaderPass(CinematicShader);
  lens = new ShaderPass(LensShader);
  lens.uniforms.tSky.value = sky.cubeRT.texture;
  lens.enabled = false;
  shipPass = new RenderPass(scene, shipCam);
  shipPass.clear = false;
  shipPass.clearDepth = true;
  composer.addPass(skyPass);
  composer.addPass(mainPass);
  composer.addPass(lens);
  composer.addPass(shipPass);
  composer.addPass(new ShaderPass(SanitizeShader));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(cine);
}

// Os níveis de 1/16 e 1/32 da resolução do bloom, ampliados, transformam pontos brilhantes em quadrados:
// zeramos esses níveis e deixamos o brilho largo por conta dos próprios shaders (glare das estrelas)
function noBlockyBloom(pass) {
  pass.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.8, 0.5, 0.12, 0.0];
  return pass;
}

function setupWarpFx() {
  const N = 1400;
  const pos = new Float32Array(N * 6), end = new Float32Array(N * 2), spd = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.6 + Math.pow(Math.random(), 0.6) * 9;
    const x = Math.cos(a) * r, y = Math.sin(a) * r, z = -Math.random() * 80;
    const s = 0.6 + Math.random();
    pos.set([x, y, z, x, y, z], i * 6);
    end.set([0, 1], i * 2);
    spd.set([s, s], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  const streaks = new THREE.LineSegments(g, streakMaterial());
  streaks.frustumCulled = false;
  streaks.renderOrder = 20;
  const tg = new THREE.CylinderGeometry(7, 7, 140, 64, 1, true);
  tg.rotateX(Math.PI / 2);
  const tunnel = new THREE.Mesh(tg, tunnelMaterial());
  tunnel.position.z = -60;
  tunnel.frustumCulled = false;
  tunnel.renderOrder = 19;
  const grp = new THREE.Group();
  grp.add(streaks, tunnel);
  grp.visible = false;
  camera.add(grp);
  warpFx = { grp, streaks, tunnel, level: 0 };
}

// Poeira interplanetária/interestelar em volta da nave: dá paralaxe e sensação de velocidade
function setupDust() {
  const N = 2400;
  const pos = new Float32Array(N * 6), end = new Float32Array(N * 2), seed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), s = Math.random();
    pos.set([x, y, z, x, y, z], i * 6);
    end.set([0, 1], i * 2);
    seed.set([s, s], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mesh = new THREE.LineSegments(g, dustMaterial());
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  dust = { mesh, off: new THREE.Vector3(), box: 1 };
}

function updateDust(dt) {
  const m = dust.mesh;
  m.visible = !!S.ship && !(S.warp && S.warp.phase === 'tunnel') && (S.state === 'play' || S.state === 'ending' || S.state === 'pause')
    && S.mode === 'ship' && !S.landed && !(S.env && S.env.rho > 0.002);
  if (!m.visible) return;
  const u = m.material.uniforms;
  const L = S.ship.length;
  const want = Math.max(S.speed * 2.5, L * 40);
  dust.box = dust.box < L ? want : dust.box * Math.exp(Math.log(want / dust.box) * (1 - Math.exp(-dt * 1.5)));
  const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat);
  dust.off.addScaledVector(fwd, S.lastStep / dust.box);
  dust.off.set(dust.off.x - Math.floor(dust.off.x), dust.off.y - Math.floor(dust.off.y), dust.off.z - Math.floor(dust.off.z));
  u.uOff.value.copy(dust.off);
  u.uBox.value = dust.box;
  u.uTrail.value.copy(fwd).multiplyScalar(Math.min(S.speed * 0.05, dust.box * 0.3) + dust.box * 0.002);
  u.uA.value = 0.3 * (S.view ? 1 : 0.7);
  if (S.view) u.uColor.value.copy(S.view.lightColor).multiplyScalar(0.85); else u.uColor.value.setRGB(0.65, 0.72, 0.9);
}

// Lente gravitacional do buraco negro do sistema atual (se houver)
const DISK = { cygx1: [1.0, 26], v404: [0.8, 20], a0620: [0.3, 16], sgra: [0.45, 13] };
function updateLens() {
  const it = S.view && S.view.bh;
  const u = lens.uniforms;
  if (!it || (S.warp && S.warp.phase === 'tunnel')) { lens.enabled = false; return; }
  const b = it.body;
  const rel = _v.copy(it.world).sub(camera.position);
  const D = rel.length() / b.rs;
  if (D > 2e6) { lens.enabled = false; return; }
  lens.enabled = true;
  u.uActive.value = 1;
  const inv = _q.copy(camera.quaternion).invert();
  u.uC.value.copy(rel).applyQuaternion(inv).normalize();
  u.uD.value = D;
  u.uTanH.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  u.uAspect.value = camera.aspect;
  u.uRes.value.set(W, H);
  u.uV2W.value.setFromMatrix4(camera.matrixWorld);
  u.uProj.value.copy(camera.projectionMatrix);
  u.uDiskN.value.set(-Math.sin(b.tilt), Math.cos(b.tilt), 0).applyQuaternion(inv);
  const dk = DISK[galaxy.realKey.get(S.sysIndex)] || [0, 18];
  u.uDisk.value = dk[0];
  u.uDiskOut.value = dk[1];
  u.uTime.value = elapsed;
}

function setupPreview() {
  const sc = new THREE.Scene();
  sc.background = sky.cubeRT.texture;
  sc.environment = scene.environment;
  sc.environmentIntensity = 4;
  const key = new THREE.DirectionalLight(0xfff0dd, 3.2); key.position.set(-1, 0.7, 0.9);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 2.2); rim.position.set(1, 0.3, -1);
  sc.add(key, rim, new THREE.AmbientLight(0x405070, 0.4));
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  const comp = new EffectComposer(renderer);
  comp.setPixelRatio(pixelRatio()); comp.setSize(W, H);
  comp.addPass(new RenderPass(sc, cam));
  comp.addPass(noBlockyBloom(new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0, 1.0)));
  comp.addPass(new OutputPass());
  cam.setViewOffset(W, H, -W * 0.17, 0, W, H);
  preview = { scene: sc, cam, comp, idx: 0, model: null, ang: 0.6 };
}

function showPreviewShip(idx) {
  preview.idx = (idx + SHIPS.length) % SHIPS.length;
  if (preview.model) preview.scene.remove(preview.model.group);
  const m = buildShip(SHIPS[preview.idx]);
  setShipScale(m.group, 1 / m.meters, m.meters);
  preview.scene.add(m.group);
  preview.model = m;
  UI.shipCard(SHIPS[preview.idx], preview.idx, SHIPS.length);
}

// ------------------------------------------------------------------------------------------------
// Sistemas e posição
// ------------------------------------------------------------------------------------------------
function loadSystem(i, announce = true) {
  unloadSystem();
  const sys = getSystem(galaxy, i);
  S.view = new SystemView(sys, scene);
  // posiciona os astros já agora: até o primeiro update, todos estão em (0,0,0) — em cima da nave —
  // e a checagem de perigo do mesmo quadro "via" a nave dentro do horizonte de um buraco negro
  S.view.update(S.t, S.local, camera, H);
  S.fv = new FleetView(scene, S.view, fleet, S);
  S.view.showOrbits = S.showOrbits;
  for (const b of sys.bodies) if (S.scanned[b.id]) b.scannedScore = S.scanned[b.id].score;
  S.sysIndex = i;
  const first = !S.visited.has(i);
  S.visited.add(i);
  if (announce) {
    const st = sys.star;
    UI.msg(`Sistema ${st.name} — ${st.spectral}, ${KIND_DESC[st.kind].toLowerCase()}. ${sys.planets.length ? sys.planets.length + ' planeta(s) detectado(s).' : 'Nenhum planeta detectado.'}`, first ? 'good' : '');
    if (sys.planets.some((p) => p.special === 'nova') && !S.flags.novaHint) {
      S.flags.novaHint = true;
      setTimeout(() => UI.msg('Comandante… a assinatura espectral deste sistema bate com o sinal da Vigia-7. Escaneie os planetas.', 'good'), 5000);
    }
  }
  if (S.state === 'play') renderer.compile(scene, camera);
  return first;
}

function unloadSystem() {
  dropSurface();
  S.frame = null; S.si = null; S.landed = null; S.autoland = false;
  if (S.mode === 'foot') leaveFoot();
  if (S.fv) { S.fv.dispose(); S.fv = null; }
  if (S.shadow) { S.shadow.dispose(); S.shadow = null; S.flags.shadowEscaped = true; S.shadowFled = true; }
  else if (S.flags.tupaLog && !S.flags.shadowSeen) S.flags.shadowEscaped = true; // saiu antes da emboscada
  if (S.view) { S.view.dispose(); S.view = null; }
  S.sysIndex = -1;
}

// ------------------------------------------------------------------------------------------------
// Referenciais: perto de um corpo a nave acompanha a órbita dele; perto da superfície, também a rotação
// ------------------------------------------------------------------------------------------------
const AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);
const _fq = new THREE.Quaternion(), _fq2 = new THREE.Quaternion(), _fv = new THREE.Vector3(), _fv2 = new THREE.Vector3();
function bodyItem(id) { return S.view ? S.view.items.find((it) => it.body.id === id) || null : null; }
// rotação: referencial fixo no planeta -> cena
function planetQuat(b, out = _fq) {
  out.setFromAxisAngle(AX_Z, b.tilt || 0);
  return out.multiply(_fq2.setFromAxisAngle(AX_Y, spinAngle(b, S.t)));
}
function frameApply() {
  const f = S.frame;
  if (!f) return;
  const it = bodyItem(f.id);
  if (!it) { S.frame = null; return; }
  const P = bodyPosition(it.body, S.t, [0, 0, 0]);
  const rel = _fv.set(f.rel[0], f.rel[1], f.rel[2]);
  if (f.rot) {
    rel.applyQuaternion(planetQuat(it.body));
    const sp = spinAngle(it.body, S.t);
    if (f.spin != null && S.mode === 'ship' && !S.landed) {
      let d = sp - f.spin;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      const axis = _fv2.set(0, 1, 0).applyAxisAngle(AX_Z, it.body.tilt || 0);
      const qd = new THREE.Quaternion().setFromAxisAngle(axis, d);
      S.quat.premultiply(qd); S.cam.quat.premultiply(qd);
    }
    f.spin = sp;
  }
  S.local = [P[0] + rel.x, P[1] + rel.y, P[2] + rel.z];
}
function frameStore() {
  const f = S.frame;
  if (!f) return;
  const it = bodyItem(f.id);
  if (!it) return;
  const P = bodyPosition(it.body, S.t, [0, 0, 0]);
  const rel = _fv.set(S.local[0] - P[0], S.local[1] - P[1], S.local[2] - P[2]);
  if (f.rot) rel.applyQuaternion(planetQuat(it.body).invert());
  f.rel = [rel.x, rel.y, rel.z];
}
let frameTimer = 0;
function frameChoose(dt) {
  frameTimer -= dt;
  if (frameTimer > 0) return;
  frameTimer = 0.2;
  if (!S.view) { S.frame = null; return; }
  if (S.landed || S.mode === 'foot') return;
  let best = null, bs = 1, bd = 0;
  for (const it of S.view.items) {
    const b = it.body;
    if (b.kind === 'star' || b.body === 'bh') continue;
    const d = Math.hypot(S.local[0] - it.pos[0], S.local[1] - it.pos[1], S.local[2] - it.pos[2]);
    const s = d / (b.radius * (b.kind === 'moon' ? 20 : 50));
    if (s < bs) { bs = s; best = it; bd = d; }
  }
  if (!best) { S.frame = null; return; }
  const R = best.body.radius, alt = bd - R;
  const cur = S.frame && S.frame.id === best.body.id ? S.frame : null;
  const rot = cur && cur.rot ? alt < R * 0.65 : alt < R * 0.55;
  if (cur && cur.rot === rot) return;
  S.frame = { id: best.body.id, rot, rel: [0, 0, 0], spin: null };
  frameStore();
  if (rot) S.frame.spin = spinAngle(best.body, S.t);
}

// Superfície detalhada do corpo rochoso em que estamos "em rotação"
function updateSurfaceCtx() {
  const f = S.frame;
  const it = f && f.rot ? bodyItem(f.id) : null;
  const want = it && it.body.body === 'rocky' ? it : null;
  if (S.surf && S.surf.item !== want) dropSurface();
  if (want && !S.surf) {
    want.surfaceOn = true;
    S.surf = { item: want, P: terrainParams(want.body), surface: new PlanetSurface(renderer, want), detail: null };
  }
}
function dropSurface() {
  if (!S.surf) return;
  S.surf.surface.dispose();
  if (S.surf.detail) S.surf.detail.dispose();
  if (S.surf.life) S.surf.life.dispose();
  S.surf.item.surfaceOn = false;
  S.surf = null;
}

// Altitude, chão e ambiente no ponto da nave (ou do jogador a pé)
function computeSI() {
  const f = S.frame;
  if (!f || !f.rot) { S.si = null; return null; }
  const it = bodyItem(f.id);
  if (!it) { S.si = null; return null; }
  const b = it.body;
  const r = Math.hypot(f.rel[0], f.rel[1], f.rel[2]);
  const dir = new THREE.Vector3(f.rel[0] / r, f.rel[1] / r, f.rel[2] / r);
  let ground = b.radius, h = null;
  if (S.surf && b.body === 'rocky') { h = heightAt(S.surf.P, dir.x, dir.y, dir.z); ground = b.radius + (h.water ? 0 : h.e); }
  S.si = { it, b, r, dir, h, ground, alt: r - ground, water: !!(h && h.water) };
  return S.si;
}

// Pressão (atm/bar), temperatura (K) e densidade relativa na altitude atual
function environment() {
  const si = S.si;
  if (!si) return (S.env = null);
  const b = si.b, alt = si.alt;
  let P = 0, T = 0, H = 8;
  if (b.body === 'gas') {
    H = clamp(27 * (b.temp / 165), 12, 80);
    P = Math.exp(-alt / H);
    T = b.temp * Math.pow(Math.max(P, 0.05), 0.19);
  } else {
    const g = b.gravity || 1;
    H = clamp((8.5 * (b.temp / 288)) / Math.max(g, 0.1), 3, 80);
    P = b.pressure * Math.exp(-Math.max(alt, 0) / H);
    if (b.pressure > 0.01) T = Math.max(b.temp - 6 * Math.max(alt, 0), b.temp * 0.55);
    else T = alt < 5 ? b.temp : 250;
    if (b.temp > 700 && b.pressure < 1) T = 300 + (b.temp - 300) * Math.exp(-Math.max(alt, 0) / 6); // calor irradiado do chão
  }
  S.env = { P, T, H, rho: P };
  return S.env;
}

function shipHalf() { return S.ship.length * 0.12; }
// Folga (km) entre o casco da nave e o de cada objeto da frota; calculada uma vez por quadro
const _rel = new THREE.Vector3(), _sc = new THREE.Vector3(), _n = new THREE.Vector3(), _n2 = new THREE.Vector3();
const FOOT_SPHERE = [{ c: new THREE.Vector3(), r: 0.001 }];
let fleetNear = null;
function fleetGap(o, out) {
  const base = _rel.set(S.local[0] - o.pos[0], S.local[1] - o.pos[1], S.local[2] - o.pos[2]);
  let gap = Infinity;
  const sph = S.mode === 'ship' && S.ship ? S.ship.spheres : FOOT_SPHERE;
  for (const sp of sph) {
    const c = _sc.copy(sp.c).applyQuaternion(S.quat).add(base);
    const g = S.fv.probe(o, c, sp.r, _n2);
    if (g < gap) { gap = g; if (out) out.copy(_n2); }
  }
  return gap;
}
function updateFleetProx() {
  fleetNear = null;
  if (!S.fv) return;
  S.fv.place(S.t);
  for (const o of S.fv.objs) {
    o.gap = fleetGap(o, _n);
    if (!fleetNear || o.gap < fleetNear.d) fleetNear = { o, d: o.gap, n: _n.clone() };
  }
}
function nearestFleet() { return fleetNear; }

// Batida contra uma nave da frota: empurra para fora, quica e causa dano conforme a velocidade de impacto
let bumpCd = 0;
function fleetContact(dt) {
  bumpCd -= dt;
  if (!S.fv || S.mode !== 'ship' || S.landed || !S.ship) return;
  for (const o of S.fv.objs) {
    if (!o.shape || o.gap > S.ship.length + 0.5) continue;
    const gap = fleetGap(o, _n);
    if (gap >= 0) continue;
    S.local[0] -= _n.x * gap; S.local[1] -= _n.y * gap; S.local[2] -= _n.z * gap;
    const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat);
    const head = -fwd.dot(_n); // 1 = de frente contra o casco
    const vn = fwd.multiplyScalar(S.speed).add(S.knock).dot(_n);
    if (vn >= 0) continue;
    S.knock.addScaledVector(_n, -vn * 1.35);
    S.speed *= 1 - clamp(head, 0, 1) * 0.85;
    S.autopilot = false;
    bump(-vn * 1000, o);
  }
}
function bump(ms, o) {
  S.bumpShake = Math.max(S.bumpShake, clamp(ms / 25, 0.15, 1));
  const j = clamp(ms / 40, 0.05, 0.6);
  S.angVel.x += (Math.random() - 0.5) * j; S.angVel.y += (Math.random() - 0.5) * j; S.angVel.z += (Math.random() - 0.5) * j * 2;
  if (bumpCd > 0 && ms < 4) return;
  bumpCd = 0.35;
  audio.clang(clamp(ms / 20, 0.2, 1.2));
  if (ms > 150) {
    destroyShip(`Batemos na ${o.name} a ${fmtNum(ms, 0)} m/s. Nenhum casco aguenta isso.`);
  } else if (ms > 4) {
    S.lastCause = `A colisão com a ${o.name} rompeu o casco.`;
    damage((ms - 4) * 0.7);
    cine.uniforms.uFlashC.value.set(1, 0.35, 0.2);
    cine.uniforms.uFlash.value = Math.max(cine.uniforms.uFlash.value, clamp(ms / 120, 0.08, 0.4));
    UI.msg(`Colisão com a ${o.name} a ${fmtNum(ms, 0)} m/s · casco ${fmtNum(S.hull, 0)}%`, 'warn', 'NAV');
  } else UI.msg(`Encostamos na ${o.name}.`, '', 'NAV');
}

// ------------------------------------------------------------------------------------------------
// Interação com a frota ([R] segurado) e Sombras
// ------------------------------------------------------------------------------------------------
let holdT = 0;
function interactable() {
  const nf = nearestFleet();
  if (!nf || nf.d > 30 || S.mode !== 'ship') return null;
  const o = nf.o;
  if (o.id === 'iara' && o.state === 'socorro') return { o, label: 'Transferir energia para a Iara', dur: 3.5, act: rescueIara };
  if (o.id === 'tupa' && !S.flags.tupaLog) return { o, label: 'Ler o registro de bordo da Tupã', dur: 2.5, act: readTupa };
  if (o.def && o.state === 'ok') return { o, label: `Falar com ${o.def.ia}`, dur: 0.6, act: () => chatFleet(o) };
  return null;
}
function updateInteract(dt) {
  const it = interactable();
  const bar = $('scanbar');
  if (it && keys.KeyR && !S.scan) {
    holdT += dt;
    bar.classList.remove('hidden');
    UI.setText('scanlabel', 'SEGURE [R]');
    UI.setText('scanname', it.label);
    $('scanfill').style.width = Math.min(100, (holdT / it.dur) * 100) + '%';
    if (holdT >= it.dur) { holdT = 0; bar.classList.add('hidden'); UI.setText('scanlabel', 'ESCANEANDO'); it.act(it.o); }
  } else if (holdT > 0) {
    holdT = 0;
    if (!S.scan) { bar.classList.add('hidden'); UI.setText('scanlabel', 'ESCANEANDO'); }
  }
}
function rescueIara(o) {
  S.flags.iaraSaved = true;
  o.state = 'ok';
  if (o.beacon) o.beacon.visible = false;
  audio.discovery();
  UI.say('MAÍRA', 'Núcleo religado! Obrigada, comandante. Estou mandando nossa célula de dobra reserva para vocês.', { prio: true });
  UI.say('LUMEN', `Célula instalada: nosso alcance de salto subiu 30%, para ${fmtNum(jumpRange(), 0)} anos-luz.`, { cls: 'good' });
  UI.say('MAÍRA', 'A Iara vai seguir para o sinal. Nos vemos lá. E… cuidado com o rádio.');
  // a Iara salta embora alguns segundos depois
  setTimeout(() => {
    if (!S.fv) return;
    const k = S.fv.objs.indexOf(o);
    if (k >= 0) { cine.uniforms.uFlash.value = 0.5; audio.warpJump(1); S.fv.scene.remove(o.group); S.fv.objs.splice(k, 1); if (S.target && S.target.id === 'iara') S.target = null; }
  }, 16000);
  save();
}
function readTupa() {
  S.flags.tupaLog = true;
  S.flags.lockT = Math.max(S.flags.lockT || 0, 12);
  audio.scanDone();
  UI.storyPanel('Registro de bordo — Tupã · IA ARANDU', TUPA_LOG, () => {
    UI.say('LUMEN', 'Os dados de triangulação da Tupã já estão nos meus sensores. Ela não morreu à toa.');
    // emboscada: algo estava esperando nos destroços
    setTimeout(() => { if (S.state === 'play' && S.view && S.view.sys.star.index === fleet.tupaStar) spawnShadow(); }, 5000);
  });
  save();
}
const CHAT = {
  esperanca: ['Mantenha o curso, comandante. A frota depende de quem chegar primeiro.', 'Silêncio de rádio ajuda. Elas ouvem.', 'Já contei as estrelas daqui até o sinal três vezes. É o que uma IA faz quando está com medo.'],
  iara: ['Ainda estamos aqui por sua causa.', 'As crianças a bordo deram um nome à sua nave. Não vou dizer qual — é constrangedor.'],
  aurora: ['Quarenta mil pessoas dormindo. Nenhuma delas sabe que chegamos. Ainda.'],
};
function chatFleet(o) {
  const lines = CHAT[o.id] || ['…'];
  UI.say(o.def.ia, lines[Math.floor(Math.random() * lines.length)]);
}
function spawnShadow() {
  if (!S.view || S.shadow || S.state !== 'play') return;
  const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
  S.shadow = new ShadowEncounter(scene, dir.multiplyScalar(1600));
  S.flags.shadowSeen = true;
  cine.uniforms.uFlashC.value.set(0.6, 0.3, 1.0); cine.uniforms.uFlash.value = 0.6;
  audio.alert(); audio.alert();
  UI.clearSubs();
  UI.say('LUMEN', 'Contato a 1.600 km… não aparece no radar. Comandante, é uma Sombra. SALTE AGORA — ou pouse e desligue os motores!', { prio: true, cls: 'warn' });
}
function updateShadow(dt) {
  const sh = S.shadow;
  if (!sh) return;
  const hide = !!S.landed || S.mode === 'foot';
  const dmg = sh.update(dt, elapsed, hide);
  if (dmg > 0) { S.lastCause = 'Uma Sombra cortou o casco ao meio. Nunca soubemos o que ela queria.'; damage(dmg * dt); cine.uniforms.uFlashC.value.set(0.7, 0.3, 1.0); cine.uniforms.uFlash.value = Math.max(cine.uniforms.uFlash.value, 0.15); }
  if (sh.state === 'partindo' && !S.shadowLeft) {
    S.shadowLeft = true;
    UI.say('LUMEN', 'Ela… perdeu o nosso rastro. Com os motores desligados, somos só mais uma pedra fria.', { cls: 'good' });
  }
  if (sh.gone) { sh.dispose(); S.shadow = null; S.shadowLeft = false; S.flags.shadowEscaped = true; save(); }
}
// teclas contextuais no centro da tela (o que dá para fazer agora)
let promptT = 0;
function updatePrompts(dt) {
  promptT -= dt;
  if (promptT > 0) return;
  promptT = 0.15;
  const L = [];
  if (S.shadow && S.shadow.state !== 'partindo') {
    L.push({ k: 'J', t: S.shadow.state === 'atacando' ? 'SALTE! O casco está sendo cortado' : `Saltar — ataque em ${S.shadow.secondsLeft} s`, danger: true });
    if (S.surf && S.si && S.si.alt < 80 && !S.landed) L.push({ k: 'P', t: 'Pousar e desligar os motores', danger: true });
    if (S.landed) L.push({ k: '…', t: `Escondidos: ${Math.max(0, Math.ceil(14 - S.shadow.hidden))} s`, danger: true });
  } else if (S.mode === 'foot') {
    const d = S.walker.pos.distanceTo(new THREE.Vector3(...S.landed.rel)) * 1000;
    if (d < S.ship.length * 700 + 25) L.push({ k: 'E', t: 'Voltar à nave' });
    L.push({ k: 'F', t: 'Coletar amostra' });
  } else if (S.landed) {
    if (!S.landed.water) L.push({ k: 'E', t: 'Desembarcar' });
    L.push({ k: 'W', t: 'Decolar · [Espaço] subir na vertical' });
  } else if (!S.warp) {
    const it = interactable();
    if (it) L.push({ k: 'R', t: it.label, hold: true });
    const ti = targetInfo();
    if (ti && ti.dLy != null) L.push({ k: 'J', t: ti.dLy <= jumpRange() ? `Saltar para ${ti.name}` : `Salto parcial rumo a ${ti.name}` });
    else if (ti && ti.it && ti.it.body.kind !== 'star' && !ti.fleet) {
      if (ti.dist > scanRange(ti.it.body)) L.push({ k: 'G', t: `Voar até ${ti.name}` });
      else if (ti.it.body.scannedScore == null) L.push({ k: 'F', t: `Escanear ${ti.name}` });
    } else if (ti && ti.fleet && !it) L.push({ k: 'G', t: `Voar até ${ti.name}` });
    if (S.gw > 0.5 && S.vrise < -0.004 && !S.autoland) L.push({ k: 'Espaço', t: 'Propulsores verticais (subir)' });
    if (S.surf && S.si && S.si.b.body === 'rocky' && S.si.alt < 80) L.push({ k: 'P', t: 'Pouso automático' });
    if (!ti && mission && mission.wp) L.push({ k: 'T', t: 'Marcar objetivo como destino' });
  }
  UI.prompts(L.slice(0, 3));
}

function shipGal(out = new THREE.Vector3()) {
  if (S.warp && S.warp.phase === 'tunnel') return out.copy(S.warp.gal);
  const i = S.anchor;
  return out.set(galaxy.px[i] + S.local[0] / KM_PER_LY, galaxy.py[i] + S.local[1] / KM_PER_LY, galaxy.pz[i] + S.local[2] / KM_PER_LY);
}

function lookQuat(dir, up = new THREE.Vector3(0, 1, 0)) {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function placeAtEarth() {
  const sys = getSystem(galaxy, 0);
  const terra = sys.planets.find((p) => p.special === 'terra');
  const p = bodyPosition(terra, S.t, [0, 0, 0]);
  const toSun = new THREE.Vector3(-p[0], -p[1], -p[2]).normalize();
  const side = new THREE.Vector3().crossVectors(toSun, new THREE.Vector3(0, 1, 0)).normalize();
  const off = toSun.clone().multiplyScalar(-0.78).add(side.multiplyScalar(0.62)).normalize().multiplyScalar(30000);
  off.y += 5000;
  S.anchor = 0;
  S.local = [p[0] + off.x, p[1] + off.y, p[2] + off.z];
  const toRem = off.clone().negate().normalize();
  const fwd = toRem.multiplyScalar(0.78).add(toSun.clone().multiplyScalar(0.22)).normalize();
  S.quat.copy(lookQuat(fwd));
  S.cam.quat.copy(S.quat);
  S.speed = 0; S.throttle = 0;
  if (S.view && S.sysIndex === 0) S.view.setSwarm(off);
}

function nearestSurface() {
  const nf = nearestFleet();
  if (nf && nf.d < 2000 && !S.si) return { dist: Math.max(nf.d, 0.002), item: null };
  if (S.si) return { dist: Math.max(S.si.alt - (S.mode === 'ship' && S.ship ? shipHalf() : 0), 0), item: S.si.it };
  if (S.view) {
    let best = Infinity, item = null;
    for (const it of S.view.items) {
      const dx = it.pos[0] - S.local[0], dy = it.pos[1] - S.local[1], dz = it.pos[2] - S.local[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - it.body.radius;
      if (d < best) { best = d; item = it; }
    }
    return { dist: best, item };
  }
  const g = shipGal();
  const n = galaxy.nearest(g.x, g.y, g.z);
  return { dist: n.dist * KM_PER_LY - galaxy.rad[n.index] * 695700, item: null };
}

// Troca a estrela de referência quando outra fica mais próxima; carrega/descarrega sistemas
let anchorTimer = 0;
function updateAnchor(dt) {
  anchorTimer -= dt;
  if (anchorTimer > 0) return;
  anchorTimer = 0.4;
  const g = shipGal();
  const n = galaxy.nearest(g.x, g.y, g.z);
  if (n.index !== S.anchor) {
    const a = S.anchor, b = n.index;
    S.local[0] += (galaxy.px[a] - galaxy.px[b]) * KM_PER_LY;
    S.local[1] += (galaxy.py[a] - galaxy.py[b]) * KM_PER_LY;
    S.local[2] += (galaxy.pz[a] - galaxy.pz[b]) * KM_PER_LY;
    S.anchor = b;
  }
  const d = Math.hypot(...S.local);
  if (!S.view && d < SYS_ENTER) loadSystem(S.anchor);
  else if (S.view && (S.sysIndex !== S.anchor || d > SYS_EXIT)) {
    const name = S.view.sys.star.name;
    unloadSystem();
    UI.msg(`Deixando o sistema ${name}. Espaço interestelar.`);
    if (d < SYS_ENTER) loadSystem(S.anchor);
  }
  // zona da bioassinatura
  const bz = galaxy.bioZone;
  if (!S.flags.bioEnter && Math.hypot(g.x - bz.x, g.y - bz.y, g.z - bz.z) < bz.r) {
    S.flags.bioEnter = true;
    UI.msg('Entramos na zona da bioassinatura da Vigia-7. O sinal vinha de uma estrela parecida com o Sol — tipo G ou K. Vou triangular a origem.', 'good');
    audio.discovery();
  }
  if (S.flags.bioEnter && !S.flags.signalLocked) {
    S.flags.lockT = (S.flags.lockT || 0) + 0.4;
    if (S.flags.lockT >= 20) {
      S.flags.signalLocked = true;
      const nt = galaxy.novaTerra;
      UI.msg(`Sinal triangulado! A bioassinatura vem de ${galaxy.name(nt)}, a ${fmtNum(galaxy.dist(nt, g.x, g.y, g.z), 1)} anos-luz. Pressione [T] para marcá-la como destino.`, 'good');
      audio.discovery();
      save();
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Alvos
// ------------------------------------------------------------------------------------------------
function targetItem() {
  if (!S.target || S.target.kind !== 'body' || !S.view) return null;
  return S.view.items.find((it) => it.body.id === S.target.id) || null;
}

function setTargetBody(id, align = true) {
  S.target = { kind: 'body', id };
  S.align = align;
  const it = targetItem();
  if (it) audio.click();
  if (!$('sysPanel').classList.contains('hidden')) UI.systemPanel(S.view, id, setTargetBody);
}

function setTargetStar(i) {
  if (S.view && i === S.sysIndex) { setTargetBody('star:' + i); return; }
  S.target = { kind: 'star', index: i };
  S.align = true;
  S.flags.targetStar = true;
  audio.click();
}

function fleetObj(id) { return S.fv ? S.fv.find(id) : null; }
function setTargetFleet(id, align = true) {
  S.target = { kind: 'fleet', id };
  S.align = align;
  audio.click();
}
function targetInfo() {
  if (!S.target) return null;
  if (S.target.kind === 'fleet') {
    const o = fleetObj(S.target.id);
    if (!o) { S.target = null; return null; }
    return {
      name: o.name, world: o.world.clone(), dist: Math.max(o.gap, 0), fleet: o,
      type: o.shadow ? 'Desconhecido · origem: Érebo' : `Frota da Diáspora · IA ${o.def.ia}${o.state === 'socorro' ? ' · SOCORRO' : o.state === 'destroco' ? ' · destroços' : ''}`,
    };
  }
  if (S.target.kind === 'body') {
    const it = targetItem();
    if (!it) { S.target = null; return null; }
    const b = it.body;
    return {
      name: b.name, world: it.world.clone(), dist: it.world.length() - b.radius,
      type: b.kind === 'star' ? `Estrela ${b.star.spectral}` : (TYPE_NAME[b.type] || b.type) + (b.scannedScore != null ? ` · ${b.scannedScore}% habitável` : ''),
      it,
    };
  }
  const i = S.target.index;
  const g = shipGal();
  const dLy = galaxy.dist(i, g.x, g.y, g.z);
  const dir = new THREE.Vector3(galaxy.px[i] - g.x, galaxy.py[i] - g.y, galaxy.pz[i] - g.z).normalize();
  return {
    name: galaxy.name(i), world: dir.multiplyScalar(1e12), dist: dLy * KM_PER_LY, dLy,
    type: `${galaxy.spectral(i)} · ${KIND_NAME[galaxy.kind[i]]}${galaxy.bh.has(i) ? ' · ● buraco negro' : ''}`, star: i,
  };
}

// ------------------------------------------------------------------------------------------------
// Voo
// ------------------------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function steerToward(dirWorld) {
  const d = _v.copy(dirWorld).normalize().applyQuaternion(_q.copy(S.quat).invert());
  let yaw = -d.x * 3, pitch = d.y * 3;
  if (d.z > 0) { yaw = d.x >= 0 ? -1 : 1; pitch = d.y * 2; }
  return { yaw: clamp(yaw, -1, 1), pitch: clamp(pitch, -1, 1), align: -d.z };
}

// Perto de um planeta a nave voa "como na Terra": há um em cima e um embaixo, ela nivela as asas com o
// horizonte, a guinada gira em torno da vertical local e, com os motores em baixa, a gravidade a puxa para baixo
function gravityWeight() {
  const si = S.si;
  if (!si || S.mode !== 'ship' || S.landed) return 0;
  const R = si.b.radius;
  return 1 - smoothstep(R * 0.1, R * 0.35, si.alt);
}
function surfGravity(b) { return b.gravity || b.mass / Math.pow(b.radius / 6371, 2); }
const _gv = new THREE.Vector3(), _gv2 = new THREE.Vector3();

function flight(dt) {
  const def = S.shipDef;
  if (S.landed) {
    // pousado: [W] / [Espaço] / propulsão decola
    S.speed = 0; S.angVel.set(0, 0, 0); S.knock.set(0, 0, 0); S.vrise = 0; S.gw = 0;
    if (keys.KeyW || keys.Space || S.throttle > 0.05) takeoff();
    return;
  }
  let yaw = 0, pitch = 0, roll = 0;
  const inv = settings.invert ? -1 : 1;
  let manual = false;
  if (mouse.steer) {
    const r = Math.min(W, H) / 2;
    let sx = (mouse.x - W / 2) / r, sy = (mouse.y - H / 2) / r;
    const m = Math.hypot(sx, sy);
    if (m > 0.035) {
      const k = Math.min(1, ((m - 0.035) / 0.6) * settings.steer) / m;
      yaw -= sx * k; pitch -= sy * k * inv;
      manual = true;
    }
  }
  if (keys.ArrowLeft || keys.KeyA) { yaw += 1; manual = true; }
  if (keys.ArrowRight || keys.KeyD) { yaw -= 1; manual = true; }
  if (keys.ArrowUp) { pitch += inv; manual = true; }
  if (keys.ArrowDown) { pitch -= inv; manual = true; }
  if (keys.KeyQ) { roll += 1; manual = true; }
  if (keys.KeyE) { roll -= 1; manual = true; }

  if (manual && S.autopilot) { S.autopilot = false; UI.msg('Piloto automático desligado.'); }
  if (manual) S.align = false;
  if (manual && S.autoland) { S.autoland = false; S.vdesc = 0; UI.msg('Pouso automático cancelado.'); }

  // Piloto automático / alinhamento para salto
  if (S.warp && S.warp.phase === 'charge') {
    const ti = targetInfo();
    if (ti) { const s = steerToward(ti.world); yaw = s.yaw; pitch = s.pitch; }
  } else if (S.autopilot) {
    const ti = targetInfo();
    if (ti && ti.fleet) {
      const s = steerToward(ti.world);
      yaw = s.yaw; pitch = s.pitch;
      S.throttle = s.align > 0.995 ? 1 : s.align > 0.95 ? 0.35 : 0;
      if (ti.dist < Math.max(0.15, ti.fleet.radius * 0.5)) { S.autopilot = false; S.throttle = 0; S.speed = 0; UI.msg(`Chegamos à ${ti.name}.`); audio.message(); }
    } else if (!ti || !ti.it) { S.autopilot = false; }
    else {
      const s = steerToward(ti.world);
      yaw = s.yaw; pitch = s.pitch;
      const b = ti.it.body;
      const stop = b.kind === 'star' ? b.radius * 12 : b.radius * (b.rings ? 3.2 : 2.2);
      S.throttle = s.align > 0.995 ? 1 : s.align > 0.95 ? 0.35 : 0;
      if (ti.dist < stop) {
        S.autopilot = false; S.throttle = 0;
        UI.msg(`Chegamos a ${b.name}.` + (b.kind !== 'star' && b.scannedScore == null ? ' Pressione [F] para escanear.' : ''));
        audio.message();
      }
    }
  } else if (S.align && !manual) {
    // a nave vira sozinha para o alvo recém-selecionado
    const ti = targetInfo();
    if (!ti) S.align = false;
    else {
      const s = steerToward(ti.world);
      yaw = s.yaw; pitch = s.pitch;
      if (s.align > 0.9995) S.align = false;
    }
  }

  const gw = (S.gw = gravityWeight());
  const upW = gw > 0 ? upWorld() : null;
  let level = 0;
  if (upW) {
    const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat);
    level = gw * (1 - smoothstep(0.85, 0.97, Math.abs(fwd.dot(upW)))); // apontando para o céu/chão não há "asas"
    if (!S.flags.gravTip && gw > 0.5 && S.state === 'play') {
      S.flags.gravTip = true;
      UI.msg(`Gravidade de ${S.si.b.name}: ${fmtNum(surfGravity(S.si.b), 2)} g. Agora há um em cima e um embaixo — a nave se nivela com o horizonte. Com os motores em baixa ela desce; [Espaço] liga os propulsores verticais.`);
    }
    // sem [Q]/[E] as asas voltam ao nível do horizonte; nas curvas a nave inclina para dentro
    if (!keys.KeyQ && !keys.KeyE && !S.autoland && level > 0) {
      const right = _gv.set(1, 0, 0).applyQuaternion(S.quat), up = _gv2.set(0, 1, 0).applyQuaternion(S.quat);
      const err = Math.atan2(right.dot(upW), up.dot(upW)) - yaw * 0.5;
      roll = clamp(-err * 2.5, -1, 1) * level;
    }
  }

  const turn = def.turn;
  if (S.autoland) { yaw = 0; pitch = 0; roll = 0; }
  const tgt = _v.set(pitch * turn, yaw * turn, roll * turn * 1.4);
  S.angVel.lerp(tgt, 1 - Math.exp(-dt * (2 + turn * 2.5)));
  // perto de um planeta a guinada gira em torno da vertical local (curva de avião, horizonte fixo)
  const yawW = upW ? S.angVel.y * level : 0;
  _q.setFromEuler(_e.set(S.angVel.x * dt, (S.angVel.y - yawW) * dt, S.angVel.z * dt, 'XYZ'));
  S.quat.multiply(_q);
  if (yawW) S.quat.premultiply(_q.setFromAxisAngle(upW, yawW * dt));
  S.quat.normalize();
  if (S.autoland) autoland(dt);

  if (!S.autopilot && !S.autoland && !(S.warp && S.warp.phase === 'charge')) {
    if (keys.KeyW) S.throttle = Math.min(1, S.throttle + dt * 0.45);
    if (keys.KeyS) S.throttle = Math.max(0, S.throttle - dt * 0.6);
  }
  const near = nearestSurface();
  let autoMax = clamp(near.dist * 0.75, near.dist < 3 ? 0.0015 : 0.02, def.maxC * C_KMS);
  // numa atmosfera o limitador respeita a densidade do ar (acima disso só com [Shift], e o casco esquenta)
  if (S.env && S.env.rho > 1e-6) autoMax = Math.min(autoMax, Math.max(0.3 / Math.sqrt(S.env.rho), S.si && S.si.b.body === 'gas' ? 0.6 : 0.05));
  // perto de uma nave da frota: aproximação lenta (30% da folga por segundo, mínimo 2 m/s), só indo na direção dela
  const nf = nearestFleet();
  if (nf && nf.d < 5 && !nf.o.shadow && nf.n.dot(_v.set(0, 0, -1).applyQuaternion(S.quat)) < 0.15) autoMax = Math.min(autoMax, Math.max(nf.d * 0.3, 0.002));
  const boost = keys.ShiftLeft || keys.ShiftRight ? 4 : 1;
  // [Shift] perto da superfície = forçar: o freio automático deixa de agir e a nave mantém a inércia
  const forcing = boost > 1 && S.si && S.si.alt < 60;
  S.forcing = forcing;
  const target = S.throttle * S.throttle * autoMax * boost;
  const rate = target < S.speed ? (forcing ? 0.35 : 6) : 1.6;
  S.speed += (target - S.speed) * (1 - Math.exp(-dt * rate));
  if (!forcing && S.speed > autoMax * boost) S.speed = autoMax * boost;
  if (S.speed < 1e-4 && target === 0) S.speed = 0;
  const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat);
  const step = S.speed * dt;
  S.lastStep = step;
  S.local[0] += fwd.x * step; S.local[1] += fwd.y * step; S.local[2] += fwd.z * step;
  S.stats.ly += step / KM_PER_LY;
  if (S.knock.lengthSq() > 1e-14) {
    S.local[0] += S.knock.x * dt; S.local[1] += S.knock.y * dt; S.local[2] += S.knock.z * dt;
    S.knock.multiplyScalar(Math.exp(-dt * 0.8));
  }
  // gravidade: motores em baixa e devagar = a nave desce (até ~12 m/s a 1 g); [Espaço] = propulsores verticais
  S.liftT = Math.max(0, S.liftT - dt);
  if (upW && !S.autoland) {
    const g = surfGravity(S.si.b);
    const support = Math.max(smoothstep(0.02, 0.08, S.speed), smoothstep(0.05, 0.3, S.throttle));
    const lift = keys.Space || S.liftT > 0;
    const want = lift ? 0.045 : -0.012 * Math.sqrt(Math.max(g, 0.05)) * (1 - support) * gw;
    S.vrise += (want - S.vrise) * (1 - Math.exp(-dt * (lift ? 1.2 : 0.3 + 0.35 * Math.max(g, 0.2))));
  } else S.vrise *= Math.exp(-dt * 2);
  if (upW && Math.abs(S.vrise) > 1e-7) {
    const k = S.vrise * dt;
    S.local[0] += upW.x * k; S.local[1] += upW.y * k; S.local[2] += upW.z * k;
  }
}

// ------------------------------------------------------------------------------------------------
// Pouso, decolagem e colisão com o solo
// ------------------------------------------------------------------------------------------------
// orientação nivelada (frente projetada no horizonte local), no referencial da cena
function levelQuat(upW) {
  const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat);
  fwd.addScaledVector(upW, -fwd.dot(upW));
  if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0).addScaledVector(upW, -upW.x);
  return lookQuat(fwd.normalize(), upW);
}
function upWorld() {
  return S.si ? S.si.dir.clone().applyQuaternion(planetQuat(S.si.b)) : new THREE.Vector3(0, 1, 0);
}
function requestAutoland() {
  if (S.landed) { takeoff(); return; }
  if (!S.surf || !S.si) { UI.msg('O pouso automático só funciona perto da superfície de um planeta ou lua rochosos.', 'warn'); return; }
  if (S.si.alt > 80) { UI.msg(`Desça abaixo de 80 km para o pouso automático (altitude: ${fmtDist(S.si.alt)}).`, 'warn'); return; }
  S.autoland = true; S.autopilot = false; S.align = false; S.throttle = 0;
  UI.msg(`Pouso automático em ${S.si.b.name}. Nivelando e descendo…`);
  audio.click();
}
function autoland(dt) {
  const si = S.si;
  if (!si || !S.surf) { S.autoland = false; return; }
  const upW = upWorld();
  S.quat.slerp(levelQuat(upW), 1 - Math.exp(-dt * 1.6));
  S.angVel.set(0, 0, 0);
  S.throttle = 0;
  S.speed *= Math.exp(-dt * 2.5);
  const alt = si.alt - shipHalf();
  S.vdesc = clamp(alt * 0.35, 0.0015, 0.8);
  const step = S.vdesc * dt;
  S.local[0] -= upW.x * step; S.local[1] -= upW.y * step; S.local[2] -= upW.z * step;
}
// Chão mais alto sob o casco (centro, proa, popa e laterais), no referencial do planeta: em terreno
// acidentado a nave apoia nos pontos altos em vez de afundar o nariz ou as asas no relevo
const _hg = new THREE.Vector3(), _hg2 = new THREE.Vector3(), _hg3 = new THREE.Vector3();
const HULL_PTS = [[0, 0], [0.42, 0], [-0.42, 0], [0, 0.22], [0, -0.22], [0.25, 0.15], [0.25, -0.15], [-0.25, 0.15], [-0.25, -0.15]];
function hullGround(dir, b) {
  const L = S.ship.length;
  const fwd = _hg.set(0, 0, -1).applyQuaternion(S.quat).applyQuaternion(_fq.copy(planetQuat(b)).invert());
  fwd.addScaledVector(dir, -fwd.dot(dir));
  if (fwd.lengthSq() < 1e-10) fwd.set(1, 0, 0).addScaledVector(dir, -dir.x);
  fwd.normalize();
  const right = _hg2.crossVectors(fwd, dir);
  let ground = -Infinity, water = false;
  for (const [a, c] of HULL_PTS) {
    const p = _hg3.copy(dir).multiplyScalar(b.radius).addScaledVector(fwd, a * L).addScaledVector(right, c * L).normalize();
    const h = heightAt(S.surf.P, p.x, p.y, p.z);
    if (a === 0 && c === 0) water = h.water;
    ground = Math.max(ground, b.radius + (h.water ? 0 : h.e));
  }
  return { ground, water };
}
function groundContact() {
  if (!S.surf || !S.frame || !S.frame.rot || S.landed || S.mode !== 'ship' || S.state !== 'play') return;
  const f = S.frame, b = S.surf.item.body;
  const r = Math.hypot(f.rel[0], f.rel[1], f.rel[2]);
  const dir = new THREE.Vector3(f.rel[0] / r, f.rel[1] / r, f.rel[2] / r);
  if (S.si && S.si.alt > 1) return; // bem acima do chão: dispensa as amostras
  const h = hullGround(dir, b);
  const ground = h.ground;
  const half = shipHalf();
  if (r - ground - half >= 0) return;
  const impact = Math.max(S.speed, S.vdesc, -S.vrise) * 1000; // m/s
  if (impact < 45) { land(dir, ground, h.water); return; }
  if (impact > 160) { destroyShip(`Colisão com ${h.water ? 'o oceano' : 'o solo'} de ${b.name} a ${fmtNum(impact * 3.6, 0)} km/h.`); return; }
  damage((impact - 45) * 0.9);
  const k = (ground + half + 0.003) / r;
  f.rel = [f.rel[0] * k, f.rel[1] * k, f.rel[2] * k];
  S.speed = 0; S.throttle = 0;
  UI.msg(`Impacto a ${fmtNum(impact * 3.6, 0)} km/h! Casco em ${Math.round(S.hull)}%. Desça mais devagar ou use [P].`, 'warn');
  audio.thud(1.5); audio.alert();
  cine.uniforms.uFlash.value = 0.3;
}
function land(dir, ground, water) {
  const b = S.surf.item.body;
  const up = dir.clone();
  const qInv = planetQuat(b).clone().invert();
  const fwd = _v.set(0, 0, -1).applyQuaternion(S.quat).applyQuaternion(qInv);
  fwd.addScaledVector(up, -fwd.dot(up));
  if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
  const q = lookQuat(fwd.normalize(), up);
  const pos = up.clone().multiplyScalar(ground + shipHalf() * (water ? 0.6 : 1));
  S.landed = { rel: [pos.x, pos.y, pos.z], q: q.toArray(), water, body: b.id };
  S.autoland = false; S.vdesc = 0; S.vrise = 0; S.speed = 0; S.throttle = 0; S.autopilot = false;
  audio.thud(1);
  const T = Math.round(b.temp - 273.15);
  UI.msg(water ? `Pousamos no oceano de ${b.name}. A nave flutua. [W] decola.`
    : `Pouso concluído em ${b.name}. Gravidade ${fmtNum(b.gravity || 0, 2)} g · ${T} °C · ${fmtNum(b.pressure, 3)} atm. [E] desembarcar · [W] decolar.`, 'good');
  if (!S.flags.firstLanding) { S.flags.firstLanding = true; S.stats.landings = (S.stats.landings || 0) + 1; }
  save();
}
function takeoff() {
  if (!S.landed) return;
  const L = S.landed;
  S.landed = null;
  const r = Math.hypot(...L.rel);
  const k = (r + shipHalf() * 2 + 0.004) / r;
  S.frame.rel = [L.rel[0] * k, L.rel[1] * k, L.rel[2] * k];
  frameApply();
  S.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25));
  S.cam.quat.copy(S.quat);
  S.throttle = Math.max(S.throttle, 0.12);
  S.vrise = 0.02; S.liftT = 2; // os propulsores verticais tiram a nave do chão
  UI.msg('Decolando.');
  audio.click();
}
// mantém a nave pousada presa ao chão (que gira com o planeta)
function holdLanded() {
  const L = S.landed;
  if (!L || !S.frame) return;
  const b = S.surf ? S.surf.item.body : null;
  if (!b) { S.landed = null; return; }
  let rel = L.rel;
  if (L.water) { const r = Math.hypot(...rel), k = (r + Math.sin(elapsed * 0.9) * 0.0003) / r; rel = rel.map((x) => x * k); }
  if (S.mode === 'ship') S.frame.rel = [...rel];
  S.quat.copy(planetQuat(b)).multiply(_fq2.fromArray(L.q));
}

// ------------------------------------------------------------------------------------------------
// Casco, perigos e destruição
// ------------------------------------------------------------------------------------------------
function damage(pct) {
  S.hull = Math.max(0, S.hull - pct);
  S.dmgT = 0;
  if (S.hull <= 0) destroyShip(S.lastCause || 'O casco cedeu.');
}
let hazardTxt = '';
function hazards(dt) {
  if (S.state !== 'play' || !S.view || !S.ship) { hazardTxt = ''; return; }
  S.dmgT += dt;
  let rate = 0, warn = '', heat = 0, fog = 0;
  const fogC = cine.uniforms.uFogC.value.set(0, 0, 0);
  // estrela
  const st = S.view.sys.star;
  const ds = Math.hypot(...S.local) / st.radius;
  if (ds < 1.02) return destroyShip(`A nave mergulhou na fotosfera de ${st.name}, a ${fmtNum(st.temp, 0)} K.`);
  if (ds < 5) {
    const Th = st.temp * Math.sqrt(1 / (2 * ds));
    rate += 30 * (5 - ds) / 4; warn = `TEMPERATURA DO CASCO ${fmtNum(Th - 273, 0)} °C`; S.lastCause = `O calor de ${st.name} derreteu o casco.`;
  }
  // buraco negro
  const bh = S.view.bh;
  if (bh) {
    const dr = bh.world.length() / bh.body.rs;
    if (dr < 2.6) return destroyShip(`Atravessamos o horizonte de eventos de ${bh.body.name.replace(' ●', '')}. Nada — nem a luz — volta de lá.`);
    if (dr < 12) { rate += (12 - dr) * 5; warn = 'FORÇA DE MARÉ EXTREMA'; S.lastCause = 'A força de maré esticou a nave até ela se desfazer (espaguetificação).'; }
  }
  const si = S.si, env = S.env;
  if (si && env && S.mode === 'ship') {
    const b = si.b;
    if (b.body === 'gas') {
      if (si.alt < 0) {
        const depth = -si.alt;
        fog = clamp(depth / 45, 0, 0.985);
        const a = b.visual.avg || [0.6, 0.5, 0.4];
        const lit = Math.exp(-depth / 90) * (S.view.lightColor ? 1 : 1);
        fogC.set(a[0] * lit * 0.9, a[1] * lit * 0.9, a[2] * lit * 0.9);
        warn = `PRESSÃO EXTERNA ${fmtNum(env.P, 1)} bar · ${fmtNum(env.T - 273, 0)} °C`;
        S.lastCause = `A pressão de ${fmtNum(env.P, 0)} bar dentro de ${b.name} esmagou a nave.`;
      }
      if (env.P > 10) rate += (env.P - 10) * 0.9;
    } else {
      if (env.P > 60) { rate += (env.P - 60) * 0.12; S.lastCause = `A pressão de ${fmtNum(env.P, 0)} atm em ${b.name} esmagou a nave.`; warn = `PRESSÃO EXTERNA ${fmtNum(env.P, 0)} atm`; }
      if (env.T > 650) { rate += (env.T - 650) / 40; S.lastCause = `A ${fmtNum(env.T - 273, 0)} °C, o casco derreteu sobre ${b.name}.`; warn = `TEMPERATURA EXTERNA ${fmtNum(env.T - 273, 0)} °C`; }
    }
    // reentrada: acima do limite seguro de velocidade para a densidade do ar
    if (env.rho > 1e-4 && !S.landed) {
      const vSafe = Math.max(0.3 / Math.sqrt(env.rho), 0.05);
      const k = S.speed / vSafe;
      heat = clamp((k - 1.05) / 1.5, 0, 1) * clamp(env.rho * 30, 0.2, 1);
      if (k > 2.2) { rate += (k - 2.2) * 9; warn = 'REENTRADA — CASCO SUPERAQUECIDO'; S.lastCause = `A nave se desintegrou na reentrada a ${fmtNum(S.speed, 1)} km/s.`; }
    }
  }
  if (S.forcing && si && si.b.body === 'rocky' && !S.landed) {
    const vDown = -_v.set(0, 0, -1).applyQuaternion(S.quat).dot(upWorld()) * S.speed * 1000;
    if (vDown > 45 && si.alt < 3) warn = warn || `ALERTA DE IMPACTO · DESCIDA A ${fmtNum(vDown * 3.6, 0)} km/h`;
  }
  if (rate > 0) damage(rate * dt);
  else if (S.dmgT > 4) S.hull = Math.min(100, S.hull + dt * 4);
  hazardTxt = warn;
  cine.uniforms.uFog.value += (fog - cine.uniforms.uFog.value) * (1 - Math.exp(-dt * 4));
  cine.uniforms.uHeat.value += (heat - cine.uniforms.uHeat.value) * (1 - Math.exp(-dt * 3));
  if (rate > 0 && performance.now() - (hazards.lastAlarm || 0) > 2500) { hazards.lastAlarm = performance.now(); audio.alert(); }
}

function destroyShip(cause) {
  if (S.state !== 'play') return;
  S.state = 'destroyed';
  S.hull = 0;
  S.autoland = false; S.autopilot = false; S.speed = 0; S.throttle = 0;
  if (S.warp && S.warp.stop) S.warp.stop(0.1);
  S.warp = null;
  if (S.mode === 'foot') leaveFoot();
  cine.uniforms.uFlashC.value.set(1.0, 0.55, 0.25);
  cine.uniforms.uFlash.value = 2.2;
  audio.explosion();
  S.ship.group.visible = false;
  $('hud').classList.add('hidden');
  UI.labels([]);
  closePanels();
  setTimeout(() => {
    $('d-cause').textContent = cause;
    $('destroyed').classList.remove('hidden');
  }, 2600);
}

// ------------------------------------------------------------------------------------------------
// Exploração a pé
// ------------------------------------------------------------------------------------------------
const EYE = 0.0017; // 1,7 m
function disembark() {
  if (!S.landed || !S.surf) { UI.msg('Pouse primeiro — [P] faz o pouso automático.', 'warn'); return; }
  if (S.landed.water) { UI.msg('Estamos boiando no oceano — não há onde pisar.', 'warn'); return; }
  const b = S.surf.item.body;
  const T = b.temp - 273.15;
  if (b.temp > 430) { UI.msg(`Lá fora faz ${fmtNum(T, 0)} °C. O traje não aguentaria nem um minuto.`, 'warn'); audio.alert(); return; }
  if (b.pressure > 15) { UI.msg(`A pressão lá fora é de ${fmtNum(b.pressure, 0)} atm — esmagaria o traje.`, 'warn'); audio.alert(); return; }
  if (b.temp < 30) { UI.msg(`${fmtNum(T, 0)} °C lá fora: frio além do limite do traje.`, 'warn'); audio.alert(); return; }
  const L = S.landed;
  const q = new THREE.Quaternion().fromArray(L.q);
  const up = new THREE.Vector3(...L.rel).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const off = S.ship.length * 0.45 + 0.004;
  const pos = new THREE.Vector3(...L.rel).addScaledVector(right, off);
  const d = pos.clone().normalize();
  const h = heightAt(S.surf.P, d.x, d.y, d.z);
  pos.copy(d).multiplyScalar(b.radius + (h.water ? 0 : h.e));
  // olhando de volta para a nave
  const basis = footBasis(d);
  const toShip = new THREE.Vector3(...L.rel).sub(pos);
  const yaw = Math.atan2(toShip.dot(basis.east), toShip.dot(basis.north));
  S.walker = { pos, vr: 0, yaw, pitch: 0.05, ground: true, stepT: 0 };
  S.mode = 'foot';
  S.frame.rel = [...pos.clone().addScaledVector(d, EYE).toArray()];
  if (canvas.requestPointerLock) try { canvas.requestPointerLock(); } catch (e) { /* sem bloqueio */ }
  const breath = b.o2 >= 0.16 && b.pressure > 0.5 && b.pressure < 3 && b.temp > 250 && b.temp < 320;
  UI.msg(breath ? 'O ar lá fora é respirável. Pela primeira vez desde a Terra, abrimos o capacete.'
    : `Traje pressurizado ativo. Atmosfera: ${b.atmoComp}. ${fmtNum(T, 0)} °C · gravidade ${fmtNum(b.gravity || 0, 2)} g.`, breath ? 'good' : '', 'TRAJE', 10000);
  if (b.special === 'nova' && !S.flags.novaWalk) {
    S.flags.novaWalk = true;
    setTimeout(() => { UI.msg('Grama sob as botas. Vento. Água correndo em algum lugar. Comandante… estamos em casa.', 'good', 'LUMEN', 14000); audio.discovery(); }, 2500);
  }
  audio.thud(0.4);
}
function leaveFoot() {
  S.mode = 'ship';
  S.walker = null;
  if (document.pointerLockElement) document.exitPointerLock();
}
function embark() {
  const W = S.walker, L = S.landed;
  if (!W || !L) return;
  const d = W.pos.distanceTo(new THREE.Vector3(...L.rel)) * 1000;
  const lim = S.ship.length * 1000 * 0.7 + 25;
  if (d > lim) { UI.msg(`A nave está a ${fmtNum(d, 0)} m. Chegue mais perto (menos de ${fmtNum(lim, 0)} m).`, 'warn'); return; }
  leaveFoot();
  S.frame.rel = [...L.rel];
  S.cam.mode = 'chase';
  UI.msg('De volta a bordo.');
  audio.click();
}
function footBasis(up) {
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
  if (north.lengthSq() < 1e-8) north.set(1, 0, 0).addScaledVector(up, -up.x);
  north.normalize();
  const east = new THREE.Vector3().crossVectors(north, up);
  return { north, east };
}
function walk(dt) {
  const W = S.walker;
  const b = S.surf.item.body;
  const up = W.pos.clone().normalize();
  const { north, east } = footBasis(up);
  const fwd = north.clone().multiplyScalar(Math.cos(W.yaw)).addScaledVector(east, Math.sin(W.yaw));
  const right = new THREE.Vector3().crossVectors(fwd, up);
  const mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const g = 9.81 * (b.gravity || 1);
  let r = W.pos.length();
  let h = heightAt(S.surf.P, up.x, up.y, up.z);
  const swim = h.water;
  let speed = (keys.ShiftLeft || keys.ShiftRight ? 5.5 : 1.7) * (swim ? 0.45 : 1);
  if (b.gravity < 0.4) speed *= 1.3; // passos saltados em gravidade baixa
  if (mz || mx) {
    const mv = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx).normalize().multiplyScalar((speed * dt) / 1000);
    W.pos.add(mv);
    W.stepT -= dt * speed;
    if (W.ground && W.stepT <= 0) { W.stepT = 0.75; audio.step(); }
  }
  const d = W.pos.clone().normalize();
  h = heightAt(S.surf.P, d.x, d.y, d.z);
  const ground = b.radius + (h.water ? -0.0013 : h.e);
  r = W.pos.length();
  if (W.ground && !h.water && r - ground < 0.0006 && W.vr === 0) r = ground; // acompanha descidas suaves
  else {
    W.vr -= g * dt;
    r += (W.vr * dt) / 1000;
    if (r <= ground) {
      if (W.vr < -6) audio.thud(Math.min(1, -W.vr / 15));
      r = ground; W.vr = 0; W.ground = true;
    } else W.ground = false;
  }
  if (h.water) { r = Math.max(r, ground); W.ground = true; }
  if (S.landed) {
    const L = S.landed, c = new THREE.Vector3(...L.rel);
    const ax = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().fromArray(L.q));
    const half = S.ship.length * 0.45, rad = S.ship.length * 0.13 + 0.0004;
    const t = clamp(W.pos.clone().sub(c).dot(ax), -half, half);
    const close = c.clone().addScaledVector(ax, t);
    const off = W.pos.clone().sub(close);
    off.addScaledVector(up, -off.dot(up));
    const dl = off.length();
    if (dl < rad) W.pos.addScaledVector(dl > 1e-9 ? off.divideScalar(dl) : right, rad - dl);
  }
  if (keys.Space && W.ground && !h.water) { W.vr = 3.2; W.ground = false; r += 0.00001; }
  W.pos.copy(d).multiplyScalar(r);
  W.speedNow = mz || mx ? speed : 0;
  S.frame.rel = W.pos.clone().addScaledVector(d, EYE).toArray();
}
function footCamera() {
  const W = S.walker, b = S.surf.item.body;
  const up = W.pos.clone().normalize();
  const { north, east } = footBasis(up);
  const fwd = north.clone().multiplyScalar(Math.cos(W.yaw)).addScaledVector(east, Math.sin(W.yaw));
  const look = fwd.multiplyScalar(Math.cos(W.pitch)).addScaledVector(up, Math.sin(W.pitch));
  const q = planetQuat(b);
  camera.position.set(0, 0, 0);
  camera.quaternion.copy(lookQuat(look.applyQuaternion(q), up.clone().applyQuaternion(q)));
  if (Math.abs(camera.fov - settings.fov) > 0.01) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  // a nave pousada, vista de fora
  const L = S.landed;
  S.ship.group.visible = true;
  S.ship.group.position.set(L.rel[0] - S.frame.rel[0], L.rel[1] - S.frame.rel[1], L.rel[2] - S.frame.rel[2]).applyQuaternion(q);
  S.ship.group.quaternion.copy(q).multiply(_fq2.fromArray(L.q));
}
function sampleGround() {
  const b = S.surf.item.body;
  const f = b.finds && b.finds.length ? b.finds[Math.floor(Math.random() * b.finds.length)] : null;
  const soil = b.type === 'gelo' ? 'gelo de água misturado a poeira' : b.type === 'deserto' || b.type === 'deserto_frio' ? 'areia fina rica em óxido de ferro' : b.life === 'complexa' ? 'solo orgânico, cheio de raízes' : 'rocha basáltica e regolito';
  UI.msg(`Amostra coletada: ${soil}.${f ? ' Relacionado: ' + f.toLowerCase() + '.' : ''}`, 'good', 'TRAJE', 9000);
  audio.scanDone();
}

// Faróis de pouso: acendem sozinhos no escuro perto do chão e iluminam o relevo, as pedras e a vegetação
let lampI = 0;
const lampLight = new THREE.SpotLight(0xffeedd, 0, 1, 0.6, 0.65, 0);
scene.add(lampLight, lampLight.target);
const _lp = new THREE.Vector3(), _ld = new THREE.Vector3(), _lu = new THREE.Vector3();
function landingLamp(dt, it) {
  const ship = S.ship && S.ship.group;
  const near = !!ship && S.state !== 'destroyed' && (S.landed || (S.mode === 'ship' && S.si && S.si.alt < 0.8));
  let want = 0;
  if (near) {
    _lu.copy(ship.position).sub(it.world).normalize();
    const elev = _ld.copy(S.view.items[0].world).sub(ship.position).normalize().dot(_lu);
    want = 1 - smoothstep(-0.08, 0.12, elev);
  }
  lampI += (want - lampI) * (1 - Math.exp(-dt * 3));
  if (lampI < 0.01) { lampLight.intensity = 0; return null; }
  const L = S.ship.length, r = Math.max(0.12, L * 6);
  const pos = _lp.set(0, -L * 0.12, -L * 0.45).applyQuaternion(ship.quaternion).add(ship.position);
  const dir = _ld.set(0, -0.75, -1).normalize().applyQuaternion(ship.quaternion);
  lampLight.position.copy(pos); lampLight.target.position.copy(pos).add(dir);
  lampLight.intensity = lampI * 3; lampLight.distance = r * 4;
  return { pos: pos.clone().applyMatrix4(camera.matrixWorldInverse), dir: dir.clone().transformDirection(camera.matrixWorldInverse), i: lampI * 2.2, r };
}

// Ambiente visual da superfície: céu, névoa, luz do dia
const _ev = new THREE.Vector3(), _ev2 = new THREE.Vector3();
function surfaceVisuals(dt) {
  let daylight = 0;
  if (S.surf && S.view) {
    const it = S.surf.item, b = it.body;
    const sunW = _ev.copy(S.view.items[0].world).sub(camera.position).normalize();
    const upW = _ev2.copy(camera.position).sub(it.world).normalize();
    const elev = sunW.dot(upW);
    const altCam = camera.position.distanceTo(it.world) - b.radius;
    const P0 = b.pressure || 0;
    const H = S.env ? S.env.H : 8;
    const rho = P0 * Math.exp(-Math.max(altCam, 0) / H);
    const day = smoothstep(-0.14, 0.12, elev);
    const atm = b.visual.atm;
    const sky = new THREE.Color(0, 0, 0);
    if (atm) {
      const r = atm.tauR, m = atm.tauM;
      sky.setRGB(r[0] + m[0] * 0.7, r[1] + m[1] * 0.7, r[2] + m[2] * 0.7);
      const mx = Math.max(sky.r, sky.g, sky.b, 1e-4);
      sky.multiplyScalar(1 / mx);
      const sunset = 1 - smoothstep(0.0, 0.3, elev);
      sky.lerp(new THREE.Color(1.0, 0.45, 0.2), sunset * 0.55 * day);
      sky.multiply(S.view.lightColor).multiplyScalar(day * Math.min(1, rho * 3) * 0.75);
    }
    const env = {
      sunView: sunW.clone().transformDirection(camera.matrixWorldInverse),
      sunWorld: S.view.items[0].world, sunCol: S.view.lightColor, sunI: it.mat.uniforms.uSunI.value,
      skyCol: sky, fogCol: sky.clone().multiplyScalar(0.9),
      fogK: 0.012 * rho * (b.type === 'nebuloso' ? 6 : b.type === 'venusiano' ? 3 : 1),
      day: Math.min(1, rho * 4), time: elapsed % 1000, cloudRot: (S.t * 0.002) % (Math.PI * 2),
    };
    it.group.updateMatrixWorld(true);
    const camPl = it.spin.worldToLocal(camera.position.clone());
    env.lamp = landingLamp(dt, it);
    S.surf.surface.update(camPl, camera, env);
    daylight = day * clamp(rho * 4, 0, 1);
    ambient.color.setRGB(0.19, 0.25, 0.35).lerp(sky, Math.min(1, daylight));
    ambient.intensity = 0.3 + 0.5 * daylight;
    // pedras e vegetação perto do chão
    const low = S.mode === 'foot' || (S.si && S.si.alt < 0.35);
    if (low && !S.surf.detail) S.surf.detail = new GroundDetail(it, S.surf.P);
    const here = S.mode === 'foot' ? S.walker.pos.clone().normalize() : S.si ? S.si.dir : null;
    if (S.surf.detail) {
      S.surf.detail.group.visible = low;
      if (low && here) S.surf.detail.update(here);
    }
    // grama, flores e fauna nos mundos com vida
    const lifeOk = b.life === 'complexa' && (S.mode === 'foot' || (S.si && S.si.alt < 0.15));
    if (lifeOk && !S.surf.life) S.surf.life = new LifeDetail(it, S.surf.P);
    if (S.surf.life) {
      S.surf.life.group.visible = lifeOk;
      if (lifeOk && here) { S.surf.life.update(here); S.surf.life.animate(dt, elapsed, here); }
      if (lifeOk && b.special === 'nova' && Math.random() < dt * 0.25) audio.chirp();
    }
    audio.setWind(Math.min(1, rho) * clamp((S.mode === 'foot' ? 3 : S.speed * 1000) / 250, 0.08, 1));
  } else {
    ambient.color.setRGB(0.19, 0.25, 0.35);
    audio.setWind(0);
    lampI = 0; lampLight.intensity = 0;
  }
  return daylight;
}

// Sombra no chão, poeira/respingos dos motores e o plasma da reentrada
let reentry = 0;
const _fxShip = new THREE.Vector3(), _fxRel = new THREE.Vector3(), _fxSun = new THREE.Vector3();
function updateFlightFx(dt) {
  const st = S.state;
  const on = !!S.ship && S.view && (st === 'play' || st === 'ending' || st === 'pause') && !(S.warp && S.warp.phase === 'tunnel');
  if (!on) { fx.hide(); reentry = 0; audio.setReentry(0); return; }
  if (st === 'pause') dt = 0;
  // reentrada: pressão dinâmica acima do que o limitador do ar permite (chegando rápido do espaço ou forçando com [Shift])
  const rho = S.env && S.mode === 'ship' && !S.landed ? S.env.rho : 0;
  const want = rho > 1e-5 ? smoothstep(0.34, 1.1, S.speed * Math.sqrt(rho)) : 0;
  reentry += (want - reentry) * (1 - Math.exp(-dt * (want > reentry ? 3 : 1.2)));
  if (reentry < 0.003) reentry = 0;
  audio.setReentry(reentry);
  const surf = S.surf && S.frame && S.frame.rot ? S.surf : null;
  const b = surf ? surf.item.body : null;
  const power = S.landed || S.mode !== 'ship' ? 0 : Math.max(S.throttle, S.autoland ? 0.5 : 0, S.vrise > 0.004 ? 1 : 0);
  fx.update(dt, {
    surf: surf && b.body === 'rocky' ? { P: surf.P, b } : null,
    q: b ? planetQuat(b).clone() : null,
    frameRel: _fxRel.set(...S.frame ? S.frame.rel : [0, 0, 0]),
    ship: _fxShip.set(...(S.landed ? S.landed.rel : S.frame ? S.frame.rel : [0, 0, 0])),
    shipQuat: S.ship.group.quaternion, shipScene: S.ship.group.position, L: S.ship.length,
    sunScene: _fxSun.copy(S.view.items[0].world).sub(S.ship.group.position).normalize(),
    power, lift: S.mode === 'ship' && S.gw > 0 && (keys.Space || S.liftT > 0), heat: reentry, time: elapsed, camera, H,
  });
}

// ------------------------------------------------------------------------------------------------
// Salto hiperespacial
// ------------------------------------------------------------------------------------------------
function requestJump() {
  if (S.warp) {
    if (S.warp.phase === 'charge') { S.warp.stop(0.3); S.warp = null; UI.msg('Salto cancelado.'); }
    return;
  }
  if (S.landed || S.mode === 'foot') { UI.msg('Decole antes de saltar — [W] ou [P].', 'warn'); audio.alert(); return; }
  if (S.env && S.env.rho > 1e-3) { UI.msg('Ainda estamos dentro da atmosfera. Suba mais antes de ligar o motor de salto.', 'warn'); audio.alert(); return; }
  const t = S.target;
  if (!t || t.kind !== 'star') {
    UI.msg('Nenhuma estrela de destino. Abra o mapa [M] ou clique numa estrela no céu.', 'warn');
    audio.alert();
    return;
  }
  const i = t.index;
  const g = shipGal();
  const d = galaxy.dist(i, g.x, g.y, g.z);
  const def = S.shipDef;
  if (S.view && i === S.sysIndex) { UI.msg('Já estamos neste sistema.', 'warn'); return; }
  S.autopilot = false;
  const partial = d > jumpRange();
  const hop = partial ? jumpRange() * 0.97 : d;
  const toPt = new THREE.Vector3(galaxy.px[i] - g.x, galaxy.py[i] - g.y, galaxy.pz[i] - g.z).setLength(hop).add(g);
  S.warp = { phase: 'charge', t: 0, dur: def.charge, target: i, from: g.clone(), dist: hop, partial, toPt, stop: audio.warpCharge(def.charge) };
  if (partial) UI.msg(`${galaxy.name(i)} está a ${fmtNum(d, 1)} al, além do alcance (${fmtNum(jumpRange(), 0)} al). Salto parcial: ${fmtNum(hop, 1)} al nessa direção. [J] cancela.`);
  else UI.msg(`Carregando o motor de salto… destino: ${galaxy.name(i)}, ${fmtNum(d, 2)} anos-luz. [J] cancela.`);
  $('warpinfo').classList.remove('hidden');
}

function updateWarp(dt) {
  const w = S.warp;
  if (!w) { warpFx.level = Math.max(0, warpFx.level - dt * 2); return; }
  w.t += dt;
  if (w.phase === 'charge') {
    const p = w.t / w.dur;
    $('warpinfo').innerHTML = `CARREGANDO SALTO<div class="big">${Math.round(p * 100)}%</div>`;
    S.throttle = 0;
    if (w.t >= w.dur) {
      w.stop(0.1);
      w.phase = 'tunnel';
      w.t = 0;
      w.dur = 4 + Math.min(4, Math.log10(1 + w.dist) * 1.8);
      const to = w.partial ? w.toPt.clone() : new THREE.Vector3(galaxy.px[w.target], galaxy.py[w.target], galaxy.pz[w.target]);
      w.to = to;
      w.gal = w.from.clone();
      w.dir = to.clone().sub(w.from).normalize();
      S.quat.copy(lookQuat(w.dir, new THREE.Vector3(0, 1, 0).applyQuaternion(S.quat)));
      unloadSystem();
      audio.warpJump(w.dur);
      audio.duck(true);
      cine.uniforms.uFlash.value = 0.8;
      $('warpinfo').innerHTML = `${w.partial ? 'SALTO PARCIAL' : 'EM DOBRA'}<div class="big">${galaxy.name(w.target).toUpperCase()}</div>`;
    }
  } else {
    const p = clamp(w.t / w.dur, 0, 1);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    w.gal.copy(w.from).lerp(w.to, e);
    warpFx.level = Math.min(1, w.t / 0.6) * Math.min(1, (w.dur - w.t) / 0.9);
    if (w.t >= w.dur) arrive();
  }
}

function arrive() {
  const w = S.warp;
  const i = w.target;
  S.speed = 0; S.throttle = 0; S.knock.set(0, 0, 0); S.vrise = 0;
  S.stats.jumps++;
  S.warp = null;
  warpFx.level = 0;
  $('warpinfo').classList.add('hidden');
  cine.uniforms.uFlash.value = 1;
  audio.arrive();
  audio.duck(false);
  if (w.partial) {
    // chegada no espaço interestelar: a referência passa a ser a estrela mais próxima
    const n = galaxy.nearest(w.to.x, w.to.y, w.to.z);
    S.anchor = n.index;
    S.local = [(w.to.x - galaxy.px[n.index]) * KM_PER_LY, (w.to.y - galaxy.py[n.index]) * KM_PER_LY, (w.to.z - galaxy.pz[n.index]) * KM_PER_LY];
    anchorTimer = 0;
    S.flags.firstJump = true;
    const left = galaxy.dist(i, w.to.x, w.to.y, w.to.z);
    UI.msg(`Salto parcial concluído. Faltam ${fmtNum(left, 1)} al até ${galaxy.name(i)}. ${left <= jumpRange() ? 'Já está ao alcance — [J] de novo.' : 'Pressione [J] para o próximo salto.'}`);
    save();
    return;
  }
  const L = galaxy.lum[i], R = galaxy.rad[i] * 695700;
  const dist = Math.max(R * 60, Math.sqrt(L) * 2.2 * KM_PER_AU, 0.15 * KM_PER_AU);
  S.anchor = i;
  S.local = [-w.dir.x * dist, -w.dir.y * dist, -w.dir.z * dist];
  S.target = { kind: 'body', id: 'star:' + i };
  const bh = getSystem(galaxy, i).bodies.find((b) => b.body === 'bh');
  if (bh) {
    // sistemas com buraco negro: chegamos perto dele, com o buraco negro à frente
    const p = bodyPosition(bh, S.t, [0, 0, 0]);
    const dd = bh.rs * 700;
    S.local = [p[0] - w.dir.x * dd, p[1] - w.dir.y * dd, p[2] - w.dir.z * dd];
    S.target = { kind: 'body', id: bh.id };
  }
  loadSystem(i);
  if (S.shadowFled) {
    S.shadowFled = false;
    setTimeout(() => UI.say('LUMEN', 'Conseguimos. Ela não nos seguiu… desta vez.', { cls: 'good' }), 2500);
  }
  if (S.flags.tupaLog && i !== 0 && i !== galaxy.novaTerra && i !== fleet.tupaStar && Math.random() < 0.07) setTimeout(spawnShadow, 9000);
  if (bh) setTimeout(() => UI.msg(`À frente: ${bh.name.replace(' ●', '')}, um buraco negro de ${fmtNum(bh.massSun, bh.massSun > 1000 ? 0 : 1)} massas solares. Repare como ele curva a luz das estrelas atrás dele. [F] escaneia.`, 'good'), 2500);
  save();
  if (!S.flags.firstJump) {
    S.flags.firstJump = true;
    setTimeout(() => UI.msg('Primeiro salto concluído. Use [Tab] para ver os planetas deste sistema e [G] para voar até eles.'), 4000);
  }
}

// ------------------------------------------------------------------------------------------------
// Scanner
// ------------------------------------------------------------------------------------------------
function scanRange(b) { return Math.max(b.radius * 150, 200000); }

function requestScan() {
  if (S.mode === 'foot') { sampleGround(); return; }
  if (!$('scanPanel').classList.contains('hidden')) { $('scanPanel').classList.add('hidden'); return; }
  if (S.scan) return;
  if (!S.view) { UI.msg('Nenhum planeta ao alcance dos sensores.', 'warn'); return; }
  let it = targetItem();
  if (!it || it.body.kind === 'star') {
    let bd = Infinity;
    for (const x of S.view.items) {
      if (x.body.kind === 'star') continue;
      const d = (x.world.length() - x.body.radius) / scanRange(x.body);
      if (d < bd) { bd = d; it = x; }
    }
  }
  if (!it || it.body.kind === 'star') { UI.msg('Este sistema não tem planetas.', 'warn'); return; }
  const b = it.body;
  const d = it.world.length() - b.radius;
  if (d > scanRange(b)) {
    UI.msg(`${b.name} está longe demais para o scanner (${fmtDist(d)}). Aproxime-se a menos de ${fmtDist(scanRange(b))} — use [G].`, 'warn');
    S.target = { kind: 'body', id: b.id };
    audio.alert();
    return;
  }
  S.scan = { it, t: 0, dur: 3.2 };
  $('scanbar').classList.remove('hidden');
  $('scanname').textContent = b.name;
  audio.scanStart();
}

function updateScan(dt) {
  const sc = S.scan;
  if (!sc) return;
  if (!S.view || !S.view.items.includes(sc.it)) { S.scan = null; $('scanbar').classList.add('hidden'); return; }
  sc.t += dt;
  $('scanfill').style.width = Math.min(100, (sc.t / sc.dur) * 100) + '%';
  const b = sc.it.body;
  if (sc.it.world.length() - b.radius > scanRange(b) * 1.3) {
    S.scan = null; $('scanbar').classList.add('hidden');
    UI.msg('Varredura interrompida — saímos do alcance.', 'warn');
    return;
  }
  if (sc.t >= sc.dur) {
    S.scan = null;
    $('scanbar').classList.add('hidden');
    const star = S.view.sys.star;
    b.scannedScore = b.hab.score;
    const first = !S.scanned[b.id];
    S.scanned[b.id] = { name: b.name, system: star.name, type: b.type, score: b.hab.score };
    if (b.special === 'terra') S.flags.scannedTerra = true;
    else if (b.body === 'bh') S.flags.bhScanned = true;
    else if (S.sysIndex !== 0) S.flags.scannedExo = true;
    if (b.body === 'bh') UI.bhPanel(b, sc.it.world.length());
    else UI.scanPanel(b, star, remarkFor(b, star));
    audio.scanDone();
    if (first && b.hab.score >= 60 && b.hab.score < 90) audio.discovery();
    save();
    if ((b.special === 'nova' || b.hab.score >= 90) && !S.won) {
      S.won = true;
      save();
      audio.discovery();
      setTimeout(() => {
        audio.discovery();
        S.state = 'ending';
        $('hud').classList.add('hidden');
        $('scanPanel').classList.add('hidden');
        UI.ending(b, S, () => { $('ending').classList.add('hidden'); S.state = 'play'; $('hud').classList.toggle('hidden', S.hudHidden); }, () => toMenu());
      }, 6000);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Câmera
// ------------------------------------------------------------------------------------------------
let speedFov = 0;
const _look = new THREE.Quaternion(), _tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.07), _cq = new THREE.Quaternion();
function updateCamera(dt) {
  const L = S.ship.length;
  const cockpit = S.cam.mode === 'cockpit';
  let want = S.quat;
  // perto de um planeta a câmera externa acompanha a nave mas mantém o horizonte quase reto
  if (!cockpit && S.gw > 0) {
    const f = _v.set(0, 0, -1).applyQuaternion(S.quat), up = upWorld();
    if (Math.abs(f.dot(up)) < 0.97) want = _cq.copy(S.quat).slerp(lookQuat(f, up), S.gw * 0.7);
  }
  S.cam.quat.slerp(want, 1 - Math.exp(-dt * (cockpit ? 40 : 4.5)));
  _look.setFromEuler(_e.set(S.cam.pitch, S.cam.yaw, 0, 'YXZ'));
  if (S.cam.intro) {
    S.cam.zoom += (1 - S.cam.zoom) * (1 - Math.exp(-dt * 0.35));
    if (Math.abs(S.cam.zoom - 1) < 0.01) S.cam.intro = false;
  }
  if (cockpit) {
    camera.position.copy(S.ship.cockpit).applyQuaternion(S.quat);
    camera.quaternion.copy(S.quat).multiply(_look);
  } else {
    const off = _v.set(0, L * 0.2, L * 1.9 * S.cam.zoom).applyQuaternion(_look).applyQuaternion(S.cam.quat);
    camera.position.copy(off);
    camera.quaternion.copy(S.cam.quat).multiply(_look).multiply(_tilt);
  }
  S.ship.group.visible = !cockpit && S.state !== 'destroyed';
  // a câmera externa não entra no chão e sobe se um morro ficar entre ela e a nave
  if (!cockpit && S.surf && S.frame && S.frame.rot && S.si && S.si.alt < 3) {
    const b = S.surf.item.body;
    const q = planetQuat(b), qi = q.clone().invert();
    const ship = _fv.set(...S.frame.rel);
    const cp = camera.position.clone().applyQuaternion(qi).add(ship);
    const up = cp.clone().normalize();
    let lift = 0;
    for (const k of [1, 0.75, 0.5, 0.3]) {
      const p = ship.clone().lerp(cp, k), r = p.length(), d = p.divideScalar(r);
      const h = heightAt(S.surf.P, d.x, d.y, d.z);
      const deficit = b.radius + (h.water ? 0 : h.e) + 0.0015 - r;
      if (deficit > 0) lift = Math.max(lift, deficit / k);
    }
    if (lift > 0) camera.position.addScaledVector(up.applyQuaternion(q), lift);
  }
  if (!cockpit) cameraOutsideFleet();
  let shake = S.bumpShake;
  S.bumpShake *= Math.exp(-dt * 4);
  if (S.warp) shake = Math.max(shake, S.warp.phase === 'charge' ? (S.warp.t / S.warp.dur) * 0.5 : 0.25 * warpFx.level);
  if (shake > 0) camera.position.add(_v.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(L * 0.02 * shake));
  // o ar sacode a câmera (turbulência e plasma da reentrada) e o campo de visão abre um pouco com a velocidade
  const rho = S.env && S.mode === 'ship' && !S.landed ? Math.min(S.env.rho, 1.5) : 0;
  const turb = rho * smoothstep(0.03, 0.4, S.speed) * 0.35 + reentry * 1.2;
  if (turb > 0.005) {
    const t = elapsed;
    camera.position.add(_v.set(Math.sin(t * 13.1) + 0.5 * Math.sin(t * 23.7), Math.sin(t * 11.3 + 1) + 0.5 * Math.sin(t * 19.1), 0).applyQuaternion(camera.quaternion).multiplyScalar(L * 0.006 * turb));
  }
  const fovWant = S.landed ? 0 : 6 * smoothstep(2.3, 4.6, Math.log10(1 + S.speed * 1000));
  speedFov += (fovWant - speedFov) * (1 - Math.exp(-dt * 1.5));
  const fov = settings.fov + speedFov + warpFx.level * 32 + (S.warp && S.warp.phase === 'charge' ? -4 * (S.warp.t / S.warp.dur) : 0);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// a câmera externa recua em direção à nave se ficaria dentro do casco de outra nave
function cameraOutsideFleet() {
  if (!S.fv || !fleetNear || fleetNear.d > S.ship.length * 3) return;
  const o = fleetNear.o;
  const at = (k) => S.fv.probe(o, _sc.copy(camera.position).multiplyScalar(k).add(_rel.set(S.local[0] - o.pos[0], S.local[1] - o.pos[1], S.local[2] - o.pos[2])), 0.002, _n2);
  if (at(1) > 0) return;
  let lo = 0, hi = 1;
  for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (at(m) > 0) lo = m; else hi = m; }
  camera.position.multiplyScalar(lo);
}

function syncShipCam() {
  shipCam.copy(camera, false);
  shipCam.layers.set(SHIP_LAYER);
  shipCam.updateMatrixWorld();
}

// ------------------------------------------------------------------------------------------------
// Luz, céu e HUD
// ------------------------------------------------------------------------------------------------
function updateLighting() {
  if (S.view) {
    const sw = S.view.items[0].world;
    const dStar = sw.length();
    sun.position.copy(sw).normalize();
    const flux = S.view.sys.star.lum / Math.pow(dStar / KM_PER_AU, 2);
    let I = 2.6 * clamp(Math.pow(flux, 0.15), 0.25, 1.4);
    // eclipse: algum planeta entre a nave e a estrela?
    const dir = _v.copy(sw).normalize();
    for (let k = 1; k < S.view.items.length; k++) {
      const it = S.view.items[k];
      const t = it.world.dot(dir);
      if (t <= 0 || t > dStar) continue;
      const d2 = it.world.lengthSq() - t * t;
      if (d2 < it.body.radius * it.body.radius) { I *= 0.03; break; }
    }
    sun.intensity = I;
    sun.color.copy(S.view.lightColor);
    ambient.intensity = 0.3;
  } else {
    const g = shipGal();
    const i = S.anchor;
    sun.position.set(galaxy.px[i] - g.x, galaxy.py[i] - g.y, galaxy.pz[i] - g.z).normalize();
    sun.intensity = 0.5;
    sun.color.setRGB(...galaxy.color(i));
    ambient.intensity = 0.45;
  }
}

const _p = new THREE.Vector3();
// "atrás da câmera" é decidido no espaço da câmera: com near = 1e-5 e far = 1e14, o z projetado de
// alvos muito distantes vale exatamente 1 e o teste z > 1 falhava — o marcador aparecia espelhado atrás
function project(world) {
  _p.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const behind = _p.z >= 0;
  _p.applyMatrix4(camera.projectionMatrix);
  return { x: ((_p.x + 1) / 2) * W, y: ((1 - _p.y) / 2) * H, behind, on: !behind && Math.abs(_p.x) <= 1 && Math.abs(_p.y) <= 1 };
}

let hudTimer = 0;
function updateHUD(dt) {
  UI.throttle(S.throttle);
  const c = S.speed / C_KMS;
  if (S.mode === 'foot') {
    UI.setText('h-speed', fmtNum(S.walker.speedNow || 0, 1) + ' m/s');
    UI.setText('h-mode', 'A PÉ' + (S.si && S.si.water ? ' · NADANDO' : ''));
  } else {
    UI.setText('h-speed', fmtSpeed(S.warp && S.warp.phase === 'tunnel' ? S.warp.dist / S.warp.dur * KM_PER_LY : S.speed));
    UI.setText('h-mode', S.landed ? 'POUSADO' : S.autoland ? 'POUSO AUTOMÁTICO' : S.warp && S.warp.phase === 'tunnel' ? 'DOBRA HIPERESPACIAL' : S.si && S.env && S.env.rho > 1e-4 ? 'VOO ATMOSFÉRICO' : c < 0.1 ? 'SUBLUMÍNICO' : c < 1 ? 'RELATIVÍSTICO' : 'SUPERLUMÍNICO');
  }
  // casco e alertas
  const hf = $('hull-fill');
  hf.style.width = S.hull.toFixed(0) + '%';
  hf.style.background = S.hull > 60 ? 'var(--good)' : S.hull > 30 ? 'var(--warn)' : 'var(--bad)';
  UI.setText('hull-txt', Math.round(S.hull) + '%');
  $('hazard').classList.toggle('hidden', !hazardTxt);
  if (hazardTxt) UI.setText('hazard', '⚠ ' + hazardTxt);
  $('h-ap').classList.toggle('hidden', !S.autopilot);
  UI.steer(W / 2, H / 2, mouse.x, mouse.y, mouse.steer && S.state === 'play');
  updateHorizon(dt);

  // marcador do alvo
  const ti = targetInfo();
  $('hud-tr').classList.toggle('hidden', !ti);
  if (S.mode === 'foot') {
    const pr = project(S.ship.group.position);
    const dShip = S.walker.pos.distanceTo(new THREE.Vector3(...S.landed.rel)) * 1000;
    if (pr.on) { UI.marker(pr.x, pr.y, true, `NAVE · ${fmtNum(dShip, 0)} m`); UI.arrow(0, 0, 0, false); }
    else {
      UI.marker(0, 0, false);
      let dx = pr.x - W / 2, dy = pr.y - H / 2;
      if (pr.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx), r = Math.min(W, H) * 0.42;
      UI.arrow(W / 2 + Math.cos(ang) * r, H / 2 + Math.sin(ang) * r, ang, true);
    }
  } else if (ti) {
    const pr = project(ti.world);
    if (pr.on) { UI.marker(pr.x, pr.y, true, ti.name); UI.arrow(0, 0, 0, false); }
    else {
      UI.marker(0, 0, false);
      let dx = pr.x - W / 2, dy = pr.y - H / 2;
      if (pr.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx);
      const r = Math.min(W, H) * 0.42;
      UI.arrow(W / 2 + Math.cos(ang) * r, H / 2 + Math.sin(ang) * r, ang, true);
    }
  } else { UI.marker(0, 0, false); UI.arrow(0, 0, 0, false); }

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    const g = shipGal();
    if (S.view) {
      const st = S.view.sys.star;
      UI.setText('h-sys', st.name);
      UI.setText('h-sys2', `${st.spectral} · ${KIND_NAME[st.kind]} · ${S.view.sys.planets.length} planeta(s)`);
      const n = S.view.nearestSurface();
      if (S.view.bh) {
        const bh = S.view.bh.body, r = S.view.bh.world.length();
        const f = Math.sqrt(Math.max(1 - bh.rs / r, 1e-9));
        UI.setText('h-loc', `${bh.name.replace(' ●', '')} — ${fmtDist(r)} · 1 s a bordo = ${fmtNum(1 / f, 1 / f < 1.01 ? 4 : 2)} s lá fora`);
      } else UI.setText('h-loc', n.item ? `Mais próximo: ${n.item.body.name} — ${fmtDist(n.dist)}` : '—');
    } else {
      UI.setText('h-sys', S.warp && S.warp.phase === 'tunnel' ? 'Hiperespaço' : 'Espaço interestelar');
      const n = galaxy.nearest(g.x, g.y, g.z);
      UI.setText('h-sys2', `Estrela mais próxima: ${galaxy.name(n.index)}`);
      UI.setText('h-loc', `a ${fmtNum(n.dist, 3)} anos-luz`);
    }
    UI.setText('h-home', `Distância do Sol: ${fmtNum(g.length(), 2)} al`);
    // painel de superfície
    const si = S.si;
    $('surfbox').classList.toggle('hidden', !si);
    if (si) {
      const b = si.b, env = S.env || { P: 0, T: b.temp };
      UI.setText('s-name', b.name);
      if (S.mode === 'foot') {
        const dShip = S.walker.pos.distanceTo(new THREE.Vector3(...S.landed.rel)) * 1000;
        UI.setText('s-alt', `Nave a ${fmtNum(dShip, 0)} m`);
        UI.setText('s-act', dShip < S.ship.length * 700 + 25 ? '[E] voltar à nave · [F] coletar amostra' : 'WASD andar · Shift correr · Espaço pular · [F] amostra');
      } else {
        const altTxt = si.alt < 1 ? `${fmtNum(si.alt * 1000, 0)} m` : fmtDist(si.alt);
        UI.setText('s-alt', b.body === 'gas' ? (si.alt >= 0 ? `Acima das nuvens: ${altTxt}` : `Profundidade: ${fmtDist(-si.alt)}`) : `Altitude: ${altTxt}${si.water ? ' (sobre o oceano)' : ''}`);
        UI.setText('s-act', S.landed ? (S.landed.water ? 'Flutuando · [W] decolar' : '[E] desembarcar · [W] decolar') : S.autoland ? 'Descendo…' : b.body === 'rocky' && si.alt < 80 ? '[P] pouso automático' : '');
      }
      UI.setText('s-env', `${env.P > 0.0001 ? fmtNum(env.P, env.P < 0.1 ? 4 : 2) + (b.body === 'gas' ? ' bar' : ' atm') : 'Vácuo'} · ${fmtNum((env.T || b.temp) - 273.15, 0)} °C · ${fmtNum(b.gravity || b.mass / Math.pow(b.radius / 6371, 2), 2)} g`);
    }
    UI.setText('h-ship', S.shipDef.nome.toUpperCase());
    UI.setText('h-range', `Alcance de salto: ${fmtNum(jumpRange(), 1)} al`);
    if (ti) {
      UI.setText('h-tname', ti.name);
      UI.setText('h-ttype', ti.type);
      UI.setText('h-tdist', ti.dLy != null ? `${fmtNum(ti.dLy, 2)} anos-luz` : fmtDist(ti.dist));
      UI.setText('h-teta', ti.dLy != null ? '' : S.speed > 0.01 ? `Chegada em ~${fmtTime(ti.dist / S.speed)}` : '');
      let act = '';
      if (ti.dLy != null) act = ti.dLy <= jumpRange() ? '[J] saltar' : `[J] salto parcial (alcance ${fmtNum(jumpRange(), 1)} al)`;
      else if (ti.it && ti.it.body.kind !== 'star') act = ti.dist > scanRange(ti.it.body) ? '[G] aproximar' : '[F] escanear';
      else act = '[G] aproximar';
      UI.setText('h-tact', act);
    }
  }

  // rótulos dos astros
  const entries = [];
  if (S.view && S.showLabels && !(S.warp && S.warp.phase === 'tunnel')) {
    for (const it of S.view.items) {
      const b = it.body;
      if (b.kind === 'moon') {
        const par = S.view.items.find((x) => x.body === b.parent);
        if (par && par.world.length() > b.a * 40) continue;
      }
      if (S.si && S.si.it === it) continue; // o planeta em que estamos não precisa de rótulo
      const pr = project(it.world);
      if (!pr.on) continue;
      const d = it.world.length() - b.radius;
      const isT = S.target && S.target.kind === 'body' && S.target.id === b.id;
      entries.push({
        key: b.id, x: pr.x, y: pr.y, text: b.name, sub: fmtDist(d),
        cls: isT ? 'tgt' : b.kind === 'star' ? 'star' : b.body === 'bh' ? 'bh' : b.scannedScore >= 60 ? 'hab' : '',
        color: labelColor(b),
      });
    }
  }
  if (S.fv && S.showLabels && !(S.warp && S.warp.phase === 'tunnel')) {
    for (const o of S.fv.objs) {
      const pr = project(o.world);
      if (!pr.on) continue;
      const isT = S.target && S.target.kind === 'fleet' && S.target.id === o.id;
      entries.push({ key: 'fleet:' + o.id, x: pr.x, y: pr.y, text: o.shadow ? 'Sombra' : o.name + (o.state === 'socorro' ? ' · SOCORRO' : o.state === 'destroco' ? ' · destroços' : ''), sub: o.model ? `${fmtNum(o.model.meters, 0)} m · ${fmtDist(Math.max(o.gap, 0))}` : fmtDist(o.world.length()), cls: isT ? 'tgt' : o.shadow ? 'shadow' : 'fleet', color: o.shadow ? '#c49bff' : FLEET[o.id] ? FLEET[o.id].cor : '#ffd27a' });
    }
  }
  if (S.shadow) {
    const pr = project(S.shadow.rel);
    if (pr.on) entries.push({ key: 'shadow', x: pr.x, y: pr.y, text: 'SOMBRA', sub: fmtDist(S.shadow.rel.length()), cls: 'shadow', color: '#c49bff' });
  }
  UI.labels(entries);
  updateApproach(dt);
  updateMission(dt);
  updatePrompts(dt);
}

// Linha do horizonte (na tela) e altímetro com velocidade vertical, perto de um planeta
const _hv = new THREE.Vector3();
let hzAlt = null, hzVs = 0, gpwsT = 0;
function updateHorizon(dt) {
  const show = S.gw > 0.05 && S.mode === 'ship' && !S.landed && !S.warp && !!S.si;
  $('horizon').classList.toggle('hidden', !show);
  if (!show) { hzAlt = null; $('gpws').classList.add('hidden'); return; }
  // vertical local no espaço da câmera; o horizonte é a reta da tela perpendicular a ela
  const u = _hv.copy(upWorld()).applyQuaternion(_q.copy(camera.quaternion).invert());
  const s = H / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const q2 = u.x * u.x + u.y * u.y;
  let ox = 0, oy = 0;
  if (q2 > 1e-6) { ox = (s * u.z * u.x) / q2; oy = (-s * u.z * u.y) / q2; }
  const m = Math.hypot(ox, oy), lim = H * 0.32;
  if (m > lim) { ox *= lim / m; oy *= lim / m; }
  $('hz-line').style.transform = `translate(${W / 2 + ox}px, ${H / 2 + oy}px) rotate(${Math.atan2(u.x, u.y)}rad)`;
  const alt = S.si.alt - shipHalf();
  if (hzAlt != null && dt > 0) hzVs += ((alt - hzAlt) / dt - hzVs) * (1 - Math.exp(-dt * 3));
  hzAlt = alt;
  const vs = hzVs * 1000, altM = Math.max(alt, 0) * 1000;
  UI.setText('hz-alt', altM < 10000 ? `${fmtNum(altM, 0)} m` : fmtDist(alt));
  UI.setText('hz-vs', Math.abs(vs) < 0.5 ? 'nível' : `${vs > 0 ? '▲ subindo' : '▼ descendo'} ${fmtNum(Math.abs(vs), Math.abs(vs) < 10 ? 1 : 0)} m/s`);
  $('hz-box').className = vs < -30 && altM < 1500 ? 'hz-danger' : vs < -12 && altM < 600 ? 'hz-warn' : '';
  // alerta de proximidade do solo: descendo rápido e a menos de ~7 s do impacto
  const gp = !S.autoland && altM < 1500 && vs < -25 && altM / -vs < 7 && S.si.b.body === 'rocky';
  $('gpws').classList.toggle('hidden', !gp);
  if (gp) { gpwsT -= dt; if (gpwsT <= 0) { gpwsT = 0.75; audio.gpws(); } } else gpwsT = 0;
}

// Painel de aproximação: folga até o casco e velocidade de aproximação da nave da frota mais próxima
let apPrev = null, apClose = 0;
function updateApproach(dt) {
  const nf = fleetNear;
  const show = !!(nf && nf.o.model && nf.d < 5 && S.mode === 'ship' && !S.landed && !S.warp);
  $('approach').classList.toggle('hidden', !show);
  if (!show) { apPrev = null; return; }
  if (apPrev && apPrev.o === nf.o && dt > 0) apClose += ((apPrev.d - nf.d) / dt - apClose) * (1 - Math.exp(-dt * 4));
  else apClose = 0;
  apPrev = { o: nf.o, d: nf.d };
  const ms = apClose * 1000, gapM = Math.max(0, nf.d * 1000);
  const lvl = ms > 20 && gapM < 400 ? 'danger' : ms > 5 && gapM < 150 ? 'warn' : 'ok';
  $('approach').className = 'ap-' + lvl;
  UI.setText('ap-name', `${nf.o.name.toUpperCase()} · ${fmtNum(nf.o.model.meters, 0)} m`);
  UI.setText('ap-gap', gapM < 1000 ? `${fmtNum(gapM, 0)} m` : `${fmtNum(gapM / 1000, 2)} km`);
  UI.setText('ap-vel', `${ms >= 0 ? 'aproximando' : 'afastando'} ${fmtNum(Math.abs(ms), Math.abs(ms) < 10 ? 1 : 0)} m/s`);
}

function labelColor(b) {
  if (b.kind === 'star') { const c = S.view.starColor; return `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`; }
  if (b.body === 'bh') return '#b48cff';
  const a = b.visual.avg || [0.6, 0.6, 0.6];
  const s = a.map((x) => Math.pow(x, 1 / 2.2));
  const m = Math.max(...s, 0.05);
  return `rgb(${s.map((x) => Math.round(Math.min(1, (x / m) * 0.9 + 0.1) * 255)).join(',')})`;
}

// Objetivo atual + marcador de navegação na tela
let mission = null, missionTimer = 0;
function updateMission(dt) {
  missionTimer -= dt;
  if (missionTimer <= 0 || !mission) {
    missionTimer = 0.25;
    const nova = getSystem(galaxy, galaxy.novaTerra).planets.find((p) => p.special === 'nova');
    const prev = mission && mission.idx;
    mission = missionStatus({ S, galaxy, fleet, shipGal: shipGal(), novaPlanetId: nova && nova.id });
    UI.mission(mission);
    if (prev != null && mission.idx > prev) { audio.discovery(); UI.msg(`✓ Objetivo concluído`, 'good', 'MISSÃO', 4000); }
  }
  const wp = mission.wp;
  let world = null, label = '', dist = '';
  if (wp) {
    const g = shipGal();
    if (wp.kind === 'gal' || wp.kind === 'star') {
      const p = wp.kind === 'gal' ? wp.p : { x: galaxy.px[wp.index], y: galaxy.py[wp.index], z: galaxy.pz[wp.index] };
      if (wp.kind === 'star' && S.view && wp.index === S.sysIndex) world = S.view.items[0].world.clone();
      else {
        world = new THREE.Vector3(p.x - g.x, p.y - g.y, p.z - g.z);
        dist = `${fmtNum(world.length(), 1)} al`;
        world.setLength(1e12);
      }
    } else if (wp.kind === 'fleet') {
      const o = fleetObj(wp.id);
      if (o) { world = o.world.clone(); dist = fmtDist(o.world.length()); }
    } else if (S.view) {
      const it = S.view.items.find((x) => x.body.id === wp.id);
      if (it) { world = it.world.clone(); dist = fmtDist(it.world.length() - it.body.radius); }
    }
    label = wp.label;
  }
  // não duplica o marcador quando o objetivo já é o alvo
  const same = world && S.target && wp && ((wp.kind === 'star' && S.target.kind === 'star' && S.target.index === wp.index) || ((wp.kind === 'body' || wp.kind === 'fleet') && S.target.kind === wp.kind && S.target.id === wp.id));
  if (!world || same || (S.warp && S.warp.phase === 'tunnel')) { UI.waypoint(0, 0, false); UI.warrow(0, 0, 0, false); return; }
  const pr = project(world);
  if (pr.on) { UI.waypoint(pr.x, pr.y, true, `${label} · ${dist}`); UI.warrow(0, 0, 0, false); }
  else {
    UI.waypoint(0, 0, false);
    let dx = pr.x - W / 2, dy = pr.y - H / 2;
    if (pr.behind) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx), r = Math.min(W, H) * 0.38;
    UI.warrow(W / 2 + Math.cos(ang) * r, H / 2 + Math.sin(ang) * r, ang, true);
  }
}

// [T] marca o ponto do objetivo atual como alvo
function targetMission() {
  const wp = mission && mission.wp;
  if (!wp) { UI.msg('O objetivo atual não tem um ponto de navegação.', 'warn'); return; }
  if (wp.kind === 'body') setTargetBody(wp.id);
  else if (wp.kind === 'fleet') { if (fleetObj(wp.id)) setTargetFleet(wp.id); }
  else if (wp.kind === 'star') setTargetStar(wp.index);
  else {
    // ponto no espaço (zona do sinal): escolhe a estrela alcançável que mais nos aproxima dele
    const g = shipGal();
    const cand = galaxy.within(g.x, g.y, g.z, jumpRange());
    let best = -1, bd = Math.hypot(wp.p.x - g.x, wp.p.y - g.y, wp.p.z - g.z);
    for (const i of cand) {
      if (S.view && i === S.sysIndex) continue;
      const d = Math.hypot(wp.p.x - galaxy.px[i], wp.p.y - galaxy.py[i], wp.p.z - galaxy.pz[i]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) { UI.msg('Nenhuma estrela ao alcance nos aproxima do sinal. Abra o mapa [M].', 'warn'); return; }
    setTargetStar(best);
    UI.msg(`Destino sugerido: ${galaxy.name(best)} — nos deixa a ${fmtNum(bd, 1)} al do centro do sinal. [J] para saltar.`, '', 'NAV', 8000);
  }
}

// ------------------------------------------------------------------------------------------------
// Seleção por clique
// ------------------------------------------------------------------------------------------------
function pickAt(x, y) {
  let best = null, bd = 22;
  if (S.fv) {
    for (const o of S.fv.objs) {
      const pr = project(o.world);
      if (!pr.on) continue;
      const d = Math.hypot(pr.x - x, pr.y - y);
      if (d < bd) { bd = d; best = { fleet: o.id }; }
    }
    if (best) { setTargetFleet(best.fleet); return; }
  }
  if (S.view) {
    for (const it of S.view.items) {
      const pr = project(it.world);
      if (!pr.on) continue;
      const dist = it.world.length();
      const rpx = (it.body.radius / dist) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (H / 2);
      const d = Math.hypot(pr.x - x, pr.y - y) - rpx;
      if (d < bd) { bd = d; best = { body: it.body.id }; }
    }
  }
  if (best) { setTargetBody(best.body); return; }
  // estrelas do céu
  const g = shipGal();
  const lim = sky.pointsMat.uniforms.uLimit.value;
  let bi = -1, bs = Infinity;
  for (let i = 0; i < galaxy.count; i++) {
    if (S.view && i === S.sysIndex) continue;
    const dx = galaxy.px[i] - g.x, dy = galaxy.py[i] - g.y, dz = galaxy.pz[i] - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const m = 4.83 - 2.5 * Math.log10(galaxy.lum[i]) + 5 * Math.log10(d / 32.6);
    if (m > lim + 0.5) continue;
    _p.set(dx, dy, dz).applyMatrix4(sky.camera.matrixWorldInverse);
    if (_p.z >= 0) continue; // atrás da câmera
    _p.applyMatrix4(sky.camera.projectionMatrix);
    if (Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1) continue;
    const px = ((_p.x + 1) / 2) * W, py = ((1 - _p.y) / 2) * H;
    const pd = Math.hypot(px - x, py - y);
    if (pd > 18) continue;
    const score = pd + m * 1.5;
    if (score < bs) { bs = score; bi = i; }
  }
  if (bi >= 0) {
    setTargetStar(bi);
    const d = galaxy.dist(bi, g.x, g.y, g.z);
    UI.msg(`Alvo: ${galaxy.name(bi)} (${galaxy.spectral(bi)}), ${fmtNum(d, 2)} anos-luz. ${d <= jumpRange() ? '[J] para saltar.' : 'Fora do alcance de salto.'}`, '', 'NAV', 6000);
  }
}

// ------------------------------------------------------------------------------------------------
// Mapa
// ------------------------------------------------------------------------------------------------
function openMap() {
  if (S.warp) return;
  S.state = 'map';
  $('mapUI').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('labels').classList.add('hidden');
  closePanels();
  S.flags.mapOpened = true;
  map.open(shipGal(), jumpRange(), S.target && S.target.kind === 'star' ? S.target.index : -1, S.visited);
  map.setFleet(fleet.mapMarkers(S).map((m) => ({ ...m, pos: [galaxy.px[m.star], galaxy.py[m.star], galaxy.pz[m.star]] })));
  if (!$('map-exo').classList.contains('hidden')) renderExo();
  map.camera.aspect = W / H; map.camera.updateProjectionMatrix();
  S.mapSel = -1;
  map.select(-1);
  UI.mapInfo(-1);
  audio.click();
}
let exoFilter = 'todos';
function renderExo() {
  const items = exoCatalog(galaxy, shipGal(), S);
  UI.exoList(items, exoFilter, jumpRange(), (i) => { map.focus(i); mapSelect(i); });
}
function closeMap() {
  S.state = 'play';
  map.close();
  $('mapUI').classList.add('hidden');
  $('hud').classList.toggle('hidden', S.hudHidden);
  $('labels').classList.remove('hidden');
  audio.click();
}
function mapSelect(i) {
  S.mapSel = i;
  map.select(i);
  if (i < 0) { UI.mapInfo(-1); return; }
  const g = shipGal();
  const d = galaxy.dist(i, g.x, g.y, g.z);
  const visited = S.visited.has(i);
  const sysInfo = visited ? `${getSystem(galaxy, i).planets.length} planeta(s)` : '';
  const isT = S.target && S.target.kind === 'star' && S.target.index === i;
  UI.mapInfo(i, galaxy, d, jumpRange(), visited, sysInfo, () => {
    setTargetStar(i);
    map.setTarget(i);
    mapSelect(i);
    UI.msg(`Destino definido: ${galaxy.name(i)}. ${d <= jumpRange() ? 'Feche o mapa e pressione [J].' : 'Fora do alcance — escolha uma estrela intermediária.'}`, '', 'NAV', 6000);
  }, isT);
  audio.click();
}

// ------------------------------------------------------------------------------------------------
// Painéis
// ------------------------------------------------------------------------------------------------
function closePanels() {
  for (const id of ['sysPanel', 'scanPanel', 'logPanel', 'helpPanel']) $(id).classList.add('hidden');
  $('title').classList.remove('behind');
}
function togglePanel(id, render) {
  const p = $(id);
  const open = p.classList.contains('hidden');
  closePanels();
  if (open) { render && render(); p.classList.remove('hidden'); audio.click(); }
}

// ------------------------------------------------------------------------------------------------
// Salvamento
// ------------------------------------------------------------------------------------------------
function save() {
  if (!S.ship) return;
  const data = {
    ship: S.shipDef.id, anchor: S.anchor, local: S.local, quat: S.quat.toArray(),
    visited: [...S.visited], scanned: S.scanned, stats: S.stats, won: S.won, t: S.t, flags: S.flags,
    frame: S.frame ? { id: S.frame.id, rot: S.frame.rot, rel: S.frame.rel } : null, landed: S.landed,
  };
  if (S.mode === 'foot' && S.landed) data.frame.rel = S.landed.rel;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadGame() {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (!d) return false;
  S.shipDef = SHIPS.find((s) => s.id === d.ship) || SHIPS[0];
  S.anchor = d.anchor; S.local = d.local; S.quat.fromArray(d.quat); S.cam.quat.copy(S.quat);
  S.visited = new Set(d.visited); S.scanned = d.scanned || {}; S.stats = d.stats; S.won = d.won; S.t = d.t; S.flags = d.flags || {};
  S.savedFrame = d.frame || null; S.savedLanded = d.landed || null;
  return true;
}

// ------------------------------------------------------------------------------------------------
// Fluxo de telas
// ------------------------------------------------------------------------------------------------
function fade(on) { $('fade').style.opacity = on ? '1' : '0'; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));


async function newGame() {
  audio.init();
  audio.click();
  $('title').classList.add('hidden');
  S.state = 'intro';
  $('intro').classList.remove('hidden');
  audio.duck(false);
  const finish = UI.intro(INTRO, () => toSelect());
  $('intro-skip').onclick = finish;
  S.skipIntro = finish;
}

async function toSelect() {
  if (S.state !== 'intro') return;
  fade(true);
  await wait(1200);
  $('intro').classList.add('hidden');
  S.state = 'select';
  $('select').classList.remove('hidden');
  showPreviewShip(0);
  fade(false);
}

async function startGame(def, fromSave = false) {
  fade(true);
  await wait(1300);
  $('select').classList.add('hidden');
  $('title').classList.add('hidden');
  if (S.ship) scene.remove(S.ship.group);
  S.shipDef = def;
  S.ship = buildShip(def);
  S.ship.group.traverse((o) => o.layers.set(SHIP_LAYER));
  scene.add(S.ship.group);
  if (!fromSave) {
    S.visited = new Set(); S.scanned = {}; S.stats = { ly: 0, jumps: 0, time: 0 }; S.won = false; S.flags = {}; S.t = T0;
    unloadSystem();
    loadSystem(0, false);
    placeAtEarth();
  } else {
    unloadSystem();
    const d = Math.hypot(...S.local);
    if (d < SYS_ENTER) loadSystem(S.anchor, false);
    if (S.view && S.savedFrame && bodyItem(S.savedFrame.id)) {
      S.frame = { ...S.savedFrame, spin: null };
      if (S.frame.rot) S.frame.spin = spinAngle(bodyItem(S.frame.id).body, S.t);
      if (S.savedLanded && S.savedLanded.body === S.frame.id) S.landed = S.savedLanded;
    }
  }
  S.hull = 100; S.dmgT = 10; S.mode = 'ship'; S.walker = null; S.autoland = false; S.vdesc = 0;
  cine.uniforms.uFog.value = 0; cine.uniforms.uHeat.value = 0; cine.uniforms.uFlashC.value.set(0.8, 0.9, 1.0);
  S.ship.group.visible = true;
  $('destroyed').classList.add('hidden');
  S.target = null; S.autopilot = false; S.align = false; S.speed = 0; S.throttle = 0; S.warp = null; S.scan = null; S.knock.set(0, 0, 0); S.vrise = 0; S.liftT = 0;
  if (!fromSave) S.target = { kind: 'body', id: '0:Terra' };
  mission = null;
  S.cam.mode = 'chase'; S.cam.yaw = 0; S.cam.pitch = 0; S.cam.zoom = fromSave ? 1 : 5; S.cam.intro = !fromSave;
  S.state = 'play';
  $('hud').classList.remove('hidden');
  renderer.compile(scene, camera);
  fade(false);
  save();
  if (!fromSave) {
    UI.clearSubs();
    setTimeout(() => {
      UI.say('LUMEN', `Sistemas online. Suporte de vida estável. Bem-vindo a bordo da ${def.nome}, comandante.`);
      UI.say('LUMEN', 'À frente está o que restou da Terra. O manto ainda brilha… Sinto muito.');
      UI.say('LUMEN', 'O objetivo aparece no alto da tela, e as teclas que você pode usar, logo abaixo da mira. Segure o botão esquerdo do mouse para pilotar.');
      audio.message();
    }, 1500);
  } else {
    UI.msg(`Bem-vindo de volta, comandante. ${S.view ? 'Sistema ' + S.view.sys.star.name + '.' : 'Estamos no espaço interestelar.'}`);
  }
}

async function toMenu() {
  save();
  fade(true);
  await wait(1300);
  closePanels();
  for (const id of ['hud', 'pause', 'ending', 'mapUI', 'destroyed']) $(id).classList.add('hidden');
  if (S.mode === 'foot') leaveFoot();
  cine.uniforms.uFog.value = 0; cine.uniforms.uHeat.value = 0; audio.setWind(0);
  if (S.ship) { scene.remove(S.ship.group); S.ship = null; }
  map.close();
  unloadSystem();
  loadSystem(0, false);
  placeAtEarth();
  UI.labels([]);
  S.state = 'title';
  $('title').classList.remove('hidden');
  $('btn-continue').classList.remove('hidden');
  fade(false);
}

function fillOptions() {
  $('vol-music').value = settings.music; $('vol-sfx').value = settings.sfx; $('vol-amb').value = settings.amb;
  $('opt-fov').value = settings.fov; $('opt-quality').value = String(settings.quality);
  $('opt-exposure').value = settings.exposure; $('opt-invert').checked = settings.invert; $('opt-tick').checked = settings.tick;
  $('opt-steer').value = settings.steer; $('opt-look').value = settings.look; $('opt-fps').checked = settings.fps;
}
function titleOptions(on) {
  $('pause').classList.toggle('hidden', !on);
  $('pause').classList.toggle('from-title', on);
  $('btn-opt-back').classList.toggle('hidden', !on);
  $('pause-title').textContent = on ? 'AJUSTES' : 'PAUSA';
  $('title').classList.toggle('behind', on);
  if (on) fillOptions(); else { saveSettings(); blurUI(); }
}
// tira o foco de sliders e botões do menu: senão as setas, o A/D e o Espaço continuam mexendo neles durante o jogo
function blurUI() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
function pause(on) {
  if (on) {
    S.prevState = S.state;
    S.state = 'pause';
    $('pause').classList.remove('hidden');
    fillOptions();
  } else {
    S.state = S.prevState || 'play';
    $('pause').classList.add('hidden');
    saveSettings();
    blurUI();
  }
}

// ------------------------------------------------------------------------------------------------
// Entrada
// ------------------------------------------------------------------------------------------------
function bindUI() {
  $('btn-new').onclick = newGame;
  $('btn-continue').onclick = () => { audio.init(); audio.click(); if (loadGame()) startGame(S.shipDef, true); };
  $('btn-help').onclick = () => { audio.init(); togglePanel('helpPanel'); $('title').classList.toggle('behind', !$('helpPanel').classList.contains('hidden')); };
  $('sel-prev').onclick = () => { showPreviewShip(preview.idx - 1); audio.click(); };
  $('sel-next').onclick = () => { showPreviewShip(preview.idx + 1); audio.click(); };
  $('sel-go').onclick = () => { audio.click(); startGame(SHIPS[preview.idx]); };
  $('btn-resume').onclick = () => pause(false);
  $('btn-options').onclick = () => { audio.init(); audio.click(); titleOptions(true); };
  $('btn-opt-back').onclick = () => { audio.click(); titleOptions(false); };
  $('d-retry').onclick = () => { audio.duck(false); $('destroyed').classList.add('hidden'); if (loadGame()) startGame(S.shipDef, true); else toMenu(); };
  $('d-menu').onclick = () => { audio.duck(false); toMenu(); };
  $('btn-menu').onclick = () => { pause(false); toMenu(); };
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $(b.dataset.close).classList.add('hidden')));
  document.addEventListener('click', (e) => { if (e.target.dataset && e.target.dataset.close) { $(e.target.dataset.close).classList.add('hidden'); $('title').classList.remove('behind'); } });
  const vol = (k) => (e) => { settings[k] = +e.target.value; audio.setVolume(k, settings[k]); };
  $('vol-music').oninput = vol('music'); $('vol-sfx').oninput = vol('sfx'); $('vol-amb').oninput = vol('amb');
  $('opt-fov').oninput = (e) => { settings.fov = +e.target.value; };
  $('opt-exposure').oninput = (e) => { settings.exposure = +e.target.value; renderer.toneMappingExposure = settings.exposure; };
  $('opt-quality').onchange = (e) => { settings.quality = +e.target.value; onResize(); };
  $('opt-invert').onchange = (e) => { settings.invert = e.target.checked; };
  $('opt-tick').onchange = (e) => { settings.tick = e.target.checked; audio.ticking = settings.tick; };
  $('opt-steer').oninput = (e) => { settings.steer = +e.target.value; };
  $('opt-look').oninput = (e) => { settings.look = +e.target.value; };
  $('opt-fps').onchange = (e) => { settings.fps = e.target.checked; $('fps').classList.toggle('hidden', !settings.fps); };
  $('fps').classList.toggle('hidden', !settings.fps);
  $('music-file-btn').onclick = () => $('music-file').click();
  $('music-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await audio.useCustom(await f.arrayBuffer()); UI.msg('Trilha carregada: ' + f.name, 'good', 'ÁUDIO'); } catch (err) { UI.msg('Não foi possível ler esse arquivo de áudio.', 'warn', 'ÁUDIO'); }
  };
  $('music-organ').onclick = () => { audio.useOrgan(); UI.msg('Trilha original restaurada.', '', 'ÁUDIO'); };
  // mapa
  $('map-close').onclick = closeMap;
  $('map-exo-btn').onclick = () => { $('map-exo').classList.toggle('hidden'); if (!$('map-exo').classList.contains('hidden')) renderExo(); audio.click(); };
  document.querySelectorAll('#map-exo .chip').forEach((c) => (c.onclick = () => {
    document.querySelectorAll('#map-exo .chip').forEach((x) => x.classList.toggle('on', x === c));
    exoFilter = c.dataset.f; renderExo();
  }));
  $('map-ship').onclick = () => { map.controls.target.copy(shipGal()); };
  $('map-sol').onclick = () => { map.focus(0); mapSelect(0); };
  $('map-bio').onclick = () => {
    const bz = galaxy.bioZone;
    const off = map.camera.position.clone().sub(map.controls.target).setLength(90);
    map.controls.target.set(bz.x, bz.y, bz.z);
    map.camera.position.copy(map.controls.target).add(off);
  };
  $('map-search').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    let found = -1;
    for (let i = 0; i < galaxy.firstProc && found < 0; i++) if (galaxy.name(i).toLowerCase().startsWith(q)) found = i;
    for (const [i, n] of galaxy.names) if (found < 0 && n.toLowerCase().startsWith(q)) found = i;
    if (found < 0) { e.target.style.borderColor = '#ff6b6b'; return; }
    e.target.style.borderColor = '';
    map.focus(found);
    mapSelect(found);
  });

  addEventListener('resize', onResize);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.steer = false; mouse.look = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    mouse.downX = e.clientX; mouse.downY = e.clientY; mouse.downT = performance.now();
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    if (S.state !== 'play') return;
    if (S.mode === 'foot') { if (!document.pointerLockElement && canvas.requestPointerLock) try { canvas.requestPointerLock(); } catch (er) { /* */ } return; }
    if (e.button === 0) mouse.steer = true;
    if (e.button === 2) mouse.look = true;
  });
  addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (S.mode === 'foot' && S.walker && S.state === 'play' && document.pointerLockElement === canvas) {
      const inv = settings.invert ? -1 : 1;
      const k = 0.0024 * settings.look;
      S.walker.yaw += e.movementX * k;
      S.walker.pitch = clamp(S.walker.pitch - e.movementY * k * inv, -1.45, 1.45);
    } else if (mouse.look && S.state === 'play') {
      const k = 0.005 * settings.look, inv = settings.invert ? -1 : 1;
      S.cam.yaw -= (e.clientX - mouse.lastX) * k;
      S.cam.pitch = clamp(S.cam.pitch - (e.clientY - mouse.lastY) * k * inv, -1.4, 1.4);
    }
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  });
  addEventListener('pointerup', (e) => {
    const click = Math.hypot(e.clientX - mouse.downX, e.clientY - mouse.downY) < 5 && performance.now() - mouse.downT < 300;
    if (e.button === 0) mouse.steer = false;
    if (e.button === 2) mouse.look = false;
    if (!click || e.target !== canvas) return;
    if (S.state === 'play' && e.button === 0 && S.mode === 'ship') pickAt(e.clientX, e.clientY);
    else if (S.state === 'map' && e.button === 0) mapSelect(map.pick(e.clientX, e.clientY, W, H));
  });
  canvas.addEventListener('dblclick', (e) => {
    if (S.state === 'play') {
      // duplo clique num astro: piloto automático até ele
      if (S.target && S.target.kind === 'body' && targetItem() && !S.warp) { S.autopilot = true; S.align = false; UI.msg('Piloto automático engajado.'); }
      return;
    }
    if (S.state !== 'map') return;
    const i = map.pick(e.clientX, e.clientY, W, H);
    if (i >= 0) { map.focus(i); mapSelect(i); }
  });
  canvas.addEventListener('wheel', (e) => {
    if (S.state !== 'play') return;
    S.cam.intro = false;
    if (S.cam.mode === 'chase') S.cam.zoom = clamp(S.cam.zoom * Math.exp(e.deltaY * 0.001), 0.45, 12);
  }, { passive: true });
}

function onKeyDown(e) {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  keys[e.code] = true;
  const st = S.state;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (st === 'intro' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { S.skipIntro && S.skipIntro(); return; }
  if (st === 'select') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { showPreviewShip(preview.idx - 1); audio.click(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { showPreviewShip(preview.idx + 1); audio.click(); }
    if (e.code === 'Enter') startGame(SHIPS[preview.idx]);
    return;
  }
  if (st === 'pause') { if (e.code === 'Escape') pause(false); return; }
  if (st === 'title') { if (e.code === 'Escape') { if (!$('pause').classList.contains('hidden')) titleOptions(false); closePanels(); } return; }
  if (st === 'map') {
    if (e.code === 'KeyM' || e.code === 'Escape') closeMap();
    if (e.code === 'KeyJ') { closeMap(); requestJump(); }
    return;
  }
  if (st !== 'play') return;
  if (e.repeat) return;
  switch (e.code) {
    case 'Escape': {
      const anyOpen = ['sysPanel', 'scanPanel', 'logPanel', 'helpPanel'].some((id) => !$(id).classList.contains('hidden'));
      if (anyOpen) closePanels(); else pause(true);
      break;
    }
    case 'KeyM': openMap(); break;
    case 'KeyT': targetMission(); break;
    case 'KeyP': if (S.mode === 'ship') requestAutoland(); break;
    case 'KeyE':
      if (S.mode === 'foot') embark();
      else if (S.landed) disembark();
      break;
    case 'KeyJ': requestJump(); break;
    case 'KeyF': requestScan(); break;
    case 'KeyG':
      if (S.mode === 'foot' || S.landed) break;
      if (S.autopilot) { S.autopilot = false; UI.msg('Piloto automático desligado.'); break; }
      if (!S.target) { UI.msg('Selecione um alvo primeiro (clique num astro ou use [Tab]).', 'warn'); break; }
      if (S.target.kind === 'star') { UI.msg('Essa estrela fica em outro sistema — use o salto [J].', 'warn'); break; }
      if (S.target.kind === 'fleet' && !fleetObj(S.target.id)) break;
      S.autopilot = true; UI.msg('Piloto automático engajado.'); audio.click();
      break;
    case 'Tab': togglePanel('sysPanel', () => UI.systemPanel(S.view, S.target && S.target.id, setTargetBody)); break;
    case 'KeyL': togglePanel('logPanel', () => UI.logPanel(S, galaxy)); break;
    case 'KeyH': togglePanel('helpPanel'); break;
    case 'KeyC': if (S.mode === 'foot') break; S.cam.mode = S.cam.mode === 'chase' ? 'cockpit' : 'chase'; S.cam.yaw = 0; S.cam.pitch = 0; audio.click(); break;
    case 'KeyO': S.showOrbits = !S.showOrbits; if (S.view) S.view.showOrbits = S.showOrbits; break;
    case 'KeyN': S.showLabels = !S.showLabels; break;
    case 'KeyU': S.hudHidden = !S.hudHidden; $('hud').classList.toggle('hidden', S.hudHidden); $('labels').classList.toggle('hidden', S.hudHidden); break;
    case 'KeyX': S.throttle = 0; S.autopilot = false; break;
    case 'KeyZ': S.throttle = 1; break;
    case 'KeyV': S.cam.yaw = 0; S.cam.pitch = 0; break;
    default:
      if (/^Digit\d$/.test(e.code)) { const n = +e.code.slice(5); S.throttle = n === 0 ? 1 : n / 10; }
  }
}

function onResize() {
  W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(W, H, false);
  composer.setPixelRatio(pixelRatio()); composer.setSize(W, H);
  preview.comp.setPixelRatio(pixelRatio()); preview.comp.setSize(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  preview.cam.aspect = W / H; preview.cam.setViewOffset(W, H, -W * 0.17, 0, W, H);
  map.camera.aspect = W / H; map.camera.updateProjectionMatrix();
  cine.uniforms.uRes.value.set(W, H);
}

// ------------------------------------------------------------------------------------------------
// Loop principal
// ------------------------------------------------------------------------------------------------
let last = performance.now(), saveTimer = 0, titleAng = 0, elapsed = 0, storyT = 0;
let fpsN = 0, fpsT = 0, fpsLast = 0;

// epílogo: depois de pisar na Nova Terra, as Sombras falam
function epilogueTick() {
  const f = S.flags;
  if (!f.novaWalk || f.epilogue) return;
  f.tWalk = f.tWalk ?? S.stats.time;
  if (S.stats.time - f.tWalk < 12) return;
  f.epilogue = true;
  UI.clearSubs();
  for (const [sp, t] of EPILOGUE) UI.say(sp, t, { prio: true, glitch: sp === '???' });
  audio.discovery();
  setTimeout(() => {
    const e = $('ending');
    e.innerHTML = `<div class="pre" style="font-family:var(--title);letter-spacing:8px;font-size:12px;color:var(--hud-dim);margin-bottom:12px">ÚLTIMO HORIZONTE</div>
      <h1>FIM DO CAPÍTULO I</h1>
      <p>A Frota da Diáspora encontrou um lar. As Sombras deixaram a humanidade ficar — por enquanto.<br>O que era o Érebo? Por que a Terra? E quem mais está olhando?</p>
      <div class="menu"><button class="btn big" id="end-cont">Continuar explorando</button><button class="btn" id="end-menu">Menu principal</button></div>`;
    e.classList.remove('hidden');
    $('end-cont').onclick = () => e.classList.add('hidden');
    $('end-menu').onclick = () => toMenu();
    save();
  }, 42000);
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;
  if (settings.fps) {
    fpsN++; fpsT += now - (fpsLast || now); fpsLast = now;
    if (fpsT > 500) { $('fps').textContent = `${Math.round((fpsN * 1000) / fpsT)} FPS`; fpsN = 0; fpsT = 0; }
  }
  cine.uniforms.uTime.value = elapsed;
  cine.uniforms.uRes.value.set(W, H);
  cine.uniforms.uFlash.value *= Math.exp(-dt * 2.5);
  const st = S.state;

  if (st === 'select') {
    preview.ang += dt * 0.25;
    const r = 2.1;
    preview.cam.position.set(Math.sin(preview.ang) * r, 0.45 + Math.sin(elapsed * 0.3) * 0.08, Math.cos(preview.ang) * r);
    preview.cam.lookAt(0, 0, 0);
    if (preview.model) preview.model.update(elapsed, 0.55);
    preview.comp.render(dt);
    return;
  }

  if (st === 'map') {
    if (S.ship) {
      S.t += dt; S.stats.time += dt;
      frameChoose(dt); frameApply(); updateSurfaceCtx(); computeSI(); environment();
      if (S.landed) holdLanded(), frameApply();
      else if (S.mode === 'ship') { updateFleetProx(); flight(dt); fleetContact(dt); frameStore(); groundContact(); }
      updateAnchor(dt); updateScan(dt);
    }
    map.update(dt, W, H);
    renderer.render(map.scene, map.camera);
    return;
  }

  if (st === 'title' || st === 'intro' || st === 'loading') {
    S.t += dt;
    frameChoose(dt); frameApply();
    titleAng += dt * 0.012;
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(S.quat).multiply(_q.setFromEuler(_e.set(Math.sin(titleAng * 0.7) * 0.05, -0.25 + Math.sin(titleAng) * 0.25, 0)));
    if (camera.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  if (st === 'play' || st === 'ending' || st === 'destroyed') {
    S.t += dt;
    S.stats.time += dt;
    frameChoose(dt);
    frameApply();
    updateSurfaceCtx();
    computeSI();
    environment();
    if (st !== 'destroyed') {
      if (S.mode === 'foot' && S.walker && S.surf) { holdLanded(); walk(dt); frameApply(); computeSI(); }
      else if (S.landed) { holdLanded(); frameApply(); flight(dt); }
      else if (!S.warp || S.warp.phase !== 'tunnel') { updateFleetProx(); flight(dt); fleetContact(dt); frameStore(); groundContact(); }
      else { S.angVel.multiplyScalar(0.9); }
      if (S.mode === 'foot' || S.landed) updateFleetProx();
      updateWarp(dt);
      if (!S.warp) updateAnchor(dt);
      updateScan(dt);
      hazards(dt);
      updateShadow(dt);
      updateInteract(dt);
      storyT -= dt;
      if (storyT <= 0) {
        storyT = 0.5;
        storyTick({ S, galaxy, fleet, say: (sp, txt, o) => { UI.say(sp, txt, o); audio.message(); }, inSystem: (i) => !!S.view && S.sysIndex === i }, 0.5);
        epilogueTick();
      }
    }
    if (S.mode === 'foot' && S.walker && S.surf) footCamera();
    else updateCamera(dt);
    camera.updateMatrixWorld();
    const power = S.landed || st === 'destroyed' ? 0 : S.warp && S.warp.phase === 'tunnel' ? 1 : Math.max(S.throttle, S.speed > 0 ? 0.08 : 0, S.autoland ? 0.25 : 0) * ((keys.ShiftLeft || keys.ShiftRight) ? 1.3 : 1);
    S.ship.update(elapsed, power, warpFx.level);
    if (S.mode !== 'foot') { S.ship.group.position.set(0, 0, 0); S.ship.group.quaternion.copy(S.quat); }
    audio.setEngine(Math.min(1, power), clamp(Math.log10(1 + S.speed) / 9, 0, 1));
    saveTimer += dt;
    // só salva em situação segura (para não renascer dentro de um perigo)
    if (saveTimer > 15 && st === 'play' && S.hull > 70 && S.dmgT > 5 && !hazardTxt && !S.autoland) { saveTimer = 0; save(); }
  }

  if (st === 'pause' && S.ship) updateCamera(0);

  audio.setMood(st === 'title' || st === 'intro' || st === 'select' || st === 'loading' ? 'title'
    : S.shadow || hazardTxt ? 'tension' : !S.view || S.warp ? 'deep' : 'explore');
  if (S.view) { S.view.showOrbits = S.showOrbits && !S.si; S.view.update(S.t, S.local, camera, H); }
  if (S.fv) S.fv.update(dt, S.t, S.local, elapsed);
  updateLighting();
  const daylight = surfaceVisuals(dt);
  updateFlightFx(dt);
  updateDust(dt);
  updateLens();
  syncShipCam();
  // a lente troca o alvo de render: aí a profundidade da cena se perde e precisa ser limpa
  shipPass.clearDepth = lens.enabled;
  sky.update(camera, shipGal(), S.view ? S.sysIndex : -1, daylight);
  // efeitos de dobra
  warpFx.grp.visible = warpFx.level > 0.001;
  if (warpFx.grp.visible) {
    const L = S.ship ? S.ship.length : 0.05;
    warpFx.grp.scale.setScalar(L * 1.2);
    warpFx.streaks.material.uniforms.uTime.value = elapsed;
    warpFx.streaks.material.uniforms.uWarp.value = warpFx.level;
    warpFx.tunnel.material.uniforms.uTime.value = elapsed;
    warpFx.tunnel.material.uniforms.uWarp.value = warpFx.level * 0.45;
  }
  cine.uniforms.uWarp.value = warpFx.level + (S.warp && S.warp.phase === 'charge' ? (S.warp.t / S.warp.dur) * 0.3 : 0);
  bloom.strength = 0.85 + warpFx.level * 0.3;
  if (st === 'play' || st === 'ending') updateHUD(dt);
  if (st === 'destroyed') cine.uniforms.uFog.value *= Math.exp(-dt);
  composer.render(dt);
}

init().catch((err) => {
  console.error(err);
  setLoading('Erro ao iniciar: ' + err.message);
});
