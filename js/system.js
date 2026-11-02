// Geração de sistemas planetários (Sistema Solar real, exoplanetas reais e sistemas procedurais)
import { KIND } from './galaxy.js';
import { mulberry32, gauss, clamp, KM_PER_AU, R_SUN, R_EARTH, DAY } from './util.js';

const GM_SUN = 1.32712440018e11; // km³/s²
const GM_EARTH = 398600.4418;

export const TYPE_NAME = {
  terrestre: 'Terrestre', oceano: 'Mundo oceânico', deserto: 'Desértico', deserto_frio: 'Desértico frio',
  rochoso: 'Rochoso sem atmosfera', lava: 'Mundo de lava', venusiano: 'Estufa tóxica', gelo: 'Mundo gelado',
  tundra: 'Tundra congelada', vulcanico: 'Vulcânico', nebuloso: 'Coberto por névoa', gasoso: 'Gigante gasoso',
  gelo_gigante: 'Gigante de gelo', ruinas: 'Planeta destruído', anao: 'Planeta anão', buraco_negro: 'Buraco negro',
};
export const RS_PER_MSUN = 2.95325; // raio de Schwarzschild (km) por massa solar

const ATM = {
  terra: { thick: 0.016, tauR: [0.045, 0.1, 0.22], tauM: [0.02, 0.02, 0.02], g: 0.76 },
  marte: { thick: 0.02, tauR: [0.006, 0.004, 0.003], tauM: [0.09, 0.05, 0.025], g: 0.65 },
  venus: { thick: 0.035, tauR: [0.25, 0.2, 0.09], tauM: [0.5, 0.42, 0.25], g: 0.7 },
  titan: { thick: 0.1, tauR: [0.04, 0.03, 0.01], tauM: [0.7, 0.4, 0.12], g: 0.6 },
  jupiter: { thick: 0.012, tauR: [0.03, 0.045, 0.08], tauM: [0.03, 0.028, 0.022], g: 0.7 },
  netuno: { thick: 0.014, tauR: [0.02, 0.07, 0.16], tauM: [0.01, 0.015, 0.02], g: 0.7 },
  quente: { thick: 0.02, tauR: [0.1, 0.05, 0.03], tauM: [0.15, 0.08, 0.04], g: 0.7 },
};

export function getSystem(galaxy, i) {
  galaxy._sys = galaxy._sys || new Map();
  if (galaxy._sys.has(i)) return galaxy._sys.get(i);
  const star = {
    index: i, name: galaxy.name(i), spectral: galaxy.spectral(i), kind: galaxy.kind[i],
    temp: galaxy.temp[i], lum: galaxy.lum[i], radius: galaxy.rad[i] * R_SUN, mass: galaxy.mass[i],
    bh: galaxy.bh.get(i) || null,
  };
  const key = galaxy.realKey.get(i);
  const rng = mulberry32(galaxy.seedOf(i));
  let planets;
  if (key && REAL_SYSTEMS[key]) planets = REAL_SYSTEMS[key](star, rng);
  else planets = procedural(star, rng, i === galaxy.novaTerra);
  planets.forEach((p, k) => finalize(p, star, k, rng, null));
  const sys = { star, planets, bodies: [] };
  for (const p of planets) {
    sys.bodies.push(p);
    for (const m of p.moons) sys.bodies.push(m);
  }
  galaxy._sys.set(i, sys);
  return sys;
}

// ----------------------------------------------------------------------------
// Construção de planetas
// ----------------------------------------------------------------------------
function teqAt(star, aAU) { return 278.6 * Math.pow(star.lum, 0.25) / Math.sqrt(aAU); }

// Cria um corpo rochoso a partir de parâmetros físicos; tudo pode ser sobrescrito por `o`
function rocky(star, aAU, mass, rng, o = {}) {
  const p = { body: 'rocky', aAU, mass };
  p.radius = o.radius ?? R_EARTH * Math.pow(mass, mass < 1 ? 0.3 : 0.27);
  const teq = o.teq ?? teqAt(star, aAU);
  let P = o.pressure;
  if (P === undefined) {
    if (mass < 0.12) P = rng() < 0.15 ? rng() * 0.02 : 0;
    else P = clamp(Math.pow(10, gauss(rng) * 0.75 + Math.log10(mass) * 1.1 - 0.1), 0, 120);
    if (teq > 600 && mass < 0.6) P *= 0.05;
  }
  p.pressure = P;
  p.temp = o.temp ?? teq * 0.92 * (1 + 0.13 * Math.pow(P, 0.62));
  const T = p.temp;
  let water = o.water;
  if (water === undefined) {
    if (P < 0.006) water = T < 200 ? rng() * 0.4 : 0;
    else if (T > 373) water = 0;
    else water = clamp(rng() * 1.1 - 0.05, 0, 1);
  }
  p.water = water;
  let type = o.type;
  if (!type) {
    if (T > 900) type = 'lava';
    else if (P > 30) type = 'venusiano';
    else if (P < 0.006) type = T < 160 ? 'gelo' : 'rochoso';
    else if (T > 373) type = 'deserto';
    else if (T >= 268) type = water > 0.85 ? 'oceano' : water > 0.15 ? 'terrestre' : 'deserto';
    else if (T >= 190) type = water > 0.2 ? 'tundra' : 'deserto_frio';
    else type = 'gelo';
  }
  p.type = type;
  p.magnet = o.magnet ?? (mass > 0.35 && rng() < 0.7);
  let o2 = o.o2;
  if (o2 === undefined) {
    o2 = 0;
    if ((type === 'terrestre' || type === 'oceano') && T > 262 && T < 318 && P > 0.35 && P < 3.5 && rng() < 0.3)
      o2 = 0.1 + rng() * 0.18;
  }
  p.o2 = o2;
  p.life = o.life ?? (o2 > 0.17 ? 'complexa' : o2 > 0.05 ? 'microbiana' : 'nenhuma');
  p.atmoComp = o.atmoComp ?? atmoComposition(p);
  p.rings = o.rings ?? null;
  p.special = o.special ?? null;
  p.realName = o.name ?? null;
  p.tilt = o.tilt ?? rng() * 0.5;
  p.rotPeriod = o.rotPeriod ?? (0.4 + rng() * 2) * DAY;
  p.moonsSpec = o.moons ?? null;
  p.desc = o.desc ?? null;
  return p;
}

