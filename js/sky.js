// Céu: cubemap da Via Láctea, estrelas do setor com paralaxe real e nebulosas
import * as THREE from 'three';
import { skyGenMaterial, starPointsMaterial, bakeNebula, nebulaMaterial } from './shaders.js';
import { eqToGame, mulberry32, gauss } from './util.js';

const dirOf = (ra, dec) => new THREE.Vector3(...eqToGame(ra, dec, 1)).normalize();

export class Sky {
  constructor(renderer, galaxy) {
    this.galaxy = galaxy;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 1e-5, 1e7);

    // --- Fundo (gerado uma única vez) ---
    const rt = new THREE.WebGLCubeRenderTarget(2048, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    const gen = new THREE.Scene();
    gen.add(new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), skyGenMaterial({
      and: dirOf(10.68, 41.27), lmc: dirOf(80.9, -69.76), smc: dirOf(13.2, -72.8),
    })));
    const cc = new THREE.CubeCamera(0.1, 10, rt);
    cc.update(renderer, gen);
    this.cubeRT = rt;
    this.scene.background = rt.texture;
    this.scene.backgroundIntensity = 1;

    // --- Estrelas do setor ---
    const N = galaxy.count;
    const pos = new Float32Array(N * 3), colr = new Float32Array(N * 3), lum = new Float32Array(N), idx = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = galaxy.px[i]; pos[i * 3 + 1] = galaxy.py[i]; pos[i * 3 + 2] = galaxy.pz[i];
      const c = galaxy.color(i);
      colr[i * 3] = c[0]; colr[i * 3 + 1] = c[1]; colr[i * 3 + 2] = c[2];
      lum[i] = galaxy.lum[i]; idx[i] = i;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colr, 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    this.pointsMat = starPointsMaterial();
    this.points = new THREE.Points(g, this.pointsMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // --- Nebulosas ---
    this.nebulae = [];
    const rng = mulberry32(777);
    const defs = [
      { name: 'Nebulosa de Órion', p: eqToGame(83.82, -5.39, 1344), r: 14, c: ['#ff3a5a', '#3a7dff', '#ffd0a0'], a: 1.0 },
      { name: 'Plêiades (reflexão)', p: eqToGame(56.75, 24.117, 444), r: 9, c: ['#2a5cff', '#7aa8ff', '#c0d8ff'], a: 0.5 },
      { name: 'Nebulosa da Lagoa', p: eqToGame(270.9, -24.38, 4100), r: 50, c: ['#ff2a50', '#ff7a6a', '#ffe0c0'], a: 0.7 },
      { name: 'Nebulosa da Águia', p: eqToGame(274.7, -13.8, 5700), r: 45, c: ['#ff4a3a', '#30a0ff', '#ffe08a'], a: 0.6 },
    ];
    for (let k = 0; k < 6; k++) {
      const ang = rng() * Math.PI * 2, rr = 120 + rng() * 330;
      const pal = [['#ff2e55', '#2a6bff', '#ffc890'], ['#24d0c0', '#3a5aff', '#e0fff8'], ['#ff5a2a', '#a030ff', '#ffd8a0'], ['#4060ff', '#ff3080', '#ffffff']][k % 4];
      defs.push({ name: 'Nebulosa ' + ['Véu Cinzento', 'Lira Distante', 'Cálice', 'Sombra de Ícaro', 'Fenda Azul', 'Brasa'][k], p: [Math.cos(ang) * rr, gauss(rng) * 30, Math.sin(ang) * rr], r: 18 + rng() * 30, c: pal, a: 0.55 + rng() * 0.4 });
    }
    for (const d of defs) {
      const grp = { def: d, layers: [], center: new THREE.Vector3(...d.p) };
      const nl = 5;
      for (let l = 0; l < nl; l++) {
        const tex = bakeNebula(renderer, d.c[l % 3], d.c[(l + 1) % 3], d.c[2], rng() * 100);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nebulaMaterial(tex));
        m.frustumCulled = false;
        m.userData.off = new THREE.Vector3(gauss(rng), gauss(rng), gauss(rng)).multiplyScalar(d.r * 0.3);
        m.userData.scale = d.r * (1.4 + rng() * 1.2);
        m.userData.rot = rng() * Math.PI * 2;
        m.userData.a = d.a * (0.08 + rng() * 0.06);
        this.scene.add(m);
        grp.layers.push(m);
      }
      this.nebulae.push(grp);
    }
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._z = new THREE.Vector3(0, 0, 1);
  }

  // shipGal: posição galáctica da nave (al) ; hideIndex: estrela renderizada como objeto local
  update(mainCamera, shipGal, hideIndex, daylight = 0) {
    this.scene.backgroundIntensity = 1 - 0.96 * daylight;
    this.pointsMat.uniforms.uDim.value = 1 - 0.97 * daylight;
    this.camera.quaternion.copy(mainCamera.quaternion);
    if (this.camera.fov !== mainCamera.fov || this.camera.aspect !== mainCamera.aspect) {
      this.camera.fov = mainCamera.fov; this.camera.aspect = mainCamera.aspect; this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.pointsMat.uniforms.uShip.value.set(shipGal.x, shipGal.y, shipGal.z);
    this.pointsMat.uniforms.uHide.value = hideIndex;
    // Billboards das nebulosas, voltados para a câmera, com rotação própria
    for (const n of this.nebulae) {
      const dist = this._v.copy(n.center).sub(shipGal).length();
      const fade = THREE.MathUtils.smoothstep(dist, n.def.r * 0.6, n.def.r * 1.6);
      for (const m of n.layers) {
        m.position.copy(n.center).add(m.userData.off).sub(shipGal);
        m.quaternion.copy(this.camera.quaternion);
        this._q.setFromAxisAngle(this._z, m.userData.rot);
        m.quaternion.multiply(this._q);
        m.scale.setScalar(m.userData.scale);
        m.material.uniforms.uA.value = m.userData.a * fade * (1 - daylight);
        m.visible = fade > 0.001;
      }
    }
  }
}
