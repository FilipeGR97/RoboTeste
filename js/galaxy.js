// Geração do setor galáctico: estrelas reais da vizinhança solar + estrelas procedurais
import { mulberry32, hashInts, gauss, eqToGame, tempToRGB, lerp } from './util.js';

export const KIND = { O: 0, B: 1, A: 2, F: 3, G: 4, K: 5, M: 6, GIANT: 7, WD: 8, SUPER: 9 };
export const KIND_NAME = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'Gigante', 'Anã branca', 'Supergigante'];
export const KIND_DESC = [
  'Estrela azul hipergigante, extremamente quente e luminosa',
  'Estrela azul-branca quente e jovem',
  'Estrela branca de sequência principal',
  'Estrela branco-amarelada de sequência principal',
  'Anã amarela — como o nosso Sol',
  'Anã laranja — estável e longeva',
  'Anã vermelha — fria, pequena e sujeita a erupções',
  'Gigante vermelha — uma estrela velha e inchada',
  'Anã branca — o núcleo exposto de uma estrela morta',
  'Supergigante — um colosso perto do fim da vida',
];

// [nome, AR°, Dec°, dist (al), espectro, T(K), L(L☉), R(R☉), tipo, chave de sistema real]
const REAL = [
  ['Proxima Centauri', 217.429, -62.68, 4.246, 'M5.5Ve', 3042, 0.00155, 0.154, KIND.M, 'proxima'],
  ['Alfa Centauri', 219.902, -60.834, 4.367, 'G2V', 5790, 1.519, 1.22, KIND.G, null],
  ['Estrela de Barnard', 269.452, 4.693, 5.963, 'M4V', 3134, 0.0035, 0.187, KIND.M, null],
  ['Wolf 359', 164.12, 7.015, 7.856, 'M6V', 2749, 0.0011, 0.144, KIND.M, null],
  ['Lalande 21185', 165.836, 35.97, 8.307, 'M2V', 3601, 0.021, 0.392, KIND.M, null],
  ['Sirius', 101.287, -16.716, 8.611, 'A1V', 9940, 25.4, 1.711, KIND.A, null],
  ['Epsilon Eridani', 53.233, -9.458, 10.475, 'K2V', 5084, 0.34, 0.735, KIND.K, 'epseri'],
  ['Ross 128', 176.935, 0.799, 11.007, 'M4V', 3192, 0.00362, 0.197, KIND.M, 'ross128'],
  ['61 Cygni', 316.725, 38.749, 11.4, 'K5V', 4526, 0.153, 0.665, KIND.K, null],
  ['Procyon', 114.825, 5.225, 11.46, 'F5IV', 6530, 6.93, 2.048, KIND.F, null],
  ['Tau Ceti', 26.017, -15.937, 11.912, 'G8V', 5344, 0.52, 0.793, KIND.G, 'tauceti'],
  ['Estrela de Teegarden', 43.254, 16.881, 12.497, 'M7V', 2904, 0.00073, 0.107, KIND.M, 'teegarden'],
  ['Altair', 297.696, 8.868, 16.73, 'A7V', 7700, 10.6, 1.8, KIND.A, null],
  ['Gliese 581', 229.862, -7.722, 20.55, 'M3V', 3484, 0.0121, 0.3, KIND.M, 'gj581'],
  ['Gliese 667 C', 259.745, -34.998, 23.6, 'M1.5V', 3350, 0.0137, 0.42, KIND.M, 'gj667c'],
  ['Vega', 279.235, 38.784, 25.04, 'A0V', 9602, 40.1, 2.36, KIND.A, null],
  ['Fomalhaut', 344.413, -29.622, 25.13, 'A3V', 8590, 16.6, 1.84, KIND.A, null],
  ['Pólux', 116.329, 28.026, 33.78, 'K0III', 4666, 43, 9.06, KIND.GIANT, 'pollux'],
  ['Arcturus', 213.915, 19.182, 36.7, 'K1.5III', 4286, 170, 25.4, KIND.GIANT, null],
  ['TRAPPIST-1', 346.622, -5.041, 40.66, 'M8V', 2566, 0.000553, 0.119, KIND.M, 'trappist'],
  ['Capella', 79.172, 45.998, 42.9, 'G3III', 4970, 78.7, 11.98, KIND.GIANT, null],
  ['LHS 1140', 11.247, -15.272, 48.8, 'M4.5V', 3216, 0.0038, 0.21, KIND.M, 'lhs1140'],
  ['Aldebaran', 68.98, 16.509, 65.3, 'K5III', 3910, 439, 45.1, KIND.GIANT, null],
  ['Régulo', 152.093, 11.967, 79.3, 'B8IV', 12460, 316, 4.35, KIND.B, null],
  ['Spica', 201.298, -11.161, 250, 'B1V', 25300, 20500, 7.47, KIND.B, null],
  ['Canopus', 95.988, -52.696, 310, 'A9II', 7400, 10700, 71, KIND.SUPER, null],
  ['Polaris', 37.955, 89.264, 433, 'F7Ib', 6015, 1260, 37.5, KIND.SUPER, null],
  ['Betelgeuse', 88.793, 7.407, 548, 'M2Ia', 3600, 90000, 764, KIND.SUPER, null],
  ['Antares', 247.352, -26.432, 554, 'M1.5Iab', 3570, 75900, 680, KIND.SUPER, null],
  ['Kepler-186', 298.653, 43.955, 579, 'M1V', 3755, 0.055, 0.523, KIND.M, 'kepler186'],
  ['Kepler-22', 289.218, 47.884, 640, 'G5V', 5518, 0.79, 0.98, KIND.G, 'kepler22'],
  ['Rigel', 78.634, -8.202, 863, 'B8Ia', 12100, 120000, 78.9, KIND.SUPER, null],
  ['Kepler-452', 296.0, 44.28, 1799, 'G2V', 5757, 1.2, 1.11, KIND.G, 'kepler452'],
  ['Deneb', 310.358, 45.28, 2615, 'A2Ia', 8525, 196000, 203, KIND.SUPER, null],
];

