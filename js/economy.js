// Economia da frota: créditos e materiais, melhorias dos sistemas de bordo, hangar de naves, pintura
// e contratos (missões que se renovam: levantamento, amostra, carga perdida, resgate, buraco negro).
import * as THREE from 'three';
import { getSystem } from './system.js';
import { ALL_SHIPS } from './ships.js';
import { fmtNum } from './util.js';

export const RES_NAME = { cr: 'créditos', metal: 'metal', cristal: 'cristal' };

// ---------------------------------------------------------------- melhorias (3 níveis, valem para qualquer nave)
export const UPGRADES = [
  { id: 'motor', nome: 'Motor principal', desc: (n) => `Velocidade máxima +${50 * n}% · manobra +${8 * n}%` },
  { id: 'salto', nome: 'Motor de salto', desc: (n) => `Alcance de salto +${25 * n}% · carga ${12 * n}% mais rápida` },
  { id: 'casco', nome: 'Blindagem do casco', desc: (n) => `Dano recebido −${18 * n}%` },
  { id: 'escudo', nome: 'Escudo térmico', desc: (n) => `Reentrada segura ${30 * n}% mais rápida · menos calor de estrelas` },
  { id: 'sensor', nome: 'Sensores', desc: (n) => `Alcance do scanner +${60 * n}% · perfuração +${25 * n}% de minério` },
];
export const UPG_COST = [
  { cr: 600, metal: 20, cristal: 0 },
  { cr: 1600, metal: 60, cristal: 3 },
  { cr: 3800, metal: 150, cristal: 10 },
];
// preços do hangar
export const SHIP_COST = {
  andorinha: { cr: 1500, metal: 30, cristal: 0 },
  odisseia: { cr: 4500, metal: 90, cristal: 4 },
  jabuti: { cr: 5000, metal: 180, cristal: 2 },
  gaviao: { cr: 6500, metal: 120, cristal: 8 },
  leviata: { cr: 14000, metal: 320, cristal: 16 },
  exodo: { cr: 32000, metal: 650, cristal: 40 },
};
export const PAINTS = ['#c9ccd1', '#e8e4da', '#3a3d42', '#1e2a3a', '#b33a2a', '#d26a2a', '#d0a040', '#2f6a3a', '#2a5aa0', '#2a8ad0', '#7a5ab0', '#c03a7a'];
export const PAINT_COST = 150;

export function newEconomy(shipId) {
  return { cr: 300, metal: 0, cristal: 0, upg: { motor: 0, salto: 0, casco: 0, escudo: 0, sensor: 0 }, owned: [shipId], paint: {}, contracts: { offers: [], active: [], seq: 1, at: -1e9 }, mined: {}, done: 0 };
}
// economia salva pode vir de uma versão antiga: completa o que faltar
export function fixEconomy(e, shipId) {
  const n = newEconomy(shipId);
  if (!e) return n;
  const out = { ...n, ...e, upg: { ...n.upg, ...(e.upg || {}) }, contracts: { ...n.contracts, ...(e.contracts || {}) } };
  if (!out.owned.includes(shipId)) out.owned.push(shipId);
  return out;
}
export const canPay = (e, c) => e.cr >= c.cr && e.metal >= (c.metal || 0) && e.cristal >= (c.cristal || 0);
export function pay(e, c) { e.cr -= c.cr; e.metal -= c.metal || 0; e.cristal -= c.cristal || 0; }
export function gain(e, r) { e.cr += r.cr || 0; e.metal += r.metal || 0; e.cristal += r.cristal || 0; }
export const costTxt = (c) => [c.cr ? `${fmtNum(c.cr, 0)} CR` : '', c.metal ? `${c.metal} metal` : '', c.cristal ? `${c.cristal} cristal` : ''].filter(Boolean).join(' · ');

