// Superfícies planetárias: relevo real em quadtree sobre cubo-esfera, assado na GPU por pedaço (chunk),
// e a mesma função de relevo em JavaScript para colisão, pouso e caminhada.
//
// Precisão: um planeta tem milhares de km e o jogador anda em metros. Tudo que é grande (centro do
// pedaço, bases do ruído) é calculado em float64 no JS; a GPU só recebe deslocamentos pequenos.
// O ruído simplex é periódico em 867 (= 3·289) por eixo, então as bases são reduzidas módulo 867.
import * as THREE from 'three';
import { NOISE } from './shaders.js';
import { clamp } from './util.js';

// ================================================================================================
// Ruído em JavaScript — espelho exato do GLSL (shaders.js / NOISE)
// ================================================================================================
const m289 = (x) => x - Math.floor((x + 0.5) * (1 / 289)) * 289;
const perm = (x) => { x = m289(x); return m289((x * 34 + 1) * x); };
const NSX = 0.285714285714, NSY = -0.928571428571;

export function snoise(x, y, z) {
  const s = (x + y + z) / 3;
  const i0 = Math.floor(x + s), j0 = Math.floor(y + s), k0 = Math.floor(z + s);
  const t = (i0 + j0 + k0) / 6;
  const x0 = x - i0 + t, y0 = y - j0 + t, z0 = z - k0 + t;
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);
  const xs = [x0, x0 - i1x + 1 / 6, x0 - i2x + 1 / 3, x0 - 0.5];
  const ys = [y0, y0 - i1y + 1 / 6, y0 - i2y + 1 / 3, y0 - 0.5];
  const zs = [z0, z0 - i1z + 1 / 6, z0 - i2z + 1 / 3, z0 - 0.5];
  const ii = m289(i0), jj = m289(j0), kk = m289(k0);
  const oi = [0, i1x, i2x, 1], oj = [0, i1y, i2y, 1], ok = [0, i1z, i2z, 1];
  let sum = 0;
  for (let c = 0; c < 4; c++) {
    const p = perm(perm(perm(kk + ok[c]) + jj + oj[c]) + ii + oi[c]);
    const j = p - 49 * Math.floor((p + 0.5) / 49);
    const xq = Math.floor((j + 0.5) / 7), yq = Math.floor(j - 7 * xq);
    const X = xq * NSX + NSY, Y = yq * NSX + NSY;
    const h = 1 - Math.abs(X) - Math.abs(Y);
    const sh = h <= -0.01 ? -1 : 0;
    let px = X + (Math.floor(X) * 2 + 1) * sh, py = Y + (Math.floor(Y) * 2 + 1) * sh, pz = h;
    const nr = 1.79284291400159 - 0.85373472095314 * (px * px + py * py + pz * pz);
    px *= nr; py *= nr; pz *= nr;
    let m = Math.max(0.6 - (xs[c] * xs[c] + ys[c] * ys[c] + zs[c] * zs[c]), 0);
    m *= m;
    sum += m * m * (px * xs[c] + py * ys[c] + pz * zs[c]);
  }
  return 42 * sum;
}

// PCG3D (inteiros de 32 bits) — idêntico ao hash33 do GLSL
function pcg3d(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0; z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x / 4294967295, y / 4294967295, z / 4294967295];
}
function crater(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  let h = 0;
  for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) for (let gz = -1; gz <= 1; gz++) {
    const o = pcg3d((ix + gx + 65536) >>> 0, (iy + gy + 65536) >>> 0, (iz + gz + 65536) >>> 0);
    if (o[2] < 0.45) continue;
    const rad = 0.12 + 0.3 * o[0] * o[0];
    const d = Math.hypot(gx + o[0] - fx, gy + o[1] - fy, gz + o[2] - fz) / rad;
    if (d < 1) h += (d * d - 1) * 0.6 * rad * 3;
    else h += Math.exp(-(d - 1) * (d - 1) * 18) * 0.22 * rad * 3;
  }
  return h;
}

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const NF = 16, NR = 14, ND = 12;
const FBM_OFF = [1.7, 9.2, 3.1], RID_OFF = [4.1, 1.3, 7.7];
const DET_OFF = (k) => [k * 7.13, k * 3.71 + 1.3, k * 5.19 + 2.9];

// ================================================================================================
// Parâmetros físicos/visuais do relevo de um corpo rochoso
// ================================================================================================
export function terrainParams(b) {
  const v = b.visual;
  const ocean = v.sea > -1.5;
  const g = b.gravity || b.mass / Math.pow(b.radius / 6371, 2);
  return {
    R: b.radius, S: v.contScale, seed: v.seed, warp: v.warp, islands: v.islands || 0, craters: v.craters || 0,
    ocean, seaLvl: ocean ? v.sea : -0.45,
    // amplitude do relevo (km): montanhas maiores em mundos de gravidade baixa
    E: 8 * (v.relief / 7) * clamp(Math.pow(Math.max(g, 0.05), -0.5), 0.6, 2.5),
    detA: v.craters > 0.5 ? 0.16 : 0.1,
    Sd: b.radius / 2, // ruído de detalhe: comprimento de onda base de 2 km
    v,
  };
}

// Relevo no ponto da superfície na direção dir (unitária, referencial fixo do planeta)
// Retorna { e (km acima do raio de referência; < 0 = fundo do mar), hs, water }
export function heightAt(P, dx, dy, dz) {
  const S = P.S, sd = P.seed;
  const qx = dx * S + sd, qy = dy * S + sd, qz = dz * S + sd;
  const wx = snoise(qx * 0.7, qy * 0.7, qz * 0.7);
  const wy = snoise(qx * 0.7 + 13.1, qy * 0.7 + 13.1, qz * 0.7 + 13.1);
  const wz = snoise(qx * 0.7 + 27.7, qy * 0.7 + 27.7, qz * 0.7 + 27.7);
  const Wx = qx + wx * P.warp * 0.5, Wy = qy + wy * P.warp * 0.5, Wz = qz + wz * P.warp * 0.5;
  let a = 0.5, c = 0, px = Wx, py = Wy, pz = Wz;
  for (let i = 0; i < NF; i++) {
    c += a * snoise(px, py, pz);
    px = px * 2.03 + FBM_OFF[0]; py = py * 2.03 + FBM_OFF[1]; pz = pz * 2.03 + FBM_OFF[2];
    a *= 0.5;
  }
  let m = 0, wgt = 1; a = 0.5;
  px = Wx * 2.3 + 5; py = Wy * 2.3 + 5; pz = Wz * 2.3 + 5;
  for (let j = 0; j < NR; j++) {
    let n = 1 - Math.abs(snoise(px, py, pz));
    n *= n; n *= wgt;
    wgt = clamp(n * 1.6, 0, 1);
    m += a * n;
    px = px * 2.1 + RID_OFF[0]; py = py * 2.1 + RID_OFF[1]; pz = pz * 2.1 + RID_OFF[2];
    a *= 0.5;
  }
  let h = c + m * 0.42 * smooth(-0.05, 0.25, c) - 0.12;
  if (P.islands > 0) {
    const chain = smooth(0.05, 0.55, snoise(Wx * 1.4 + 4, Wy * 1.4 + 4, Wz * 1.4 + 4) * 0.5 + 0.5);
    const isl = Math.pow(Math.max(snoise(Wx * 5.5 + 11, Wy * 5.5 + 11, Wz * 5.5 + 11), 0), 1.6) + Math.pow(Math.max(snoise(Wx * 14 + 3, Wy * 14 + 3, Wz * 14 + 3), 0), 2) * 0.35;
    h += P.islands * isl * chain * 0.75;
  }
  if (P.craters > 0) {
    h += P.craters * (crater(dx * 3 + sd, dy * 3 + sd, dz * 3 + sd) * 0.3 + crater(dx * 9 + sd * 1.7, dy * 9 + sd * 1.7, dz * 9 + sd * 1.7) * 0.15
      + crater(dx * 27 + sd * 2.3, dy * 27 + sd * 2.3, dz * 27 + sd * 2.3) * 0.07);
  }
  let det = 0; a = 1;
  for (let k = 0, f = P.Sd; k < ND; k++, f *= 2) {
    const o = DET_OFF(k);
    det += a * snoise(dx * f + o[0], dy * f + o[1], dz * f + o[2]);
    a *= 0.55;
  }
  return elevation(P, h, det);
}
function elevation(P, h, det) {
  const hs = h - P.seaLvl;
  let e;
  if (hs >= 0) e = hs * P.E + det * P.detA * (0.3 + 1.4 * smooth(0.02, 0.45, hs));
  else e = P.ocean ? hs * P.E * 0.6 : hs * P.E + det * P.detA * 0.3;
  return { e, hs, water: P.ocean && e < 0 };
}