// Buraco negro como corpo do sistema (em órbita relativa à estrela companheira)
function blackHole(star, aAU, massSun, rng, o = {}) {
  const rs = RS_PER_MSUN * massSun;
  return {
    body: 'bh', aAU, mass: massSun * 332946, massSun, rs, radius: rs * 3, type: 'buraco_negro',
    temp: 0, pressure: 0, water: 0, o2: 0, life: 'nenhuma', magnet: false, atmoComp: '—', rings: null,
    special: 'bh', realName: o.name ?? null, tilt: o.tilt ?? 0.35, rotPeriod: DAY, moonsSpec: [], desc: o.desc ?? null,
    active: !!o.active, periodDays: o.periodDays ?? null,
  };
}

function giant(star, aAU, mass, rng, o = {}) {
  const p = { body: 'gas', aAU, mass };
  const ice = o.ice ?? mass < 40;
  p.type = ice ? 'gelo_gigante' : 'gasoso';
  p.radius = o.radius ?? (ice ? R_EARTH * (3.6 + rng() * 0.6) * Math.pow(mass / 15, 0.1) : 69911 * clamp(Math.pow(mass / 318, 0.05), 0.75, 1.2));
  p.temp = o.temp ?? teqAt(star, aAU) * 0.9;
  if (p.temp > 900 && !ice) p.radius *= 1.25; // Júpiter quente inflado
  p.pressure = Infinity; p.water = 0; p.o2 = 0; p.life = 'nenhuma';
  p.magnet = true;
  p.atmoComp = ice ? 'H₂, He, CH₄' : 'H₂, He';
  p.rings = o.rings !== undefined ? o.rings : rng() < (ice ? 0.35 : 0.3) ? { inner: 1.25 + rng() * 0.3, outer: 1.9 + rng() * 0.8, op: 0.3 + rng() * 0.6 } : null;
  p.tilt = o.tilt ?? rng() * 0.5;
  p.rotPeriod = o.rotPeriod ?? (0.35 + rng() * 0.4) * DAY;
  p.realName = o.name ?? null;
  p.moonsSpec = o.moons ?? null;
  p.palette = o.palette ?? null;
  p.desc = o.desc ?? null;
  p.special = o.special ?? null;
  return p;
}

function atmoComposition(p) {
  if (p.pressure < 0.006) return 'Nenhuma (vácuo)';
  if (p.type === 'venusiano') return 'CO₂, N₂, nuvens de H₂SO₄';
  if (p.o2 > 0.05) return 'N₂ ' + Math.round((1 - p.o2 - 0.01) * 100) + '%, O₂ ' + Math.round(p.o2 * 100) + '%, Ar';
  if (p.type === 'lava') return 'SO₂, CO₂ (traços)';
  if (p.type === 'deserto_frio') return 'CO₂, N₂, Ar';
  if (p.type === 'nebuloso') return 'N₂, CH₄ (névoa orgânica)';
  if (p.type === 'gelo') return 'N₂, CH₄ (rarefeita)';
  return 'N₂, CO₂';
}

// ----------------------------------------------------------------------------
// Habitabilidade
// ----------------------------------------------------------------------------
export function habitability(p, star) {
  const f = { temp: 0, grav: 0, press: 0, agua: 0, oxig: 0, magnet: 0, estrela: 0 };
  if (p.body === 'gas' || p.body === 'bh' || p.type === 'ruinas') return { score: 0, f };
  const g = p.mass / Math.pow(p.radius / R_EARTH, 2);
  p.gravity = g;
  f.temp = Math.exp(-Math.pow((p.temp - 288) / 34, 2));
  f.grav = Math.exp(-Math.pow((g - 1) / 0.5, 2));
  f.press = p.pressure < 0.006 ? 0 : Math.exp(-Math.pow(Math.log10(p.pressure), 2) / (2 * 0.5 * 0.5));
  const liquid = p.temp > 273 && p.temp < 373 && p.pressure > 0.006;
  f.agua = liquid ? clamp(1 - Math.abs(p.water - 0.62) * 0.9, 0.1, 1) * (p.water > 0.05 ? 1 : 0.15) : 0.08;
  f.oxig = p.o2 >= 0.16 ? 1 : 0.55 + p.o2 * 2.8;
  f.magnet = p.magnet ? 1 : 0.7;
  const sk = { [KIND.G]: 1, [KIND.K]: 0.97, [KIND.F]: 0.9, [KIND.M]: 0.62, [KIND.A]: 0.55, [KIND.B]: 0.2, [KIND.O]: 0.1, [KIND.GIANT]: 0.3, [KIND.WD]: 0.3, [KIND.SUPER]: 0.1 };
  f.estrela = sk[star.kind] ?? 0.5;
  const s = Math.pow(f.temp, 0.9) * Math.pow(f.grav, 0.5) * Math.pow(f.press, 0.6) * Math.pow(f.agua, 0.7) *
    Math.pow(f.oxig, 0.6) * Math.pow(f.magnet, 0.5) * f.estrela;
  return { score: Math.round(clamp(s, 0, 1) * 100), f };
}

// ----------------------------------------------------------------------------
// Finalização: órbita, nomes, visual, luas
// ----------------------------------------------------------------------------
const LETTER = 'bcdefghijklmnop';

