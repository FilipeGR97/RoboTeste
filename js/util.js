// Constantes físicas e utilidades gerais
export const KM_PER_AU = 149597870.7;
export const KM_PER_LY = 9.4607304725808e12;
export const C_KMS = 299792.458;
export const R_SUN = 695700;     // km
export const R_EARTH = 6371;     // km
export const DAY = 86400;        // s

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInts(...v) {
  let h = 2166136261 >>> 0;
  for (const x of v) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Cor de corpo negro (aprox. Tanner Helland) -> RGB linear normalizado
export function tempToRGB(T) {
  const t = T / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const toLin = (c) => {
    c = clamp(c, 0, 255) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const out = [toLin(r), toLin(g), toLin(b)];
  const m = Math.max(...out);
  return out.map((c) => c / m);
}

// Equatorial (J2000) -> coordenadas do jogo (X = centro galáctico, Y = norte galáctico)
export function eqToGame(raDeg, decDeg, dist) {
  const ra = (raDeg * Math.PI) / 180, dec = (decDeg * Math.PI) / 180;
  const xe = Math.cos(dec) * Math.cos(ra), ye = Math.cos(dec) * Math.sin(ra), ze = Math.sin(dec);
  const xg = -0.0548755604 * xe - 0.8734370902 * ye - 0.4838350155 * ze;
  const yg = 0.4941094279 * xe - 0.44482963 * ye + 0.7469822445 * ze;
  const zg = -0.867666149 * xe - 0.1980763734 * ye + 0.4559837762 * ze;
  return [xg * dist, zg * dist, -yg * dist];
}

export function fmtDist(km) {
  const a = Math.abs(km);
  if (a < 1) return (a * 1000).toFixed(0) + ' m';
  if (a < 1e6) return a.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' km';
  if (a < 0.1 * KM_PER_AU) return (a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi km';
  if (a < 0.05 * KM_PER_LY) return (a / KM_PER_AU).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' UA';
  return (a / KM_PER_LY).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' al';
}

export function fmtSpeed(kms) {
  if (kms < 1) return (kms * 1000).toFixed(0) + ' m/s';
  if (kms < 0.1 * C_KMS) return kms.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km/s';
  const c = kms / C_KMS;
  if (c < 1000) return c.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' c';
  return c.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' c';
}

export function fmtTime(s) {
  if (!isFinite(s)) return '—';
  if (s < 60) return s.toFixed(0) + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + Math.floor(s % 60) + ' s';
  if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
  return (s / 86400).toFixed(1) + ' dias';
}

export const fmtNum = (x, d = 2) => x.toLocaleString('pt-BR', { maximumFractionDigits: d });