// ================================================================================================
// Cubo-esfera: 6 faces, coordenadas angulares (a, b) ∈ [-π/4, π/4] com mapeamento por tangente
// ================================================================================================
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
function facePoint(f, a, b) {
  const F = FACES[f], ta = Math.tan(a), tb = Math.tan(b);
  return [F.n[0] + ta * F.u[0] + tb * F.v[0], F.n[1] + ta * F.u[1] + tb * F.v[1], F.n[2] + ta * F.u[2] + tb * F.v[2]];
}

// ================================================================================================
// GLSL: relevo com bases de alta precisão (assado por pedaço)
// ================================================================================================
export const TERRAIN_GLSL = /* glsl */ `
// bases do ruído separadas em parte inteira (exata) e fração
uniform vec3 uBW[3]; uniform vec3 uBF[16]; uniform vec3 uBR[14]; uniform vec3 uBI[3]; uniform vec3 uBD[12];
uniform vec3 uBWi[3]; uniform vec3 uBFi[16]; uniform vec3 uBRi[14]; uniform vec3 uBIi[3]; uniform vec3 uBDi[12];
uniform vec3 uBC[4]; uniform vec3 uBL[3];
uniform vec3 uCI[3]; uniform vec3 uCF[3]; // crateras: célula inteira (float exato; o three.js não achata arrays ivec3) + fração
uniform vec3 uC, uPc, uU, uV;
uniform float uLen, uA0, uB0, uHs, uCosA0, uCosB0;
uniform float uR, uS, uSd, uSeed, uWarp, uIslands, uCraters, uSeaLvl, uOcean, uE, uDetA;
uniform float uOct, uOctR, uOctD;

// deslocamento (dir - c) na esfera unitária, sem perda de precisão
// sin() da GPU tem erro absoluto ~1e-7: para ângulos pequenos (pedaços de metros) usa a série
float sinS(float x){ return abs(x) < 0.02 ? x * (1.0 - x * x / 6.0) : sin(x); }
vec3 chunkDD(float da, float db){
  float a = uA0 + da, b = uB0 + db;
  vec3 dP = uU * (sinS(da) / (cos(a) * uCosA0)) + uV * (sinS(db) / (cos(b) * uCosB0));
  float k = 2.0 * dot(uPc, dP) + dot(dP, dP);
  float bb = sqrt(uLen * uLen + k);
  return dP / bb + uPc * ((-k / (uLen + bb)) / (uLen * bb));
}
float fbmB(vec3 D){
  float a = 0.5, s = 0.0, f = 1.0;
  for (int i = 0; i < 16; i++){
    float w = clamp(uOct - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    s += a * snoiseS(uBFi[i], uBF[i] + D * f) * w;
    f *= 2.03; a *= 0.5;
  }
  return s;
}
float ridgedB(vec3 D){
  float a = 0.5, s = 0.0, wgt = 1.0, f = 2.3;
  for (int i = 0; i < 14; i++){
    float w = clamp(uOctR - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    float n = 1.0 - abs(snoiseS(uBRi[i], uBR[i] + D * f));
    n *= n; n *= wgt;
    wgt = clamp(n * 1.6, 0.0, 1.0);
    s += a * n * w;
    f *= 2.1; a *= 0.5;
  }
  return s;
}
float detailB(vec3 dd, out float fine){
  float a = 1.0, s = 0.0, f = uSd;
  fine = 0.0;
  for (int k = 0; k < 12; k++){
    float w = clamp(uOctD - float(k), 0.0, 1.0);
    if (w <= 0.0) break;
    float n = snoiseS(uBDi[k], uBD[k] + dd * f);
    s += a * n * w;
    if (k >= 6) fine += n * w * 0.25;
    f *= 2.0; a *= 0.55;
  }
  return s;
}
float craterI(ivec3 ci, vec3 pl){
  vec3 ip = floor(pl); vec3 f = pl - ip;
  ivec3 c0 = ci + ivec3(ip);
  float h = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(pcg3d(uvec3(c0 + ivec3(x, y, z) + 65536))) * (1.0 / 4294967295.0);
    if (o.z < 0.45) continue;
    float rad = 0.12 + 0.3 * o.x * o.x;
    float d = length(g + o - f) / rad;
    if (d < 1.0) h += (d * d - 1.0) * 0.6 * rad * 3.0;
    else h += exp(-(d - 1.0) * (d - 1.0) * 18.0) * 0.22 * rad * 3.0;
  }
  return h;
}
// h (como no planeta visto de longe) e D (coordenada de ruído deslocada) num ponto
float terrainH(vec3 dd, out vec3 D){
  vec3 dq = dd * uS;
  vec3 w = vec3(snoiseS(uBWi[0], uBW[0] + dq * 0.7), snoiseS(uBWi[1], uBW[1] + dq * 0.7), snoiseS(uBWi[2], uBW[2] + dq * 0.7));
  D = dq + w * uWarp * 0.5;
  float c = fbmB(D);
  float m = ridgedB(D);
  float h = c + m * 0.42 * smoothstep(-0.05, 0.25, c) - 0.12;
  if (uIslands > 0.0){
    float chain = smoothstep(0.05, 0.55, snoiseS(uBIi[0], uBI[0] + D * 1.4) * 0.5 + 0.5);
    float isl = pow(max(snoiseS(uBIi[1], uBI[1] + D * 5.5), 0.0), 1.6) + pow(max(snoiseS(uBIi[2], uBI[2] + D * 14.0), 0.0), 2.0) * 0.35;
    h += uIslands * isl * chain * 0.75;
  }
  if (uCraters > 0.0){
    h += uCraters * (craterI(ivec3(uCI[0]), uCF[0] + dd * 3.0) * 0.3 + craterI(ivec3(uCI[1]), uCF[1] + dd * 9.0) * 0.15 + craterI(ivec3(uCI[2]), uCF[2] + dd * 27.0) * 0.07);
  }
  return h;
}
float elevKm(float h, float det){
  float hs = h - uSeaLvl;
  if (hs >= 0.0) return hs * uE + det * uDetA * (0.3 + 1.4 * smoothstep(0.02, 0.45, hs));
  return uOcean > 0.5 ? hs * uE * 0.6 : hs * uE + det * uDetA * 0.3;
}
`;

