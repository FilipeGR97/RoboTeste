// Shaders GLSL e fábricas de materiais
import * as THREE from 'three';

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor((x + 0.5) * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor((x + 0.5) * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ x = mod289(x); return mod289(((x * 34.0) + 1.0) * x); } // reduz antes: float32 exato
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoiseCore(vec3 i, vec3 x0);
float snoise(vec3 v){
  vec3 i = floor(v + dot(v, vec3(1.0 / 3.0)));
  return snoiseCore(i, v - i + dot(i, vec3(1.0 / 6.0)));
}
// mesmo ruído para v = I + f com I inteiro (exato) e f pequeno: a inclinação do simplex é feita
// algebricamente, sem nunca somar números grandes em float32
float snoiseS(vec3 I, vec3 f){
  float SI = I.x + I.y + I.z;
  float q = floor((SI + 0.5) / 3.0);
  float r = SI - 3.0 * q;
  vec3 fl = floor(f + (r + f.x + f.y + f.z) / 3.0);
  return snoiseCore(I + q + fl, f - fl + (r + fl.x + fl.y + fl.z) / 6.0);
}
float snoiseCore(vec3 i, vec3 x0){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor((p + 0.5) / 49.0);
  vec4 x_ = floor((j + 0.5) / 7.0);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(-0.01)); // h = 0 exato acontece; o limiar deslocado torna a escolha igual na GPU e na CPU
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, float oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 14; i++){
    float w = clamp(oct - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    s += a * snoise(p) * w;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p, float oct){
  float a = 0.5, s = 0.0, wgt = 1.0;
  for (int i = 0; i < 12; i++){
    float w = clamp(oct - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    float n = 1.0 - abs(snoise(p));
    n *= n; n *= wgt;
    wgt = clamp(n * 1.6, 0.0, 1.0);
    s += a * n * w;
    p = p * 2.1 + vec3(4.1, 1.3, 7.7);
    a *= 0.5;
  }
  return s;
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// hash inteiro (PCG3D): resultado idêntico na GPU e no JavaScript (usado pelas crateras e pela colisão)
uvec3 pcg3d(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash33(vec3 p){
  uvec3 u = uvec3(ivec3(floor(p)) + 65536);
  return vec3(pcg3d(u)) * (1.0 / 4294967295.0);
}
// Crateras via células de Voronoi
float crater(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  float h = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(i + g);
    if (o.z < 0.45) continue;
    float rad = 0.12 + 0.3 * o.x * o.x;
    float d = length(g + o - f) / rad;
    if (d < 1.0) h += (d * d - 1.0) * 0.6 * rad * 3.0;
    else h += exp(-(d - 1.0) * (d - 1.0) * 18.0) * 0.22 * rad * 3.0;
  }
  return h;
}
`;

const VERT_SURF = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNw;
void main(){
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNw = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const BUMP = /* glsl */ `
vec3 perturb(vec3 pos, vec3 nrm, float h){
  vec3 sx = dFdx(pos); vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, nrm); vec3 r2 = cross(nrm, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  float ad = abs(det);
  grad -= nrm * dot(grad, nrm);
  float gl = length(grad);
  if (gl > ad * 1.2) grad *= ad * 1.2 / gl; // limita a inclinação (~50°) para evitar normais degeneradas
  return normalize(ad * nrm - grad);
}
`;

// -------------------------------------------------------------------------------------------------
// Planetas rochosos
// -------------------------------------------------------------------------------------------------
const ROCKY_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunPos; uniform vec3 uSunCol; uniform float uSunI;
uniform float uSeed, uOct, uTime;
uniform vec3 cDeep, cShallow, cBeach, cLow, cMid, cHigh, cSnow, cVeg, cCloud;
uniform float uSea, uRelief, uIceLat, uClouds, uLava, uCraters, uContScale, uWarp, uVeg, uCloudRot, uIslands, uStorm;
uniform vec3 uStormDir;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNw;
${NOISE}
${BUMP}
float terrain(vec3 n, vec3 q){
  vec3 w = vec3(snoise(q * 0.7), snoise(q * 0.7 + 13.1), snoise(q * 0.7 + 27.7));
  q += w * uWarp * 0.5;
  float c = fbm(q, uOct);
  float m = ridged(q * 2.3 + 5.0, max(uOct - 2.0, 1.0));
  float h = c + m * 0.42 * smoothstep(-0.05, 0.25, c) - 0.12;
  if (uIslands > 0.0){
    // arquipélagos: picos vulcânicos isolados, agrupados em cadeias
    float chain = smoothstep(0.05, 0.55, snoise(q * 1.4 + 4.0) * 0.5 + 0.5);
    float isl = pow(max(snoise(q * 5.5 + 11.0), 0.0), 1.6) + pow(max(snoise(q * 14.0 + 3.0), 0.0), 2.0) * 0.35;
    h += uIslands * isl * chain * 0.75;
  }
  if (uCraters > 0.0){
    h += uCraters * (crater(n * 3.0 + uSeed) * 0.3 + crater(n * 9.0 + uSeed * 1.7) * 0.15);
    if (uOct > 6.0) h += uCraters * crater(n * 27.0 + uSeed * 2.3) * 0.07 * clamp(uOct - 6.0, 0.0, 1.0);
  }
  return h;
}
void main(){
  vec3 n = normalize(vObj);
  vec3 q = n * uContScale + uSeed;
  float h = terrain(n, q);
  vec3 Ng = normalize(vNw);
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float lat = abs(n.y);
  float moist = snoise(q * 1.3 + 31.0) * 0.5 + 0.5;
  float detail = snoise(q * 14.0) * 0.5 + snoise(q * 40.0) * 0.25;
  bool ocean = uSea > -1.5;
  float hs = h - (ocean ? uSea : -0.45);
  vec3 col; float spec = 0.0;
  if (ocean && hs < 0.0){
    float d = smoothstep(-0.45, 0.0, hs);
    col = mix(cDeep, cShallow, d * d * d);
    spec = 1.0;
  } else {
    hs = max(hs, 0.0);
    col = mix(cBeach, cLow, smoothstep(0.0, 0.035, hs));
    col = mix(col, cMid, smoothstep(0.1, 0.4, hs + (moist - 0.5) * 0.25));
    col = mix(col, cHigh, smoothstep(0.4, 0.75, hs + detail * 0.05));
    float vg = uVeg * smoothstep(0.3, 0.6, moist) * (1.0 - smoothstep(0.22, 0.5, hs)) * (1.0 - smoothstep(0.55, 0.8, lat));
    col = mix(col, cVeg * (0.7 + 0.6 * moist), vg);
    col *= 0.88 + 0.24 * detail;
  }
  float iceN = lat + snoise(q * 3.0) * 0.06 + max(hs, 0.0) * 0.35;
  float ice = smoothstep(uIceLat - 0.03, uIceLat + 0.03, iceN);
  col = mix(col, cSnow, ice);
  spec *= 1.0 - ice;
  vec3 N = Ng;
  if (uRelief > 0.0 && spec < 0.5) N = perturb(vWorld, Ng, max(hs, 0.0) * uRelief);
  float ndlG = dot(Ng, L);
  float diff = max(dot(N, L), 0.0) * smoothstep(-0.08, 0.12, ndlG);
  vec3 H = normalize(L + V);
  float fres = pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
  float sp = spec * pow(max(dot(Ng, H), 0.0), 90.0) * (0.25 + 0.75 * fres) * 2.5 * step(0.0, ndlG);
  vec3 lit = col * diff + vec3(sp) * vec3(1.0, 0.95, 0.85);
  vec3 emis = vec3(0.0);
  if (uLava > 0.0){
    float rift = 1.0 - abs(snoise(q * 1.6 + 7.0));
    float cr = 1.0 - abs(snoise(q * 5.0 + vec3(0.0, uTime * 0.01, 0.0)));
    float cr2 = 1.0 - abs(snoise(q * 17.0 + 3.0));
    float g = max(pow(rift, 40.0), max(pow(cr, 22.0) * 0.7, pow(cr2, 30.0) * 0.4));
    g *= uLava;
    float pulse = 0.85 + 0.15 * sin(uTime * 0.7 + q.x * 3.0);
    emis = (vec3(0.9, 0.18, 0.02) * g * 0.9 + vec3(1.0, 0.6, 0.2) * pow(g, 4.0) * 1.6) * pulse;
    lit *= 1.0 - g * 0.8;
  }
  if (uClouds > 0.0){
    float cr = uCloudRot;
    vec3 cn0 = vec3(n.x * cos(cr) - n.z * sin(cr), n.y, n.x * sin(cr) + n.z * cos(cr));
    float cd = 10.0;
    if (uStorm > 0.0){
      // ciclone: torce o campo de nuvens em espiral em volta do olho
      cd = acos(clamp(dot(cn0, uStormDir), -1.0, 1.0));
      float sw = uStorm * 7.0 * exp(-cd * cd / 0.045) * sign(uStormDir.y + 1e-4);
      vec3 k = uStormDir; float cs = cos(sw), sn = sin(sw);
      cn0 = cn0 * cs + cross(k, cn0) * sn + k * dot(k, cn0) * (1.0 - cs);
    }
    vec3 cp = cn0 * 2.2 + uSeed * 0.37;
    cp += vec3(snoise(cp * 0.6), snoise(cp * 0.6 + 7.0), snoise(cp * 0.6 + 13.0)) * 0.45;
    float cv = fbm(cp * vec3(1.0, 2.2, 1.0), min(uOct, 7.0)) * 0.5 + 0.5;
    float th = 0.7 - uClouds * 0.45;
    float cov = smoothstep(th, th + 0.2, cv) * min(uClouds * 3.0, 1.0);
    if (uClouds > 0.95) cov = 0.85 + 0.15 * cv;
    if (uStorm > 0.0){
      float core = exp(-cd * cd / 0.02);
      cov = max(cov, core * uStorm * smoothstep(0.35, 0.6, cv + core * 0.3));
      cov *= 1.0 - exp(-cd * cd / 0.00012) * uStorm;
    }
    float cdiff = smoothstep(-0.12, 0.45, ndlG);
    lit = mix(lit, cCloud * 0.9 * cdiff, cov);
    emis *= 1.0 - cov * 0.85;
  }
  vec3 outc = lit * uSunCol * uSunI * 0.78 + emis + col * 0.0025;
  gl_FragColor = vec4(outc, 1.0);
  #include <logdepthbuf_fragment>
}
`;

const col = (h) => new THREE.Color(h);

export function rockyMaterial(v) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT_SURF,
    fragmentShader: ROCKY_FRAG,
    uniforms: {
      uSunPos: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 },
      uSeed: { value: v.seed }, uOct: { value: 6 }, uTime: { value: 0 },
      cDeep: { value: col(v.deep) }, cShallow: { value: col(v.shallow) }, cBeach: { value: col(v.beach) },
      cLow: { value: col(v.low) }, cMid: { value: col(v.mid) }, cHigh: { value: col(v.high) }, cSnow: { value: col(v.snow) },
      cVeg: { value: col(v.vegColor) }, cCloud: { value: col(v.cloudColor) },
      uSea: { value: v.sea }, uRelief: { value: v.relief }, uIceLat: { value: v.iceLat }, uClouds: { value: v.clouds },
      uLava: { value: v.lava }, uCraters: { value: v.craters }, uContScale: { value: v.contScale }, uWarp: { value: v.warp },
      uVeg: { value: v.veg }, uCloudRot: { value: 0 }, uIslands: { value: v.islands || 0 }, uStorm: { value: v.storm || 0 },
      uStormDir: { value: new THREE.Vector3(...(v.stormDir || [0, 1, 0])) },
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Gigantes gasosos
// -------------------------------------------------------------------------------------------------
const GAS_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunPos; uniform vec3 uSunCol; uniform float uSunI;
uniform vec3 c1, c2, c3, cStorm;
uniform float uBands, uTurb, uStorm, uStormLat, uStormLon, uSeed, uTime, uEmis, uOct;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNw;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float lat = n.y;
  float lon = atan(n.z, n.x);
  vec3 sp = vec3(n.x * 2.5, n.y * 11.0, n.z * 2.5) + uSeed;
  float t1 = fbm(sp + vec3(uTime * 0.0015, 0.0, 0.0), min(uOct, 6.0));
  float wv = fbm(n * 3.5 + uSeed * 1.3, 4.0);
  float b = lat * uBands + t1 * uTurb * 0.55 + wv * uTurb * 0.7;
  float s1 = sin(b * 3.14159) * 0.5 + 0.5;
  float s2 = sin(b * 1.73 + 1.3) * 0.5 + 0.5;
  vec3 col = mix(c1, c2, s1);
  col = mix(col, c3, smoothstep(0.55, 0.95, s2) * 0.8);
  col *= 0.9 + 0.2 * (fbm(vec3(n.x * 9.0, n.y * 36.0, n.z * 9.0) + uSeed, min(uOct, 5.0)) * 0.5 + 0.5);
  if (uStorm > 0.0){
    float dl = atan(sin(lon - uStormLon), cos(lon - uStormLon));
    vec2 d = vec2(dl * cos(lat), lat - uStormLat);
    float r = length(d / vec2(0.2, 0.09));
    float sw = snoise(vec3(d * 18.0, uSeed + r * 2.0));
    float m = smoothstep(1.0, 0.55, r + sw * 0.12) * uStorm;
    col = mix(col, cStorm * (0.85 + 0.3 * sw), m);
  }
  col *= mix(1.0, 0.72, smoothstep(0.78, 1.0, abs(lat)));
  vec3 Ng = normalize(vNw);
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(Ng, L);
  float diff = smoothstep(-0.06, 0.5, ndl) * 0.35 + max(ndl, 0.0) * 0.65;
  diff *= smoothstep(-0.06, 0.06, ndl);
  float mu = max(dot(Ng, V), 0.0);
  col *= 0.65 + 0.35 * pow(mu, 0.35);
  vec3 outc = col * diff * uSunCol * uSunI * 0.8;
  outc += uEmis * mix(vec3(1.0, 0.25, 0.05), col, 0.3) * (1.0 - s1 * 0.6) * 1.5;
  gl_FragColor = vec4(outc + col * 0.002, 1.0);
  #include <logdepthbuf_fragment>
}
`;

export function gasMaterial(v) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT_SURF,
    fragmentShader: GAS_FRAG,
    uniforms: {
      uSunPos: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 },
      c1: { value: col(v.c1) }, c2: { value: col(v.c2) }, c3: { value: col(v.c3) }, cStorm: { value: col(v.stormColor) },
      uBands: { value: v.bands }, uTurb: { value: v.turb }, uStorm: { value: v.storm }, uStormLat: { value: v.stormLat },
      uStormLon: { value: v.stormLon }, uSeed: { value: v.seed }, uTime: { value: 0 }, uEmis: { value: v.emissive }, uOct: { value: 5 },
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Atmosfera — espalhamento simples (Rayleigh + Mie) integrado ao longo do raio de visão
// -------------------------------------------------------------------------------------------------
const ATM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;
const ATM_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uCenter; uniform float uR; uniform float uTop;
uniform vec3 uBetaR; uniform vec3 uBetaM; uniform float uHR; uniform float uHM; uniform float uG;
uniform vec3 uSunPos; uniform vec3 uSunCol; uniform float uSunI;
varying vec3 vWorld;
vec2 rs(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0, -2.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
void main(){
  vec3 ro = (cameraPosition - uCenter) / uR;
  vec3 rd = normalize(vWorld - cameraPosition);
  vec2 ta = rs(ro, rd, uTop);
  if (ta.y < 0.0) discard;
  vec2 tp = rs(ro, rd, 1.0);
  float t0 = max(ta.x, 0.0), t1 = ta.y;
  if (tp.x > 0.0) t1 = min(t1, tp.x);
  vec3 L = normalize(uSunPos - uCenter);
  const int NS = 20; const int NL = 6;
  float ds = (t1 - t0) / float(NS);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < NS; i++){
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float hgt = length(p) - 1.0;
    float dR = exp(-hgt / uHR) * ds, dM = exp(-hgt / uHM) * ds;
    odR += dR; odM += dM;
    vec2 tl = rs(p, L, uTop);
    vec2 tpl = rs(p, L, 1.0);
    if (tpl.x > 0.0) continue;
    float dsl = tl.y / float(NL);
    float lR = 0.0, lM = 0.0;
    for (int j = 0; j < NL; j++){
      vec3 q = p + L * dsl * (float(j) + 0.5);
      float hq = max(length(q) - 1.0, 0.0);
      lR += exp(-hq / uHR) * dsl; lM += exp(-hq / uHM) * dsl;
    }
    vec3 tau = uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM);
    vec3 att = exp(-tau);
    sumR += dR * att; sumM += dM * att;
  }
  float mu = dot(rd, L);
  float pR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
  float g = uG;
  float pM = 3.0 / (8.0 * 3.14159) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 c = uSunI * uSunCol * (sumR * uBetaR * pR + sumM * uBetaM * pM);
  gl_FragColor = vec4(c, 1.0);
  #include <logdepthbuf_fragment>
}
`;

export function atmosphereMaterial(atm) {
  const HR = atm.thick / 8, HM = atm.thick / 30;
  return new THREE.ShaderMaterial({
    vertexShader: ATM_VERT,
    fragmentShader: ATM_FRAG,
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uTop: { value: 1 + atm.thick },
      uBetaR: { value: new THREE.Vector3(...atm.tauR.map((t) => t / HR)) },
      uBetaM: { value: new THREE.Vector3(...atm.tauM.map((t) => t / HM)) },
      uHR: { value: HR }, uHM: { value: HM }, uG: { value: atm.g },
      uSunPos: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 22 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}

// -------------------------------------------------------------------------------------------------
// Anéis planetários
// -------------------------------------------------------------------------------------------------
const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld; varying vec3 vLocal;
void main(){
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;
const RING_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uInner, uOuter, uOp, uSeed, uR, uSunI;
uniform vec3 uCenter, uSunPos, uSunCol;
varying vec3 vWorld; varying vec3 vLocal;
${NOISE}
void main(){
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float n = 0.55 + 0.3 * snoise(vec3(r * 25.0, uSeed, 0.5)) + 0.2 * snoise(vec3(r * 120.0, uSeed * 2.0, 1.5)) + 0.1 * snoise(vec3(r * 600.0, uSeed, 3.0));
  float dens = clamp(n, 0.0, 1.0) * smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.95, t);
  dens *= 1.0 - 0.9 * exp(-pow((t - 0.68) / 0.025, 2.0));
  dens *= mix(0.45, 1.0, smoothstep(0.0, 0.3, t));
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 oc = vWorld - uCenter;
  float b = dot(oc, L); float c = dot(oc, oc) - uR * uR;
  float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.04 : 1.0;
  float fwd = pow(max(dot(-V, L), 0.0), 6.0);
  vec3 cc = uColor * (0.75 + 0.5 * snoise(vec3(r * 60.0, uSeed + 5.0, 0.0)));
  vec3 lit = cc * (0.55 + 1.6 * fwd) * shadow * uSunI * uSunCol;
  gl_FragColor = vec4(lit, dens * uOp);
  #include <logdepthbuf_fragment>
}
`;

export function ringMaterial(color, inner, outer, op, seed) {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uColor: { value: col(color) }, uInner: { value: inner }, uOuter: { value: outer }, uOp: { value: op }, uSeed: { value: seed },
      uR: { value: 1 }, uSunI: { value: 1 }, uCenter: { value: new THREE.Vector3() }, uSunPos: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// -------------------------------------------------------------------------------------------------
// Estrela (superfície) e brilho (glare)
// -------------------------------------------------------------------------------------------------
const STAR_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uTime, uI, uSeed;
varying vec3 vObj; varying vec3 vWorld; varying vec3 vNw;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  vec3 Ng = normalize(vNw);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = max(dot(Ng, V), 0.0);
  float gran = fbm(n * 34.0 + vec3(uTime * 0.04), 4.0) * 0.5 + 0.5;
  float big = fbm(n * 4.0 + uSeed + vec3(0.0, uTime * 0.004, 0.0), 4.0);
  float spots = smoothstep(0.5, 0.7, big) * 0.75;
  float fac = fbm(n * 9.0 - uSeed + vec3(uTime * 0.01), 3.0);
  float limb = pow(mu, 0.5);
  vec3 c = uColor * (0.7 + 0.6 * gran + 0.25 * smoothstep(0.3, 0.6, fac)) * (1.0 - spots) * (0.25 + 0.75 * limb);
  c = mix(c, vec3(1.0), 0.08 * limb);
  gl_FragColor = vec4(c * uI, 1.0);
  #include <logdepthbuf_fragment>
}
`;
export function starMaterial(color, seed) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT_SURF, fragmentShader: STAR_FRAG,
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uI: { value: 6 }, uSeed: { value: seed } },
  });
}

