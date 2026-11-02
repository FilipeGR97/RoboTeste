// A Frota da Diáspora (naves com IA própria que fugiram junto) e as Sombras (as naves que saíram do Érebo).
// Tudo aqui é determinístico a partir da galáxia e do estado salvo (S.flags, S.stats.time).
import * as THREE from 'three';
import { SHIPS, buildShip } from './ships.js';
import { getSystem, bodyPosition, hzRange } from './system.js';
import { KM_PER_AU, fmtNum } from './util.js';

export const FLEET = {
  esperanca: { nome: 'Esperança', ia: 'ATLAS', model: 'odisseia', cor: '#ffd27a', desc: 'Nave-comando da frota. A IA ATLAS coordena a fuga.' },
  iara: { nome: 'Iara', ia: 'MAÍRA', model: 'andorinha', cor: '#7affc8', desc: 'Cápsula com quatro pessoas a bordo.' },
  tupa: { nome: 'Tupã', ia: 'ARANDU', model: 'leviata', cor: '#ff9a7a', desc: 'Cargueiro pesado com as sementes e os arquivos genéticos da Terra.' },
  aurora: { nome: 'Aurora', ia: 'GAIA', model: 'exodo', cor: '#9ad0ff', desc: 'Arca com quarenta mil pessoas em sono criogênico.' },
  valquiria: { nome: 'Valquíria', ia: 'HELA', model: 'odisseia', cor: '#ff7a9a', desc: 'Fragata militar.' },
};
export const SPEAKER_COLOR = { LUMEN: '#7fe0ff', ATLAS: '#ffd27a', 'MAÍRA': '#7affc8', ARANDU: '#ff9a7a', GAIA: '#9ad0ff', HELA: '#ff7a9a', '???': '#c49bff', 'REGISTRO': '#d8d8d8' };

const shipDef = (id) => SHIPS.find((s) => s.id === id);