const BAKE_VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
// Passo 1: elevação (km) por texel
const BAKE_ELEV = /* glsl */ `
${NOISE}
${TERRAIN_GLSL}
void main(){
  vec2 k = gl_FragCoord.xy - 0.5;              // 0..130 (1..129 = interior)
  float da = ((k.x - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  float db = ((k.y - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  vec3 dd = chunkDD(da, db);
  vec3 D; float fine;
  float h = terrainH(dd, D);
  gl_FragColor = vec4(elevKm(h, detailB(dd, fine)), 0.0, 0.0, 1.0);
}
`;
// Passo 2: normal geométrica a partir das elevações vizinhas (sem recalcular o relevo)
const BAKE_NRM = /* glsl */ `
uniform sampler2D tE;
uniform vec3 uC, uPc, uU, uV;
uniform float uLen, uA0, uB0, uHs, uCosA0, uCosB0, uR, uOcean;
// sin() da GPU tem erro absoluto ~1e-7: para ângulos pequenos (pedaços de metros) usa a série
float sinS(float x){ return abs(x) < 0.02 ? x * (1.0 - x * x / 6.0) : sin(x); }
vec3 chunkDD(float da, float db){
  float a = uA0 + da, b = uB0 + db;
  vec3 dP = uU * (sinS(da) / (cos(a) * uCosA0)) + uV * (sinS(db) / (cos(b) * uCosB0));
  float k = 2.0 * dot(uPc, dP) + dot(dP, dP);
  float bb = sqrt(uLen * uLen + k);
  return dP / bb + uPc * ((-k / (uLen + bb)) / (uLen * bb));
}
vec3 posAt(ivec2 t){
  t = clamp(t, ivec2(0), ivec2(130));
  float e = texelFetch(tE, t, 0).r;
  if (uOcean > 0.5) e = max(e, 0.0);
  float da = ((float(t.x) - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  float db = ((float(t.y) - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  return chunkDD(da, db) * (uR + e) + uC * e;
}
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec3 N = normalize(cross(posAt(t + ivec2(1, 0)) - posAt(t - ivec2(1, 0)), posAt(t + ivec2(0, 1)) - posAt(t - ivec2(0, 1))));
  float da = ((float(t.x) - 1.0) / 128.0 * 2.0 - 1.0) * uHs, db = ((float(t.y) - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  vec3 n = normalize(uC + chunkDD(da, db));
  if (dot(N, n) < 0.0) N = -N;
  gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
}
`;
// Passo 3: cor (mesma lógica do planeta visto de longe + variação fina no chão)
const BAKE_ALB = /* glsl */ `
uniform sampler2D tE, tN;
uniform vec3 cDeep, cShallow, cBeach, cLow, cMid, cHigh, cSnow, cVeg;
uniform float uIceLat, uVeg, uLava;
${NOISE}
${TERRAIN_GLSL}
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy);
  float da = ((float(t.x) - 1.0) / 128.0 * 2.0 - 1.0) * uHs, db = ((float(t.y) - 1.0) / 128.0 * 2.0 - 1.0) * uHs;
  vec3 dd = chunkDD(da, db);
  vec3 n = normalize(uC + dd);
  float e = texelFetch(tE, t, 0).r;
  vec3 N = texelFetch(tN, t, 0).rgb * 2.0 - 1.0;
  bool water = uOcean > 0.5 && e < 0.0;
  float hs = water ? e / (uE * 0.6) : e / uE;
  vec3 dq = dd * uS;
  float lat = abs(n.y);
  float moist = snoise(uBC[0] + dq * 1.3) * 0.5 + 0.5;
  float detail = snoise(uBC[1] + dq * 14.0) * 0.5 + snoise(uBC[2] + dq * 40.0) * 0.25;
  float fine = 0.0;
  if (uOctD > 6.0) fine = snoiseS(uBDi[7], uBD[7] + dd * uSd * 128.0) * 0.5 + snoiseS(uBDi[9], uBD[9] + dd * uSd * 512.0) * 0.3;
  vec3 col;
  float vg = 0.0;
  if (water){
    float d = smoothstep(-0.45, 0.0, hs);
    col = mix(cDeep, cShallow, d * d * d);
  } else {
    float hl = max(hs, 0.0);
    col = mix(cBeach, cLow, smoothstep(0.0, 0.035, hl));
    col = mix(col, cMid, smoothstep(0.1, 0.4, hl + (moist - 0.5) * 0.25));
    col = mix(col, cHigh, smoothstep(0.4, 0.75, hl + detail * 0.05));
    vg = uVeg * smoothstep(0.22, 0.5, moist) * (1.0 - smoothstep(0.25, 0.55, hl)) * (1.0 - smoothstep(0.55, 0.8, lat));
    vec3 grass = cVeg * 1.6 + vec3(0.05, 0.04, 0.0);
    vec3 forest = cVeg * 0.55;
    col = mix(col, mix(grass, forest, smoothstep(0.5, 0.72, moist + fine * 0.15)), vg);
    col *= 0.88 + 0.24 * detail;
    float slope = 1.0 - dot(N, n);
    col = mix(col, mix(cHigh, cMid, 0.4) * 0.8, smoothstep(0.12, 0.3, slope) * 0.8); // rocha exposta nas encostas
    col *= 0.72 + 0.56 * clamp(fine * 0.8 + 0.5, 0.0, 1.0);
    col = mix(col, mix(cBeach, cMid, 0.5) * 0.85, smoothstep(0.25, 0.6, fine) * vg * 0.6); // clareiras de solo entre a vegetação
  }
  float iceN = lat + snoise(uBC[3] + dq * 3.0) * 0.06 + max(hs, 0.0) * 0.35;
  col = mix(col, cSnow, smoothstep(uIceLat - 0.03, uIceLat + 0.03, iceN));
  float glow = 0.0;
  if (uLava > 0.0){
    float rift = 1.0 - abs(snoise(uBL[0] + dq * 1.6));
    float cr = 1.0 - abs(snoise(uBL[1] + dq * 5.0));
    float cr2 = 1.0 - abs(snoise(uBL[2] + dq * 17.0));
    glow = max(pow(rift, 40.0), max(pow(cr, 22.0) * 0.7, pow(cr2, 30.0) * 0.4)) * uLava;
    col *= 1.0 - glow * 0.8;
  }
  gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), clamp(glow, 0.0, 1.0)); // raiz: menos degraus em 8 bits
}
`;

