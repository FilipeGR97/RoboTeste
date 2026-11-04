// Florestas dos mundos com vida: espécies de árvores, mata densa onde o chão é de floresta (vegAt),
// árvores de longe (até ~2 km, visíveis do ar) e copas balançando ao vento.
// O posicionamento é determinístico (grade fixa no planeta) e calculado aos poucos, alguns milhares de
// células por quadro, para não travar o voo.
import * as THREE from 'three';
import { heightAt, vegAt, forestChance, pcg3d } from './terrain.js';

// ---------------------------------------------------------------- geometria
// junta várias geometrias (com cor por vértice) numa só, sem índice
function merge(parts) {
  const pos = [], nrm = [], col = [];
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
function paint(g, fn) {
  const p = g.attributes.position, c = [];
  for (let i = 0; i < p.count; i++) c.push(...fn(p.getX(i), p.getY(i), p.getZ(i)));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}
const rngOf = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const BARK = [0.3, 0.22, 0.15];

// folhagem: icosaedro deformado com normais "infladas" (luz macia, como um tufo de folhas)
function lobe(r, cx, cy, cz, rnd, detail, leaf, crownC) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.18 * Math.sin(v.x * 31 + v.y * 17) * Math.cos(v.z * 23 - v.y * 11);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
  }
  g.computeVertexNormals();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(crownC).normalize();
    w.fromBufferAttribute(n, i).lerp(v, 0.88).normalize();
    n.setXYZ(i, w.x, w.y, w.z);
  }
  const tint = 0.85 + rnd() * 0.3;
  return paint(g, (x, y, z) => {
    const ao = 0.45 + 0.55 * Math.min(1, Math.max(0, (y - (crownC.y - 0.25)) / 0.45)); // embaixo da copa é mais escuro
    return [leaf[0] * ao * tint, leaf[1] * ao * tint, leaf[2] * ao * tint];
  });
}
function trunk(r0, r1, h, seg, y0 = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true); g.translate(0, y0 + h / 2, 0);
  return paint(g, (x, y) => BARK.map((c) => c * (0.7 + 0.3 * Math.min(1, y / 0.4))));
}

// Copa-larga: tronco com galhos e copa de vários tufos
function broadleaf(far) {
  const rnd = rngOf(11), leaf = [0.42, 0.62, 0.25], C = new THREE.Vector3(0, 0.66, 0);
  const parts = [trunk(far ? 0.04 : 0.028, far ? 0.025 : 0.016, far ? 0.75 : 0.62, far ? 5 : 7, far ? -0.15 : 0)];
  if (!far) {
    for (const a of [0.6, 2.7, 4.6]) {
      const b = new THREE.CylinderGeometry(0.012, 0.02, 0.26, 5); b.translate(0, 0.13, 0);
      b.rotateZ(0.8); b.rotateY(a); b.translate(0, 0.42, 0);
      parts.push(paint(b, () => BARK));
    }
  }
  const lobes = far ? [[0, 0.68, 0, 0.3], [0.12, 0.56, 0.08, 0.22]] : [[0, 0.72, 0, 0.25], [0.17, 0.6, 0.05, 0.21], [-0.15, 0.62, 0.1, 0.2], [0.03, 0.6, -0.17, 0.21], [-0.06, 0.86, -0.04, 0.17], [0.1, 0.8, 0.12, 0.16]];
  for (const [x, y, z, r] of lobes) parts.push(lobe(r, x, y, z, rnd, far ? 0 : 1, leaf, C));
  return merge(parts);
}
// Agulheiro: conífera de camadas
function conifer(far) {
  const parts = [trunk(far ? 0.03 : 0.022, 0.01, 1.0, far ? 5 : 6, far ? -0.15 : 0)];
  const n = far ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), r = 0.26 * (1 - t * 0.8), h = far ? 0.42 : 0.3, y = 0.2 + t * 0.62;
    const g = new THREE.ConeGeometry(r, h, far ? 6 : 10, 1, false); g.translate(0, y + h / 2, 0);
    parts.push(paint(g, (x, yy) => { const s = 0.55 + 0.6 * Math.min(1, Math.max(0, (yy - y) / h)); return [0.16 * s, 0.34 * s, 0.2 * s]; }));
  }
  return merge(parts);
}
// Lanterna (só na Nova Terra): tronco fino e curvo, folhas pendentes e frutos que brilham à noite
function lantern() {
  const parts = [];
  let px = 0, py = 0;
  for (let k = 0; k < 3; k++) {
    const g = new THREE.CylinderGeometry(0.018, 0.026, 0.3, 6); g.translate(0, 0.15, 0); g.rotateZ(-0.12 * k); g.translate(px, py, 0);
    parts.push(paint(g, () => [0.38, 0.32, 0.26]));
    px += Math.sin(0.12 * k) * 0.3; py += Math.cos(0.12 * k) * 0.3;
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const g = new THREE.SphereGeometry(1, 8, 4); g.scale(0.045, 0.012, 0.28); g.translate(0, 0, 0.24); g.rotateX(0.55); g.rotateY(a); g.translate(px, py, 0);
    parts.push(paint(g, (x, y) => { const s = 0.7 + 0.5 * Math.min(1, Math.max(0, (y - py + 0.2) / 0.2)); return [0.2 * s, 0.5 * s, 0.48 * s]; }));
  }
  const geo = merge(parts);
  const pods = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.4, r = 0.17 + (k % 2) * 0.06;
    const g = new THREE.SphereGeometry(0.028, 6, 4); g.translate(px + Math.sin(a) * r, py - 0.13 - (k % 3) * 0.03, Math.cos(a) * r);
    pods.push(paint(g, () => [1, 1, 1]));
  }
  return { geo, pods: merge(pods), top: [px, py] };
}