// Sistemas com buracos negros reais: [nome, AR°, Dec°, dist (al), espectro da companheira, T, L, R, tipo, chave,
//   massa do buraco negro (M☉), separação (UA), período (dias), acreção ativa?, descrição]
export const BLACK_HOLES = [
  ['Gaia BH1', 262.171, -0.581, 1560, 'G', 5850, 1.06, 0.99, KIND.G, 'gaiabh1', 9.62, 1.4, 185.6, false,
    'O buraco negro conhecido mais próximo da Terra (descoberto em 2022 pela sonda Gaia). Dormente: não há disco de acreção — só a sombra e a lente gravitacional.'],
  ['Gaia BH3', 294.83, 14.93, 1926, 'G5IV', 5200, 16, 4.9, KIND.GIANT, 'gaiabh3', 32.7, 16.2, 4250, false,
    'O buraco negro estelar mais massivo da Via Láctea (33 massas solares), orbitado por uma estrela antiga e pobre em metais.'],
  ['Gaia BH2', 207.57, -59.239, 3800, 'K III', 4600, 24, 7.8, KIND.GIANT, 'gaiabh2', 8.94, 4.96, 1277, false,
    'Um buraco negro dormente com uma gigante vermelha em órbita larga.'],
  ['A0620-00', 95.685, -0.346, 3460, 'K5V', 4600, 0.25, 0.9, KIND.K, 'a0620', 6.6, 0.016, 0.323, true,
    'V616 Monocerotis: o buraco negro estelar confirmado mais próximo com disco de acreção (fraco, em quiescência).'],
  ['Cygnus X-1', 299.59, 35.20, 7240, 'O9.7Iab', 31000, 250000, 22, KIND.SUPER, 'cygx1', 21.2, 0.2, 5.6, true,
    'O primeiro buraco negro já identificado (1964). Devora a supergigante azul HDE 226868: um disco de acreção a milhões de graus brilha em raios X.'],
  ['V404 Cygni', 306.016, 33.867, 7800, 'K3III', 4300, 10, 6, KIND.GIANT, 'v404', 9, 0.07, 6.47, true,
    'Sistema binário com explosões violentas: o disco de acreção se reacende a cada poucas décadas.'],
  ['Sagitário A*', 266.4168, -29.0078, 26670, 'B0V (S2)', 28000, 15000, 7, KIND.B, 'sgra', 4.3e6, 1000, 5860, true,
    'O buraco negro supermassivo no centro da Via Láctea: 4,3 milhões de massas solares. A estrela S2 passa perto dele a cada 16 anos.'],
];