// nave com as melhorias, a pintura e o nome aplicados
export function shipWithUpgrades(base, e) {
  const u = e.upg, paint = e.paint[base.id] || null;
  return {
    ...base,
    maxC: base.maxC * (1 + 0.5 * u.motor), turn: base.turn * (1 + 0.08 * u.motor),
    jump: base.jump * (1 + 0.25 * u.salto), charge: base.charge * (1 - 0.12 * u.salto),
    paint, reg: (paint && paint.name) || base.reg,
  };
}
export const damageMul = (e, def) => (1 - 0.18 * e.upg.casco) * (def.armor || 1);
export const heatMul = (e) => 1 + 0.3 * e.upg.escudo;
export const scanMul = (e) => 1 + 0.6 * e.upg.sensor;
export const drillMul = (e, def) => (1 + 0.25 * e.upg.sensor) * (def.drill || 1);

// ---------------------------------------------------------------- contratos
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
const CARGO = ['peças de reator', 'sementes congeladas', 'filtros de água', 'baterias de dobra', 'módulos médicos', 'ligas estruturais'];
const POD_NAMES = ['Sabiá', 'Juriti', 'Carcará', 'Bem-te-vi', 'Tiê', 'Uirapuru', 'Jandaia', 'Graúna'];

// gera ofertas novas a partir da posição atual (estrelas dentro de ~1,6 saltos)
export function makeOffers(galaxy, S, here, range, count = 4) {
  let s = (S.eco.contracts.seq * 7919 + Math.floor(S.stats.time)) % 2147483647 || 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const stars = galaxy.within(here.x, here.y, here.z, range * 1.15).filter((i) => i !== S.sysIndex || r() < 0.3);
  const out = [];
  const used = new Set(S.eco.contracts.active.map((c) => c.star));
  const nType = {}, pods = new Set();
  for (let tries = 0; out.length < count && tries < 60; tries++) {
    const star = pick(stars, r);
    if (star == null || used.has(star)) continue;
    const sys = getSystem(galaxy, star);
    const dist = Math.hypot(galaxy.px[star] - here.x, galaxy.py[star] - here.y, galaxy.pz[star] - here.z);
    const name = galaxy.name(star);
    const far = 1 + dist / Math.max(range, 1);
    const type = galaxy.bh.has(star) ? 'bh' : pick(['scan', 'scan', 'sample', 'sample', 'salvage', 'salvage', 'rescue'], r);
    if ((nType[type] || 0) >= 2) continue; // variedade: no máximo dois do mesmo tipo
    const id = S.eco.contracts.seq++;
    const base = { id, type, star, starName: name, dist };
    if (type === 'bh') {
      out.push({ ...base, title: `Buraco negro em ${name}`, text: `Os físicos da Esperança querem dados de perto. Escaneie o buraco negro de ${name}.`, reward: { cr: Math.round(1400 * far), metal: 0, cristal: 5 } });
    } else if (type === 'scan') {
      const n = Math.min(3, sys.planets.length);
      if (n < 1) continue;
      out.push({ ...base, n, title: `Levantamento em ${name}`, text: `Escaneie ${n} planeta${n > 1 ? 's' : ''} de ${name}. Cada mundo mapeado é um lugar a menos para procurar às cegas.`, reward: { cr: Math.round((260 + 140 * n) * far), metal: 0, cristal: 0 } });
    } else if (type === 'sample') {
      const p = sys.planets.filter((b) => b.body === 'rocky' && b.temp > 130 && b.temp < 420 && b.pressure < 15 && b.special !== 'nova' && b.special !== 'terra');
      if (!p.length) continue;
      const b = pick(p, r);
      out.push({ ...base, planet: b.id, planetName: b.name, title: `Amostra de ${b.name}`, text: `Pouse em ${b.name} (${name}), desembarque e colete uma amostra do solo [F].`, reward: { cr: Math.round(650 * far), metal: 15, cristal: r() < 0.3 ? 1 : 0 } });
    } else if (type === 'salvage') {
      if (!sys.planets.length) continue;
      const what = pick(CARGO, r);
      out.push({ ...base, anchor: pick(sys.planets, r).id, title: `Carga perdida em ${name}`, text: `Um contêiner de ${what} se soltou durante a fuga. Ache-o em ${name} e segure [R] para rebocá-lo.`, reward: { cr: Math.round(420 * far), metal: 30 + Math.floor(r() * 20), cristal: r() < 0.4 ? 2 : 0 } });
    } else {
      if (!sys.planets.length) continue;
      const pod = pick(POD_NAMES, r);
      if (pods.has(pod)) continue;
      pods.add(pod);
      out.push({ ...base, anchor: pick(sys.planets, r).id, pod, title: `Socorro: cápsula ${pod}`, text: `Uma cápsula de fuga da Diáspora, a ${pod}, está à deriva em ${name} com duas pessoas. Chegue perto e segure [R].`, reward: { cr: Math.round(700 * far), metal: 0, cristal: 1 } });
    }
    used.add(star); nType[type] = (nType[type] || 0) + 1;
  }
  return out;
}

