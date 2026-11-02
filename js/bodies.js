// Representação 3D de um sistema estelar (estrela, planetas, luas, anéis, destroços)
import * as THREE from 'three';
import { rockyMaterial, gasMaterial, atmosphereMaterial, ringMaterial, starMaterial, glareMaterial, impostorMaterial } from './shaders.js';
import { bodyPosition } from './system.js';
import { tempToRGB, KM_PER_AU, mulberry32, gauss, clamp } from './util.js';

const SPIN_SCALE = 30; // rotação planetária acelerada para ser perceptível

// Ângulo de rotação do corpo em torno do próprio eixo no instante t (mesmo usado no desenho)
export function spinAngle(b, t) {
  const a = (((2 * Math.PI * t) / b.rotPeriod) * SPIN_SCALE) % (2 * Math.PI);
  return a < 0 ? a + 2 * Math.PI : a;
}

let SPHERE = null, CIRCLE = null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function shared() {
  if (!SPHERE) {
    SPHERE = new THREE.SphereGeometry(1, 192, 96);
    const pts = [];
    for (let i = 0; i < 1024; i++) { const a = (i / 1024) * Math.PI * 2; pts.push(Math.cos(a), 0, Math.sin(a)); }
    CIRCLE = new THREE.BufferGeometry();
    CIRCLE.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
}

export class SystemView {
  constructor(sys, scene) {
    shared();
    this.sys = sys;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const st = sys.star;
    const rgb = tempToRGB(st.temp);
    this.starColor = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    // cor da luz com adaptação do olho (menos saturada)
    this.lightColor = new THREE.Color(0.45 + 0.55 * rgb[0], 0.45 + 0.55 * rgb[1], 0.45 + 0.55 * rgb[2]);
    this.starMesh = new THREE.Mesh(SPHERE, starMaterial(this.starColor, (st.index % 97) * 1.37));
    this.starMesh.scale.setScalar(st.radius);
    this.root.add(this.starMesh);
    this.glare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glareMaterial(this.starColor));
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 10;
    this.root.add(this.glare);

    this.items = [];
    this.orbits = new THREE.Group();
    this.root.add(this.orbits);
    this.items.push({ body: { name: st.name, kind: 'star', radius: st.radius, star: st, id: 'star:' + st.index }, pos: [0, 0, 0], world: new THREE.Vector3() });
    for (const b of sys.bodies) this.items.push(this.makeBody(b));
    this.bh = this.items.find((it) => it.body.body === 'bh') || null;
    this.makeImpostors();
    this.debris = null;
    const terra = sys.bodies.find((b) => b.special === 'terra');
    if (terra) this.makeDebris(terra);
    this.showOrbits = true;
  }

  makeBody(b) {
    const it = { body: b, pos: [0, 0, 0], world: new THREE.Vector3() };
    const g = new THREE.Group();
    if (b.body === 'bh') {
      // o buraco negro em si é desenhado pelo passe de lente (LensShader); aqui só a órbita
      it.group = g;
      this.root.add(g);
      it.orbit = this.orbitLine(b, 0x9a6aff);
      return it;
    }
    const tilt = new THREE.Group();
    tilt.rotation.z = b.tilt || 0;
    g.add(tilt);
    const v = b.visual;
    const mat = v.shader === 'gas' ? gasMaterial(v) : rockyMaterial(v);
    const mesh = new THREE.Mesh(SPHERE, mat);
    mesh.scale.setScalar(b.radius);
    tilt.add(mesh);
    // grupo que gira com o planeta, sem escala (o relevo de perto é pendurado aqui)
    const spin = new THREE.Group();
    tilt.add(spin);
    it.spin = spin;
    it.group = g; it.tilt = tilt; it.mesh = mesh; it.mat = mat;
    if (v.atm) {
      const am = atmosphereMaterial(v.atm);
      const atm = new THREE.Mesh(SPHERE, am);
      atm.scale.setScalar(b.radius * (1 + v.atm.thick) * 1.002);
      atm.renderOrder = 2;
      g.add(atm);
      it.atm = atm; it.atmTop = 1 + v.atm.thick;
    }
    if (b.rings) {
      const rg = new THREE.RingGeometry(b.rings.inner, b.rings.outer, 256, 4);
      const rm = ringMaterial(v.ringColor || '#c8b89a', b.rings.inner, b.rings.outer, b.rings.op, (b.seed % 100) * 0.37);
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(b.radius);
      ring.renderOrder = 3;
      tilt.add(ring);
      it.ring = ring;
    }
    this.root.add(g);
    it.orbit = this.orbitLine(b, b.kind === 'moon' ? 0x3a5a78 : b.hab.score >= 50 ? 0x4aa878 : 0x4a78a8);
    return it;
  }

  orbitLine(b, color) {
    const line = new THREE.LineLoop(CIRCLE, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: b.kind === 'moon' ? 0.22 : 0.32, depthWrite: false,
    }));
    line.scale.setScalar(b.a);
    line.rotation.set(-b.inc, -b.node, 0, 'YXZ');
    line.frustumCulled = false;
    this.orbits.add(line);
    return line;
  }

  // Pontos coloridos para planetas e luas distantes demais para formar um disco
  makeImpostors() {
    const list = this.items.filter((it) => it.body.kind !== 'star' && it.body.body !== 'bh');
    const n = list.length;
    const g = new THREE.BufferGeometry();
    const col = new Float32Array(n * 3);
    list.forEach((it, k) => col.set(it.body.visual.avg || [0.7, 0.7, 0.7], k * 3));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aI', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.imp = new THREE.Points(g, impostorMaterial());
    this.imp.frustumCulled = false;
    this.imp.renderOrder = 1;
    this.imp.userData.list = list;
    this.root.add(this.imp);
  }

  makeDebris(terra) {
    const rng = mulberry32(4242);
    // rocha irregular: icosaedro deformado por ondas pseudoaleatórias (vértices coincidentes recebem o mesmo deslocamento)
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    const waves = Array.from({ length: 7 }, () => [new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), 1.5 + rng() * 5, rng() * 6.28, 0.04 + rng() * 0.12]);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let k = 1;
      for (const [d, f, ph, a] of waves) k += Math.sin(v.dot(d) * f + ph) * a;
      if (v.y > 0.55) k *= 0.82; // face fraturada
      p.setXYZ(i, v.x * k, v.y * k * 0.75, v.z * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a5e54, roughness: 1, metalness: 0, flatShading: true });
    const N = 3000;
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), e = new THREE.Euler();
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      let x, y, z;
      if (i < N * 0.65) {
        const r = 7200 + Math.abs(gauss(rng)) * 45000;
        const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1);
        x = r * Math.sin(ph) * Math.cos(th); y = r * Math.cos(ph) * 0.35; z = r * Math.sin(ph) * Math.sin(th);
      } else {
        // corrente de destroços espalhada ao longo da órbita
        const along = gauss(rng) * 900000;
        x = gauss(rng) * 30000; y = gauss(rng) * 8000; z = along;
      }
      t.set(x, y, z);
      const size = 4 + Math.pow(rng(), 5) * 380;
      s.set(size, size * (0.6 + rng() * 0.5), size * (0.7 + rng() * 0.6));
      q.setFromEuler(e.set(rng() * 6.28, rng() * 6.28, rng() * 6.28));
      m.compose(t, q, s);
      inst.setMatrixAt(i, m);
      const hot = rng() < 0.12;
      c.setRGB(hot ? 0.9 : 0.42 + rng() * 0.2, hot ? 0.4 : 0.38 + rng() * 0.15, hot ? 0.25 : 0.34 + rng() * 0.12);
      inst.setColorAt(i, c);
    }
    inst.frustumCulled = false;
    this.root.add(inst);
    const dust = new THREE.Mesh(new THREE.RingGeometry(1.4, 9, 256, 4), ringMaterial('#5a3426', 1.4, 9, 0.1, 3.3));
    dust.rotation.x = -Math.PI / 2;
    dust.scale.setScalar(terra.radius);
    this.root.add(dust);
    this.debris = { inst, dust, terra, rot: new THREE.Quaternion(), geo, swarm: null };
  }

  // Nuvem densa de fragmentos ao redor de um ponto (relativo ao corpo destruído) — dá escala e paralaxe
  setSwarm(off) {
    if (!this.debris) return;
    const d = this.debris;
    if (d.swarm) { this.root.remove(d.swarm); d.swarm.material.dispose(); }
    const rng = mulberry32(777);
    const N = 1800;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a6c, roughness: 0.95, metalness: 0.05, flatShading: true });
    const inst = new THREE.InstancedMesh(d.geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const near = i < 700;
      const sig = near ? 60 : 1800;
      t.set(gauss(rng) * sig, gauss(rng) * sig * 0.6, gauss(rng) * sig);
      if (t.length() < 1.5) t.setLength(1.5 + rng() * 3);
      const size = near ? 0.004 + Math.pow(rng(), 4) * 0.6 : 0.3 + Math.pow(rng(), 5) * 25;
      s.set(size, size * (0.5 + rng() * 0.6), size * (0.6 + rng() * 0.7));
      q.setFromEuler(e.set(rng() * 6.28, rng() * 6.28, rng() * 6.28));
      m.compose(t, q, s);
      inst.setMatrixAt(i, m);
      const hot = rng() < 0.06;
      c.setRGB(hot ? 1.0 : 0.5 + rng() * 0.25, hot ? 0.4 : 0.45 + rng() * 0.2, hot ? 0.25 : 0.4 + rng() * 0.15);
      inst.setColorAt(i, c);
    }
    inst.frustumCulled = false;
    this.root.add(inst);
    d.swarm = inst;
    d.swarmOff = off.clone();
  }

  // shipLocal: [x,y,z] da nave em km relativo à estrela; camWorld: posição da câmera (cena)
  update(t, shipLocal, camera, screenH) {
    const st = this.sys.star;
    const pxAngle = THREE.MathUtils.degToRad(camera.fov) / screenH;
    const camW = camera.position;
    // Estrela
    const sp = this.items[0];
    sp.world.set(-shipLocal[0], -shipLocal[1], -shipLocal[2]);
    this.starMesh.position.copy(sp.world);
    const ts = t % 20000; // tempo limitado para os shaders (precisão float32)
    this.starMesh.material.uniforms.uTime.value = ts;
    const dStar = sp.world.distanceTo(camW);
    const flux = st.lum / Math.pow(dStar / KM_PER_AU, 2);
    const ang = Math.max((st.radius / dStar) * 7, 0.012 + 0.11 * Math.pow(flux, 0.25));
    this.glare.position.copy(sp.world);
    this.glare.quaternion.copy(camera.quaternion);
    this.glare.scale.setScalar(dStar * Math.tan(Math.min(ang, 1.2)));
    this.glare.material.uniforms.uI.value = clamp(Math.pow(flux, 0.16) * 2.0, 0.6, 3.2);
    this.starMesh.material.uniforms.uI.value = 2.4 + Math.min(2.5, Math.pow(st.lum, 0.1) * 1.2);
    this.orbits.visible = this.showOrbits;
    this.orbits.position.copy(sp.world);

    for (let k = 1; k < this.items.length; k++) {
      const it = this.items[k];
      const b = it.body;
      bodyPosition(b, t, it.pos);
      it.world.set(it.pos[0] - shipLocal[0], it.pos[1] - shipLocal[1], it.pos[2] - shipLocal[2]);
      it.group.position.copy(it.world);
      if (b.body === 'bh') {
        if (b.parent == null) it.orbit.position.set(0, 0, 0);
        continue;
      }
      it.mesh.rotation.y = spinAngle(b, t);
      it.spin.rotation.y = it.mesh.rotation.y;
      it.mesh.visible = !it.surfaceOn;
      const u = it.mat.uniforms;
      u.uSunPos.value.copy(sp.world);
      u.uTime.value = ts;
      const dP = Math.max(it.world.distanceTo(camW) - b.radius, b.radius * 0.0005);
      const fluxP = st.lum / Math.pow(Math.hypot(...it.pos) / KM_PER_AU, 2);
      const sunI = clamp(Math.pow(fluxP, 0.12), 0.35, 1.5);
      u.uSunI.value = sunI;
      u.uSunCol.value.copy(this.lightColor);
      const oct = Math.log2(b.radius / (dP * pxAngle * 3));
      u.uOct.value = clamp(oct, 3, b.visual.shader === 'gas' ? 7 : 13);
      if (u.uCloudRot) u.uCloudRot.value = (t * 0.002) % (Math.PI * 2);
      if (it.atm) {
        const am = it.atm.material.uniforms;
        am.uCenter.value.copy(it.world);
        am.uR.value = b.radius;
        am.uSunPos.value.copy(sp.world);
        am.uSunCol.value.copy(this.lightColor);
        am.uSunI.value = 9 * sunI;
        const inside = it.world.distanceTo(camW) < b.radius * it.atmTop * 1.002;
        it.atm.material.side = inside ? THREE.BackSide : THREE.FrontSide;
      }
      if (it.ring) {
        const rm = it.ring.material.uniforms;
        rm.uCenter.value.copy(it.world); rm.uR.value = b.radius; rm.uSunPos.value.copy(sp.world);
        rm.uSunI.value = sunI; rm.uSunCol.value.copy(this.lightColor);
      }
      if (it.orbit) {
        if (b.parent) {
          const pi = this.items.find((x) => x.body === b.parent);
          it.orbit.position.set(pi.pos[0], pi.pos[1], pi.pos[2]);
        }
      }
    }
    // pontos dos planetas distantes: brilho pela luz refletida (albedo × área aparente × fluxo × fase)
    const imp = this.imp;
    const ip = imp.geometry.attributes.position, ia = imp.geometry.attributes.aI;
    imp.userData.list.forEach((it, k) => {
      const b = it.body;
      const dCam = Math.max(it.world.distanceTo(camW), 1);
      const rpx = (b.radius / dCam) / pxAngle;
      ip.setXYZ(k, it.world.x, it.world.y, it.world.z);
      const dS = Math.hypot(...it.pos) / KM_PER_AU;
      const toStar = _a.copy(sp.world).sub(it.world).normalize();
      const toCam = _b.copy(camW).sub(it.world).normalize();
      const phase = 0.5 * (1 + toStar.dot(toCam));
      const alb = 0.3 + 0.4 * Math.min(b.visual.clouds || (b.body === 'gas' ? 0.6 : 0), 1);
      const B = alb * Math.pow(b.radius / dCam, 2) * st.lum / (dS * dS) * (0.15 + 0.85 * phase);
      let I = clamp(Math.pow(B / 2e-11, 0.35), 0.07, 2.5);
      I *= clamp(2.5 - rpx, 0, 1); // some quando o disco real já aparece
      ia.setX(k, I);
    });
    ip.needsUpdate = true; ia.needsUpdate = true;
    imp.material.uniforms.uScale.value = Math.min(window.devicePixelRatio, 2);

    if (this.debris) {
      const ti = this.items.find((x) => x.body === this.debris.terra);
      const d = this.debris;
      d.inst.position.copy(ti.world);
      // orienta a corrente de destroços ao longo da órbita (tangente)
      const th = Math.atan2(ti.pos[2], ti.pos[0]);
      d.inst.rotation.set(0, -th, 0);
      d.dust.position.copy(ti.world);
      if (d.swarm) d.swarm.position.copy(ti.world).add(d.swarmOff);
      const dm = d.dust.material.uniforms;
      dm.uCenter.value.copy(ti.world); dm.uR.value = d.terra.radius; dm.uSunPos.value.copy(sp.world); dm.uSunCol.value.copy(this.lightColor);
    }
  }

  // Distância à superfície mais próxima (km) a partir da origem (nave)
  nearestSurface() {
    let best = Infinity, item = null;
    for (const it of this.items) {
      const d = it.world.length() - it.body.radius;
      if (d < best) { best = d; item = it; }
    }
    return { dist: best, item };
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.material) o.material.dispose();
      if (o.geometry && o.geometry !== SPHERE && o.geometry !== CIRCLE) o.geometry.dispose();
    });
    this.scene.remove(this.root);
  }
}
