// Mapa galáctico 3D
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bakeTexture, GALAXY_DISK_FRAG } from './shaders.js';
import { GC } from './galaxy.js';

const STAR_VERT = /* glsl */ `
attribute float aLum; attribute vec3 aColor;
uniform float uScale; uniform float uFade;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.01);
  float lg = log(aLum) / 2.3026;
  float size = clamp(1.8 + lg * 0.9, 1.2, 8.0) * clamp(80.0 / dist, 0.7, 3.5);
  vA = clamp(0.4 + lg * 0.18, 0.18, 1.0) * clamp(600.0 / dist, 0.2, 1.0) * uFade;
  vC = aColor;
  gl_PointSize = size * uScale;
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 5.0) * vA;
  gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35) * a * 1.6, 1.0);
}`;

const RIM_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const RIM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uA;
varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  gl_FragColor = vec4(uColor * (pow(f, 3.0) * 0.8 + 0.04) * uA, 1.0);
}`;
const rimMat = (c, a = 1) => new THREE.ShaderMaterial({
  vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, uniforms: { uColor: { value: new THREE.Color(c) }, uA: { value: a } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

function ringTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function diamondTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffffff'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GalaxyMap {
  constructor(galaxy, renderer, labelRoot) {
    this.galaxy = galaxy;
    this.renderer = renderer;
    this.labelRoot = labelRoot;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01020a);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 2e6);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 140000;
    this.controls.zoomSpeed = 1.4;
    this.controls.enabled = false;

    const N = galaxy.count;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = galaxy.px[i]; pos[i * 3 + 1] = galaxy.py[i]; pos[i * 3 + 2] = galaxy.pz[i];
      const c = galaxy.color(i);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      lum[i] = galaxy.lum[i];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uScale: { value: 1 }, uFade: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.starMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Via Láctea vista de fora (aparece ao afastar o zoom)
    const diskTex = bakeTexture(renderer, GALAXY_DISK_FRAG, {}, 2048);
    this.disk = new THREE.Mesh(new THREE.PlaneGeometry(104000, 104000), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D uTex; uniform float uA; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uA, 1.0); }',
      uniforms: { uTex: { value: diskTex }, uA: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.disk.rotation.x = -Math.PI / 2;
    this.disk.position.set(GC[0], GC[1], GC[2]);
    this.disk.renderOrder = -1;
    this.scene.add(this.disk);

    // buracos negros reais
    const bhp = [];
    this.bhList = [...galaxy.bh.keys()];
    for (const i of this.bhList) bhp.push(galaxy.px[i], galaxy.py[i], galaxy.pz[i]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bhp, 3));
    this.bhPts = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xb48cff, size: 16, sizeAttenuation: false, map: ringTexture('#ffffff'), transparent: true, depthWrite: false, depthTest: false }));
    this.bhPts.frustumCulled = false;
    this.scene.add(this.bhPts);

    // naves da Frota da Diáspora
    this.fleetGeo = new THREE.BufferGeometry();
    this.fleetPts = new THREE.Points(this.fleetGeo, new THREE.PointsMaterial({ color: 0xffd27a, size: 14, sizeAttenuation: false, map: diamondTexture(), transparent: true, depthWrite: false, depthTest: false }));
    this.fleetPts.frustumCulled = false;
    this.scene.add(this.fleetPts);
    this.fleet = [];

    // marcadores
    this.visitedGeo = new THREE.BufferGeometry();
    this.visited = new THREE.Points(this.visitedGeo, new THREE.PointsMaterial({ color: 0x5cffb0, size: 9, sizeAttenuation: false, map: ringTexture('#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.visited.frustumCulled = false;
    this.scene.add(this.visited);

    this.range = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), rimMat('#3ab8ff', 0.9));
    this.scene.add(this.range);
    this.bio = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), rimMat('#ff7a3a', 1));
    this.bio.position.set(galaxy.bioZone.x, galaxy.bioZone.y, galaxy.bioZone.z);
    this.bio.scale.setScalar(galaxy.bioZone.r);
    this.scene.add(this.bio);

    this.ship = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.5, 4) }));
    this.scene.add(this.ship);

    const ringPts = [];
    for (const r of [5, 10, 25, 50, 100, 200, 400]) {
      for (let k = 0; k < 128; k++) {
        const a = (k / 128) * Math.PI * 2, b = ((k + 1) / 128) * Math.PI * 2;
        ringPts.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(b) * r, 0, Math.sin(b) * r);
      }
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ringPts.push(Math.cos(a) * 5, 0, Math.sin(a) * 5, Math.cos(a) * 400, 0, Math.sin(a) * 400);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    this.grid = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x2a5a8a, transparent: true, opacity: 0.28, depthWrite: false }));
    this.scene.add(this.grid);

    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineDashedMaterial({ color: 0x7ad8ff, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false;
    this.scene.add(this.line);

    this.sel = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture('#9fe0ff'), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.sel.scale.setScalar(0.05);
    this.sel.visible = false;
    this.scene.add(this.sel);
    this.tgt = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture('#ffb040'), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.tgt.scale.setScalar(0.06);
    this.tgt.visible = false;
    this.scene.add(this.tgt);

    this.raycaster = new THREE.Raycaster();
    this.selected = -1;
    this.labels = [];
    // estrelas nomeadas (reais) para rótulos
    this.named = [];
    for (let i = 0; i < galaxy.firstProc; i++) {
      const n = galaxy.names.get(i);
      if (!n || /^(Plêiades|Híades) \d/.test(n)) continue;
      this.named.push(i);
    }
  }

  open(shipGal, rangeLy, targetIdx, visited) {
    this.shipGal = shipGal.clone();
    this.ship.position.copy(shipGal);
    this.range.position.copy(shipGal);
    this.range.scale.setScalar(rangeLy);
    this.rangeLy = rangeLy;
    this.grid.position.copy(shipGal);
    this.controls.target.copy(shipGal);
    const d = Math.max(rangeLy * 3.2, 25);
    this.camera.position.set(shipGal.x + d * 0.5, shipGal.y + d * 0.65, shipGal.z + d * 0.75);
    this.controls.enabled = true;
    this.controls.update();
    this.setTarget(targetIdx);
    const vp = [];
    for (const i of visited) vp.push(this.galaxy.px[i], this.galaxy.py[i], this.galaxy.pz[i]);
    this.visitedGeo.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    this.visitedGeo.computeBoundingSphere();
  }

  close() { this.controls.enabled = false; this.clearLabels(); }

  setFleet(list) {
    this.fleet = list;
    this.fleetGeo.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((m) => m.pos), 3));
    this.fleetGeo.computeBoundingSphere();
  }

  setTarget(i) {
    this.targetIdx = i;
    const g = this.galaxy;
    if (i == null || i < 0) { this.tgt.visible = false; this.line.visible = false; return; }
    this.tgt.visible = true;
    this.tgt.position.set(g.px[i], g.py[i], g.pz[i]);
    const p = this.lineGeo.attributes.position;
    p.setXYZ(0, this.shipGal.x, this.shipGal.y, this.shipGal.z);
    p.setXYZ(1, g.px[i], g.py[i], g.pz[i]);
    p.needsUpdate = true;
    this.lineGeo.computeBoundingSphere();
    this.line.computeLineDistances();
    this.line.visible = true;
  }

  select(i) {
    this.selected = i;
    if (i < 0) { this.sel.visible = false; return; }
    this.sel.visible = true;
    this.sel.position.set(this.galaxy.px[i], this.galaxy.py[i], this.galaxy.pz[i]);
  }

  focus(i) {
    const g = this.galaxy;
    const p = new THREE.Vector3(g.px[i], g.py[i], g.pz[i]);
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(p);
    this.camera.position.copy(p).add(off.setLength(Math.min(off.length(), 40)));
  }

  pick(x, y, w, h) {
    const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.raycaster.params.Points.threshold = Math.max(dist * 0.012, 0.05);
    const hits = this.raycaster.intersectObject(this.points);
    if (!hits.length) return -1;
    let best = -1, bs = Infinity;
    for (const h of hits.slice(0, 200)) {
      const s = h.distanceToRay / this.raycaster.params.Points.threshold - Math.log10(this.galaxy.lum[h.index] + 1e-4) * 0.08 + h.distance / dist * 0.15;
      if (s < bs) { bs = s; best = h.index; }
    }
    return best;
  }

  clearLabels() { for (const l of this.labels) l.remove(); this.labels = []; }

  updateLabels(w, h) {
    this.clearLabels();
    const g = this.galaxy;
    const v = new THREE.Vector3();
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const add = (pos, text, cls) => {
      v.copy(pos).project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      const el = document.createElement('div');
      el.className = 'maplabel ' + (cls || '');
      el.textContent = text;
      el.style.left = ((v.x + 1) / 2) * w + 'px';
      el.style.top = ((1 - v.y) / 2) * h + 'px';
      this.labelRoot.appendChild(el);
      this.labels.push(el);
    };
    const p = new THREE.Vector3();
    for (const i of this.named) {
      p.set(g.px[i], g.py[i], g.pz[i]);
      const d = p.distanceTo(this.camera.position);
      if (d > camDist * 2.5 && g.lum[i] < 1000) continue;
      add(p, g.name(i), 'named');
    }
    for (const i of this.bhList) { p.set(g.px[i], g.py[i], g.pz[i]); add(p, '● ' + g.name(i), 'bh'); }
    if (camDist > 2500) add(p.set(GC[0], GC[1], GC[2]), 'Centro galáctico', 'named');
    for (const m of this.fleet) add(p.set(m.pos[0], m.pos[1], m.pos[2]), '◆ ' + m.label, 'fleet');
    add(this.shipGal, 'VOCÊ', 'you');
    add(this.bio.position, 'Bioassinatura · sonda Vigia-7', 'bio');
    if (this.targetIdx >= 0) add(this.tgt.position, g.name(this.targetIdx), 'target');
    if (this.selected >= 0 && this.selected !== this.targetIdx) add(this.sel.position, g.name(this.selected), 'sel');
  }

  update(dt, w, h) {
    this.controls.update();
    this.starMat.uniforms.uScale.value = Math.min(window.devicePixelRatio, 2);
    const s = Math.max(this.camera.position.distanceTo(this.controls.target) * 0.012, 0.03);
    this.ship.scale.setScalar(s);
    this.ship.rotation.y += dt;
    const cd = this.camera.position.distanceTo(this.controls.target);
    this.disk.material.uniforms.uA.value = THREE.MathUtils.smoothstep(cd, 1500, 12000) * 0.9;
    this.grid.visible = cd < 6000;
    this.starMat.uniforms.uFade.value = 1 - 0.8 * THREE.MathUtils.smoothstep(cd, 3000, 40000);
    this.updateLabels(w, h);
  }
}
