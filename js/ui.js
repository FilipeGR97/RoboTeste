// Interface (DOM): HUD, mensagens, rótulos, painéis
import { KIND_NAME, KIND_DESC } from './galaxy.js';
import { TYPE_NAME } from './system.js';
import { fmtDist, fmtNum, fmtTime, R_EARTH, KM_PER_LY, C_KMS } from './util.js';
import { SPEAKER_COLOR } from './fleet.js';
import { SPECIES } from './novaterra.js';

// Falas em fila, legendadas no centro da tela (estilo cinema); avisos curtos viram um "toast"
const TOAST_FROM = new Set(['NAV', 'ÁUDIO', 'MISSÃO']);
const subQueue = [];
let subBusy = false;
function nextSub() {
  const box = $('subs');
  if (!subQueue.length) { subBusy = false; return; }
  subBusy = true;
  const s = subQueue.shift();
  box.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'sub ' + (s.cls || '') + (s.glitch ? ' glitch' : '');
  el.innerHTML = (s.from ? `<b style="color:${SPEAKER_COLOR[s.from] || '#7fe0ff'}">${esc(s.from)}</b>` : '') + esc(s.text);
  box.appendChild(el);
  const life = Math.min(s.life || 2200 + s.text.length * 52, 14000) * (subQueue.length > 2 ? 0.6 : 1);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(nextSub, 450); }, life);
}
let toastT = null;
function toast(text, cls, life) {
  const t = $('toast');
  t.textContent = text;
  t.className = cls || '';
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), life || 5000);
}
const keyHtml = (k, t, extra = '') => `<span class="key ${extra}"><kbd>${esc(k)}</kbd>${esc(t)}</span>`;