function finalize(p, star, k, rng, parent) {
  p.kind = parent ? 'moon' : 'planet';
  p.parent = parent;
  if (!parent) {
    p.name = p.realName ? p.realName : star.name + ' ' + LETTER[k];
    p.a = p.aAU * KM_PER_AU;
    p.period = p.periodDays ? p.periodDays * DAY : 2 * Math.PI * Math.sqrt(Math.pow(p.a, 3) / (GM_SUN * star.mass));
  } else {
    p.name = p.realName || parent.name + ' ' + ['I', 'II', 'III', 'IV', 'V', 'VI'][k];
    p.period = 2 * Math.PI * Math.sqrt(Math.pow(p.a, 3) / (GM_EARTH * parent.mass));
  }
  p.phase = rng() * Math.PI * 2;
  p.inc = (rng() - 0.5) * (parent ? 0.08 : 0.06);
  p.node = rng() * Math.PI * 2;
  p.seed = Math.floor(rng() * 100000);
  p.hab = habitability(p, star);
  p.visual = visualFor(p, rng, star);
  p.finds = discoveries(p, rng);
  p.id = star.index + ':' + (parent ? parent.name + '/' : '') + p.name;
  p.moons = [];
  if (!parent) {
    const specs = p.moonsSpec ?? autoMoons(p, star, rng);
    specs.forEach((m, j) => {
      finalize(m, star, j, rng, p);
      p.moons.push(m);
    });
  }
  delete p.moonsSpec;
}

function autoMoons(p, star, rng) {
  const out = [];
  let n = 0;
  if (p.body === 'gas') n = Math.floor(rng() * 5);
  else if (p.mass > 0.3 && rng() < 0.35) n = 1;
  let a = p.radius * (p.body === 'gas' ? 5 + rng() * 4 : 15 + rng() * 30);
  if (p.rings) a = Math.max(a, p.radius * (p.rings.outer + 0.8));
  for (let j = 0; j < n; j++) {
    const big = p.body === 'gas' && rng() < 0.25;
    const mass = big ? 0.02 + rng() * 0.4 : 0.0005 + rng() * 0.02;
    const m = rocky(star, p.aAU, mass, rng, { radius: R_EARTH * Math.pow(mass, 0.3) * 0.95, tilt: 0, rotPeriod: (2 + rng() * 10) * DAY });
    m.a = a;
    out.push(m);
    a *= 1.5 + rng() * 0.9;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Parâmetros visuais (consumidos pelos shaders)
// ----------------------------------------------------------------------------
function jitter(hex, rng, amt = 0.08) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const k = 1 + (rng() - 0.5) * amt * 2;
  r = clamp(r * k + (rng() - 0.5) * amt, 0, 1); g = clamp(g * k + (rng() - 0.5) * amt, 0, 1); b = clamp(b * k + (rng() - 0.5) * amt, 0, 1);
  return '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// Várias paletas por tipo de mundo: cada planeta sorteia uma e depois recebe variação própria
// [oceano fundo, oceano raso, praia, terras baixas, terras médias, terras altas, neve]
const PALS = {
  terrestre: [
    ['#051a40', '#17627f', '#c9b88d', '#556b33', '#6d5b3e', '#8b8479', '#f0f3f6'],
    ['#04283a', '#127a7a', '#d2c08a', '#6f7a3a', '#8a6a40', '#9a8f80', '#f2f2ee'],
    ['#06163a', '#1d4f8f', '#d8b48a', '#7a5a3a', '#8a4a32', '#7d6f66', '#f4f0ea'],
    ['#071c33', '#1a5a6a', '#c8b078', '#8a7a48', '#a08850', '#8a8270', '#f0eee8'],
  ],
  oceano: [
    ['#03163a', '#145a80', '#b9b089', '#3d6236', '#5d5341', '#7b7468', '#eef2f6'],
    ['#032a2a', '#0f6e66', '#c8c090', '#3d6236', '#5d5341', '#7b7468', '#eef2f6'],
    ['#050f38', '#1b3f9a', '#d0c49a', '#4a5a30', '#6a5a40', '#857a6a', '#f2f4f8'],
    ['#02202e', '#1a7090', '#e0d0a0', '#5a6a3a', '#7a6a48', '#8a8070', '#f0f4f6'],
  ],
  deserto: [
    ['#000000', '#000000', '#dcb47e', '#c78b52', '#a9673a', '#78492d', '#e8dccf'],
    ['#000000', '#000000', '#d08850', '#b0603a', '#8a4a2a', '#6a3a22', '#e8d8c8'],
    ['#000000', '#000000', '#e2c860', '#c89a3a', '#8a8a3a', '#6a6a30', '#f0e8b0'],
    ['#000000', '#000000', '#cfa59a', '#a8807a', '#8a6a68', '#6a5555', '#eee6e2'],
    ['#000000', '#000000', '#e8d8a8', '#c8b080', '#a89068', '#887050', '#f4eedc'],
  ],
  deserto_frio: [
    ['#000000', '#000000', '#c0703f', '#a8502a', '#8a3f22', '#5f3220', '#efe3da'],
    ['#000000', '#000000', '#a89080', '#8a7060', '#6a5848', '#504038', '#efe9e2'],
    ['#000000', '#000000', '#b8885a', '#98683e', '#7a5030', '#5a3c26', '#f0e8de'],
  ],
  rochoso: [
    ['#000000', '#000000', '#8c8781', '#77726c', '#5c5853', '#a19c94', '#d0ccc6'],
    ['#000000', '#000000', '#9a8468', '#7a6650', '#5a4a3a', '#b0a088', '#d8d0c0'],
    ['#000000', '#000000', '#7a4a3a', '#5a3428', '#432820', '#8a6a5a', '#c8b8b0'],
    ['#000000', '#000000', '#b8a058', '#988040', '#706030', '#c8b878', '#e0d8b0'],
    ['#000000', '#000000', '#6a6a72', '#55555e', '#40404a', '#8a8a94', '#c8c8d0'],
  ],
  lava: [['#000000', '#000000', '#2a1f1b', '#1b1512', '#2e2522', '#45403c', '#555050']],
  venusiano: [
    ['#000000', '#000000', '#b88f55', '#9c7442', '#7f5c34', '#6b4c2c', '#d8c49a'],
    ['#000000', '#000000', '#c87a40', '#a85a30', '#884020', '#703020', '#e0a070'],
  ],
  gelo: [
    ['#000000', '#000000', '#dbe5ee', '#c4d3e2', '#a9bccf', '#e9f0f6', '#ffffff'],
    ['#000000', '#000000', '#bfe8ee', '#9ad6e0', '#7cc0d0', '#d8f4f8', '#ffffff'],
    ['#000000', '#000000', '#e8d0c0', '#c8a088', '#a07060', '#f0e0d8', '#ffffff'],
    ['#000000', '#000000', '#e0e0d0', '#c0b8a0', '#a09880', '#f0eee0', '#ffffff'],
  ],
  tundra: [
    ['#9fb6c9', '#b9cddd', '#9a917f', '#7d7462', '#6b6355', '#938a7c', '#f3f6f9'],
    ['#1a3a50', '#3a6a80', '#a09880', '#6a6a50', '#5a5040', '#8a8070', '#f4f6f8'],
  ],
  vulcanico: [['#000000', '#000000', '#e0c95c', '#c49a35', '#e8e2a8', '#8a4a1e', '#f0eccc']],
  nebuloso: [['#1c2a3a', '#3b4a50', '#b0773a', '#8c5a2c', '#6f4a2a', '#5a3d25', '#d8b080']],
  ruinas: [['#000000', '#000000', '#2c201b', '#1e1714', '#33291f', '#4a3f36', '#5a5048']],
};

// Cor da vegetação conforme a luz da estrela (fotossíntese adaptada ao espectro)
function vegFor(star, rng) {
  const T = star.temp;
  const opts = T < 3900 ? ['#2a1a30', '#4a1c28', '#1e1e24'] : T < 5300 ? ['#3a4a1a', '#5a3a1a', '#2c5a1f', '#6a2a1a'] : T < 6000 ? ['#2c5a1f', '#1f4a1a', '#3a6a2a'] : ['#1f4a4a', '#2a5a3a', '#3a5070'];
  return opts[Math.floor(rng() * opts.length)];
}

const hexLin = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
};
const mixc = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);