const PLEIADES = [
  ['Alcíone', 'B7III', 12258, 2400, 9.3], ['Atlas', 'B8III', 12000, 940, 5],
  ['Electra', 'B6III', 13400, 1225, 6], ['Maia', 'B8III', 12600, 660, 5.5],
  ['Mérope', 'B6IV', 14000, 630, 4.5], ['Taígeta', 'B6IV', 13700, 600, 3.6],
  ['Pleione', 'B8V', 12000, 190, 3.2], ['Celeno', 'B7IV', 12700, 240, 3.2],
  ['Astérope', 'B8V', 11000, 75, 2.5],
];

const CLASSES = [
  { k: KIND.O, w: 0.0006, T: [30000, 45000], L: [3e4, 8e5], R: [6.6, 12], M: [16, 60], lc: 'V' },
  { k: KIND.B, w: 0.01, T: [10000, 30000], L: [25, 3e4], R: [1.8, 6.6], M: [2.1, 16], lc: 'V' },
  { k: KIND.A, w: 0.035, T: [7500, 10000], L: [5, 25], R: [1.4, 1.8], M: [1.4, 2.1], lc: 'V' },
  { k: KIND.F, w: 0.09, T: [6000, 7500], L: [1.5, 5], R: [1.15, 1.4], M: [1.04, 1.4], lc: 'V' },
  { k: KIND.G, w: 0.13, T: [5200, 6000], L: [0.6, 1.5], R: [0.9, 1.15], M: [0.8, 1.04], lc: 'V' },
  { k: KIND.K, w: 0.18, T: [3700, 5200], L: [0.08, 0.6], R: [0.7, 0.9], M: [0.45, 0.8], lc: 'V' },
  { k: KIND.M, w: 0.47, T: [2400, 3700], L: [0.0008, 0.08], R: [0.1, 0.7], M: [0.08, 0.45], lc: 'V' },
  { k: KIND.GIANT, w: 0.025, T: [3500, 5200], L: [40, 1500], R: [8, 80], M: [1, 4], lc: 'III' },
  { k: KIND.WD, w: 0.04, T: [5000, 30000], L: [0.0003, 0.05], R: [0.008, 0.02], M: [0.5, 1.2], lc: 'D' },
];
const LETTERS = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
const NFAR = 60000;  // estrelas esparsas do disco além do setor local (500–9000 al)
const NCORE = 4000;  // aglomerado estelar nuclear em volta de Sagitário A*
export const GC = [26670, -20, 0]; // centro galáctico (al)

const SYL_A = ['Ka', 'Ve', 'Sa', 'Tor', 'Ae', 'Ly', 'Mi', 'Or', 'Ze', 'Ce', 'Al', 'Ny', 'Pha', 'Dra', 'Is', 'Eu', 'Thal', 'Ri', 'Vo', 'Xa', 'Bel', 'Cas', 'Hel', 'Ner', 'Osi', 'Sel', 'Tau', 'Ura', 'Var', 'Yr'];
const SYL_B = ['ri', 'lo', 'ne', 'ta', 'ra', 'mi', 'sa', 'do', 'li', 'ka', 'the', 'ro', 'va', 'nu', 'co', 'phi', 'ze', 'ga', 'le', 'ma'];
const SYL_C = ['a', 'is', 'on', 'ar', 'ia', 'ea', 'us', 'ion', 'ax', 'el', 'or', 'ys', 'um', 'ix', 'en'];