// ---------------------------------------------------------------- material de exibição dos pedaços
const CHUNK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform sampler2D tElev;
uniform vec3 uC, uPc, uU, uV;
uniform float uLen, uA0, uB0, uHs, uCosA0, uCosB0, uR, uOcean, uSkirt;
varying vec2 vUv; varying vec3 vDir; varying vec3 vMV; varying vec3 vPl;
// sin() da GPU tem erro absoluto ~1e-7: para ângulos pequenos (pedaços de metros) usa a série
float sinS(float x){ return abs(x) < 0.02 ? x * (1.0 - x * x / 6.0) : sin(x); }
vec3 chunkDD(float da, float db){
  float a = uA0 + da, b = uB0 + db;
  vec3 dP = uU * (sinS(da) / (cos(a) * uCosA0)) + uV * (sinS(db) / (cos(b) * uCosB0));
  float k = 2.0 * dot(uPc, dP) + dot(dP, dP);
  float bb = sqrt(uLen * uLen + k);
  return dP / bb + uPc * ((-k / (uLen + bb)) / (uLen * bb));
}
void main(){
  float i = position.x, j = position.y;
  float da = (i / 32.0 * 2.0 - 1.0) * uHs, db = (j / 32.0 * 2.0 - 1.0) * uHs;
  vec3 dd = chunkDD(da, db);
  float e = texelFetch(tElev, ivec2(int(1.0 + i * 4.0), int(1.0 + j * 4.0)), 0).r;
  if (uOcean > 0.5) e = max(e, 0.0);
  e -= position.z * uSkirt;
  vec3 local = dd * (uR + e) + uC * e;
  vDir = normalize(uC + dd);
  vPl = local + uC * uR;
  vUv = vec2((1.0 + i * 4.0 + 0.5) / 131.0, (1.0 + j * 4.0 + 0.5) / 131.0);
  vec4 mv = modelViewMatrix * vec4(local, 1.0);
  vMV = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;
const CHUNK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D tAlb, tNrm, tElev;
uniform float uOcean;
uniform mat3 uNM; // rotação planeta -> câmera
uniform vec3 uSunView, uSunCol, uFogCol, uSkyCol;
uniform float uSunI, uFogK, uDay, uTime, uDebug;
varying vec2 vUv; varying vec3 vDir; varying vec3 vMV; varying vec3 vPl;
${NOISE}
void main(){
  vec4 alb = texture2D(tAlb, vUv);
  alb.rgb *= alb.rgb;
  vec4 nt = texture2D(tNrm, vUv);
  bool water = uOcean > 0.5 && texelFetch(tElev, ivec2(vUv * 131.0), 0).r < 0.0;
  vec3 up = normalize(uNM * vDir);
  vec3 V = normalize(-vMV);
  vec3 L = uSunView;
  float horizon = smoothstep(-0.06, 0.1, dot(up, L));
  vec3 col;
  if (water){
    // água: ondas animadas, reflexo do céu e brilho especular do sol
    vec3 p = vPl * 18.0;
    vec3 w = vec3(snoise(p + vec3(uTime * 0.25, 0.0, 0.0)), snoise(p * 1.7 + vec3(0.0, uTime * 0.3, 7.0)), snoise(p * 3.1 + vec3(3.0, 0.0, uTime * 0.4)));
    vec3 Nw = normalize(uNM * normalize(vDir + (w - vDir * dot(w, vDir)) * 0.06));
    float ndl = max(dot(Nw, L), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(Nw, H), 0.0), 400.0) * 6.0;
    vec3 body = alb.rgb * (ndl * 0.8 + 0.2) * horizon;
    col = mix(body * uSunI * 0.78, uSkyCol * uDay, fres) + uSunCol * spec * uSunI * horizon;
  } else {
    vec3 N = normalize(uNM * (nt.rgb * 2.0 - 1.0));
    float diff = max(dot(N, L), 0.0) * horizon;
    vec3 amb = uSkyCol * uDay * (0.25 + 0.25 * dot(N, up)) + vec3(0.004);
    col = alb.rgb * (diff * uSunCol * uSunI * 0.95 + amb);
    col += vec3(1.0, 0.35, 0.08) * pow(alb.a, 2.0) * 2.0 + vec3(0.9, 0.18, 0.02) * alb.a * 0.8;
  }
  float dist = length(vMV);
  float fog = 1.0 - exp(-dist * uFogK);
  col = mix(col, uFogCol, fog);
  if (uDebug > 0.5 && uDebug < 1.5) col = nt.rgb * 0.5;
  if (uDebug > 1.5 && uDebug < 2.5) col = alb.rgb;
  if (uDebug > 2.5) col = vec3(fract(vUv * 4.0) , 0.0) * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <logdepthbuf_fragment>
}
`;

// ---------------------------------------------------------------- camada de nuvens vista de perto
const CLOUD_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunPos, uSunCol, cCloud, uStormDir;
uniform float uSunI, uClouds, uCloudRot, uSeed, uStorm, uOct, uInside;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNw;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float cr = uCloudRot;
  vec3 cn0 = vec3(n.x * cos(cr) - n.z * sin(cr), n.y, n.x * sin(cr) + n.z * cos(cr));
  float cd = 10.0;
  if (uStorm > 0.0){
    cd = acos(clamp(dot(cn0, uStormDir), -1.0, 1.0));
    float sw = uStorm * 7.0 * exp(-cd * cd / 0.045) * sign(uStormDir.y + 1e-4);
    vec3 k = uStormDir; float cs = cos(sw), sn = sin(sw);
    cn0 = cn0 * cs + cross(k, cn0) * sn + k * dot(k, cn0) * (1.0 - cs);
  }
  vec3 cp = cn0 * 2.2 + uSeed * 0.37;
  cp += vec3(snoise(cp * 0.6), snoise(cp * 0.6 + 7.0), snoise(cp * 0.6 + 13.0)) * 0.45;
  float cv = fbm(cp * vec3(1.0, 2.2, 1.0), uOct) * 0.5 + 0.5;
  float th = 0.7 - uClouds * 0.45;
  float cov = smoothstep(th, th + 0.2, cv) * min(uClouds * 3.0, 1.0);
  if (uClouds > 0.95) cov = 0.85 + 0.15 * cv;
  if (uStorm > 0.0){
    float core = exp(-cd * cd / 0.02);
    cov = max(cov, core * uStorm * smoothstep(0.35, 0.6, cv + core * 0.3));
    cov *= 1.0 - exp(-cd * cd / 0.00012) * uStorm;
  }
  if (cov < 0.01) discard;
  vec3 L = normalize(uSunPos - vWorld);
  float ndl = dot(normalize(vNw), L);
  float lit = smoothstep(-0.12, 0.45, ndl);
  // vista de baixo: base das nuvens mais escura conforme a espessura
  float under = uInside * (0.35 + 0.4 * (1.0 - cov));
  vec3 c = cCloud * 0.9 * lit * mix(1.0, under, uInside) * uSunCol * uSunI * 0.78;
  gl_FragColor = vec4(c, cov * (uInside > 0.5 ? 0.97 : 0.9));
  #include <logdepthbuf_fragment>
}
`;

// ================================================================================================
// Superfície de um planeta (quadtree de pedaços)
// ================================================================================================
const RES = 131;               // texels por pedaço (129 + borda)
const GRID = 32;               // quads por lado da malha de exibição
const SPLIT_K = 1.6;           // divide quando a distância < tamanho × K
const BAKES_PER_FRAME = 6;
const MAX_RT = 420;

let GRID_GEO = null;
function gridGeometry() {
  if (GRID_GEO) return GRID_GEO;
  const pos = [], idx = [];
  const id = (i, j) => j * (GRID + 1) + i;
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) pos.push(i, j, 0);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    idx.push(a, b, d, a, d, c);
  }
  // saias nas bordas (escondem frestas entre pedaços de níveis diferentes)
  const base = pos.length / 3;
  const edge = [];
  for (let i = 0; i <= GRID; i++) edge.push([i, 0]);
  for (let j = 1; j <= GRID; j++) edge.push([GRID, j]);
  for (let i = GRID - 1; i >= 0; i--) edge.push([i, GRID]);
  for (let j = GRID - 1; j >= 1; j--) edge.push([0, j]);
  edge.forEach(([i, j]) => pos.push(i, j, 1));
  for (let k = 0; k < edge.length; k++) {
    const k2 = (k + 1) % edge.length;
    const a = id(edge[k][0], edge[k][1]), b = id(edge[k2][0], edge[k2][1]);
    const sa = base + k, sb = base + k2;
    idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  GRID_GEO = new THREE.BufferGeometry();
  GRID_GEO.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  GRID_GEO.setIndex(idx);
  return GRID_GEO;
}

const col = (h) => new THREE.Color(h);
const mod867 = (x) => x - Math.floor(x / 867) * 867;