// Cor média aparente (usada quando o planeta é só um ponto no céu)
function averageColor(v, p) {
  if (v.shader === 'gas') return mixc(mixc(hexLin(v.c1), hexLin(v.c2), 0.5), hexLin(v.c3), 0.3);
  let c = mixc(hexLin(v.low), hexLin(v.mid), 0.5);
  if (v.veg > 0) c = mixc(c, hexLin(v.vegColor), v.veg * 0.4);
  if (v.sea > -1.5) c = mixc(c, mixc(hexLin(v.deep), hexLin(v.shallow), 0.4), clamp(p.water * 0.9 + (v.sea > 0.1 ? 0.3 : 0), 0, 0.95));
  c = mixc(c, hexLin(v.snow), clamp(1 - v.iceLat, 0, 1));
  if (v.clouds > 0) c = mixc(c, hexLin(v.cloudColor), Math.min(v.clouds * 0.7, 0.95));
  if (v.lava > 0.5) c = mixc(c, [0.5, 0.08, 0.01], 0.35);
  return c;
}

function visualFor(p, rng, star) {
  if (p.body === 'bh') return { shader: 'bh', disk: p.active ? 1 : 0, avg: [0, 0, 0] };
  if (p.body === 'gas') { const g = gasVisual(p, rng); g.avg = averageColor(g, p); return g; }
  const t = p.type;
  const set = PALS[t] || PALS.rochoso;
  const base = p.special === 'nova' ? PALS.terrestre[0] : set[Math.floor(rng() * set.length)];
  const pal = base.map((h) => jitter(h, rng, t === 'terrestre' || t === 'oceano' ? 0.05 : 0.09));
  const v = {
    shader: 'rocky', seed: p.seed % 1000 + rng(), contScale: 1.1 + rng() * 1.1, warp: 0.4 + rng() * 0.8,
    deep: pal[0], shallow: pal[1], beach: pal[2], low: pal[3], mid: pal[4], high: pal[5], snow: pal[6],
    sea: -2, relief: 4 + rng() * 6, veg: 0, vegColor: jitter(vegFor(star, rng), rng, 0.05), iceLat: 2,
    clouds: 0, cloudColor: rng() < 0.2 ? '#f2ead8' : '#ffffff', lava: 0, craters: 0, atm: null,
    islands: 0, storm: 0, stormDir: [0, 1, 0],
  };
  const storm = () => {
    // ciclone tropical em latitude média (15–35°)
    const lat = (0.26 + rng() * 0.35) * (rng() < 0.5 ? -1 : 1), lon = rng() * Math.PI * 2;
    v.storm = 0.6 + rng() * 0.4;
    v.stormDir = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  };
  const scaleAtm = (a, P) => ({ ...a, tauR: a.tauR.map((x) => x * P), tauM: a.tauM.map((x) => x * P) });
  switch (t) {
    case 'terrestre':
      v.sea = -0.05 + p.water * 0.35 - 0.15; v.clouds = 0.25 + rng() * 0.3; v.iceLat = clamp(0.95 - (p.temp - 250) / 120, 0.55, 1.1);
      v.veg = p.life === 'complexa' ? 0.75 + rng() * 0.25 : p.life === 'microbiana' ? 0.25 : 0;
      v.atm = scaleAtm(ATM.terra, clamp(Math.sqrt(p.pressure), 0.4, 2.2));
      v.islands = rng() < 0.5 ? rng() * 0.5 : 0;
      if (rng() < 0.35) storm();
      if (p.special === 'nova') { v.clouds = 0.36; v.sea = -0.1; v.veg = 1; v.vegColor = '#2c5a1f'; v.cloudColor = '#ffffff'; v.storm = 0; v.islands = 0.3; }
      break;
    case 'oceano':
      // mundo oceânico: arquipélagos vulcânicos e alguns continentes pequenos
      v.sea = 0.12 + rng() * 0.16; v.clouds = 0.28 + rng() * 0.3; v.iceLat = clamp(0.95 - (p.temp - 250) / 120, 0.6, 1.1);
      v.islands = 0.6 + rng() * 0.4;
      v.veg = p.life === 'complexa' ? 0.8 : p.life === 'microbiana' ? 0.3 : 0;
      v.atm = scaleAtm(ATM.terra, clamp(Math.sqrt(p.pressure), 0.4, 2.2));
      if (rng() < 0.6) storm();
      break;
    case 'deserto':
      v.clouds = p.pressure > 0.3 ? rng() * 0.15 : 0; v.relief = 6 + rng() * 6;
      v.atm = p.pressure > 0.02 ? scaleAtm(ATM.marte, clamp(Math.sqrt(p.pressure) * 1.5, 0.3, 3)) : null;
      break;
    case 'deserto_frio':
      v.iceLat = 0.82 + rng() * 0.08; v.craters = 0.35; v.relief = 8 + rng() * 6;
      v.atm = p.pressure > 0.002 ? scaleAtm(ATM.marte, clamp(Math.sqrt(p.pressure / 0.006), 0.4, 3)) : null;
      break;
    case 'rochoso': case 'anao':
      v.craters = 0.6 + rng() * 0.4; v.relief = 3 + rng() * 4; break;
    case 'lava':
      v.lava = 0.8 + rng() * 0.2; v.relief = 5; v.craters = 0.2;
      v.atm = p.pressure > 0.05 ? scaleAtm(ATM.quente, 0.6) : null;
      break;
    case 'venusiano':
      v.clouds = 1.0; v.cloudColor = jitter(['#e3cf98', '#e8c080', '#d8d0b0', '#e0a868'][Math.floor(rng() * 4)], rng, 0.05); v.atm = ATM.venus; break;
    case 'gelo':
      v.craters = 0.3 + rng() * 0.3; v.relief = 2 + rng() * 2;
      v.atm = p.pressure > 0.01 ? scaleAtm(ATM.netuno, 0.4) : null; break;
    case 'tundra':
      v.sea = -0.05 + p.water * 0.3 - 0.15; v.iceLat = 0.35 + rng() * 0.25; v.clouds = 0.25 + rng() * 0.2; v.islands = rng() * 0.4;
      v.atm = scaleAtm(ATM.terra, clamp(Math.sqrt(p.pressure), 0.3, 2)); break;
    case 'vulcanico':
      v.lava = 0.25; v.relief = 3; break;
    case 'nebuloso':
      v.clouds = 0.97; v.cloudColor = '#c98a3e'; v.sea = -0.2; v.atm = ATM.titan; break;
    case 'ruinas':
      v.lava = 1.0; v.craters = 1.0; v.relief = 6; v.warp = 1.6; break;
  }
  v.avg = averageColor(v, p);
  return v;
}