export class Galaxy {
  constructor(seed = 2194) {
    this.seed = seed;
    const rng = mulberry32(seed);
    const NPROC = 100000;
    const extra = 1 + REAL.length + PLEIADES.length + 70 + 45;
    const N = extra + NPROC;
    const CAP = N + BLACK_HOLES.length + NFAR + NCORE;
    this.px = new Float64Array(CAP); this.py = new Float64Array(CAP); this.pz = new Float64Array(CAP);
    this.temp = new Float32Array(CAP); this.lum = new Float32Array(CAP);
    this.rad = new Float32Array(CAP); this.mass = new Float32Array(CAP);
    this.kind = new Uint8Array(CAP);
    this.specT = new Float32Array(CAP); // fração usada para o subtipo espectral
    this.bh = new Map(); // índice da estrela companheira -> dados do buraco negro
    this.names = new Map(); this.specs = new Map(); this.realKey = new Map();
    let n = 0;
    const add = (x, y, z, T, L, R, M, kind, t) => {
      this.px[n] = x; this.py[n] = y; this.pz[n] = z;
      this.temp[n] = T; this.lum[n] = L; this.rad[n] = R; this.mass[n] = M;
      this.kind[n] = kind; this.specT[n] = t;
      return n++;
    };
    // 0 = Sol
    add(0, 0, 0, 5772, 1, 1, 1, KIND.G, 0.8);
    this.names.set(0, 'Sol'); this.specs.set(0, 'G2V'); this.realKey.set(0, 'sol');
    for (const r of REAL) {
      const [x, y, z] = eqToGame(r[1], r[2], r[3]);
      const i = add(x, y, z, r[5], r[6], r[7], massFromL(r[6], r[8]), r[8], 0.5);
      this.names.set(i, r[0]); this.specs.set(i, r[4]);
      if (r[9]) this.realKey.set(i, r[9]);
    }
    // Plêiades e Híades (aglomerados abertos reais)
    const pc = eqToGame(56.75, 24.117, 444);
    for (const p of PLEIADES) {
      const i = add(pc[0] + gauss(rng) * 2.5, pc[1] + gauss(rng) * 2.5, pc[2] + gauss(rng) * 2.5, p[2], p[3], p[4], 4.5, KIND.B, 0.5);
      this.names.set(i, p[0]); this.specs.set(i, p[1]);
    }
    for (let k = 0; k < 70; k++) {
      const c = CLASSES[1 + Math.floor(rng() * 5)];
      const t = rng();
      const i = add(pc[0] + gauss(rng) * 5, pc[1] + gauss(rng) * 5, pc[2] + gauss(rng) * 5,
        lerp(c.T[0], c.T[1], t), c.L[0] * Math.pow(c.L[1] / c.L[0], t), lerp(c.R[0], c.R[1], t), lerp(c.M[0], c.M[1], t), c.k, t);
      this.names.set(i, 'Plêiades ' + (k + 10));
    }
    const hc = eqToGame(66.75, 15.87, 153);
    for (let k = 0; k < 45; k++) {
      const c = CLASSES[2 + Math.floor(rng() * 5)];
      const t = rng();
      const i = add(hc[0] + gauss(rng) * 7, hc[1] + gauss(rng) * 7, hc[2] + gauss(rng) * 7,
        lerp(c.T[0], c.T[1], t), c.L[0] * Math.pow(c.L[1] / c.L[0], t), lerp(c.R[0], c.R[1], t), lerp(c.M[0], c.M[1], t), c.k, t);
      this.names.set(i, 'Híades ' + (k + 1));
    }
    this.firstProc = n;
    // Estrelas procedurais no disco local
    const totalW = CLASSES.reduce((s, c) => s + c.w, 0);
    while (n < N) {
      const r = 500 * Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = gauss(rng) * 55;
      if (x * x + y * y + z * z < 3.5 * 3.5) continue;
      let u = rng() * totalW, c = CLASSES[0];
      for (const cc of CLASSES) { if ((u -= cc.w) <= 0) { c = cc; break; } }
      const t = rng();
      add(x, y, z, lerp(c.T[0], c.T[1], t), c.L[0] * Math.pow(c.L[1] / c.L[0], t), lerp(c.R[0], c.R[1], t), lerp(c.M[0], c.M[1], t), c.k, t);
    }
    this.count = n;
    // Os acréscimos abaixo usam um gerador próprio e vêm depois das estrelas originais,
    // para preservar os índices (e os jogos salvos) da versão anterior.
    this.pickNovaTerra(rng);
    this.extend();
    this.buildGrid();
  }