// ---------------------------------------------------------------- materiais (vento e corte de distância)
const SWAY = { value: 0 };
const NEARCUT = { value: 0 };
function treeMaterial(far, amp) {
  const m = far ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = SWAY; sh.uniforms.uNearCut = NEARCUT;
    sh.vertexShader = 'uniform float uSway;\nvarying float vCamD;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 3100.0 + instanceMatrix[3].z * 2300.0;
        float sw = max(position.y - 0.3, 0.0);
        transformed.x += sin(uSway * 1.3 + ph) * ${amp.toFixed(3)} * sw * sw;
        transformed.z += sin(uSway * 0.9 + ph * 1.7) * ${(amp * 0.6).toFixed(3)} * sw * sw;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n vCamD = -mvPosition.z;');
    sh.fragmentShader = 'uniform float uNearCut;\nvarying float vCamD;\n' + sh.fragmentShader
      .replace('void main() {', `void main() {
        ${far ? 'if (vCamD < uNearCut) { float dd = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); if (dd > (vCamD - uNearCut * 0.8) / (uNearCut * 0.2)) discard; }' : ''}`);
  };
  return m;
}

// ---------------------------------------------------------------- floresta
const KINDS = ['copa', 'agulha', 'lanterna'];
const NEAR = { cell: 0.006, range: 0.17, move: 0.03, budget: 700, cap: [1800, 1800, 300] };
const FAR = { cell: 0.022, range: 2.1, move: 0.35, budget: 1600, cap: [9000, 9000, 1200] };

