// Efeitos de voo perto de um planeta: sombra da nave no chão, poeira/respingos levantados pelos motores
// e o plasma da reentrada atmosférica
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { clamp, smoothstep } from './util.js';

// sombra: fuselagem estreita + asas largas atrás, borrada nas bordas
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.filter = 'blur(6px)';
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(64, 64, 15, 54, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(64, 30); g.lineTo(124, 100); g.lineTo(4, 100); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PUFF_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aCol; attribute float aSize;
uniform float uScale;
varying vec4 vCol;
void main(){
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aCol.a <= 0.0 ? 0.0 : clamp(aSize * uScale / max(-mv.z, 1e-6), 1.0, 256.0);
  #include <logdepthbuf_vertex>
}`;
const PUFF_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec4 vCol;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - r2) * (1.0 - r2));
  #include <logdepthbuf_fragment>
}`;

const SHOCK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vLoc;
void main(){
  vLoc = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const SHOCK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uI, uTime, uTail;
varying vec3 vN; varying vec3 vV; varying vec3 vLoc;
void main(){
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float soft = smoothstep(0.0, 0.35, nv) * pow(1.0 - nv, 1.2);   // brilha no meio e some na silhueta (sem borda dura)
  float ang = atan(vLoc.y, vLoc.x);
  float k, front;
  if (uTail > 0.5) {
    // cauda: línguas de plasma escorrendo para trás (z de 0 a 1)
    front = 1.0 - vLoc.z;
    float fl = 0.5 + 0.5 * sin(ang * 11.0 + sin(vLoc.z * 6.0 - uTime * 9.0) * 1.8 + uTime * 1.3);
    fl *= 0.6 + 0.4 * sin(vLoc.z * 14.0 - uTime * 32.0 + ang * 3.0);
    k = uI * pow(front, 1.6) * smoothstep(0.0, 0.3, vLoc.z) * fl * soft * 1.8; // some nas duas pontas do tubo
  } else {
    // onda de choque na frente da nave (-z)
    front = smoothstep(-0.3, 1.0, -vLoc.z);
    float streak = 0.6 + 0.4 * sin(vLoc.z * 9.0 + uTime * 26.0 + sin(ang * 7.0 + uTime * 3.0) * 2.5);
    k = uI * (soft * 1.4 + front * 0.25) * front * streak;
  }
  vec3 c = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.85, 0.6), clamp(front * uI, 0.0, 1.0));
  gl_FragColor = vec4(min(c * k * 1.8, vec3(4.0)), 1.0);
  #include <logdepthbuf_fragment>
}`;

const N_PUFF = 220;

export class FlightFX {
  constructor(scene, shipLayer) {
    // sombra
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.matrixAutoUpdate = false;
    this.shadow.frustumCulled = false;
    this.shadow.visible = false;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    // poeira / respingos (posições guardadas em dupla precisão, no referencial do planeta)
    this.p = new Float64Array(N_PUFF * 3); this.v = new Float64Array(N_PUFF * 3);
    this.life = new Float32Array(N_PUFF); this.max = new Float32Array(N_PUFF); this.size0 = new Float32Array(N_PUFF);
    this.col = new Float32Array(N_PUFF * 3);
    this.next = 0; this.emitAcc = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(N_PUFF * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(N_PUFF * 4), 4);
    this.aSize = new THREE.BufferAttribute(new Float32Array(N_PUFF), 1);
    for (const a of [this.aPos, this.aCol, this.aSize]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize);
    this.puffs = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uScale: { value: 500 } }, transparent: true, depthWrite: false }));
    this.puffs.frustumCulled = false;
    this.puffs.visible = false;
    scene.add(this.puffs);
    // plasma da reentrada (desenhado com a nave): onda de choque na frente + cauda
    const shockMat = (tail) => new THREE.ShaderMaterial({
      vertexShader: SHOCK_VERT, fragmentShader: SHOCK_FRAG, uniforms: { uI: { value: 0 }, uTime: { value: 0 }, uTail: { value: tail } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: tail ? THREE.DoubleSide : THREE.FrontSide,
    });
    const tailGeo = new THREE.CylinderGeometry(0.35, 1, 1, 32, 8, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.shock = new THREE.Group();
    this.shockFront = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), shockMat(0));
    this.shockTail = new THREE.Mesh(tailGeo, shockMat(1));
    for (const m of [this.shockFront, this.shockTail]) { m.layers.set(shipLayer); m.frustumCulled = false; this.shock.add(m); }
    this.shock.visible = false;
    scene.add(this.shock);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._qi = new THREE.Quaternion(); this._m = new THREE.Matrix4();
  }

  hide() { this.shadow.visible = false; this.puffs.visible = false; this.shock.visible = false; this.alive = 0; this.life.fill(0); }

  // o: { surf: {P, b} | null, q: rotação planeta->cena, frameRel: origem da cena no planeta (Vector3), ship: posição da nave no
  //      planeta (Vector3), shipQuat, L, sunScene, power, lift, heat, time, camera, H }
  update(dt, o) {
    // plasma
    const sh = this.shock;
    sh.visible = o.heat > 0.01;
    if (sh.visible) {
      const L = o.L;
      sh.position.copy(o.shipScene);
      sh.quaternion.copy(o.shipQuat);
      this.shockFront.scale.set(L * 0.62, L * 0.5, L * 0.8);
      this.shockFront.position.set(0, 0, -L * 0.12);
      this.shockTail.scale.set(L * 0.6, L * 0.48, L * (0.8 + o.heat * 0.6)); // curta: a câmera externa fica a ~1,9 L atrás
      this.shockTail.position.set(0, 0, L * 0.05);
      for (const m of [this.shockFront, this.shockTail]) { m.material.uniforms.uI.value = o.heat; m.material.uniforms.uTime.value = o.time % 100; }
    }
    if (!o.surf) { this.shadow.visible = false; this.puffs.visible = false; return; }
    const { P, b } = o.surf;
    const R = b.radius;
    const ground = (d) => { const h = heightAt(P, d.x, d.y, d.z); return { r: R + (h.water ? 0 : h.e), water: h.water }; };
    const qi = this._qi.copy(o.q).invert();
    const ship = o.ship;
    const up = this._a.copy(ship).normalize();
    const g0 = ground(up);
    const alt = ship.length() - g0.r;
    o.light = 0.15 + 0.85 * smoothstep(-0.05, 0.2, this._b.copy(o.sunScene).applyQuaternion(qi).dot(up));
    this.updateShadow(o, qi, up, alt, ground);
    this.updatePuffs(dt, o, qi, up, alt, g0, ground);
  }

  updateShadow(o, qi, up, alt, ground) {
    const L = o.L;
    const sunL = this._b.copy(o.sunScene).applyQuaternion(qi);
    const cosS = sunL.dot(up);
    const maxAlt = Math.max(0.3, L * 25);
    const op = 0.72 * (1 - smoothstep(maxAlt * 0.3, maxAlt, alt)) * smoothstep(0.06, 0.25, cosS);
    this.shadow.visible = op > 0.01;
    if (!this.shadow.visible) return;
    // ponto onde a sombra cai: segue o raio do sol a partir da nave até o chão
    const p = this._c.copy(o.ship).addScaledVector(sunL, -Math.max(alt, 0) / cosS);
    const d = p.clone().normalize();
    const gr = ground(d).r;
    // normal do chão por diferenças finitas
    const t1 = new THREE.Vector3(0, 1, 0).cross(d); if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0); t1.normalize();
    const t2 = new THREE.Vector3().crossVectors(d, t1);
    const s = L * 0.5 / gr;
    const h1 = ground(d.clone().addScaledVector(t1, s).normalize()).r, h2 = ground(d.clone().addScaledVector(t2, s).normalize()).r;
    const n = new THREE.Vector3().crossVectors(t1.clone().multiplyScalar(L * 0.5).addScaledVector(d, h1 - gr), t2.clone().multiplyScalar(L * 0.5).addScaledVector(d, h2 - gr)).normalize();
    if (n.dot(d) < 0) n.negate();
    // eixos: frente da nave projetada no chão
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.shipQuat).applyQuaternion(qi);
    fwd.addScaledVector(n, -fwd.dot(n));
    if (fwd.lengthSq() < 1e-10) fwd.copy(t1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, n);
    const blur = 1 + Math.max(alt, 0) / L * 0.04;
    const pos = d.multiplyScalar(gr).addScaledVector(n, Math.max(0.0012, L * 0.05)).sub(o.frameRel).applyQuaternion(o.q);
    const m = this._m.makeBasis(right.applyQuaternion(o.q), fwd.applyQuaternion(o.q), n.applyQuaternion(o.q));
    m.scale(this._d.set(L * 1.0 * blur, L * 1.05 * blur, 1));
    m.setPosition(pos);
    this.shadow.matrix.copy(m);
    this.shadow.matrixWorldNeedsUpdate = true;
    this.shadow.material.opacity = op / Math.sqrt(blur);
  }

  updatePuffs(dt, o, qi, up, alt, g0, ground) {
    const L = o.L;
    const reach = L * 4 + 0.05;
    // emissão: o jato dos motores bate no chão
    const k = (1 - smoothstep(reach * 0.25, reach, alt)) * Math.max(o.power, o.lift ? 1 : 0);
    if (k > 0.02 && alt > -0.01) {
      this.emitAcc += dt * 140 * k;
      const avg = o.surf.b.visual.avg || [0.6, 0.5, 0.4];
      const t1 = new THREE.Vector3(0, 1, 0).cross(up); if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0); t1.normalize();
      const t2 = new THREE.Vector3().crossVectors(up, t1);
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const i = this.next; this.next = (this.next + 1) % N_PUFF;
        const a = Math.random() * Math.PI * 2, rr = L * (0.15 + Math.random() * 0.35);
        const dir = this._d.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
        const p = up.clone().multiplyScalar(g0.r).addScaledVector(dir, rr);
        const gp = ground(p.clone().normalize());
        p.normalize().multiplyScalar(gp.r + 0.0005);
        const sp = (0.012 + Math.random() * 0.025) * (0.5 + k);
        const vu = 0.002 + Math.random() * (gp.water ? 0.012 : 0.006);
        this.p[i * 3] = p.x; this.p[i * 3 + 1] = p.y; this.p[i * 3 + 2] = p.z;
        this.v[i * 3] = dir.x * sp + up.x * vu; this.v[i * 3 + 1] = dir.y * sp + up.y * vu; this.v[i * 3 + 2] = dir.z * sp + up.z * vu;
        this.max[i] = this.life[i] = 1.4 + Math.random() * 1.6;
        this.size0[i] = L * (0.12 + Math.random() * 0.12) + 0.002;
        if (gp.water) { this.col[i * 3] = 0.82; this.col[i * 3 + 1] = 0.88; this.col[i * 3 + 2] = 0.95; }
        else { const j = 0.85 + Math.random() * 0.3; this.col[i * 3] = clamp(avg[0] * 1.15 * j, 0, 1); this.col[i * 3 + 1] = clamp(avg[1] * 1.15 * j, 0, 1); this.col[i * 3 + 2] = clamp(avg[2] * 1.15 * j, 0, 1); }
      }
    }
    // simulação e envio para a GPU (posições relativas à câmera, pequenas o bastante para float32)
    const pos = this.aPos.array, col = this.aCol.array, size = this.aSize.array;
    const drag = Math.exp(-dt * 1.4), light = o.light;
    let any = false;
    for (let i = 0; i < N_PUFF; i++) {
      if (this.life[i] <= 0) { col[i * 4 + 3] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      for (let c = 0; c < 3; c++) { this.v[i * 3 + c] *= drag; this.p[i * 3 + c] += this.v[i * 3 + c] * dt; }
      const t = 1 - Math.max(this.life[i], 0) / this.max[i];
      const sc = this._d.set(this.p[i * 3] - o.frameRel.x, this.p[i * 3 + 1] - o.frameRel.y, this.p[i * 3 + 2] - o.frameRel.z).applyQuaternion(o.q);
      pos[i * 3] = sc.x; pos[i * 3 + 1] = sc.y; pos[i * 3 + 2] = sc.z;
      col[i * 4] = this.col[i * 3] * light; col[i * 4 + 1] = this.col[i * 3 + 1] * light; col[i * 4 + 2] = this.col[i * 3 + 2] * light;
      col[i * 4 + 3] = 0.42 * Math.pow(1 - t, 1.6) * smoothstep(0, 0.08, t);
      size[i] = this.size0[i] * (1 + t * 3);
    }
    this.puffs.visible = any;
    if (any) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
      this.puffs.material.uniforms.uScale.value = o.H / (2 * Math.tan(THREE.MathUtils.degToRad(o.camera.fov) / 2));
    }
  }
}