  extend() {
    const rng = mulberry32(this.seed * 7 + 13);
    let n = this.count;
    const add = (x, y, z, T, L, R, M, kind, t) => {
      this.px[n] = x; this.py[n] = y; this.pz[n] = z;
      this.temp[n] = T; this.lum[n] = L; this.rad[n] = R; this.mass[n] = M;
      this.kind[n] = kind; this.specT[n] = t;
      return n++;
    };
    this.firstBH = n;
    for (const b of BLACK_HOLES) {
      const [x, y, z] = eqToGame(b[1], b[2], b[3]);
      const i = add(x, y, z, b[5], b[6], b[7], massFromL(b[6], b[8]), b[8], 0.5);
      this.names.set(i, b[0]); this.specs.set(i, b[4]); this.realKey.set(i, b[9]);
      this.bh.set(i, { name: b[0], mass: b[10], sep: b[11], period: b[12], active: b[13], desc: b[14] });
    }
    this.firstFar = n;
    // disco esparso: só estrelas mais luminosas importam visualmente, então o peso favorece as classes brilhantes
    const W = [0.004, 0.06, 0.1, 0.12, 0.15, 0.2, 0.2, 0.14, 0.026];
    const pick = () => { let u = rng(); for (let k = 0; k < W.length; k++) if ((u -= W[k]) <= 0) return CLASSES[k]; return CLASSES[6]; };
    const r0 = 500, r1 = 9000;
    for (let k = 0; k < NFAR; k++) {
      const r = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
      const a = rng() * Math.PI * 2;
      const c = pick(), t = rng();
      add(Math.cos(a) * r, gauss(rng) * 140, Math.sin(a) * r, lerp(c.T[0], c.T[1], t), c.L[0] * Math.pow(c.L[1] / c.L[0], t), lerp(c.R[0], c.R[1], t), lerp(c.M[0], c.M[1], t), c.k, t);
    }
    // aglomerado nuclear (gigantes vermelhas e estrelas velhas)
    for (let k = 0; k < NCORE; k++) {
      const c = rng() < 0.35 ? CLASSES[7] : CLASSES[4 + Math.floor(rng() * 3)], t = rng();
      const s = 2 + Math.pow(rng(), 2) * 40;
      add(GC[0] + gauss(rng) * s, GC[1] + gauss(rng) * s * 0.7, GC[2] + gauss(rng) * s, lerp(c.T[0], c.T[1], t), c.L[0] * Math.pow(c.L[1] / c.L[0], t), lerp(c.R[0], c.R[1], t), lerp(c.M[0], c.M[1], t), c.k, t);
    }
    this.count = n;
  }