export class Forest {
  constructor(item, P) {
    this.item = item; this.P = P; this.R = P.R;
    this.nova = item.body.special === 'nova';
    this.root = new THREE.Group();
    item.spin.add(this.root);
    const L = lantern();
    const near = [broadleaf(false), conifer(false), L.geo], far = [broadleaf(true), conifer(true), broadleaf(true)];
    const mk = (geos, isFar, cfg) => {
      const g = new THREE.Group();
      this.root.add(g);
      const meshes = geos.map((geo, k) => {
        const m = new THREE.InstancedMesh(geo, treeMaterial(isFar, k === 1 ? 0.012 : 0.02), cfg.cap[k]);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cfg.cap[k] * 3).fill(1), 3);
        m.frustumCulled = false; m.count = 0;
        g.add(m);
        return m;
      });
      return { g, meshes, cfg, center: null, job: null, list: [] };
    };
    this.near = mk(near, false, NEAR);
    this.far = mk(far, true, FAR);
    // frutos brilhantes das lanternas (mesmas matrizes da espécie)
    this.podMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.0, 0.9) });
    this.pods = new THREE.InstancedMesh(L.pods, this.podMat, NEAR.cap[2]);
    this.pods.instanceMatrix = this.near.meshes[2].instanceMatrix;
    this.pods.frustumCulled = false; this.pods.count = 0;
    this.near.g.add(this.pods);
    this.trees = []; // árvores perto (para o scanner): {p: Vector3 no planeta, kind, h}
  }

  // regra de uma célula da grade: devolve null ou { d (direção), e, kind, size, tint }
  cell(ci, cj, ck, k, cfg) {
    const h1 = pcg3d((ci + 0x30000000) >>> 0, (cj + 0x30000000) >>> 0, (ck + 0x30000000) >>> 0);
    if (h1[0] > 0.93) return null;
    const d = new THREE.Vector3((ci + h1[1]) / k, (cj + h1[2]) / k, (ck + h1[0]) / k).normalize();
    // fora das manchas de floresta só há árvores isoladas: descarta a maioria sem calcular o relevo
    if (h1[0] > (cfg === FAR ? 0.05 : 0.02) && !forestChance(this.P, d.x, d.y, d.z)) return null;
    const hh = heightAt(this.P, d.x, d.y, d.z);
    if (hh.water) return null;
    const v = vegAt(this.P, d.x, d.y, d.z, hh);
    if (v.vg <= 0) return null;
    const far = cfg === FAR;
    const p = v.forest * (far ? 0.95 : 0.88) + v.vg * (far ? 0.05 : 0.02);
    if (h1[0] > p) return null;
    const h2 = pcg3d((ci + 0x30000777) >>> 0, (cj + 0x30000555) >>> 0, (ck + 0x30000333) >>> 0);
    const lat = Math.abs(d.y);
    let kind = 0;
    if (v.hl > 0.16 || lat > 0.5 || (v.n2 > 0.3 && v.moist < 0.5)) kind = 1;
    if (this.nova && kind === 0 && v.forest > 0.1 && v.forest < 0.6 && h2[0] < 0.22) kind = 2;
    const lone = v.forest < 0.2;
    const base = [0.011, 0.016, 0.0075][kind], var_ = [0.01, 0.014, 0.004][kind];
    const size = (base + h2[1] * var_) * (lone ? 1.3 : 1) * (far ? 1.15 : 1);
    const tint = kind === 2 ? [0.95, 1.05, 1.1] : [0.85 + h2[2] * 0.3, 0.9 + h2[1] * 0.2, 0.8 + h2[0] * 0.25];
    return { d, e: hh.e, kind, size, tint, yaw: h2[2] * 6.283, tilt: (h2[0] - 0.5) * 0.08 };
  }

  // gerador: percorre a grade em volta de dir e devolve as instâncias aos poucos
  *build(dir, cfg) {
    const R = this.R, up = dir.clone();
    const e1 = new THREE.Vector3(0, 1, 0).cross(up); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize();
    const e2 = up.clone().cross(e1);
    const k = R / cfg.cell, n0 = Math.ceil(cfg.range / cfg.cell), seen = new Set(), out = [];
    const d = new THREE.Vector3();
    let work = 0;
    for (let i = -n0; i <= n0; i++) for (let j = -n0; j <= n0; j++) {
      if (i * i + j * j > n0 * n0) continue;
      d.copy(up).addScaledVector(e1, (i * cfg.cell) / R).addScaledVector(e2, (j * cfg.cell) / R).normalize();
      const ci = Math.floor(d.x * k), cj = Math.floor(d.y * k), ck = Math.floor(d.z * k);
      const key = ci + ',' + cj + ',' + ck;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = this.cell(ci, cj, ck, k, cfg);
      if (t) out.push(t);
      if (++work >= cfg.budget) { work = 0; yield null; }
    }
    return { up, out };
  }

  apply(ring, res) {
    const { up, out } = res;
    const base = up.clone().multiplyScalar(this.R);
    ring.g.position.copy(base);
    const cnt = [0, 0, 0], m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
    const near = ring === this.near;
    if (near) this.trees = [];
    for (const t of out) {
      const mesh = ring.meshes[t.kind];
      if (cnt[t.kind] >= ring.cfg.cap[t.kind]) continue;
      pos.copy(t.d).multiplyScalar(this.R + t.e).sub(base);
      q.setFromUnitVectors(Y, t.d).multiply(qy.setFromAxisAngle(Y, t.yaw)).multiply(qy.setFromAxisAngle(X, t.tilt));
      s.setScalar(t.size);
      m.compose(pos, q, s);
      const i = cnt[t.kind]++;
      mesh.setMatrixAt(i, m);
      mesh.instanceColor.setXYZ(i, t.tint[0], t.tint[1], t.tint[2]);
      if (near) this.trees.push({ p: t.d.clone().multiplyScalar(this.R + t.e), kind: KINDS[t.kind], h: t.size });
    }
    ring.meshes.forEach((mesh, k) => { mesh.count = cnt[k]; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; });
    if (near) { this.pods.count = cnt[2]; }
  }

  step(ring, dir) {
    const R = this.R;
    if (!ring.job && (!ring.center || ring.center.distanceTo(dir) * R > ring.cfg.move)) {
      ring.job = this.build(dir.clone(), ring.cfg);
      ring.center = dir.clone();
    }
    if (ring.job) {
      const r = ring.job.next();
      if (r.done) { this.apply(ring, r.value); ring.job = null; }
    }
  }

  // dir: direção do jogador/nave no planeta; alt (km) acima do chão; night 0..1
  update(dir, alt, time, night) {
    SWAY.value = time % 1000;
    NEARCUT.value = 0.15;
    const nearOn = alt < 0.6, farOn = alt < 4;
    this.near.g.visible = nearOn; this.far.g.visible = farOn;
    if (nearOn) this.step(this.near, dir);
    if (farOn) this.step(this.far, dir);
    this.podMat.color.setRGB(0.35, 1.0, 0.9).multiplyScalar(0.25 + 1.6 * night);
  }

  dispose() {
    this.item.spin.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