const BILL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const GLARE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uI; uniform float uRot;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float core = exp(-r * r * 140.0);
  float glow = exp(-r * 8.0) * 0.55 + exp(-r * 3.0) * 0.1;
  float streak = exp(-abs(p.y) * 140.0) * exp(-abs(p.x) * 2.2) * 0.22;
  float ang = atan(p.y, p.x) + uRot;
  float rays = pow(0.5 + 0.5 * sin(ang * 11.0) * sin(ang * 7.0 + 1.0), 8.0) * exp(-r * 5.0) * 0.22;
  // raios de difração: 4 longos + 4 curtos
  float spk = 0.0;
  for (int k = 0; k < 4; k++){
    float a0 = uRot + float(k) * 0.7853982;
    vec2 d = vec2(cos(a0), sin(a0));
    float along = abs(dot(p, d)), across = abs(dot(p, vec2(-d.y, d.x)));
    float w = (k % 2 == 0) ? 0.006 : 0.004;
    float len = (k % 2 == 0) ? 0.32 : 0.14;
    spk += exp(-across * across / (w * w)) * exp(-along / len) * ((k % 2 == 0) ? 0.55 : 0.3);
  }
  // halo cromático (anel de difração) e reflexo interno da lente
  float ring = exp(-pow((r - 0.5) / 0.035, 2.0)) * 0.035;
  vec3 ringC = vec3(0.4 + 0.6 * smoothstep(0.47, 0.53, r), 0.6, 1.0 - 0.6 * smoothstep(0.47, 0.53, r));
  float a = (core * 1.6 + glow + streak + rays + spk) * smoothstep(1.0, 0.55, r);
  vec3 sat = pow(uColor, vec3(1.6));
  vec3 c = mix(sat, vec3(1.0), clamp(core * 0.8 + spk * 0.2, 0.0, 1.0)) * a * uI + ringC * ring * uI;
  gl_FragColor = vec4(c, 1.0);
  #include <logdepthbuf_fragment>
}
`;
export function glareMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: BILL_VERT, fragmentShader: GLARE_FRAG,
    uniforms: { uColor: { value: color }, uI: { value: 1 }, uRot: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Exaustão dos motores
// -------------------------------------------------------------------------------------------------
const EXH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;
const EXH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uPower, uTime, uCore;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float y = 1.0 - vUv.y;
  float f = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(y, 1.6) * pow(f, 1.5);
  float flick = 0.88 + 0.12 * sin(uTime * 70.0 + vUv.y * 30.0) * sin(uTime * 23.0);
  float shock = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 20.0), 4.0);
  vec3 c = mix(uColor, vec3(1.0), pow(y, 5.0) * uCore) * body * uPower * flick * shock * 3.0;
  gl_FragColor = vec4(c, 1.0);
  #include <logdepthbuf_fragment>
}
`;
export function exhaustMaterial(color, core = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: EXH_VERT, fragmentShader: EXH_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 0 }, uTime: { value: 0 }, uCore: { value: core } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// -------------------------------------------------------------------------------------------------
// Céu de fundo (Via Láctea + estrelas não resolvidas + galáxias) — renderizado uma vez num cubemap
// -------------------------------------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uAnd, uLMC, uSMC;
varying vec3 vDir;
${NOISE}
vec3 starLayer(vec3 d, float scale, float prob, float sharp){
  vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p);
  float h = hash13(id);
  if (h > prob) return vec3(0.0);
  vec3 o = vec3(hash13(id + 11.1), hash13(id + 23.7), hash13(id + 37.3)) * 0.6 + 0.2;
  vec3 df = f - o;
  df -= d * dot(df, d);
  float b = pow(hash13(id + 5.3), 5.0);
  float tp = hash13(id + 71.1);
  vec3 c = mix(vec3(1.0, 0.72, 0.5), vec3(0.72, 0.84, 1.0), tp);
  return c * exp(-dot(df, df) * sharp) * (0.12 + b * 2.0);
}
float galaxy(vec3 d, vec3 c, float size, float elong, float ang){
  if (dot(d, c) < 0.0) return 0.0;
  vec3 up = abs(c.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(c, up)); vec3 t2 = cross(c, t1);
  vec2 p = vec2(dot(d, t1), dot(d, t2));
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  p.y /= elong;
  float r = length(p) / size;
  return exp(-r * r * 3.0) * 0.5 + exp(-r * 14.0) * 1.5;
}
void main(){
  vec3 d = normalize(vDir);
  float b = asin(clamp(d.y, -1.0, 1.0));
  float l = atan(-d.z, d.x);
  float bulge = exp(-l * l / 0.35);
  float width = 0.07 + 0.1 * bulge;
  float band = exp(-pow(b / width, 2.0));
  float wide = exp(-pow(b / (width * 3.2), 2.0));
  float n1 = fbm(d * 3.0 + 3.1, 6.0) * 0.5 + 0.5;
  float n2 = fbm(d * 9.0 + 7.7, 6.0) * 0.5 + 0.5;
  float dustN = fbm(vec3(d.x * 6.0, d.y * 22.0, d.z * 6.0) + 1.0, 7.0);
  float dust = smoothstep(-0.12, 0.42, dustN) * exp(-pow((b + 0.012 * sin(l * 3.0)) / (width * 0.6), 2.0));
  vec3 cOuter = vec3(0.55, 0.63, 0.86);
  vec3 cInner = vec3(1.0, 0.8, 0.56);
  vec3 mw = mix(cOuter, cInner, bulge) * (band * (0.25 + 1.1 * n1 * n2) + wide * 0.1 * n1);
  mw *= 1.0 - 0.92 * dust;
  mw += cInner * exp(-(l * l + b * b * 7.0) / 0.07) * 1.1 * (1.0 - 0.85 * dust);
  float ha = pow(max(fbm(d * 7.0 + 20.0, 6.0), 0.0), 2.0) * band;
  mw += vec3(0.95, 0.16, 0.26) * ha * 0.7;
  mw += vec3(0.2, 0.42, 0.95) * pow(max(fbm(d * 4.0 + 40.0, 5.0), 0.0), 3.0) * wide * 0.4;
  vec3 c = mw * 0.11;
  float sd = 0.25 + 1.3 * band + 0.4 * bulge;
  c += starLayer(d, 150.0, 0.1 * sd, 70.0) * 0.5;
  c += starLayer(d, 380.0, 0.16 * sd, 10.0) * 0.18;
  c += vec3(0.85, 0.9, 1.0) * galaxy(d, uAnd, 0.035, 0.32, 0.6) * 0.05;
  c += vec3(0.9, 0.9, 1.0) * galaxy(d, uLMC, 0.09, 0.6, 0.2) * 0.04;
  c += vec3(0.9, 0.9, 1.0) * galaxy(d, uSMC, 0.045, 0.6, 1.0) * 0.03;
  gl_FragColor = vec4(c, 1.0);
}
`;
export function skyGenMaterial(dirs) {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uAnd: { value: dirs.and }, uLMC: { value: dirs.lmc }, uSMC: { value: dirs.smc } },
  });
}

// -------------------------------------------------------------------------------------------------
// Estrelas pontuais (com brilho físico: magnitude aparente pela distância real)
// -------------------------------------------------------------------------------------------------
const POINTS_VERT = /* glsl */ `
attribute float aLum; attribute vec3 aColor; attribute float aIdx;
uniform vec3 uShip; uniform float uHide; uniform float uLimit; uniform float uScale;
varying vec3 vColor; varying float vI;
void main(){
  vec3 rel = position - uShip;
  float d = length(rel);
  vI = 0.0; vColor = aColor;
  if (abs(aIdx - uHide) < 0.5 || d < 1e-6){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float m = 4.83 - 2.5 * log(aLum) / 2.302585 + 5.0 * log(d / 32.6) / 2.302585;
  float I = pow(10.0, -0.4 * (m - uLimit));
  vI = I;
  vec4 mv = modelViewMatrix * vec4(rel, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = I < 0.01 ? 0.0 : clamp(1.4 + 1.8 * pow(I, 0.25), 0.0, 18.0) * uScale;
}
`;
const POINTS_FRAG = /* glsl */ `
varying vec3 vColor; varying float vI;
uniform float uDim;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 10.0);
  float halo = exp(-r2 * 2.5) * 0.08;
  float bright = min(vI, 1.0);
  float hdr = 1.0 + log(max(vI / 40.0, 1.0)) * 0.5;
  vec3 sat = pow(vColor, vec3(1.45));
  sat /= max(max(sat.r, sat.g), max(sat.b, 1e-3));
  vec3 cc = mix(sat, vec3(1.0), 0.3 * core);
  // o halo é desenhado aqui mesmo e o valor fica abaixo do limiar do bloom: o bloom de
  // pontos minúsculos e muito brilhantes vira quadrados ao ser ampliado das resoluções baixas
  float glow = exp(-r2 * 5.0) * 0.22 * clamp(log(max(vI, 1.0)) * 0.45, 0.0, 1.0);
  vec3 c = cc * (core * 0.95 * min(hdr, 1.8) + halo * min(vI, 8.0) * 0.3 + glow) * bright;
  c = min(c, vec3(0.96)) * uDim;
  gl_FragColor = vec4(c, 1.0);
}
`;
export function starPointsMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG,
    uniforms: { uShip: { value: new THREE.Vector3() }, uHide: { value: -1 }, uLimit: { value: 6.3 }, uScale: { value: 1 }, uDim: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Nebulosas (textura gerada uma vez na GPU, exibida em billboards com paralaxe real)
// -------------------------------------------------------------------------------------------------
const NEB_GEN_FRAG = /* glsl */ `
uniform vec3 uC1, uC2, uC3; uniform float uSeed;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec3 q = vec3(p * 1.6, uSeed);
  q += vec3(snoise(q * 0.8), snoise(q * 0.8 + 5.0), 0.0) * 0.5;
  float n = fbm(q, 7.0) * 0.5 + 0.5;
  float n2 = fbm(q * 2.3 + 3.0, 6.0) * 0.5 + 0.5;
  float fil = pow(1.0 - abs(snoise(q * 2.0 + 9.0)), 4.0);
  float dens = smoothstep(0.38, 0.85, n) * smoothstep(1.0, 0.15, r);
  dens += fil * 0.35 * smoothstep(1.0, 0.3, r) * n;
  vec3 c = mix(uC1, uC2, smoothstep(0.3, 0.7, n2));
  c = mix(c, uC3, smoothstep(0.65, 0.9, n) * 0.6);
  float dust = smoothstep(0.52, 0.72, fbm(q * 2.8 + 17.0, 5.0) * 0.5 + 0.5);
  c *= dens * (1.0 - dust * 0.85);
  gl_FragColor = vec4(c, 1.0);
}
`;
export function bakeTexture(renderer, frag, uniforms, size = 512) {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag, uniforms,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose();
  return rt.texture;
}
export function bakeNebula(renderer, c1, c2, c3, seed) {
  return bakeTexture(renderer, NEB_GEN_FRAG, {
    uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uC3: { value: new THREE.Color(c3) }, uSeed: { value: seed },
  }, 512);
}
export function nebulaMaterial(tex) {
  return new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D uTex; uniform float uA; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uA, 1.0); }',
    uniforms: { uTex: { value: tex }, uA: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Efeito de dobra (túnel + riscos de estrelas)
// -------------------------------------------------------------------------------------------------
const TUNNEL_FRAG = /* glsl */ `
uniform float uTime, uWarp;
varying vec2 vUv;
${NOISE}
void main(){
  float a = vUv.x * 6.28318;
  float z = vUv.y;
  vec3 q = vec3(cos(a) * 2.0, sin(a) * 2.0, z * 18.0 + uTime * 9.0);
  float n = fbm(q, 4.0) * 0.5 + 0.5;
  float streak = pow(max(snoise(vec3(cos(a) * 6.0, sin(a) * 6.0, z * 2.0 + uTime * 5.0)), 0.0), 3.0);
  vec3 c = mix(vec3(0.1, 0.22, 0.8), vec3(0.55, 0.25, 0.85), n) * n * 0.5 + vec3(0.6, 0.75, 1.0) * streak * 0.6;
  float fade = smoothstep(0.0, 0.25, z) * smoothstep(1.0, 0.6, z);
  gl_FragColor = vec4(c * fade * uWarp, 1.0);
}
`;
export function tunnelMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: TUNNEL_FRAG,
    uniforms: { uTime: { value: 0 }, uWarp: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  });
}

const STREAK_VERT = /* glsl */ `
attribute float aEnd; attribute float aSpeed;
uniform float uTime, uWarp, uLen;
varying float vA;
void main(){
  vec3 p = position;
  float range = 80.0;
  float z = mod(p.z + uTime * aSpeed * (5.0 + uWarp * 120.0), range) - range;
  z += aEnd * uLen * uWarp * (0.3 + aSpeed * 0.15);
  vA = (1.0 - aEnd * 0.9) * smoothstep(-range, -range * 0.7, z) * uWarp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, p.y, z, 1.0);
}
`;
export function streakMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STREAK_VERT,
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.7, 0.82, 1.0) * vA * 0.7, 1.0); }',
    uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uLen: { value: 40 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Pós-processamento cinematográfico (aberração cromática, vinheta, granulação, desfoque radial)
// -------------------------------------------------------------------------------------------------
export const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.55 },
    uWarp: { value: 0 }, uAberr: { value: 0.0015 }, uRes: { value: new THREE.Vector2(1, 1) }, uFlash: { value: 0 },
    uFog: { value: 0 }, uFogC: { value: new THREE.Vector3() }, uHeat: { value: 0 }, uFlashC: { value: new THREE.Vector3(0.8, 0.9, 1.0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uWarp, uAberr, uFlash, uFog, uHeat; uniform vec2 uRes;
    uniform vec3 uFogC, uFlashC;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float ab = uAberr + uWarp * 0.01;
      vec3 col;
      if (uWarp > 0.01){
        col = vec3(0.0);
        for (int i = 0; i < 10; i++){
          float s = 1.0 - float(i) * 0.012 * uWarp;
          vec2 u = 0.5 + c * s;
          col.r += texture2D(tDiffuse, 0.5 + (u - 0.5) * (1.0 - ab)).r;
          col.g += texture2D(tDiffuse, u).g;
          col.b += texture2D(tDiffuse, 0.5 + (u - 0.5) * (1.0 + ab)).b;
        }
        col /= 10.0;
      } else {
        col.r = texture2D(tDiffuse, uv - c * ab).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv + c * ab).b;
      }
      col = mix(col, uFogC, uFog);
      float asp = uRes.x / uRes.y;
      // plasma de reentrada: brilho laranja que vem das bordas
      float edge = smoothstep(0.25, 0.75, length(c * vec2(asp, 1.0)));
      col += vec3(1.0, 0.42, 0.12) * uHeat * (0.25 + edge) * (0.8 + 0.2 * sin(uTime * 37.0 + c.x * 20.0));
      float v = smoothstep(1.05, 0.25, length(c * vec2(asp, 1.0)) * 1.1);
      col *= mix(1.0, v, uVignette);
      float g = fract(sin(dot(uv * uRes + fract(uTime) * 517.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      col += uFlashC * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};


// -------------------------------------------------------------------------------------------------
// Poeira espacial em volta da nave (paralaxe e sensação de velocidade)
// -------------------------------------------------------------------------------------------------
const DUST_VERT = /* glsl */ `
attribute float aEnd; attribute float aSeed;
uniform vec3 uOff; uniform float uBox; uniform vec3 uTrail; uniform float uA;
varying float vA;
void main(){
  vec3 p = (fract(position - uOff) - 0.5) * uBox;
  float d = length(p - cameraPosition);
  p += uTrail * aEnd * (0.6 + aSeed * 0.8);
  vA = uA * (1.0 - aEnd * 0.85) * smoothstep(uBox * 0.5, uBox * 0.15, d) * (0.35 + aSeed * 0.65);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export function dustMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
    uniforms: { uOff: { value: new THREE.Vector3() }, uBox: { value: 1 }, uTrail: { value: new THREE.Vector3() }, uA: { value: 0.3 }, uColor: { value: new THREE.Color(0.8, 0.85, 1) } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Planetas distantes como pontos coloridos (quando o disco tem menos de ~2 px)
// -------------------------------------------------------------------------------------------------
export function impostorMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 aColor; attribute float aI; uniform float uScale;
      varying vec3 vC; varying float vI;
      void main(){
        vC = aColor; vI = aI;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        gl_PointSize = aI <= 0.0 ? 0.0 : (3.0 + 3.0 * sqrt(min(aI, 3.0))) * uScale;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vI;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 4.0);
        gl_FragColor = vec4(min(mix(vC, vec3(1.0), 0.15 * a) * a * min(vI, 3.0) * 1.3, vec3(0.96)), 1.0);
      }`,
    uniforms: { uScale: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// -------------------------------------------------------------------------------------------------
// Buraco negro: lente gravitacional + disco de acreção (pós-processamento em espaço de câmera)
// Unidades: raio de Schwarzschild (Rs = 1). Raios traçados de trás para frente a partir da câmera.
// -------------------------------------------------------------------------------------------------
export const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, tSky: { value: null }, uActive: { value: 0 },
    uC: { value: new THREE.Vector3(0, 0, -1) }, uD: { value: 1000 }, uTanH: { value: 0.6 }, uAspect: { value: 1.7 },
    uRes: { value: new THREE.Vector2(1, 1) }, uV2W: { value: new THREE.Matrix3() }, uProj: { value: new THREE.Matrix4() },
    uDisk: { value: 0 }, uDiskN: { value: new THREE.Vector3(0, 1, 0) }, uDiskIn: { value: 3 }, uDiskOut: { value: 22 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform samplerCube tSky; uniform float uActive;
    uniform vec3 uC; uniform float uD, uTanH, uAspect; uniform vec2 uRes;
    uniform mat3 uV2W; uniform mat4 uProj;
    uniform float uDisk, uDiskIn, uDiskOut, uTime; uniform vec3 uDiskN;
    varying vec2 vUv;
    ${NOISE}
    const float RM = 60.0; // raio da esfera onde a geodésica é integrada numericamente

    vec3 background(vec3 d){
      vec3 cube = textureCube(tSky, uV2W * d).rgb;
      if (d.z >= -1e-4) return cube;
      vec4 clip = uProj * vec4(d, 1.0);
      vec2 ndc = clip.xy / clip.w;
      float e = max(abs(ndc.x), abs(ndc.y));
      if (e >= 1.0) return cube;
      vec3 scr = texture2D(tDiffuse, ndc * 0.5 + 0.5).rgb;
      return mix(cube, scr, smoothstep(1.0, 0.9, e));
    }
    // gira v em direção ao centro (origem), vista do ponto p, pelo ângulo a
    vec3 bend(vec3 v, vec3 p, float a){
      vec3 toC = -p - v * dot(-p, v);
      float l = length(toC);
      if (l < 1e-6) return v;
      return normalize(v * cos(a) + (toC / l) * sin(a));
    }
    vec3 bb(float t){
      vec3 c = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.62, 0.25), smoothstep(0.1, 0.5, t));
      c = mix(c, vec3(1.0, 0.92, 0.8), smoothstep(0.5, 0.95, t));
      return mix(c, vec3(0.75, 0.85, 1.0), smoothstep(0.95, 1.6, t));
    }
    vec4 diskColor(vec3 q, float r, vec3 v){
      vec3 n = uDiskN;
      vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 e2 = cross(n, e1);
      float ang = atan(dot(q, e2), dot(q, e1));
      // perfil de temperatura de Shakura–Sunyaev
      float x = uDiskIn / r;
      float T = pow(x, 0.75) * pow(max(1.0 - sqrt(x * 0.985), 0.0), 0.25) * 2.0;
      // velocidade orbital (aprox. relativística) e efeitos Doppler + desvio gravitacional
      float beta = clamp(sqrt(0.5 / max(r - 1.0, 0.2)), 0.0, 0.75);
      vec3 vel = normalize(cross(n, q)) * beta;
      vec3 toCam = -normalize(v);
      float gam = 1.0 / sqrt(1.0 - beta * beta);
      float g = sqrt(max(1.0 - 1.0 / r, 0.0)) / (gam * (1.0 - dot(vel, toCam)));
      float omega = 0.6 / pow(r, 1.5);
      float tur = fbm(vec3(r * 1.6, ang * 3.0 - uTime * omega * 3.0, r * 0.2), 4.0);
      float fil = 0.55 + 0.45 * sin(r * 5.0 + tur * 4.0);
      float I = pow(T, 4.0) * pow(g, 4.0) * (0.6 + 0.8 * fil) * (0.7 + 0.6 * tur);
      float a = clamp(T * 2.2, 0.0, 0.92) * smoothstep(uDiskOut, uDiskOut * 0.55, r) * (0.65 + 0.35 * fil);
      return vec4(bb(T * g) * I * 2.6 * uDisk, a);
    }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uActive < 0.5){ gl_FragColor = base; return; }
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 d = normalize(vec3(ndc.x * uTanH * uAspect, ndc.y * uTanH, -1.0));
      vec3 ro = -uC * uD;                 // câmera relativa ao buraco negro (Rs)
      float sc = dot(ro, d);              // posição ao longo do raio (0 = máxima aproximação)
      float b = length(ro - d * sc);      // parâmetro de impacto
      float h = RM * RM - b * b;
      bool hit = h > 0.0 && (uD < RM || sc < 0.0);
      if (!hit){
        // campo fraco: deflexão acumulada da câmera ao infinito, 2Rs/b em ângulo total
        float a = (1.0 - sc / uD) / b;
        if (a < 0.25 * 2.0 * uTanH / uRes.y){ gl_FragColor = base; return; }
        gl_FragColor = vec4(background(bend(d, ro, a)), 1.0);
        return;
      }
      vec3 p = ro, v = d;
      if (uD >= RM){
        float se = -sqrt(h);
        p = ro + d * (se - sc);
        v = bend(d, p, (se / RM - sc / uD) / max(b, 1e-3)); // deflexão acumulada até a entrada na esfera
      }
      vec3 hv = cross(p, v);
      float h2 = dot(hv, hv);
      vec3 col = vec3(0.0); float trans = 1.0; bool captured = false;
      for (int i = 0; i < 420; i++){
        float r = length(p);
        if (r < 1.0){ captured = true; break; }
        if (r > RM * 1.001 && dot(p, v) > 0.0) break;
        float dt = clamp(0.045 * r, 0.012, 3.0);
        v += -1.5 * h2 * p / pow(r, 5.0) * dt;
        vec3 pn = p + v * dt;
        if (uDisk > 0.0){
          float s0 = dot(p, uDiskN), s1 = dot(pn, uDiskN);
          if (s0 * s1 < 0.0){
            vec3 q = mix(p, pn, s0 / (s0 - s1));
            float rq = length(q);
            if (rq > uDiskIn && rq < uDiskOut){
              vec4 dc = diskColor(q, rq, v);
              col += trans * dc.rgb * dc.a; trans *= 1.0 - dc.a;
            }
          }
        }
        p = pn;
        if (trans < 0.02) break;
      }
      vec3 bgc = vec3(0.0);
      if (!captured && trans > 0.02){
        vec3 vo = normalize(v);
        float bo = length(cross(p, vo));
        float so = sqrt(max(RM * RM - bo * bo, 0.0));
        vo = bend(vo, p, (1.0 - so / RM) / max(bo, 1e-3)); // deflexão restante até o infinito
        bgc = background(vo);
      }
      gl_FragColor = vec4(col + trans * bgc, 1.0);
    }
  `,
};