  buildGrid() {
    this.cell = 20;
    this.grid = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = this.key(Math.floor(this.px[i] / this.cell), Math.floor(this.py[i] / this.cell), Math.floor(this.pz[i] / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
  }
  key(ix, iy, iz) { return ((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096); }

  // Estrela mais próxima de (x,y,z) em anos-luz
  nearest(x, y, z, exclude = -1) {
    const c = this.cell;
    const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 6; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++)
        for (let iy = cy - r; iy <= cy + r; iy++)
          for (let iz = cz - r; iz <= cz + r; iz++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) !== r) continue;
            const arr = this.grid.get(this.key(ix, iy, iz));
            if (!arr) continue;
            for (const i of arr) {
              if (i === exclude) continue;
              const dx = this.px[i] - x, dy = this.py[i] - y, dz = this.pz[i] - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bd) { bd = d; best = i; }
            }
          }
      if (best >= 0 && Math.sqrt(bd) <= r * c) break;
    }
    if (best < 0) {
      for (let i = 0; i < this.count; i++) {
        const dx = this.px[i] - x, dy = this.py[i] - y, dz = this.pz[i] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd && i !== exclude) { bd = d; best = i; }
      }
    }
    return { index: best, dist: Math.sqrt(bd) };
  }

  within(x, y, z, radius) {
    const c = this.cell, out = [];
    const r2 = radius * radius;
    for (let ix = Math.floor((x - radius) / c); ix <= Math.floor((x + radius) / c); ix++)
      for (let iy = Math.floor((y - radius) / c); iy <= Math.floor((y + radius) / c); iy++)
        for (let iz = Math.floor((z - radius) / c); iz <= Math.floor((z + radius) / c); iz++) {
          const arr = this.grid.get(this.key(ix, iy, iz));
          if (!arr) continue;
          for (const i of arr) {
            const dx = this.px[i] - x, dy = this.py[i] - y, dz = this.pz[i] - z;
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
          }
        }
    return out;
  }

  dist(i, x, y, z) {
    const dx = this.px[i] - x, dy = this.py[i] - y, dz = this.pz[i] - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  seedOf(i) { return hashInts(this.seed, i, 7331); }

  name(i) {
    const nm = this.names.get(i);
    if (nm) return nm;
    const rng = mulberry32(hashInts(this.seed, i, 99));
    const u = rng();
    let s;
    if (u < 0.22) {
      s = SYL_A[Math.floor(rng() * SYL_A.length)] + SYL_B[Math.floor(rng() * SYL_B.length)];
      if (rng() < 0.6) s += SYL_C[Math.floor(rng() * SYL_C.length)];
    } else if (u < 0.5) s = 'HD ' + (10000 + Math.floor(rng() * 290000));
    else if (u < 0.7) s = 'HIP ' + (1000 + Math.floor(rng() * 117000));
    else if (u < 0.85) s = 'Gliese ' + (100 + Math.floor(rng() * 3900));
    else s = 'TYC ' + (1000 + Math.floor(rng() * 8000)) + '-' + (100 + Math.floor(rng() * 1800)) + '-1';
    this.names.set(i, s);
    return s;
  }

  spectral(i) {
    const s = this.specs.get(i);
    if (s) return s;
    const k = this.kind[i], t = this.specT[i];
    const digit = Math.min(9, Math.floor((1 - t) * 10));
    if (k === KIND.WD) return 'D' + (this.temp[i] > 10000 ? 'A' : 'C') + Math.min(9, Math.round(50400 / this.temp[i]));
    if (k === KIND.GIANT) return (this.temp[i] > 4000 ? 'K' : 'M') + digit + 'III';
    return LETTERS[k] + digit + 'V';
  }

  color(i) { return tempToRGB(this.temp[i]); }

  // A estrela com a bioassinatura (Nova Terra) — uma anã G ou K entre 55 e 110 al do Sol
  pickNovaTerra(rng) {
    const cands = [];
    for (let i = this.firstProc; i < this.count; i++) {
      const k = this.kind[i];
      if (k !== KIND.G && k !== KIND.K) continue;
      const d = Math.hypot(this.px[i], this.py[i], this.pz[i]);
      if (d > 55 && d < 110) cands.push(i);
    }
    this.novaTerra = cands[Math.floor(rng() * cands.length)];
    const i = this.novaTerra;
    this.names.set(i, 'Gliese ' + (3000 + (i % 900)));
    const off = [gauss(rng), gauss(rng) * 0.4, gauss(rng)];
    const L = Math.hypot(...off);
    const dd = 6 + rng() * 8;
    this.bioZone = {
      x: this.px[i] + (off[0] / L) * dd, y: this.py[i] + (off[1] / L) * dd, z: this.pz[i] + (off[2] / L) * dd,
      r: 22,
    };
  }
}

function massFromL(L, kind) {
  if (kind === KIND.GIANT || kind === KIND.SUPER) return Math.min(25, 1 + Math.pow(L, 0.28));
  return Math.pow(L, 1 / 3.5);
}