const GAS_PAL = {
  quente: [['#3d2a24', '#7a3c25', '#b0643d', '#ff6a2a'], ['#2a1a2e', '#5a2a40', '#a0503a', '#ff5a3a'], ['#3a3020', '#7a5a28', '#c08a40', '#ffa040']],
  morno: [['#d7c4a0', '#a57a55', '#efe7d6', '#b4523a'], ['#c8a878', '#8a5a3a', '#e8d4b0', '#a03a2a'], ['#b8b098', '#7a7058', '#e0dcc8', '#8a6a4a'], ['#d0b890', '#a07848', '#f0e0c0', '#c87040']],
  frio: [['#c8b98f', '#a99467', '#e8dcc0', '#b08455'], ['#d8c898', '#b8a070', '#f0e6c8', '#c89a60'], ['#b0b8a0', '#909878', '#d8dcc8', '#8a8a60']],
  gelo: [['#7fb6d6', '#5e93c4', '#a9d2e6', '#2c4a8a'], ['#80c8c0', '#5aa8a8', '#b0e0dc', '#2a6a7a'], ['#8aa0d8', '#6a78c0', '#b8c4ec', '#3a3a8a'], ['#9ad0e0', '#78b8d0', '#c8ecf4', '#4a7aa0']],
};

function gasVisual(p, rng) {
  let pal = p.palette;
  if (!pal) {
    const set = p.type === 'gelo_gigante' ? GAS_PAL.gelo : p.temp > 700 ? GAS_PAL.quente : p.temp > 130 ? GAS_PAL.morno : GAS_PAL.frio;
    pal = set[Math.floor(rng() * set.length)].map((h) => jitter(h, rng, 0.12));
  }
  return {
    shader: 'gas', seed: p.seed % 1000 + rng(), c1: pal[0], c2: pal[1], c3: pal[2], stormColor: pal[3],
    bands: p.type === 'gelo_gigante' ? 6 + rng() * 6 : 12 + rng() * 14,
    turb: p.type === 'gelo_gigante' ? 0.3 + rng() * 0.3 : 0.8 + rng() * 0.8,
    storm: rng() < 0.5 ? 0.5 + rng() * 0.5 : 0, stormLat: (rng() - 0.5) * 0.7, stormLon: rng() * 6.28,
    emissive: p.temp > 900 ? 0.15 : 0,
    atm: p.type === 'gelo_gigante' ? ATM.netuno : p.temp > 700 ? ATM.quente : ATM.jupiter,
    ringColor: jitter(p.type === 'gelo_gigante' ? '#8f9aa6' : '#d6c4a0', rng, 0.08),
  };
}

