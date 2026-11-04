// Nuvens de perto: a cobertura no ponto da nave (espelho do shader da camada de nuvens), a neblina branca
// ao atravessar uma nuvem e flocos de nuvem em volta da nave, para sentir a passagem pelas camadas.
import * as THREE from 'three';
import { snoise } from './terrain.js';
import { smoothstep } from './util.js';

// vento em altitude: as nuvens giram com o planeta e derivam devagar por cima do chão (rad/s)
export const CLOUD_DRIFT = 5e-6;

function fbm(x, y, z, oct) {
  let a = 0.5, s = 0;
  for (let i = 0; i < 14; i++) {
    const w = Math.min(Math.max(oct - i, 0), 1);
    if (w <= 0) break;
    s += a * snoise(x, y, z) * w;
    x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return s;
}

// cobertura de nuvens (0..1) na direção n do referencial fixo do planeta; drift = deriva do vento (rad)
// (mesma conta do CLOUD_FRAG em terrain.js, sem a espiral dos ciclones)
export function cloudCover(v, n, drift) {
  if (!(v.clouds > 0)) return 0;
  const c = Math.cos(drift), s = Math.sin(drift);
  let x = (n.x * c - n.z * s) * 2.2 + v.seed * 0.37, y = n.y * 2.2 + v.seed * 0.37, z = (n.x * s + n.z * c) * 2.2 + v.seed * 0.37;
  const wx = snoise(x * 0.6, y * 0.6, z * 0.6), wy = snoise(x * 0.6 + 7, y * 0.6 + 7, z * 0.6 + 7), wz = snoise(x * 0.6 + 13, y * 0.6 + 13, z * 0.6 + 13);
  x += wx * 0.45; y += wy * 0.45; z += wz * 0.45;
  const cv = fbm(x, y * 2.2, z, 9) * 0.5 + 0.5;
  const th = 0.7 - v.clouds * 0.45;
  let cov = smoothstep(th, th + 0.2, cv) * Math.min(v.clouds * 3, 1);
  if (v.clouds > 0.95) cov = 0.85 + 0.15 * cv;
  return cov;
}

// textura de um floco: várias bolhas macias sobrepostas
function puffTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let r = 7;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (let k = 0; k < 40; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * S * 0.26;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.7, rad = S * (0.14 + rnd() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const PUFF_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aOp;
varying vec2 vUv; varying float vOp;
void main(){
  vUv = uv; vOp = aOp;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
  #include <logdepthbuf_vertex>
}`;
const PUFF_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D tPuff; uniform vec3 uLit, uShade;
varying vec2 vUv; varying float vOp;
void main(){
  float a = texture2D(tPuff, vUv).r * vOp;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uShade, uLit, smoothstep(0.15, 0.85, vUv.y)), a);
  #include <logdepthbuf_fragment>
}`;

const N = 80;
export class CloudPassage {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
      uniforms: { tPuff: { value: puffTexture() }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.62, 0.66) } },
      transparent: true, depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    this.op = new Float32Array(N);
    geo.setAttribute('aOp', new THREE.InstancedBufferAttribute(this.op, 1));
    this.mesh = new THREE.InstancedMesh(geo, this.mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    // flocos no referencial fixo do planeta (float64)
    this.p = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, size: 0, a: 0, hole: 0, live: false }));
    this.cov = 0; this.covT = 0; this.fog = 0; this.inside = 0;
    this.body = null;
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }

  hide() { this.mesh.visible = false; this.fog = 0; this.inside = 0; this.body = null; }

  // ctx: { b, R, cloudAlt, camPl (Vector3, km, referencial do planeta), q (rotação do planeta), camera, drift, light (0..1), sunCol, dt, speedDir (Vector3 no planeta) }
  update(ctx) {
    const { b, R, camPl, q, camera, dt } = ctx;
    const v = b.visual;
    if (this.body !== b) { this.body = b; for (const p of this.p) p.live = false; this.covT = 0; }
    const r = camPl.length(), alt = r - R;
    const A = ctx.cloudAlt, Th = 0.35 + 0.6 * Math.min(v.clouds, 1); // meia espessura da camada (km)
    const near = Math.abs(alt - A);
    if (near > Th + 4 || !(v.clouds > 0)) { this.hide(); this.body = b; return; }
    this.mesh.visible = true;
    this.covT -= dt;
    if (this.covT <= 0) { this.covT = 0.25; this.covNow = cloudCover(v, this._n.copy(camPl).divideScalar(r), ctx.drift); }
    this.cov += ((this.covNow || 0) - this.cov) * (1 - Math.exp(-dt * 3));
    // dentro da nuvem: densidade conforme a cobertura e a posição na espessura da camada (com buracos)
    const hole = 0.55 + 0.45 * snoise(camPl.x * 1.3, camPl.y * 1.3, camPl.z * 1.3);
    this.inside = this.cov * smoothstep(Th, Th * 0.35, near) * clamp01(hole * 1.6);
    this.fog = Math.min(0.94, this.inside * 1.1);
    // cor: branco ao sol, cinza-azulado por baixo e à noite
    const L = ctx.light;
    const cc = new THREE.Color(v.cloudColor || '#ffffff');
    this.mat.uniforms.uLit.value.copy(cc).multiply(ctx.sunCol).multiplyScalar(0.12 + 1.05 * L);
    this.mat.uniforms.uShade.value.copy(cc).multiplyScalar(0.08 + 0.55 * L);
    this.fogCol = cc.clone().multiply(ctx.sunCol).multiplyScalar(0.08 + 0.85 * L);
    // recicla flocos: ficam numa esfera de ~2,5 km em volta da câmera, dentro da camada, mais à frente
    const up = this._n.copy(camPl).divideScalar(r);
    const want = this.cov > 0.04;
    const fwd = ctx.speedDir;
    let k = 0;
    for (const p of this.p) {
      const dx = p.x - camPl.x, dy = p.y - camPl.y, dz = p.z - camPl.z;
      const d = Math.hypot(dx, dy, dz);
      if (p.live && d > 2.8) p.live = false;
      if (!p.live && want && k < 6) {
        k++;
        // ponto aleatório no disco da camada, puxado para a frente do movimento
        const e1 = this._v.set(0, 1, 0).cross(up); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
        const e2 = new THREE.Vector3().crossVectors(up, e1);
        const ang = Math.random() * Math.PI * 2, rad = 0.3 + Math.sqrt(Math.random()) * 2.3;
        let ox = Math.cos(ang) * rad, oz = Math.sin(ang) * rad;
        if (fwd) { ox += fwd.dot(e1) * 1.2; oz += fwd.dot(e2) * 1.2; }
        const h = A + (Math.random() * 2 - 1) * Th * 0.8;
        const s = (R + h) / r;
        p.x = camPl.x * s + e1.x * ox + e2.x * oz; p.y = camPl.y * s + e1.y * ox + e2.y * oz; p.z = camPl.z * s + e1.z * ox + e2.z * oz;
        p.size = 0.2 + Math.random() * 0.45;
        p.hole = clamp01(0.5 + 0.8 * snoise(p.x * 1.3, p.y * 1.3, p.z * 1.3));
        p.a = 0; p.live = true;
      }
    }
    const m = this._m, pos = this._v, sc = new THREE.Vector3(), qi = new THREE.Quaternion();
    this.p.forEach((p, i) => {
      if (!p.live) { this.op[i] = 0; m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, m); return; }
      p.a = Math.min(1, p.a + dt * 0.6);
      pos.set(p.x - camPl.x, p.y - camPl.y, p.z - camPl.z);
      const d = pos.length();
      // some ao chegar perto (a nave atravessa o floco em vez de ver um cartão) e ao longe
      const o = p.a * (want ? 1 : 0) * Math.min(this.cov * 1.3, 1) * p.hole * smoothstep(p.size * 0.25, p.size * 0.9, d) * (1 - smoothstep(2.0, 2.7, d));
      this.op[i] = o * 0.9;
      pos.applyQuaternion(q).add(camera.position);
      m.compose(pos, qi, sc.setScalar(p.size));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aOp.needsUpdate = true;
  }
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