export class PlanetSurface {
  constructor(renderer, item) {
    this.renderer = renderer;
    this.item = item;
    const b = item.body;
    this.body = b;
    this.P = terrainParams(b);
    this.R = b.radius;
    this.root = new THREE.Group();
    item.spin.add(this.root);
    this.frame = 0;
    this.maxLevel = Math.max(4, Math.ceil(Math.log2((this.R * Math.PI / 2) / 128 / 0.0003)));
    this.rtPool = [];
    this.rtCount = 0;
    this.queue = [];
    const v = b.visual;
    // materiais de cozimento: elevação → normal → cor
    const bm = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.bakeE = bm(BAKE_ELEV, this.planetUniforms({}));
    this.bakeN = bm(BAKE_NRM, this.planetUniforms({ tE: { value: null } }));
    this.bakeA = bm(BAKE_ALB, this.planetUniforms({
      tE: { value: null }, tN: { value: null },
      cDeep: { value: col(v.deep) }, cShallow: { value: col(v.shallow) }, cBeach: { value: col(v.beach) }, cLow: { value: col(v.low) },
      cMid: { value: col(v.mid) }, cHigh: { value: col(v.high) }, cSnow: { value: col(v.snow) }, cVeg: { value: col(v.vegColor) },
      uIceLat: { value: v.iceLat }, uVeg: { value: v.veg }, uLava: { value: v.lava },
    }));
    this.bakeScene = new THREE.Scene();
    this.bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeE);
    this.bakeQuad.frustumCulled = false;
    this.bakeScene.add(this.bakeQuad);
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // material de exibição
    this.chunkMat = new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG,
      uniforms: {
        tElev: { value: null }, tAlb: { value: null }, tNrm: { value: null },
        uC: { value: new THREE.Vector3() }, uPc: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() },
        uLen: { value: 1 }, uA0: { value: 0 }, uB0: { value: 0 }, uHs: { value: 1 }, uCosA0: { value: 1 }, uCosB0: { value: 1 },
        uR: { value: this.R }, uOcean: { value: this.P.ocean ? 1 : 0 }, uSkirt: { value: 0 },
        uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 },
        uFogCol: { value: new THREE.Color(0, 0, 0) }, uSkyCol: { value: new THREE.Color(0, 0, 0) }, uFogK: { value: 0 }, uDay: { value: 0 }, uTime: { value: 0 },
        uNM: { value: new THREE.Matrix3() }, uDebug: { value: 0 },
      },
      side: THREE.DoubleSide,
    });
    // nuvens
    this.clouds = null;
    if (v.clouds > 0 && v.atm) {
      const cm = new THREE.ShaderMaterial({
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vObj; varying vec3 vWorld; varying vec3 vNw;
          void main(){ vObj = position; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vNw = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uSunPos: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 }, cCloud: { value: col(v.cloudColor) },
          uStormDir: { value: new THREE.Vector3(...(v.stormDir || [0, 1, 0])) }, uClouds: { value: v.clouds }, uCloudRot: { value: 0 }, uSeed: { value: v.seed },
          uStorm: { value: v.storm || 0 }, uOct: { value: 7 }, uInside: { value: 0 },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      this.cloudAlt = clamp(this.R * v.atm.thick * 0.06, 2, 60);
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), cm);
      this.clouds.scale.setScalar(this.R + this.cloudAlt);
      this.clouds.renderOrder = 1;
      this.clouds.frustumCulled = false;
      item.tilt.add(this.clouds);
    }
    this.roots = [0, 1, 2, 3, 4, 5].map((f) => this.makeNode(f, 0, 0, Math.PI / 4, 0, null));
    for (const r of this.roots) this.bake(r);
    this._v = new THREE.Vector3(); this._s = new THREE.Sphere(); this._f = new THREE.Frustum(); this._m = new THREE.Matrix4();
  }

  planetUniforms(extra) {
    const P = this.P;
    const u = {
      uBW: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) }, uBF: { value: Array.from({ length: NF }, () => new THREE.Vector3()) },
      uBR: { value: Array.from({ length: NR }, () => new THREE.Vector3()) }, uBI: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
      uBD: { value: Array.from({ length: ND }, () => new THREE.Vector3()) },
      uBWi: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) }, uBFi: { value: Array.from({ length: NF }, () => new THREE.Vector3()) },
      uBRi: { value: Array.from({ length: NR }, () => new THREE.Vector3()) }, uBIi: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
      uBDi: { value: Array.from({ length: ND }, () => new THREE.Vector3()) }, uBC: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
      uBL: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
      uCI: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uCF: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
      uC: { value: new THREE.Vector3() }, uPc: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() },
      uLen: { value: 1 }, uA0: { value: 0 }, uB0: { value: 0 }, uHs: { value: 1 }, uCosA0: { value: 1 }, uCosB0: { value: 1 },
      uR: { value: P.R }, uS: { value: P.S }, uSd: { value: P.Sd }, uSeed: { value: P.seed }, uWarp: { value: P.warp }, uIslands: { value: P.islands },
      uCraters: { value: P.craters }, uSeaLvl: { value: P.seaLvl }, uOcean: { value: P.ocean ? 1 : 0 }, uE: { value: P.E }, uDetA: { value: P.detA },
      uOct: { value: 3 }, uOctR: { value: 1 }, uOctD: { value: 0 },
    };
    return Object.assign(u, extra);
  }

  makeNode(face, a0, b0, hs, level, parent) {
    const pc = facePoint(face, a0, b0);
    const len = Math.hypot(...pc);
    const c = pc.map((x) => x / len);
    const hc = heightAt(this.P, c[0], c[1], c[2]);
    const eMid = this.P.ocean ? Math.max(hc.e, 0) : hc.e;
    return {
      face, a0, b0, hs, level, parent, kids: null, rt: null, ready: false, mesh: null, used: 0,
      pc, len, c, eMid, sizeKm: this.R * 2 * hs * 1.15,
      centerPos: new THREE.Vector3(c[0] * (this.R + eMid), c[1] * (this.R + eMid), c[2] * (this.R + eMid)),
    };
  }

  // bases do ruído (float64 → mod 867) para o centro do pedaço
  setNodeUniforms(u, n) {
    const P = this.P, F = FACES[n.face];
    const [cx, cy, cz] = n.c;
    const Q = [cx * P.S + P.seed, cy * P.S + P.seed, cz * P.S + P.seed];
    const set = (vec, x, y, z) => vec.set(mod867(x), mod867(y), mod867(z));
    // parte inteira (mod 867, preserva o ruído) + fração
    const split = (vi, vf, x, y, z) => {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      vi.set(mod867(ix), mod867(iy), mod867(iz)); vf.set(x - ix, y - iy, z - iz);
    };
    [0, 13.1, 27.7].forEach((o, k) => split(u.uBWi.value[k], u.uBW.value[k], Q[0] * 0.7 + o, Q[1] * 0.7 + o, Q[2] * 0.7 + o));
    let p = [...Q];
    for (let i = 0; i < NF; i++) { split(u.uBFi.value[i], u.uBF.value[i], p[0], p[1], p[2]); p = p.map((x, k) => x * 2.03 + FBM_OFF[k]); }
    p = Q.map((x) => x * 2.3 + 5);
    for (let i = 0; i < NR; i++) { split(u.uBRi.value[i], u.uBR.value[i], p[0], p[1], p[2]); p = p.map((x, k) => x * 2.1 + RID_OFF[k]); }
    [[1.4, 4], [5.5, 11], [14, 3]].forEach(([m, o], k) => split(u.uBIi.value[k], u.uBI.value[k], Q[0] * m + o, Q[1] * m + o, Q[2] * m + o));
    for (let k = 0, f = P.Sd; k < ND; k++, f *= 2) { const o = DET_OFF(k); split(u.uBDi.value[k], u.uBD.value[k], cx * f + o[0], cy * f + o[1], cz * f + o[2]); }
    [[1.3, 31], [14, 0], [40, 0], [3, 0]].forEach(([m, o], k) => set(u.uBC.value[k], Q[0] * m + o, Q[1] * m + o, Q[2] * m + o));
    [[1.6, 7], [5, 0], [17, 3]].forEach(([m, o], k) => set(u.uBL.value[k], Q[0] * m + o, Q[1] * m + o, Q[2] * m + o));
    [[3, 1], [9, 1.7], [27, 2.3]].forEach(([m, s], k) => {
      const B = [cx * m + P.seed * s, cy * m + P.seed * s, cz * m + P.seed * s];
      const I = B.map(Math.floor);
      u.uCI.value[k].set(I[0], I[1], I[2]);
      u.uCF.value[k].set(B[0] - I[0], B[1] - I[1], B[2] - I[2]);
    });
    this.setGeomUniforms(u, n);
    // oitavas conforme o tamanho do texel
    const texel = n.sizeKm / 128;
    const lam0 = P.R / P.S;
    const oct = clamp(Math.log(lam0 / (2 * texel)) / Math.log(2.03), 2, 16);
    u.uOct.value = oct; u.uOctR.value = clamp(oct - 2, 1, 14);
    u.uOctD.value = clamp(Math.log2(2 / (2 * texel)) + 1, 0, 12);
  }
  setGeomUniforms(u, n) {
    const F = FACES[n.face];
    u.uC.value.set(...n.c); u.uPc.value.set(...n.pc); u.uU.value.set(...F.u); u.uV.value.set(...F.v);
    u.uLen.value = n.len; u.uA0.value = n.a0; u.uB0.value = n.b0; u.uHs.value = n.hs;
    u.uCosA0.value = Math.cos(n.a0); u.uCosB0.value = Math.cos(n.b0);
  }

  getRT() {
    if (this.rtPool.length) return this.rtPool.pop();
    this.rtCount++;
    const o = { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    return {
      e: new THREE.WebGLRenderTarget(RES, RES, { ...o, type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
      n: new THREE.WebGLRenderTarget(RES, RES, o),
      a: new THREE.WebGLRenderTarget(RES, RES, o),
    };
  }
  bake(n) {
    if (n.ready) return;
    n.rt = n.rt || this.getRT();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const pass = (mat, target) => {
      this.setNodeUniforms(mat.uniforms, n);
      mat.uniformsNeedUpdate = true;
      this.bakeQuad.material = mat;
      r.setRenderTarget(target);
      r.render(this.bakeScene, this.bakeCam);
    };
    pass(this.bakeE, n.rt.e);
    this.bakeN.uniforms.tE.value = n.rt.e.texture;
    pass(this.bakeN, n.rt.n);
    this.bakeA.uniforms.tE.value = n.rt.e.texture; this.bakeA.uniforms.tN.value = n.rt.n.texture;
    pass(this.bakeA, n.rt.a);
    r.setRenderTarget(prev);
    n.ready = true;
    const m = new THREE.Mesh(gridGeometry(), this.chunkMat);
    m.frustumCulled = false;
    m.position.set(n.c[0] * this.R, n.c[1] * this.R, n.c[2] * this.R);
    m.visible = false;
    const self = this;
    m.onBeforeRender = function () {
      const u = self.chunkMat.uniforms;
      self.setGeomUniforms(u, n);
      u.tElev.value = n.rt.e.texture; u.tAlb.value = n.rt.a.texture; u.tNrm.value = n.rt.n.texture;
      u.uSkirt.value = (n.sizeKm * 0.03 + 0.01) * (self.skirtK ?? 1);
      self.chunkMat.uniformsNeedUpdate = true;
    };
    n.mesh = m;
    this.root.add(m);
  }
  release(n) {
    if (n.kids) { for (const k of n.kids) this.release(k); n.kids = null; }
    if (n.mesh) { this.root.remove(n.mesh); n.mesh = null; }
    if (n.rt) { this.rtPool.push(n.rt); n.rt = null; }
    n.ready = false;
  }

  // camPl: posição da câmera no referencial fixo do planeta (km); camera: câmera da cena
  update(camPl, camera, env) {
    this.frame++;
    const f = this.frame;
    const camD = camPl.length();
    const R = this.R;
    // horizonte (com folga para montanhas de até ~12 km)
    const horizon = Math.acos(clamp(R / Math.max(camD, R + 0.001), -1, 1)) + Math.acos(R / (R + 12));
    const camDir = this._v.copy(camPl).normalize();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._f.setFromProjectionMatrix(this._m);
    const world = this.root.matrixWorld;
    const draw = [];
    const want = [];
    const visit = (n) => {
      n.used = f;
      const ang = Math.acos(clamp(camDir.x * n.c[0] + camDir.y * n.c[1] + camDir.z * n.c[2], -1, 1));
      if (ang - n.hs * 1.6 > horizon) return; // atrás do horizonte
      this._s.center.copy(n.centerPos).applyMatrix4(world);
      this._s.radius = n.sizeKm * 0.9 + 15;
      if (!this._f.intersectsSphere(this._s)) return;
      const d = camPl.distanceTo(n.centerPos);
      if (n.level < this.maxLevel && d < n.sizeKm * SPLIT_K) {
        if (!n.kids) {
          const h = n.hs / 2;
          n.kids = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sa, sb]) => this.makeNode(n.face, n.a0 + sa * h, n.b0 + sb * h, h, n.level + 1, n));
        }
        if (n.kids.every((k) => k.ready)) { for (const k of n.kids) visit(k); return; }
        for (const k of n.kids) if (!k.ready) want.push([k, d]);
      }
      if (n.ready) draw.push(n);
      else want.push([n, d]);
    };
    for (const r of this.roots) visit(r);
    // cozimentos pendentes, mais próximos primeiro
    want.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < Math.min(BAKES_PER_FRAME, want.length); k++) this.bake(want[k][0]);
    // visibilidade
    for (const m of this.root.children) m.visible = false;
    for (const n of draw) n.mesh.visible = true;
    // libera ramos que não são usados há algum tempo
    if (f % 30 === 0) {
      const live = this.rtCount - this.rtPool.length;
      const age = live > MAX_RT ? 2 : 90;
      const sweep = (n) => {
        if (!n.kids) return;
        if (n.kids.every((k) => f - k.used > age)) { for (const k of n.kids) this.release(k); n.kids = null; return; }
        for (const k of n.kids) sweep(k);
      };
      for (const r of this.roots) sweep(r);
    }
    // uniformes compartilhados
    const u = this.chunkMat.uniforms;
    this._m.multiplyMatrices(camera.matrixWorldInverse, this.root.matrixWorld);
    u.uNM.value.setFromMatrix4(this._m);
    u.uSunView.value.copy(env.sunView); u.uSunCol.value.copy(env.sunCol); u.uSunI.value = env.sunI;
    u.uFogCol.value.copy(env.fogCol); u.uSkyCol.value.copy(env.skyCol); u.uFogK.value = env.fogK; u.uDay.value = env.day; u.uTime.value = env.time;
    if (this.clouds) {
      const cu = this.clouds.material.uniforms;
      cu.uSunPos.value.copy(env.sunWorld); cu.uSunCol.value.copy(env.sunCol); cu.uSunI.value = env.sunI;
      cu.uCloudRot.value = env.cloudRot;
      cu.uInside.value = camD < R + this.cloudAlt ? 1 : 0;
      cu.uOct.value = camD - R < 200 ? 9 : 7;
    }
    return draw.length;
  }

  dispose() {
    for (const r of this.roots) this.release(r);
    for (const rt of this.rtPool) { rt.e.dispose(); rt.n.dispose(); rt.a.dispose(); }
    this.rtPool = [];
    this.item.spin.remove(this.root);
    if (this.clouds) { this.item.tilt.remove(this.clouds); this.clouds.geometry.dispose(); this.clouds.material.dispose(); }
    this.bakeE.dispose(); this.bakeN.dispose(); this.bakeA.dispose(); this.chunkMat.dispose();
  }
}