// passo do contrato como objetivo do HUD (mesmo formato das missões)
export function contractMission(c, S, galaxy) {
  const here = S.sysIndex === c.star && !!S.view;
  const done = c.type === 'scan' ? Object.keys(S.scanned).filter((id) => S.scanned[id].system === c.starName && !(c.before || []).includes(id)).length : 0;
  let text = c.text, keys = [['K', 'Contratos']], wp = { kind: 'star', index: c.star, label: c.starName.toUpperCase() };
  if (!here) keys = [['T', 'Marcar destino'], ['J', 'Saltar'], ['K', 'Contratos']];
  else if (c.type === 'scan') { text = `Escaneie ${c.n} planetas de ${c.starName} (${Math.min(done, c.n)}/${c.n}).`; keys = [['Tab', 'Escolher planeta'], ['F', 'Escanear']]; wp = null; }
  else if (c.type === 'sample') { wp = { kind: 'body', id: c.planet, label: c.planetName.toUpperCase() }; keys = [['T', 'Marcar'], ['P', 'Pousar'], ['F', 'Amostra (a pé)']]; }
  else if (c.type === 'salvage' || c.type === 'rescue') { wp = { kind: 'fleet', id: 'ct' + c.id, label: c.type === 'rescue' ? `CÁPSULA ${c.pod.toUpperCase()}` : 'CONTÊINER' }; keys = [['T', 'Marcar'], ['G', 'Voar até lá'], ['R', 'Segurar']]; }
  else if (c.type === 'bh') { keys = [['T', 'Marcar'], ['F', 'Escanear']]; wp = null; }
  return { idx: -1, total: 0, contract: true, title: c.title, text, keys, wp };
}

// ---------------------------------------------------------------- objetos dos contratos (no espaço)
export function propModel(type) {
  const g = new THREE.Group();
  if (type === 'rescue') {
    const hull = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5, metalness: 0.4 });
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 3, 6, 16).rotateX(Math.PI / 2), hull); g.add(pod);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.6, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd26a2a })); g.add(band);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a })); win.position.set(0, 1.1, 1.4); g.add(win);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) })); lamp.position.set(0, 1.4, -1.6); g.add(lamp);
    g.userData.lamp = lamp;
  } else {
    const body = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7, metalness: 0.5 });
    const c = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 7), body); g.add(c);
    for (const z of [-3, 0, 3]) { const rib = new THREE.Mesh(new THREE.BoxGeometry(3.15, 3.15, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a3a3a })); rib.position.z = z; g.add(rib); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.5, 0.6) })); lamp.position.set(0, 1.7, 3.2); g.add(lamp);
    g.userData.lamp = lamp;
  }
  g.scale.setScalar(0.001);
  return g;
}

export const shipCatalog = () => ALL_SHIPS();