let GLOW_TEX = null;
function glowSprite(color, size = 0.05) {
  if (!GLOW_TEX) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    GLOW_TEX = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: new THREE.Color(color), sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

export class Fleet {
  constructor(galaxy) {
    this.galaxy = galaxy;
    const g = galaxy, bz = g.bioZone;
    const dirBZ = new THREE.Vector3(bz.x, bz.y, bz.z).normalize();
    // estrela "no caminho" entre r0 e r1 anos-luz do Sol, o mais alinhada possível com o sinal
    const onPath = (r0, r1, avoid = []) => {
      let best = -1, bs = -Infinity;
      for (const i of g.within(0, 0, 0, r1)) {
        if (i === 0 || avoid.includes(i) || g.bh.has(i)) continue;
        const v = new THREE.Vector3(g.px[i], g.py[i], g.pz[i]);
        const d = v.length();
        if (d < r0) continue;
        const s = v.normalize().dot(dirBZ) + (getSystem(g, i).planets.length ? 0.15 : 0);
        if (s > bs) { bs = s; best = i; }
      }
      return best;
    };
    this.iaraStar = onPath(6, 13);
    this.tupaStar = onPath(24, 34, [this.iaraStar]);
    // rota da Esperança: saltos de até 35 al em direção ao centro da zona do sinal
    this.route = [0];
    let cur = 0;
    for (let k = 0; k < 8; k++) {
      let best = -1, bd = Math.hypot(g.px[cur] - bz.x, g.py[cur] - bz.y, g.pz[cur] - bz.z);
      for (const i of g.within(g.px[cur], g.py[cur], g.pz[cur], 34)) {
        const d = Math.hypot(g.px[i] - bz.x, g.py[i] - bz.y, g.pz[i] - bz.z);
        if (d < bd - 1) { bd = d; best = i; }
      }
      if (best < 0) break;
      this.route.push(best);
      cur = best;
    }
  }

  // estrela onde está a Esperança agora (salta a cada ~3 min de jogo)
  esperancaStar(S) {
    if (S.won) return this.galaxy.novaTerra;
    const k = Math.floor(Math.max(0, (S.stats.time - 240) / 180));
    return this.route[Math.min(k, this.route.length - 1)];
  }

  // naves da frota em um sistema: [{ id, state }]
  shipsAt(star, S) {
    const f = S.flags, out = [];
    if (star === this.esperancaStar(S)) out.push({ id: 'esperanca', state: 'ok' });
    if (star === this.iaraStar && f.iaraCalled && !f.iaraSaved) out.push({ id: 'iara', state: 'socorro' });
    if (star === this.galaxy.novaTerra && f.iaraSaved && S.won) out.push({ id: 'iara', state: 'ok' });
    if (star === this.tupaStar && f.tupaLost) out.push({ id: 'tupa', state: 'destroco' });
    if (star === this.galaxy.novaTerra && f.novaWalk) out.push({ id: 'aurora', state: 'ok' });
    return out;
  }

  // marcadores para o mapa galáctico
  mapMarkers(S) {
    const f = S.flags, out = [];
    out.push({ id: 'esperanca', star: this.esperancaStar(S), label: 'Esperança' });
    if (f.iaraCalled && !f.iaraSaved) out.push({ id: 'iara', star: this.iaraStar, label: 'Iara · SOCORRO' });
    if (f.tupaLost) out.push({ id: 'tupa', star: this.tupaStar, label: f.tupaLog ? 'Tupã · destroços' : 'Tupã · sem sinal' });
    return out;
  }
}

// ------------------------------------------------------------------------------------------------
// Modelo de uma Sombra: um fragmento alongado de obsidiana com veios violeta
// ------------------------------------------------------------------------------------------------
export function makeShadowModel() {
  const g = new THREE.Group();
  const body = new THREE.OctahedronGeometry(1, 0);
  body.scale(0.22, 0.12, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x050409, metalness: 1, roughness: 0.12, emissive: 0x12051f, emissiveIntensity: 0.6 });
  const core = new THREE.Mesh(body, mat);
  g.add(core);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.5, 0.03, 0.35), mat);
    fin.position.set(s * 0.28, 0, 0.2);
    fin.rotation.z = s * 0.25;
    g.add(fin);
  }
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body), new THREE.LineBasicMaterial({ color: new THREE.Color(0.75, 0.3, 1.4) }));
  g.add(edges);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 2.4) }));
  eye.position.z = -0.75;
  g.add(eye);
  g.scale.setScalar(0.09); // 180 m de comprimento (km)
  g.userData.eye = eye;
  return g;
}

// ------------------------------------------------------------------------------------------------
// Objetos da frota (e Sombras passivas) dentro do sistema carregado
// ------------------------------------------------------------------------------------------------
export class FleetView {
  constructor(scene, view, fleet, S) {
    this.scene = scene;
    this.view = view;
    this.objs = [];
    const sys = view.sys;
    // ponto de encontro: perto do planeta mais próximo da zona habitável (ou a 0,4 UA da estrela)
    let anchor = null;
    if (sys.planets.length) {
      const [h0, h1] = hzRange(sys.star);
      const hz = (h0 + h1) / 2;
      let bd = Infinity;
      for (const p of sys.planets) { const d = Math.abs(Math.log(p.aAU / hz)); if (d < bd) { bd = d; anchor = p; } }
    }
    const nova = sys.planets.find((p) => p.special === 'nova');
    if (nova) anchor = nova;
    const list = fleet.shipsAt(sys.star.index, S);
    list.forEach((e, k) => this.add(e.id, e.state, anchor, k));
    // na Nova Terra, três Sombras em órbita — observando
    if (nova && S.flags.bioEnter) for (let k = 0; k < 3; k++) this.addShadow(nova, k);
  }