export const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const UI = {
  // ------------------------------------------------------------ mensagens
  msg(text, cls = '', from = 'LUMEN', life = 0, opts = {}) {
    if (TOAST_FROM.has(from)) { toast(text, cls, life || 5000); return; }
    // fila: no máximo 4 falas esperando; as de prioridade (rádio da frota) nunca são descartadas
    while (subQueue.length >= 4) {
      const k = subQueue.findIndex((x) => !x.prio);
      if (k < 0) break;
      subQueue.splice(k, 1);
    }
    subQueue.push({ text, cls, from, life: opts.life || 0, prio: !!opts.prio, glitch: !!opts.glitch });
    if (!subBusy) nextSub();
  },
  say(from, text, opts = {}) { this.msg(text, opts.cls || '', from, 0, opts); },
  clearSubs() { subQueue.length = 0; $('subs').innerHTML = ''; subBusy = false; },

  prompts(list) {
    const html = list.map((p) => keyHtml(p.k, p.t, (p.hold ? 'hold ' : '') + (p.danger ? 'danger' : ''))).join('');
    const box = $('prompts');
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
  },

  storyPanel(title, entries, onClose) {
    const p = $('storyPanel');
    p.innerHTML = `<h2>${esc(title)}</h2>` + entries.map(([d, t]) => `<div class="entry"><b>${esc(d)}</b>${esc(t)}</div>`).join('') + '<button class="btn" id="story-close">Fechar</button>';
    p.classList.remove('hidden');
    $('story-close').onclick = () => { p.classList.add('hidden'); onClose && onClose(); };
  },

  exoList(items, filter, range, onPick) {
    const TC = { terrestre: '#5fbf6a', oceano: '#3a7ad8', deserto: '#d8a860', deserto_frio: '#c06a40', rochoso: '#9a948c', lava: '#e8502a', venusiano: '#e0c080', gelo: '#d8eaf6', tundra: '#a8c0c8', vulcanico: '#e0d050', nebuloso: '#c8883a', gasoso: '#d8b890', gelo_gigante: '#80c0e0', ruinas: '#702010' };
    const f = items.filter((s) => filter === 'hz' ? s.hz : filter === 'alcance' ? s.dist <= range : filter === 'novos' ? !s.visited : true);
    $('exo-list').innerHTML = f.length ? f.slice(0, 160).map((s) => `
      <div class="exo-star" data-i="${s.i}">
        <div class="row1"><span>${esc(s.name)} <small>${esc(s.spectral)}</small></span><small>${fmtNum(s.dist, s.dist < 10 ? 1 : 0)} al</small></div>
        <div class="tags">${s.planets.length} planeta(s)${s.hz ? ' · <span class="hz">ZONA HABITÁVEL</span>' : ''}${s.visited ? ' · VISITADO' : ''}${s.real ? ' · CATÁLOGO REAL' : ''}${s.dist > range ? ' · <span class="far">ALÉM DO ALCANCE</span>' : ''}${s.best >= 0 ? ` · melhor: <span style="color:${habColor(s.best)}">${s.best}%</span>` : ''}</div>
        <div>${s.planets.map((p) => `<span class="exo-pl"><i style="background:${TC[p.type] || '#888'}"></i>${esc(TYPE_NAME[p.type] || p.type)}${p.score != null ? ` ${p.score}%` : ''}${p.inHZ ? ' ✦' : ''}</span>`).join('')}</div>
      </div>`).join('') : '<p class="note" style="padding:10px">Nenhum sistema com esse filtro.</p>';
    $('exo-list').querySelectorAll('.exo-star').forEach((el) => el.addEventListener('click', () => onPick(+el.dataset.i)));
  },

  // ------------------------------------------------------------ HUD
  setText(id, t) { const e = $(id); if (e._t !== t) { e.textContent = t; e._t = t; } },

  throttle(v) { $('throttle-fill').style.height = (v * 100).toFixed(1) + '%'; },

  marker(x, y, show, text) {
    const m = $('tmarker');
    m.classList.toggle('hidden', !show);
    if (show) { m.style.left = x + 'px'; m.style.top = y + 'px'; const s = m.firstChild; if (s._t !== text) { s.textContent = text; s._t = text; } }
  },
  arrow(x, y, ang, show) {
    const a = $('tarrow');
    a.classList.toggle('hidden', !show);
    if (show) { a.style.left = x + 'px'; a.style.top = y + 'px'; a.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`; }
  },
  waypoint(x, y, show, text) {
    const m = $('wmarker');
    m.classList.toggle('hidden', !show);
    if (show) { m.style.left = x + 'px'; m.style.top = y + 'px'; const s = m.firstChild; if (s._t !== text) { s.textContent = text; s._t = text; } }
  },
  warrow(x, y, ang, show) {
    const a = $('warrow');
    a.classList.toggle('hidden', !show);
    if (show) { a.style.left = x + 'px'; a.style.top = y + 'px'; a.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`; }
  },
  mission(m) {
    const keys = (m.keys || []).map(([k, t]) => keyHtml(k, t)).join('');
    const key = m.idx + '|' + m.text + '|' + keys;
    const box = $('objective');
    if (box._k === key) return;
    const changed = box._idx !== m.idx;
    box._k = key; box._idx = m.idx;
    $('m-step').textContent = m.free ? '· LIVRE' : `${m.idx + 1}/${m.total}`;
    $('m-title').textContent = m.title;
    $('m-text').textContent = m.text;
    $('m-keys').innerHTML = keys;
    box.classList.toggle('danger', !!m.danger);
    if (changed) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  },

  steer(cx, cy, x, y, show) {
    const l = $('steer-line'), d = $('steer-dot');
    if (!show) { l.setAttribute('x1', -10); l.setAttribute('x2', -10); l.setAttribute('y1', -10); l.setAttribute('y2', -10); d.setAttribute('cx', -50); return; }
    l.setAttribute('x1', cx); l.setAttribute('y1', cy); l.setAttribute('x2', x); l.setAttribute('y2', y);
    d.setAttribute('cx', x); d.setAttribute('cy', y);
  },

  // ------------------------------------------------------------ rótulos de astros
  _labels: new Map(),
  labels(entries) {
    const root = $('labels');
    const seen = new Set();
    for (const e of entries) {
      seen.add(e.key);
      let el = this._labels.get(e.key);
      if (!el) { el = document.createElement('div'); root.appendChild(el); this._labels.set(e.key, el); }
      const html = esc(e.text) + (e.sub ? `<small>${esc(e.sub)}</small>` : '');
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      const cls = 'blabel ' + (e.cls || '');
      if (el.className !== cls) el.className = cls;
      if (e.color && el._c !== e.color) { el.style.setProperty('--c', e.color); el._c = e.color; }
      el.style.left = e.x + 'px'; el.style.top = e.y + 'px';
    }
    for (const [k, el] of this._labels) if (!seen.has(k)) { el.remove(); this._labels.delete(k); }
  },

  // ------------------------------------------------------------ painel do sistema
  systemPanel(view, targetId, onPick) {
    const p = $('sysPanel');
    if (!view) { p.innerHTML = '<h2>ESPAÇO PROFUNDO</h2><p class="note">Nenhum sistema estelar por perto. Abra o mapa [M] e escolha um destino.</p>'; return; }
    const st = view.sys.star;
    let h = `<h2>${esc(st.name)}</h2><p class="note">${esc(st.spectral)} · ${esc(KIND_DESC[st.kind])}<br>${view.sys.planets.length} planeta(s) conhecido(s)</p>`;
    const row = (it, cls) => {
      const b = it.body;
      const d = it.world.length() - b.radius;
      const id = b.id;
      const hab = b.kind !== 'star' && b.scannedScore != null ? `<span class="h" style="color:${habColor(b.scannedScore)}">${b.scannedScore}%</span>` : '';
      const typ = b.kind === 'star' ? 'Estrela' : TYPE_NAME[b.type] || b.type;
      return `<div class="sysrow ${cls} ${id === targetId ? 'sel' : ''}" data-id="${esc(id)}"><span>${esc(b.name)} ${hab}<br><span class="t">${esc(typ)}</span></span><span class="t">${fmtDist(d)}</span></div>`;
    };
    for (const it of view.items) h += row(it, it.body.kind === 'moon' ? 'moon' : '');
    h += '<p class="note">Clique para definir o alvo · [G] piloto automático · [F] escanear</p>';
    p.innerHTML = h;
    p.querySelectorAll('.sysrow').forEach((r) => r.addEventListener('click', () => onPick(r.dataset.id)));
  },

  // ------------------------------------------------------------ resultado do scanner
  scanPanel(b, star, remark) {
    const p = $('scanPanel');
    const g = b.mass / Math.pow(b.radius / R_EARTH, 2);
    const isGas = b.body === 'gas';
    const tC = b.temp - 273.15;
    const hab = b.hab.score;
    const f = b.hab.f;
    const facs = [['Temperatura', f.temp], ['Gravidade', f.grav], ['Pressão', f.press], ['Água líquida', f.agua], ['Oxigênio', f.oxig], ['Magnetosfera', f.magnet], ['Estrela', f.estrela]];
    p.innerHTML = `
      <h2>${esc(b.name)}</h2>
      <p class="note" style="margin-top:-8px">${esc(TYPE_NAME[b.type] || b.type)} · órbita de ${esc(b.parent ? b.parent.name : star.name)}</p>
      <div class="kv"><span>Raio</span><span>${fmtNum(b.radius, 0)} km (${fmtNum(b.radius / R_EARTH, 2)} R⊕)</span></div>
      <div class="kv"><span>Massa</span><span>${fmtNum(b.mass, 3)} M⊕</span></div>
      <div class="kv"><span>Gravidade</span><span>${fmtNum(g, 2)} g</span></div>
      <div class="kv"><span>Temperatura média</span><span>${fmtNum(tC, 0)} °C</span></div>
      <div class="kv"><span>Pressão</span><span>${isGas ? '—' : fmtNum(b.pressure, 3) + ' atm'}</span></div>
      <div class="kv"><span>Atmosfera</span><span>${esc(b.atmoComp)}</span></div>
      <div class="kv"><span>Água</span><span>${isGas ? '—' : b.temp < 273 && b.water > 0.05 ? 'Congelada (' + Math.round(b.water * 100) + '%)' : b.temp > 373 ? 'Evaporada' : Math.round(b.water * 100) + '% da superfície'}</span></div>
      <div class="kv"><span>Magnetosfera</span><span>${b.magnet ? 'Presente' : 'Ausente'}</span></div>
      <div class="kv"><span>Vida</span><span style="color:${b.life === 'complexa' ? 'var(--good)' : b.life === 'microbiana' ? 'var(--warn)' : ''}">${b.life === 'complexa' ? 'Biosfera complexa detectada' : b.life === 'microbiana' ? 'Sinais microbianos' : 'Nenhum sinal'}</span></div>
      <div class="hab"><div class="k" style="font-family:var(--title);font-size:10px;letter-spacing:4px;color:var(--hud-dim)">HABITABILIDADE PARA HUMANOS</div>
        <div class="score" style="color:${habColor(hab)}">${hab}%</div>
        <div class="bar"><div style="width:${hab}%;background:${habColor(hab)}"></div></div></div>
      ${isGas ? '' : `<div class="fac">${facs.map(([n, v]) => `<span>${n}</span><div class="b"><div style="width:${Math.round(v * 100)}%;background:${habColor(v * 100)}"></div></div>`).join('')}</div>`}
      ${b.finds && b.finds.length ? `<h3>DESCOBERTAS</h3><ul class="finds">${b.finds.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${b.desc ? `<p class="note">${esc(b.desc)}</p>` : ''}
      <div class="remark"><b style="font-family:var(--title);font-size:10px;letter-spacing:3px;color:var(--hud)">LUMEN</b><br>${esc(remark)}</div>
      <p class="note">[F] fechar</p>`;
    p.classList.remove('hidden');
  },

  // ------------------------------------------------------------ buraco negro
  bhPanel(b, distKm) {
    const p = $('scanPanel');
    const rs = b.rs;
    const f = Math.sqrt(Math.max(1 - rs / distKm, 1e-9));
    const tidal = (2 * 6.674e-11 * b.massSun * 1.989e30 * 2) / Math.pow(distKm * 1000, 3); // m/s² de diferença em 2 m (corpo humano)
    p.innerHTML = `
      <h2>${esc(b.name.replace(' ●', ''))}</h2>
      <p class="note" style="margin-top:-8px">Buraco negro ${b.massSun > 1e5 ? 'supermassivo' : 'estelar'} · ${b.active ? 'acreção ativa' : 'dormente'}</p>
      <div class="kv"><span>Massa</span><span>${fmtNum(b.massSun, b.massSun > 1000 ? 0 : 2)} M☉</span></div>
      <div class="kv"><span>Horizonte de eventos (raio)</span><span>${fmtDist(rs)}</span></div>
      <div class="kv"><span>Esfera de fótons</span><span>${fmtDist(rs * 1.5)}</span></div>
      <div class="kv"><span>Sombra aparente (raio)</span><span>${fmtDist(rs * 2.6)}</span></div>
      <div class="kv"><span>Órbita estável mais interna</span><span>${fmtDist(rs * 3)}</span></div>
      <div class="kv"><span>Nossa distância</span><span>${fmtDist(distKm)} (${fmtNum(distKm / rs, 0)} Rs)</span></div>
      <div class="kv"><span>Dilatação do tempo</span><span>1 s aqui = ${fmtNum(1 / f, 1 / f < 1.01 ? 5 : 3)} s lá fora</span></div>
      <div class="kv"><span>Força de maré (corpo humano)</span><span>${tidal < 0.01 ? 'imperceptível' : fmtNum(tidal / 9.81, 2) + ' g'}</span></div>
      <div class="kv"><span>Velocidade de escape aqui</span><span>${fmtNum(Math.min(1, Math.sqrt(rs / distKm)) * 100, 2)}% da luz</span></div>
      <div class="kv"><span>Habitabilidade</span><span style="color:var(--bad)">0%</span></div>
      ${b.desc ? `<p class="note">${esc(b.desc)}</p>` : ''}
      <div class="remark"><b style="font-family:var(--title);font-size:10px;letter-spacing:3px;color:var(--hud)">LUMEN</b><br>${esc(b.active
        ? 'O anel brilhante é o disco de acreção: gás a milhões de graus girando a uma fração da velocidade da luz. O lado que vem em nossa direção parece mais brilhante (efeito Doppler). A luz de trás do buraco negro é curvada por cima e por baixo dele.'
        : 'Nenhuma luz própria — só a sombra e a lente gravitacional. As estrelas atrás dele aparecem duplicadas e esticadas num anel: o anel de Einstein.')}</div>
      <p class="note">[F] fechar</p>`;
    p.classList.remove('hidden');
  },

  // ------------------------------------------------------------ diário de bordo
  logPanel(S, galaxy) {
    const p = $('logPanel');
    const list = Object.values(S.scanned).sort((a, b) => b.score - a.score);
    p.innerHTML = `<h2>DIÁRIO DE BORDO</h2>
      <div class="stats3">
        <div><b>${fmtNum(S.stats.ly, 1)}</b><span>ANOS-LUZ</span></div>
        <div><b>${S.stats.jumps}</b><span>SALTOS</span></div>
        <div><b>${S.visited.size}</b><span>SISTEMAS</span></div>
        <div><b>${fmtTime(S.stats.time)}</b><span>DE VIAGEM</span></div>
      </div>
      <h3>PLANETAS ESCANEADOS (${list.length})</h3>
      ${list.length ? list.map((x) => `<div class="logrow"><span>${esc(x.name)}<br><small class="muted">${esc(x.system)}</small></span><span class="muted">${esc(TYPE_NAME[x.type] || x.type)}</span><span style="color:${habColor(x.score)};font-family:var(--title)">${x.score}%</span></div>`).join('') : '<p class="note">Nenhum ainda. Aproxime-se de um planeta e pressione [F].</p>'}
      ${S.flags && S.flags.novaWalk ? catalogHtml(S.flags.catalog || {}) : ''}
      <p class="note">Missão: encontrar um mundo com habitabilidade acima de 90%. A sonda Vigia-7 apontou uma região — veja no mapa [M].</p>
      <button class="btn" data-close="logPanel">Fechar [L]</button>`;
    p.classList.remove('hidden');
  },

  // ------------------------------------------------------------ info de estrela no mapa
  mapInfo(i, galaxy, distLy, range, visited, sysInfo, onTarget, isTarget) {
    const p = $('map-info');
    if (i < 0) { p.classList.add('hidden'); return; }
    const k = galaxy.kind[i];
    const ok = distLy <= range;
    p.innerHTML = `<h2>${esc(galaxy.name(i))}</h2>
      <div class="sub">${esc(galaxy.spectral(i))} · ${esc(KIND_NAME[k])}</div>
      <p style="font-size:15px;margin:0 0 10px">${esc(KIND_DESC[k])}</p>
      <div class="kv"><span>Temperatura</span><span>${fmtNum(galaxy.temp[i], 0)} K</span></div>
      <div class="kv"><span>Luminosidade</span><span>${fmtNum(galaxy.lum[i], galaxy.lum[i] < 0.01 ? 5 : 2)} L☉</span></div>
      <div class="kv"><span>Raio</span><span>${fmtNum(galaxy.rad[i], 2)} R☉</span></div>
      <div class="kv"><span>Distância da nave</span><span>${fmtNum(distLy, 2)} al</span></div>
      <div class="kv"><span>Distância do Sol</span><span>${fmtNum(Math.hypot(galaxy.px[i], galaxy.py[i], galaxy.pz[i]), 2)} al</span></div>
      <div class="kv"><span>Sistema</span><span>${visited ? esc(sysInfo) : 'Não explorado'}</span></div>
      ${galaxy.bh.has(i) ? `<p style="color:#c8a8ff;margin:8px 0 0">● Buraco negro de ${fmtNum(galaxy.bh.get(i).mass, galaxy.bh.get(i).mass > 1000 ? 0 : 1)} M☉ neste sistema</p>` : ''}
      <p class="${ok ? 'ok' : 'no'}" style="margin-top:10px">${ok ? '✔ Dentro do alcance de salto' : '➜ Além do alcance (' + range + ' al): o salto será parcial, ' + Math.ceil(distLy / (range * 0.97)) + ' saltos no total'}</p>
      <button class="btn ${isTarget ? '' : 'primary'}" id="map-settarget">${isTarget ? 'Destino definido ✔ · [J] para saltar' : 'Definir como destino'}</button>`;
    p.classList.remove('hidden');
    $('map-settarget').onclick = onTarget;
  },

  // ------------------------------------------------------------ seleção de nave
  shipCard(def, idx, total) {
    const st = def.stats;
    const pips = (n) => '<span class="pips">' + [1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('') + '</span>';
    $('sel-card').innerHTML = `<div class="cls">${esc(def.classe)}</div><h2>${esc(def.nome.toUpperCase())}</h2><p>${esc(def.desc)}</p>
      <div class="stat"><label>Velocidade</label>${pips(st.velocidade)}</div>
      <div class="stat"><label>Salto</label>${pips(st.salto)}</div>
      <div class="stat"><label>Manobra</label>${pips(st.manobra)}</div>
      <div class="stat"><label>Autonomia</label>${pips(st.autonomia)}</div>
      <div class="specs">Alcance de salto: <b>${def.jump} anos-luz</b> · Velocidade máx.: <b>${fmtNum(def.maxC, 0)} c</b> · Carga do salto: <b>${def.charge} s</b></div>`;
    $('sel-dots').innerHTML = Array.from({ length: total }, (_, k) => `<i class="${k === idx ? 'on' : ''}"></i>`).join('');
  },

  // ------------------------------------------------------------ introdução
  intro(lines, onDone) {
    const box = $('intro-text');
    box.innerHTML = '';
    let i = 0, timer = null, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); onDone(); };
    const next = () => {
      if (i >= lines.length) { timer = setTimeout(finish, 3000); return; }
      box.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'line';
      el.textContent = lines[i];
      box.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
      const dur = 2400 + lines[i].length * 55;
      timer = setTimeout(() => { el.classList.remove('on'); timer = setTimeout(next, 1700); }, dur);
      i++;
    };
    next();
    return finish;
  },

  ending(planet, S, onContinue, onMenu) {
    const e = $('ending');
    e.innerHTML = `<div class="pre" style="font-family:var(--title);letter-spacing:8px;font-size:12px;color:var(--hud-dim);margin-bottom:12px">BIOASSINATURA CONFIRMADA</div>
      <h1>NOVA TERRA</h1>
      <p>${esc(planet.name)} — oceanos de água líquida, ar respirável, florestas sob uma luz amarela e morna.<br>Depois de ${fmtNum(S.stats.ly, 1)} anos-luz, a Frota da Diáspora tem um lugar para recomeçar.<br><br>Mas as Sombras chegaram primeiro. E estão esperando.</p>
      <div class="stats">${S.stats.jumps} SALTOS · ${S.visited.size} SISTEMAS VISITADOS · ${Object.keys(S.scanned).length} MUNDOS ESCANEADOS · ${fmtTime(S.stats.time)}</div>
      <div class="menu"><button class="btn big" id="end-cont">Continuar explorando</button><button class="btn" id="end-menu">Menu principal</button></div>`;
    e.classList.remove('hidden');
    $('end-cont').onclick = onContinue;
    $('end-menu').onclick = onMenu;
  },
};

// catálogo de espécies da Nova Terra (desconhecidas aparecem como ???)
function catalogHtml(cat) {
  const ids = Object.keys(SPECIES), n = ids.filter((id) => cat[id]).length;
  return `<h3>VIDA NA NOVA TERRA (${n}/${ids.length})</h3>` + ids.map((id) => {
    const sp = SPECIES[id];
    return cat[id]
      ? `<div class="logrow"><span>${esc(sp.nome)}<br><small class="muted">${esc(sp.desc)}</small></span><span class="muted">${sp.tipo}</span></div>`
      : `<div class="logrow"><span class="muted">??? · ${sp.tipo === 'fauna' ? 'animal' : 'planta'} ainda não catalogado</span></div>`;
  }).join('');
}

export function habColor(s) {
  if (s >= 85) return '#6dffb5';
  if (s >= 60) return '#c8f56a';
  if (s >= 35) return '#ffb347';
  return '#ff6b6b';
}

export function remarkFor(b, star) {
  const s = b.hab.score;
  if (b.body === 'bh') return 'Um buraco negro. Nada escapa dele — nem a luz.';
  if (b.special === 'terra') return 'Era o nosso lar. Os sensores ainda captam o calor do núcleo exposto. Não há nada para nós aqui — só lembranças.';
  if (b.special === 'nova' || s >= 90) return 'É ela. Água líquida, oxigênio, temperatura amena e uma estrela estável. Comandante… encontramos a Nova Terra.';
  if (b.body === 'gas') return 'Um gigante gasoso. Sem superfície sólida — mas suas luas podem valer uma olhada.';
  if (s >= 70) return 'Promissor, mas não perfeito. Seria possível sobreviver aqui com abrigos e muito trabalho. Continuemos procurando — a bioassinatura da Vigia-7 era mais forte que isso.';
  if (s >= 40) return 'Marginal. ' + worstFactor(b) + ' Seria preciso viver em abrigos permanentes.';
  if (b.type === 'lava') return 'Rocha derretida e temperaturas acima de mil graus. Nem pensar.';
  if (b.type === 'venusiano') return 'Um inferno de efeito estufa. A pressão na superfície esmagaria a nave.';
  if (b.type === 'gelo') return 'Gelo por toda parte. Talvez haja oceanos sob a crosta, mas a superfície é letal.';
  return 'Inabitável. ' + worstFactor(b) + ' Seguimos em frente.';
}

// Explica o fator que mais pesa contra a habitabilidade
function worstFactor(b) {
  const f = b.hab.f;
  const [k] = Object.entries(f).filter(([n]) => n !== 'estrela' || f.estrela < 0.6).sort((x, y) => x[1] - y[1])[0];
  const g = b.mass / Math.pow(b.radius / R_EARTH, 2);
  const tC = Math.round(b.temp - 273.15);
  return {
    temp: tC > 15 ? `A temperatura média de ${tC} °C é quente demais para nós.` : `A temperatura média de ${tC} °C é fria demais para nós.`,
    grav: g > 1 ? `A gravidade de ${fmtNum(g, 1)} g esmagaria nossos corpos com o tempo.` : `A gravidade de ${fmtNum(g, 2)} g é fraca demais — ossos e músculos atrofiariam.`,
    press: b.pressure < 0.006 ? 'Praticamente não há atmosfera.' : b.pressure > 1 ? `A pressão de ${fmtNum(b.pressure, 1)} atm é alta demais.` : `A pressão de ${fmtNum(b.pressure, 2)} atm é baixa demais para respirar.`,
    agua: b.temp < 273 ? 'Toda a água está congelada.' : b.temp > 373 ? 'A água evaporou.' : 'Falta água líquida em quantidade útil.',
    oxig: 'Não há oxigênio livre no ar.',
    magnet: 'Sem campo magnético, a radiação da estrela atinge a superfície.',
    estrela: 'A estrela é instável demais para sustentar uma colônia.',
  }[k];
}