// ----------------------------------------------------------------------------
// Sistemas procedurais
// ----------------------------------------------------------------------------
function procedural(star, rng, isNovaTerra) {
  const L = star.lum, kind = star.kind;
  let n;
  if (kind === KIND.WD || kind === KIND.SUPER) n = Math.floor(rng() * 3);
  else if (kind === KIND.O || kind === KIND.B) n = Math.floor(rng() * 4);
  else if (kind === KIND.GIANT) n = Math.floor(rng() * 4);
  else if (kind === KIND.M) n = 1 + Math.floor(rng() * 6);
  else n = 2 + Math.floor(rng() * 8);
  const hzIn = Math.sqrt(L / 1.1), hzOut = Math.sqrt(L / 0.53), hzMid = (hzIn + hzOut) / 2;
  const frost = 2.7 * Math.sqrt(L);
  const minA = Math.max((star.radius * 4) / KM_PER_AU, 0.012);
  let a = Math.max(minA, hzIn * (0.15 + rng() * 0.5));
  const out = [];
  for (let k = 0; k < n; k++) {
    const beyond = a > frost;
    const giantChance = beyond ? 0.55 : 0.06;
    if (rng() < giantChance) {
      const ice = beyond && rng() < 0.4;
      const mass = ice ? 10 + rng() * 40 : 50 + Math.pow(rng(), 2) * 1500;
      out.push(giant(star, a, mass, rng, { ice }));
    } else {
      const mass = clamp(Math.pow(10, gauss(rng) * 0.45 - 0.05), 0.04, 8);
      out.push(rocky(star, a, mass, rng));
    }
    a *= 1.45 + rng() * 0.9;
  }
  if (isNovaTerra) {
    // O mundo da bioassinatura: substitui (ou insere) o planeta mais próximo do centro da zona habitável
    const nova = rocky(star, hzMid, 0.95 + rng() * 0.15, rng, {
      temp: 286 + rng() * 5, pressure: 1.0 + rng() * 0.15, water: 0.66 + rng() * 0.08, o2: 0.21, magnet: true,
      life: 'complexa', type: 'terrestre', tilt: 0.38, rotPeriod: 1.07 * DAY,
      desc: 'Oceanos, continentes verdes e uma atmosfera respirável. A bioassinatura da sonda Vigia-7 vinha daqui.',
      special: 'nova',
    });
    let best = -1, bd = Infinity;
    out.forEach((p, k) => { const d = Math.abs(Math.log(p.aAU / hzMid)); if (d < bd) { bd = d; best = k; } });
    if (best >= 0 && bd < 0.35) out[best] = nova;
    else out.push(nova);
    out.sort((x, y) => x.aAU - y.aAU);
    // espaça órbitas próximas demais
    for (let k = 1; k < out.length; k++) if (out[k].aAU < out[k - 1].aAU * 1.3) out[k].aAU = out[k - 1].aAU * 1.3;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Sistemas reais
// ----------------------------------------------------------------------------
const moon = (star, name, radius, mass, aKm, rng, o = {}) => {
  const m = rocky(star, 1, mass, rng, { radius, name, tilt: 0, rotPeriod: o.rotPeriod ?? 5 * DAY, ...o });
  m.a = aKm;
  return m;
};

const REAL_SYSTEMS = {
  sol(star, rng) {
    const S = star;
    return [
      rocky(S, 0.387, 0.055, rng, { name: 'Mercúrio', radius: 2440, pressure: 0, temp: 440, water: 0, type: 'rochoso', magnet: true, rotPeriod: 58.6 * DAY, tilt: 0.0, moons: [] }),
      rocky(S, 0.723, 0.815, rng, { name: 'Vênus', radius: 6052, pressure: 92, temp: 737, water: 0, type: 'venusiano', magnet: false, rotPeriod: -243 * DAY, tilt: 3.09, moons: [] }),
      rocky(S, 1.0, 0.92, rng, {
        name: 'Terra', radius: 6371, pressure: 0, temp: 1400, water: 0, type: 'ruinas', magnet: false, rotPeriod: 0.8 * DAY, tilt: 0.41,
        special: 'terra', desc: 'O que restou do nosso lar: a crosta foi estilhaçada e o manto está exposto, ainda incandescente, cercado por bilhões de toneladas de destroços. O raio continua o mesmo — 6.371 km.',
        moons: [moon(S, 'Lua', 1737, 0.0123, 384400, rng, { type: 'rochoso', pressure: 0, temp: 250, water: 0, magnet: false, rotPeriod: 27.3 * DAY })],
      }),
      rocky(S, 1.524, 0.107, rng, { name: 'Marte', radius: 3390, pressure: 0.006, temp: 210, water: 0.02, type: 'deserto_frio', magnet: false, rotPeriod: 1.03 * DAY, tilt: 0.44, moons: [] }),
      giant(S, 5.2, 317.8, rng, {
        name: 'Júpiter', radius: 69911, ice: false, rings: null, tilt: 0.05, rotPeriod: 0.414 * DAY, temp: 165,
        palette: ['#d8c6a3', '#9c7253', '#f1ece2', '#b5533a'],
        moons: [
          moon(S, 'Io', 1821, 0.015, 421700, rng, { type: 'vulcanico', pressure: 0, temp: 130, water: 0, magnet: false }),
          moon(S, 'Europa', 1561, 0.008, 671034, rng, { type: 'gelo', pressure: 0, temp: 102, water: 0.9, magnet: false }),
          moon(S, 'Ganimedes', 2634, 0.025, 1070412, rng, { type: 'gelo', pressure: 0, temp: 110, water: 0.5, magnet: true }),
          moon(S, 'Calisto', 2410, 0.018, 1882709, rng, { type: 'rochoso', pressure: 0, temp: 134, water: 0.2, magnet: false }),
        ],
      }),
      giant(S, 9.58, 95.2, rng, {
        name: 'Saturno', radius: 58232, ice: false, tilt: 0.47, rotPeriod: 0.44 * DAY, temp: 134,
        rings: { inner: 1.24, outer: 2.27, op: 0.9 }, palette: ['#e2d1a2', '#c6a874', '#efe5c6', '#d8b37a'],
        moons: [moon(S, 'Titã', 2575, 0.0225, 1221870, rng, { type: 'nebuloso', pressure: 1.45, temp: 94, water: 0.3, magnet: false })],
      }),
      giant(S, 19.2, 14.5, rng, { name: 'Urano', radius: 25362, ice: true, tilt: 1.71, rotPeriod: -0.72 * DAY, temp: 76, rings: { inner: 1.6, outer: 2.0, op: 0.15 }, palette: ['#a6dce2', '#98d0d9', '#c2eaee', '#7fbcc8'], moons: [] }),
      giant(S, 30.05, 17.1, rng, {
        name: 'Netuno', radius: 24622, ice: true, tilt: 0.49, rotPeriod: 0.67 * DAY, temp: 72, rings: null, palette: ['#3d68cc', '#2a4ea6', '#6890e3', '#1a2c70'],
        moons: [moon(S, 'Tritão', 1353, 0.0036, 354759, rng, { type: 'gelo', pressure: 0.00001, temp: 38, water: 0.3, magnet: false })],
      }),
      rocky(S, 39.5, 0.0022, rng, { name: 'Plutão', radius: 1188, pressure: 0, temp: 44, water: 0.3, type: 'gelo', magnet: false, rotPeriod: -6.4 * DAY, moons: [] }),
    ];
  },
  proxima(S, rng) {
    return [
      rocky(S, 0.0288, 0.26, rng, { name: 'Proxima d', pressure: 0, type: 'rochoso' }),
      rocky(S, 0.0485, 1.07, rng, { name: 'Proxima b', pressure: 0.35, water: 0.12, magnet: false, desc: 'Travado por maré: um lado em dia eterno, o outro em noite eterna. Erupções da estrela varrem sua atmosfera.' }),
    ];
  },
  epseri(S, rng) { return [giant(S, 3.48, 207, rng, { name: 'Epsilon Eridani b', ice: false })]; },
  ross128(S, rng) { return [rocky(S, 0.0496, 1.4, rng, { name: 'Ross 128 b', pressure: 0.7, water: 0.3, magnet: false })]; },
  tauceti(S, rng) {
    return [
      rocky(S, 0.133, 1.75, rng, { name: 'Tau Ceti g' }), rocky(S, 0.243, 1.83, rng, { name: 'Tau Ceti h' }),
      rocky(S, 0.538, 3.93, rng, { name: 'Tau Ceti e', pressure: 3, water: 0.1 }), rocky(S, 1.334, 3.93, rng, { name: 'Tau Ceti f', pressure: 1.5, water: 0.4 }),
    ];
  },
  teegarden(S, rng) {
    return [
      rocky(S, 0.0252, 1.05, rng, { name: 'Teegarden b', pressure: 0.9, water: 0.45, magnet: true }),
      rocky(S, 0.0443, 1.11, rng, { name: 'Teegarden c', pressure: 0.8, water: 0.4 }),
      rocky(S, 0.0791, 0.82, rng, { name: 'Teegarden d' }),
    ];
  },
  gj581(S, rng) {
    return [
      rocky(S, 0.0285, 1.66, rng, { name: 'Gliese 581 e' }),
      giant(S, 0.0406, 15.8, rng, { name: 'Gliese 581 b', ice: true, rings: null }),
      rocky(S, 0.0721, 5.5, rng, { name: 'Gliese 581 c', pressure: 8 }),
    ];
  },
  gj667c(S, rng) {
    return [
      rocky(S, 0.05, 5.6, rng, { name: 'Gliese 667 C b' }), rocky(S, 0.125, 3.8, rng, { name: 'Gliese 667 C c', pressure: 1.4, water: 0.55 }),
      rocky(S, 0.156, 2.7, rng, { name: 'Gliese 667 C f', pressure: 1.1, water: 0.5 }), rocky(S, 0.213, 2.7, rng, { name: 'Gliese 667 C e' }),
    ];
  },
  trappist(S, rng) {
    const d = [['b', 0.01154, 1.374, 1.116], ['c', 0.0158, 1.308, 1.097], ['d', 0.02227, 0.388, 0.788], ['e', 0.02925, 0.692, 0.92],
      ['f', 0.03849, 1.039, 1.045], ['g', 0.04683, 1.321, 1.129], ['h', 0.06189, 0.326, 0.755]];
    return d.map(([l, a, m, r]) => rocky(S, a, m, rng, {
      name: 'TRAPPIST-1 ' + l, radius: r * R_EARTH, pressure: l === 'e' ? 1.0 : undefined, temp: l === 'e' ? 277 : undefined, water: l === 'e' ? 0.7 : l > 'e' ? 0.8 : undefined,
      tilt: 0, moons: [], desc: l === 'e' ? 'Um dos mundos mais promissores já catalogados — mas a estrela anfitriã é uma anã ultrafria e instável.' : null,
    }));
  },
  lhs1140(S, rng) {
    return [rocky(S, 0.0268, 1.91, rng, { name: 'LHS 1140 c' }), rocky(S, 0.0957, 5.6, rng, { name: 'LHS 1140 b', radius: 1.73 * R_EARTH, pressure: 2, water: 0.95, magnet: true })];
  },
  pollux(S, rng) { return [giant(S, 1.64, 730, rng, { name: 'Pólux b' })]; },
  kepler186(S, rng) {
    const d = [['b', 0.0378, 1.2, 1.07], ['c', 0.0574, 2.0, 1.25], ['d', 0.0861, 2.5, 1.4], ['e', 0.1216, 2.0, 1.27], ['f', 0.432, 1.7, 1.17]];
    return d.map(([l, a, m, r]) => rocky(S, a, m, rng, { name: 'Kepler-186 ' + l, radius: r * R_EARTH, pressure: l === 'f' ? 2 : undefined, water: l === 'f' ? 0.5 : undefined }));
  },
  kepler22(S, rng) { return [rocky(S, 0.849, 9, rng, { name: 'Kepler-22 b', radius: 2.1 * R_EARTH, pressure: 1.5, water: 0.97, magnet: true })]; },
  kepler452(S, rng) { return [rocky(S, 1.046, 5, rng, { name: 'Kepler-452 b', radius: 1.63 * R_EARTH, pressure: 1.6, water: 0.5, magnet: true })]; },
  // --- sistemas com buracos negros (dados reais; órbitas circulares aproximadas) ---
  gaiabh1(S, rng) { return [bhOf(S, rng, 'Gaia BH1 ●', 0.35)]; },
  gaiabh2(S, rng) { return [bhOf(S, rng, 'Gaia BH2 ●', 0.5)]; },
  gaiabh3(S, rng) { return [bhOf(S, rng, 'Gaia BH3 ●', 0.2)]; },
  a0620(S, rng) { return [bhOf(S, rng, 'A0620-00 ●', 0.4)]; },
  cygx1(S, rng) { return [bhOf(S, rng, 'Cygnus X-1 ●', 0.48)]; },
  v404(S, rng) { return [bhOf(S, rng, 'V404 Cygni ●', 0.3)]; },
  sgra(S, rng) { return [bhOf(S, rng, 'Sagitário A* ●', 0.6)]; },
};

function bhOf(star, rng, name, tilt) {
  const d = star.bh;
  return blackHole(star, d.sep, d.mass, rng, { name, tilt, active: d.active, periodDays: d.period, desc: d.desc });
}

// Descobertas aleatórias feitas pelo scanner — cada mundo tem algo próprio
const FINDS = {
  oceano: ['Arquipélagos vulcânicos ativos', 'Correntes oceânicas quentes ao longo do equador', 'Marés de dezenas de metros', 'Fontes hidrotermais no leito oceânico', 'Oceano com mais de 100 km de profundidade'],
  terrestre: ['Cadeias de montanhas jovens', 'Grandes desertos no interior dos continentes', 'Rios extensos e deltas', 'Placas tectônicas ativas', 'Lagos de cratera antigos'],
  tundra: ['Mares congelados no inverno', 'Geleiras que descem até as latitudes médias', 'Permafrost com metano aprisionado'],
  deserto: ['Dunas com centenas de metros de altura', 'Tempestades de poeira globais', 'Leitos de rios secos — já houve água aqui', 'Planícies de sal de antigos mares'],
  deserto_frio: ['Calotas de gelo seco (CO₂)', 'Vulcões extintos gigantes', 'Cânions profundos', 'Redemoinhos de poeira'],
  rochoso: ['Crateras de impacto antigas', 'Planícies de basalto', 'Depósitos de metais raros', 'Tubos de lava subterrâneos', 'Escarpas de contração'],
  gelo: ["Gêiseres de vapor d'água", 'Provável oceano sob a crosta de gelo', 'Fendas profundas na crosta', 'Gelo de nitrogênio'],
  lava: ['Oceanos de magma no lado diurno', 'Chuva de rocha vaporizada', 'Vulcanismo extremo'],
  venusiano: ['Nuvens de ácido sulfúrico', 'Ventos de 350 km/h no topo das nuvens', 'Vulcões em escudo sob as nuvens'],
  vulcanico: ['Mais de 400 vulcões ativos', 'Plumas de enxofre a centenas de km de altura'],
  nebuloso: ['Lagos de metano líquido', 'Névoa orgânica densa (tolinas)', 'Dunas de hidrocarbonetos'],
  gasoso: ['Tempestade anticiclônica gigante', 'Relâmpagos nas camadas profundas', 'Auroras polares intensas', 'Chuva de hélio nas camadas internas'],
  gelo_gigante: ['Ventos supersônicos', 'Possível oceano de água e amônia sob as nuvens', 'Chuva de diamantes no interior'],
};
function discoveries(p, rng) {
  if (p.body === 'bh' || p.type === 'ruinas') return [];
  const pool = [...(FINDS[p.type] || FINDS.rochoso)];
  const out = [];
  const n = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < n && pool.length; k++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const v = p.visual;
  if (v && v.shader === 'rocky' && v.storm > 0) out.push('Ciclone permanente no hemisfério ' + (v.stormDir[1] > 0 ? 'norte' : 'sul'));
  if (v && v.islands > 0.5) out.push('Milhares de ilhas espalhadas pelo oceano');
  if (p.life === 'complexa') out.push('Vegetação fotossintética — cor dominante: ' + vegName(v.vegColor));
  else if (p.life === 'microbiana') out.push('Tapetes microbianos nas zonas costeiras');
  if (p.magnet && p.body !== 'gas' && p.pressure > 0.1 && rng() < 0.4) out.push('Auroras intensas nos polos');
  if (rng() < 0.04) out.push('Sinal de rádio intermitente — origem desconhecida');
  if (rng() < 0.03) out.push('Destroços metálicos em órbita… não são naturais');
  return out;
}
function vegName(hex) {
  const [r, g, b] = hexLin(hex);
  if (r > g * 1.3 && b > g) return 'púrpura escura';
  if (r > g * 1.4) return 'vermelho-ferrugem';
  if (r > g) return 'bronze';
  if (b > r * 1.3 && b > g * 0.8) return 'azul-esverdeada';
  return 'verde';
}

// Posição de um corpo (km, relativa à estrela) no tempo t (s)
export function bodyPosition(b, t, out) {
  const th = b.phase + (2 * Math.PI * t) / b.period;
  const c = Math.cos(th) * b.a, s = Math.sin(th) * b.a;
  const cn = Math.cos(b.node), sn = Math.sin(b.node);
  // órbita no plano XZ, inclinada em torno da linha dos nodos
  let x = c, y = s * Math.sin(b.inc), z = s * Math.cos(b.inc);
  const xr = x * cn - z * sn, zr = x * sn + z * cn;
  out[0] = xr; out[1] = y; out[2] = zr;
  if (b.parent) {
    const pp = [0, 0, 0];
    bodyPosition(b.parent, t, pp);
    out[0] += pp[0]; out[1] += pp[1]; out[2] += pp[2];
  }
  return out;
}

export function hzRange(star) {
  return [Math.sqrt(star.lum / 1.1), Math.sqrt(star.lum / 0.53)];
}