  add(id, state, anchor, k) {
    const def = FLEET[id];
    const model = buildShip(shipDef(def.model));
    const group = model.group;
    if (state === 'destroco') {
      // casco morto: sem luzes nem motores, girando devagar
      group.traverse((o) => {
        if (o.material && o.material.color) o.material = o.material.clone();
        if (o.material && o.material.isMeshBasicMaterial) o.visible = false;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.color.multiplyScalar(0.35); o.material.emissiveIntensity = 0; }
        if (o.material && o.material.isShaderMaterial) o.visible = false;
      });
    }
    this.scene.add(group);
    // farol: as naves são pequenas (15–900 m), então piscam para serem vistas de longe
    const glow = glowSprite(state === 'socorro' ? '#ff3a2a' : state === 'destroco' ? '#806050' : def.cor, 0.035);
    glow.renderOrder = 5;
    this.scene.add(glow);
    const R = anchor ? anchor.radius : 0;
    const off = new THREE.Vector3(Math.cos(k * 2.1 + 0.6), 0.25 * Math.sin(k * 1.7), Math.sin(k * 2.1 + 0.6));
    off.setLength(anchor ? R * 4 + 600 + k * 120 : 0.4 * KM_PER_AU);
    this.objs.push({ id, def, state, model, group, glow, anchor, off, pos: [0, 0, 0], world: new THREE.Vector3(), name: def.nome, radius: model.length, spin: Math.random() * 6 });
  }

  addShadow(planet, k) {
    const group = makeShadowModel();
    this.scene.add(group);
    const a = (k / 3) * Math.PI * 2;
    this.objs.push({ id: 'sombra' + k, shadow: true, group, anchor: planet, orbitA: a, orbitR: planet.radius * 2.6, pos: [0, 0, 0], world: new THREE.Vector3(), name: 'Sombra', radius: 0.18 });
  }

  update(dt, t, shipLocal, elapsed) {
    for (const o of this.objs) {
      const ap = o.anchor ? bodyPosition(o.anchor, t, [0, 0, 0]) : [0, 0, 0];
      if (o.shadow) {
        o.orbitA += dt * 0.02;
        o.off = new THREE.Vector3(Math.cos(o.orbitA) * o.orbitR, Math.sin(o.orbitA * 0.7) * o.orbitR * 0.2, Math.sin(o.orbitA) * o.orbitR);
        o.group.lookAt(o.group.position.clone().add(new THREE.Vector3(-Math.sin(o.orbitA), 0, Math.cos(o.orbitA))));
        o.group.userData.eye.material.color.setRGB(1.6, 0.6, 2.4).multiplyScalar(0.7 + 0.3 * Math.sin(elapsed * 2 + o.orbitA * 5));
      }
      o.pos = [ap[0] + o.off.x, ap[1] + o.off.y, ap[2] + o.off.z];
      o.world.set(o.pos[0] - shipLocal[0], o.pos[1] - shipLocal[1], o.pos[2] - shipLocal[2]);
      o.group.position.copy(o.world);
      if (o.model) {
        if (o.state === 'destroco') { o.spin += dt * 0.05; o.group.rotation.set(o.spin * 0.7, o.spin, 0.4); }
        else o.model.update(elapsed, o.state === 'socorro' ? 0 : 0.15, 0);
        // a Iara pisca um farol vermelho de socorro
        if (o.state === 'socorro' && !o.beacon) {
          o.beacon = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15) }));
          o.beacon.scale.setScalar(0.001);
          o.group.add(o.beacon);
        }
        if (o.beacon) o.beacon.visible = (elapsed % 1.2) < 0.35;
      }
      if (o.glow) {
        o.glow.position.copy(o.world);
        const near = o.world.length() < 2; // perto, a nave já é visível por si
        o.glow.visible = !near && (o.state !== 'socorro' || (elapsed % 1.2) < 0.6);
      }
    }
  }

  find(id) { return this.objs.find((o) => o.id === id) || null; }

  dispose() {
    for (const o of this.objs) { this.scene.remove(o.group); if (o.glow) this.scene.remove(o.glow); }
    this.objs = [];
  }
}