// -------------------------------------------------------------------------------------------------
// Via Láctea vista de cima (mapa galáctico): braços espirais logarítmicos, barra e bojo
// -------------------------------------------------------------------------------------------------
export const GALAXY_DISK_FRAG = /* glsl */ `
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = (vUv * 2.0 - 1.0) * 52000.0;   // anos-luz, centro galáctico na origem
  float r = length(p);
  float a = atan(p.y, p.x);
  float warp = fbm(vec3(p / 9000.0, 1.3), 5.0) * 0.55;
  float lr = log(max(r, 800.0) / 4500.0) / tan(0.22);
  float ph = a - lr + warp;
  float arms = pow(0.5 + 0.5 * cos(2.0 * ph), 5.0) * 0.9 + pow(0.5 + 0.5 * cos(4.0 * ph + 1.2), 7.0) * 0.45;
  float dustLane = pow(0.5 + 0.5 * cos(2.0 * ph - 0.45), 14.0);
  float disk = exp(-r / 11000.0) * smoothstep(52000.0, 30000.0, r);
  float clumps = fbm(vec3(p / 1500.0, 7.7), 6.0) * 0.5 + 0.5;
  vec2 pb = mat2(cos(0.47), -sin(0.47), sin(0.47), cos(0.47)) * p;
  float bar = exp(-pow(pb.x / 9000.0, 2.0) - pow(pb.y / 2600.0, 2.0));
  float bulge = exp(-r * r / (2.0 * 2600.0 * 2600.0));
  vec3 cArm = vec3(0.55, 0.68, 1.0), cOld = vec3(1.0, 0.82, 0.58), cHII = vec3(1.0, 0.35, 0.5);
  vec3 c = cArm * disk * arms * (0.5 + 0.9 * clumps);
  c += cOld * disk * 0.35;
  c += cHII * disk * arms * pow(max(fbm(vec3(p / 600.0, 3.1), 4.0), 0.0), 2.0) * 2.5;
  c *= 1.0 - 0.75 * dustLane * smoothstep(3000.0, 9000.0, r);
  c += cOld * (bar * 1.4 + bulge * 2.2);
  gl_FragColor = vec4(c, 1.0);
}
`;