// ================================================================================================
// Detalhes do chão em volta do jogador: rochas e vegetação (instâncias determinísticas por célula)
// ================================================================================================
export class GroundDetail {
  constructor(item, P) {
    this.item = item; this.P = P;
    this.group = new THREE.Group();
    item.spin.add(this.group);
    const v = item.body.visual;
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const p = rockGeo.attributes.position, t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      t.fromBufferAttribute(p, i);
      const k = 1 + 0.25 * Math.sin(t.x * 5.1 + t.y * 2.3) * Math.cos(t.z * 4.7);
      p.setXYZ(i, t.x * k, t.y * k * 0.6, t.z * k);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(v.high).lerp(new THREE.Color(v.mid), 0.5), roughness: 0.95, flatShading: true });
    this.N = 900;
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, this.N);
    this.rocks.frustumCulled = false;
    this.group.add(this.rocks);
    this.life = item.body.life;
    if (this.life === 'complexa') {
      const vc = new THREE.Color(v.vegColor);
      const trunk = new THREE.CylinderGeometry(0.06, 0.1, 1, 6); trunk.translate(0, 0.5, 0);
      const crown = new THREE.IcosahedronGeometry(0.55, 0); crown.translate(0, 1.15, 0);
      this.trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }), 500);
      this.crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: vc.clone().multiplyScalar(1.3), roughness: 0.9, flatShading: true }), 500);
      const bush = new THREE.IcosahedronGeometry(0.5, 0); bush.scale(1, 0.6, 1);
      this.bushes = new THREE.InstancedMesh(bush, new THREE.MeshStandardMaterial({ color: vc.clone().multiplyScalar(1.1), roughness: 1, flatShading: true }), 900);
      for (const m of [this.trunks, this.crowns, this.bushes]) { m.frustumCulled = false; this.group.add(m); }
    }
    this.center = null;
  }

  // dir: direção (fixa no planeta) do jogador
  update(dir, force = false) {
    const R = this.P.R;
    if (!force && this.center && this.center.distanceTo(dir) * R < 0.04) return;
    this.center = dir.clone();
    // referencial tangente local
    const up = dir.clone();
    const e1 = new THREE.Vector3(0, 1, 0).cross(up); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
    const e2 = up.clone().cross(e1);
    const base = up.clone().multiplyScalar(R);
    this.group.position.copy(base);
    const cell = 0.008; // 8 m
    const range = 0.12;  // 120 m
    const n0 = Math.ceil(range / cell);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), d = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    let nr = 0, nt = 0, nb = 0;
    // células de uma grade 3D fixa no planeta: as pedras não mudam de lugar quando o jogador anda
    const k = R / cell;
    const seen = new Set();
    for (let i = -n0; i <= n0; i++) for (let j = -n0; j <= n0; j++) {
      d.copy(up).addScaledVector(e1, (i * cell) / R).addScaledVector(e2, (j * cell) / R).normalize();
      const ci = Math.floor(d.x * k), cj = Math.floor(d.y * k), ck = Math.floor(d.z * k);
      const key = ci + ',' + cj + ',' + ck;
      if (seen.has(key)) continue;
      seen.add(key);
      const h = pcg3d((ci + 0x40000000) >>> 0, (cj + 0x40000000) >>> 0, (ck + 0x40000000) >>> 0);
      const h2 = pcg3d((ci + 0x40000123) >>> 0, (cj + 0x40000077) >>> 0, (ck + 0x40000999) >>> 0);
      if (h[0] > 0.5) continue;
      d.set((ci + h[1]) / k, (cj + h[2]) / k, (ck + h2[2]) / k).normalize();
      const hh = heightAt(this.P, d.x, d.y, d.z);
      if (hh.water) continue;
      pos.copy(d).multiplyScalar(R + hh.e).sub(base);
      q.setFromUnitVectors(Y, d);
      const kind = this.life === 'complexa' ? h2[0] : 1;
      if (kind < 0.12 && nt < 500) {
        const sz = 0.004 + h2[1] * 0.012;
        s.set(sz, sz * (0.8 + h2[2] * 0.6), sz);
        m.compose(pos, q, s);
        this.trunks.setMatrixAt(nt, m); this.crowns.setMatrixAt(nt, m); nt++;
      } else if (kind < 0.45 && nb < 900) {
        const sz = 0.0006 + h2[1] * 0.0014;
        s.set(sz, sz, sz); m.compose(pos, q, s); this.bushes.setMatrixAt(nb++, m);
      } else if (nr < this.N) {
        const sz = 0.00008 + Math.pow(h2[1], 4) * 0.0011; // 8 cm a ~1,2 m
        s.set(sz * (0.7 + h2[2] * 0.6), sz, sz);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, h2[2] * 6.28));
        pos.addScaledVector(d, -sz * 0.25);
        m.compose(pos, q, s); this.rocks.setMatrixAt(nr++, m);
      }
    }
    this.rocks.count = nr; this.rocks.instanceMatrix.needsUpdate = true;
    if (this.trunks) {
      this.trunks.count = nt; this.crowns.count = nt; this.bushes.count = nb;
      for (const x of [this.trunks, this.crowns, this.bushes]) x.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.item.spin.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

// ================================================================================================
// Vida perto do jogador: grama, flores, uma manada pastando e pássaros (Nova Terra e mundos com vida)
// ================================================================================================
export class LifeDetail {
  constructor(item, P) {
    this.item = item; this.P = P;
    this.R = P.R;
    const b = item.body, v = b.visual;
    this.group = new THREE.Group();
    item.spin.add(this.group);
    const vc = new THREE.Color(v.vegColor);
    // tufo de grama: folhas finas e afiladas, base escura e ponta clara; normais para cima (luz igual à do chão)
    const pos = [], colA = [], nrm = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + k * 0.7, r = 0.12 + (k % 3) * 0.1, w = 0.035, h = 0.6 + ((k * 37) % 10) / 20;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, tx = Math.cos(a + 1.6) * w, tz = Math.sin(a + 1.6) * w;
      const lean = 0.25;
      pos.push(cx - tx, 0, cz - tz, cx + tx, 0, cz + tz, cx * (1 + lean) , h, cz * (1 + lean));
      colA.push(0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 1.05, 1.05, 1.0);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const tuft = new THREE.BufferGeometry();
    tuft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tuft.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    tuft.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
    this.grass = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ color: vc.clone().multiplyScalar(1.9).offsetHSL(0.03, 0.05, 0.05), vertexColors: true, side: THREE.DoubleSide }), 3200);
    this.grass.frustumCulled = false;
    this.group.add(this.grass);
    this.flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), 500);
    this.flowers.frustumCulled = false;
    this.group.add(this.flowers);
    this.nova = b.special === 'nova';
    this.creatures = [];
    this.birds = [];
    if (this.nova) {
      const hide = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 });
      for (let k = 0; k < 9; k++) {
        const c = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).scale(0.55, 0.45, 1), hide);
        body.position.y = 1.2; c.add(body);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.0, 6), hide);
        neck.position.set(0, 1.75, 0.85); neck.rotation.x = 0.7; c.add(neck);
        const head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.22, 0.24, 0.42), dark);
        head.position.set(0, 2.15, 1.25); c.add(head);
        c.userData.head = head;
        c.userData.legs = [];
        for (const [x, z] of [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.6], [0.3, -0.6]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.0, 5).translate(0, -0.5, 0), dark);
          leg.position.set(x, 1.0, z); c.add(leg); c.userData.legs.push(leg);
        }
        c.scale.setScalar(0.001 * (0.8 + (k % 3) * 0.15)); // ~2,5 m de altura
        this.group.add(c);
        this.creatures.push({ g: c, x: 0, z: 0, tx: 0, tz: 0, phase: k * 1.3, wait: Math.random() * 5 });
      }
      const wingGeo = new THREE.BufferGeometry();
      wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, 0, 0, -0.3, 1.2, 0.05, -0.1], 3));
      wingGeo.computeVertexNormals();
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, side: THREE.DoubleSide });
      for (let k = 0; k < 12; k++) {
        const bird = new THREE.Group();
        const l = new THREE.Mesh(wingGeo, wingMat), r = new THREE.Mesh(wingGeo, wingMat);
        r.scale.x = -1;
        bird.add(l, r);
        bird.scale.setScalar(0.0006);
        this.group.add(bird);
        this.birds.push({ g: bird, l, r, a: (k / 12) * Math.PI * 2, rad: 0.03 + (k % 4) * 0.008, h: 0.05 + (k % 3) * 0.012, sp: 0.25 + (k % 5) * 0.03 });
      }
    }
    this.center = null;
    this.herdCenter = null;
  }

  // referencial tangente local ao redor de "up" (direção fixa no planeta)
  frameAt(up) {
    const e1 = new THREE.Vector3(0, 1, 0).cross(up); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
    return { up, e1, e2: up.clone().cross(e1) };
  }
  ground(d) { const h = heightAt(this.P, d.x, d.y, d.z); return { r: this.R + (h.water ? 0 : h.e), h }; }

  update(dir) {
    const R = this.R;
    if (this.center && this.center.distanceTo(dir) * R < 0.012) return;
    this.center = dir.clone();
    const { up, e1, e2 } = this.frameAt(dir);
    const base = up.clone().multiplyScalar(R);
    this.group.position.copy(base);
    // alturas numa grade de 10 m (interpolação bilinear) para não calcular o relevo por tufo
    const N = 9, span = 0.045, step = (2 * span) / (N - 1);
    const H = [], OK = [];
    const d = new THREE.Vector3();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      d.copy(up).addScaledVector(e1, (-span + i * step) / R).addScaledVector(e2, (-span + j * step) / R).normalize();
      const g = this.ground(d);
      H.push(g.r); OK.push(!g.h.water && g.h.hs > 0.01 && g.h.hs < 0.45);
    }
    const hAt = (x, z) => {
      const fx = clamp((x + span) / step, 0, N - 1.001), fz = clamp((z + span) / step, 0, N - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], e = H[(j + 1) * N + i + 1];
      return { r: (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz, ok: OK[Math.round(fz) * N + Math.round(fx)] };
    };
    this.hAt = hAt; this.e1 = e1; this.e2 = e2; this.up = up; this.span = span;
    const cell = 0.0016, k = R / cell, n0 = Math.ceil(0.04 / cell);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const seen = new Set();
    let ng = 0, nf = 0;
    const FL = [new THREE.Color(1, 0.85, 0.3), new THREE.Color(0.95, 0.4, 0.55), new THREE.Color(0.85, 0.85, 1), new THREE.Color(0.7, 0.4, 1)];
    for (let i = -n0; i <= n0; i++) for (let j = -n0; j <= n0; j++) {
      d.copy(up).addScaledVector(e1, (i * cell) / R).addScaledVector(e2, (j * cell) / R).normalize();
      const ci = Math.floor(d.x * k), cj = Math.floor(d.y * k), ck = Math.floor(d.z * k);
      const key = ci + ',' + cj + ',' + ck;
      if (seen.has(key)) continue;
      seen.add(key);
      const h1 = pcg3d((ci + 0x20000000) >>> 0, (cj + 0x20000000) >>> 0, (ck + 0x20000000) >>> 0);
      d.set((ci + h1[0]) / k, (cj + h1[1]) / k, (ck + h1[2]) / k).normalize();
      const lx = (d.dot(e1)) * R, lz = (d.dot(e2)) * R;
      if (Math.abs(lx) > span || Math.abs(lz) > span) continue;
      const g = hAt(lx, lz);
      if (!g.ok) continue;
      pos.copy(d).multiplyScalar(g.r).sub(base);
      q.setFromUnitVectors(Y, d);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, h1[2] * 6.28));
      if (h1[0] < 0.08 && nf < 500) {
        const sz = 0.00007 + h1[1] * 0.00006;
        s.set(sz, sz, sz); m.compose(pos.clone().addScaledVector(d, 0.00025), q, s);
        this.flowers.setMatrixAt(nf, m); this.flowers.setColorAt(nf, FL[Math.floor(h1[1] * 4) % 4]); nf++;
      } else if (ng < 3200) {
        const sz = 0.0004 + h1[1] * 0.0005;
        s.set(sz * 1.3, sz, sz * 1.3); m.compose(pos, q, s);
        this.grass.setMatrixAt(ng++, m);
      }
    }
    this.grass.count = ng; this.grass.instanceMatrix.needsUpdate = true;
    this.flowers.count = nf; this.flowers.instanceMatrix.needsUpdate = true;
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
    // a manada fica num ponto fixo do planeta, a algumas dezenas de metros
    if (this.nova && (!this.herdCenter || this.herdCenter.distanceTo(dir) * R > 0.25)) {
      this.herdCenter = up.clone().addScaledVector(e1, 0.035 / R).addScaledVector(e2, 0.02 / R).normalize();
      for (const c of this.creatures) { c.x = (Math.random() - 0.5) * 0.03; c.z = (Math.random() - 0.5) * 0.03; c.tx = c.x; c.tz = c.z; }
    }
  }

  // movimento dos animais e pássaros (a cada quadro)
  animate(dt, t, dir) {
    if (!this.nova || !this.herdCenter) return;
    const R = this.R;
    const hf = this.frameAt(this.herdCenter);
    const base = this.group.position;
    const Y = new THREE.Vector3(0, 1, 0);
    for (const c of this.creatures) {
      if (c.wait > 0) c.wait -= dt;
      else {
        const dx = c.tx - c.x, dz = c.tz - c.z, L = Math.hypot(dx, dz);
        if (L < 0.0005) { c.tx = (Math.random() - 0.5) * 0.04; c.tz = (Math.random() - 0.5) * 0.04; c.wait = 3 + Math.random() * 8; }
        else { const sp = 0.0011 * dt; c.x += (dx / L) * Math.min(sp, L); c.z += (dz / L) * Math.min(sp, L); c.heading = Math.atan2(dx, dz); }
      }
      const d = hf.up.clone().addScaledVector(hf.e1, c.x / R).addScaledVector(hf.e2, c.z / R).normalize();
      const g = this.ground(d);
      c.g.position.copy(d).multiplyScalar(g.r).sub(base);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, d);
      c.g.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(Y, c.heading || c.phase));
      const walking = c.wait <= 0;
      c.g.userData.legs.forEach((leg, i) => { leg.rotation.x = walking ? Math.sin(t * 6 + c.phase + (i % 2) * Math.PI) * 0.45 : 0; });
      c.g.userData.head.position.y = walking ? 2.15 : 1.0 + Math.sin(t * 0.8 + c.phase) * 0.1; // pastando
      c.g.visible = !g.h.water;
    }
    const pf = this.frameAt(dir);
    for (const b of this.birds) {
      b.a += dt * b.sp;
      const x = Math.cos(b.a) * b.rad, z = Math.sin(b.a) * b.rad;
      const d = pf.up.clone().addScaledVector(pf.e1, x / R).addScaledVector(pf.e2, z / R).normalize();
      const r = this.ground(pf.up).r + b.h + Math.sin(b.a * 3) * 0.004;
      b.g.position.copy(d).multiplyScalar(r).sub(base);
      const tangent = pf.e1.clone().multiplyScalar(-Math.sin(b.a)).addScaledVector(pf.e2, Math.cos(b.a));
      b.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), tangent, d));
      const flap = Math.sin(t * 9 + b.a * 7) * 0.6;
      b.l.rotation.z = flap; b.r.rotation.z = -flap;
    }
  }

  dispose() {
    this.item.spin.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

function mergeGeos(list) {
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}