// ------------------------------------------------------------------------------------------------
// Encontro com uma Sombra: aparece, se aproxima, dá um prazo e ataca se a nave não fugir
// ------------------------------------------------------------------------------------------------
export class ShadowEncounter {
  constructor(scene, startWorld) {
    this.scene = scene;
    this.group = makeShadowModel();
    this.group.scale.setScalar(0.09);
    scene.add(this.group);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(1.4, 0.4, 2.2), transparent: true, opacity: 0.9 }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    scene.add(this.beam);
    this.glow = glowSprite('#b060ff', 0.03);
    scene.add(this.glow);
    this.rel = startWorld.clone(); // posição relativa à nave (km)
    this.state = 'chegando';
    this.t = 0;
    this.deadline = 32; // segundos até atacar
    this.hidden = 0;
  }

  // retorna o dano por segundo ao casco
  update(dt, elapsed, landed) {
    this.t += dt;
    const hold = 3.5; // km
    const d = this.rel.length();
    if (this.state === 'chegando') {
      const v = Math.max(d * 1.8, 30);
      this.rel.setLength(Math.max(hold, d - v * dt));
      if (this.rel.length() <= hold + 0.01) this.state = 'observando';
    } else if (this.state !== 'partindo') {
      this.rel.setLength(hold + Math.sin(elapsed * 0.8) * 0.4);
      this.rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.05);
    }
    if (landed && this.state !== 'partindo') {
      this.hidden += dt;
      if (this.hidden > 14) this.state = 'partindo';
    } else this.hidden = 0;
    let dmg = 0;
    if (this.state === 'observando' && this.t > this.deadline) this.state = 'atacando';
    if (this.state === 'atacando') dmg = 5;
    if (this.state === 'partindo') this.rel.multiplyScalar(1 + dt * 4);
    this.group.position.copy(this.rel);
    this.glow.position.copy(this.rel);
    this.glow.visible = this.rel.length() > 1.5;
    this.group.lookAt(0, 0, 0);
    this.group.rotateY(Math.PI);
    this.group.userData.eye.material.color.setRGB(1.6, 0.6, 2.4).multiplyScalar(this.state === 'atacando' ? 2 + Math.sin(elapsed * 20) : 0.8 + 0.2 * Math.sin(elapsed * 3));
    this.beam.visible = this.state === 'atacando';
    if (this.beam.visible) {
      const p = this.beam.geometry.attributes.position;
      p.setXYZ(0, this.rel.x, this.rel.y, this.rel.z); p.setXYZ(1, 0, 0, 0); p.needsUpdate = true;
    }
    return dmg;
  }

  get gone() { return this.state === 'partindo' && this.rel.length() > 5000; }
  get secondsLeft() { return Math.max(0, Math.ceil(this.deadline - this.t)); }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.beam);
    this.scene.remove(this.glow);
  }
}

// ------------------------------------------------------------------------------------------------
// Catálogo de exoplanetas para o mapa: catálogo real + sistemas visitados + sensores de longo alcance
// ------------------------------------------------------------------------------------------------
export function exoCatalog(galaxy, shipGal, S, sensorLy = 25) {
  const set = new Set();
  for (const [i, k] of galaxy.realKey) if (k !== 'sol' && !galaxy.bh.has(i)) set.add(i);
  for (const i of S.visited) set.add(i);
  for (const i of galaxy.within(shipGal.x, shipGal.y, shipGal.z, sensorLy)) set.add(i);
  const out = [];
  for (const i of set) {
    const sys = getSystem(galaxy, i);
    if (!sys.planets.length) continue;
    const [h0, h1] = hzRange(sys.star);
    const planets = sys.planets.map((p) => ({
      name: p.name, type: p.type, body: p.body,
      inHZ: p.body === 'rocky' && p.type !== 'ruinas' && p.aAU >= h0 * 0.9 && p.aAU <= h1 * 1.1,
      score: S.scanned[p.id] ? S.scanned[p.id].score : null,
      R: p.radius,
    }));
    out.push({
      i, name: galaxy.name(i), spectral: galaxy.spectral(i),
      dist: Math.hypot(galaxy.px[i] - shipGal.x, galaxy.py[i] - shipGal.y, galaxy.pz[i] - shipGal.z),
      visited: S.visited.has(i), real: galaxy.realKey.has(i), planets,
      hz: planets.some((p) => p.inHZ), best: Math.max(-1, ...planets.map((p) => p.score ?? -1)),
    });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
export const fmtLy = (d) => fmtNum(d, d < 10 ? 1 : 0) + ' al';
