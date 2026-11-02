// Missão guia: uma sequência de objetivos derivada do estado do jogo (S.flags), sem estado próprio.
// Cada passo diz o que fazer, quais teclas usar e — quando faz sentido — onde fica o ponto de navegação.
import { KM_PER_LY, fmtNum } from './util.js';

// ctx: { S, galaxy, fleet, shipGal (Vector3), novaPlanetId }
export function missionStatus(ctx) {
  const { S, galaxy, fleet } = ctx;
  const f = S.flags;
  const g = ctx.shipGal;
  const nova = galaxy.novaTerra;
  const bz = galaxy.bioZone;
  const signal = { kind: 'gal', p: bz, label: 'SINAL VIGIA-7' };
  const here = (star) => S.sysIndex === star;
  const steps = [
    {
      done: f.scannedTerra,
      title: 'O que restou',
      text: 'Escaneie os destroços da Terra.',
      keys: [['F', 'Escanear']],
      wp: here(0) ? { kind: 'body', id: '0:Terra', label: 'TERRA' } : null,
    },
    {
      done: f.mapOpened,
      title: 'A frota',
      text: 'Abra o mapa galáctico: veja o sinal da Vigia-7 e onde está a frota.',
      keys: [['M', 'Mapa galáctico']],
      wp: signal,
    },
    {
      done: f.targetStar,
      title: 'Rota',
      text: 'Escolha uma estrela na direção do sinal.',
      keys: [['T', 'Destino sugerido'], ['M', 'Escolher no mapa']],
      wp: signal,
    },
    {
      done: f.firstJump,
      title: 'Salto',
      text: 'Salte para a estrela escolhida.',
      keys: [['J', 'Saltar']],
      wp: null,
    },
    {
      done: f.iaraSaved,
      title: 'Pedido de socorro',
      text: f.iaraCalled ? `A Iara está à deriva em ${galaxy.name(fleet.iaraStar)}. Chegue a menos de 30 km dela.` : 'Siga rumo ao sinal.',
      keys: here(fleet.iaraStar) ? [['G', 'Voar até a Iara'], ['R', 'Segurar: transferir energia']] : [['T', 'Marcar destino'], ['J', 'Saltar']],
      wp: !f.iaraCalled ? signal : here(fleet.iaraStar) ? { kind: 'fleet', id: 'iara', label: 'IARA · SOCORRO' } : { kind: 'star', index: fleet.iaraStar, label: 'IARA · SOCORRO' },
    },
    {
      done: f.tupaLog,
      title: f.tupaLost ? 'Silêncio' : 'Rumo ao sinal',
      text: f.tupaLost ? `A Tupã parou de transmitir em ${galaxy.name(fleet.tupaStar)}. Descubra o que aconteceu.` : 'A Iara está a salvo. Continue na direção do sinal.',
      keys: !f.tupaLost ? [['T', 'Destino sugerido'], ['J', 'Saltar']] : here(fleet.tupaStar) ? [['G', 'Voar até os destroços'], ['R', 'Ler o registro']] : [['T', 'Marcar destino'], ['J', 'Saltar']],
      wp: !f.tupaLost ? signal : here(fleet.tupaStar) ? { kind: 'fleet', id: 'tupa', label: 'TUPÃ' } : { kind: 'star', index: fleet.tupaStar, label: 'TUPÃ · SEM SINAL' },
    },
    {
      done: f.shadowEscaped,
      title: f.shadowSeen ? 'Sombra' : 'Destroços',
      text: f.shadowSeen ? 'Uma Sombra encontrou vocês. Fuja: salte para qualquer estrela, ou pouse e desligue os motores.' : 'Algo se move entre os destroços da Tupã… Saia daqui.',
      keys: [['J', 'Saltar'], ['P', 'Pousar e se esconder']],
      wp: null,
      danger: true,
    },
    {
      done: f.bioEnter,
      title: 'A zona do sinal',
      text: 'Chegue à zona da bioassinatura.',
      keys: [['T', 'Destino sugerido'], ['J', 'Saltar']],
      wp: signal,
    },
    {
      done: S.visited.has(nova),
      title: 'Triangulação',
      text: f.signalLocked ? `Salte até ${galaxy.name(nova)}, a origem do sinal.` : `LUMEN está triangulando o sinal… ${Math.min(99, Math.round(((f.lockT || 0) / 20) * 100))}%. Continue dentro da zona.`,
      keys: f.signalLocked ? [['T', 'Marcar destino'], ['J', 'Saltar']] : [],
      wp: f.signalLocked ? { kind: 'star', index: nova, label: 'ORIGEM DO SINAL' } : signal,
    },
    {
      done: S.won,
      title: 'Nova Terra',
      text: 'Escaneie o planeta da bioassinatura.',
      keys: [['T', 'Marcar planeta'], ['G', 'Voar até ele'], ['F', 'Escanear']],
      wp: ctx.novaPlanetId && here(nova) ? { kind: 'body', id: ctx.novaPlanetId, label: 'NOVA TERRA' } : { kind: 'star', index: nova, label: 'ORIGEM DO SINAL' },
    },
    {
      done: f.novaWalk,
      title: 'Primeiros passos',
      text: 'Pouse na Nova Terra e pise no novo lar.',
      keys: [['P', 'Pouso automático'], ['E', 'Desembarcar']],
      wp: ctx.novaPlanetId && here(nova) ? { kind: 'body', id: ctx.novaPlanetId, label: 'NOVA TERRA' } : { kind: 'star', index: nova, label: 'NOVA TERRA' },
    },
  ];
  const idx = steps.findIndex((s) => !s.done);
  if (idx < 0) {
    // exploração livre: sugere o buraco negro real mais próximo ainda não visitado
    let best = -1, bd = Infinity;
    for (const i of galaxy.bh.keys()) {
      if (S.visited.has(i)) continue;
      const d = Math.hypot(galaxy.px[i] - g.x, galaxy.py[i] - g.y, galaxy.pz[i] - g.z);
      if (d < bd) { bd = d; best = i; }
    }
    return {
      idx: steps.length, total: steps.length, free: true,
      title: 'Exploração livre',
      text: best >= 0 ? `Extra: visite o buraco negro ${galaxy.name(best)} (${fmtNum(bd, 0)} al).` : 'Você visitou todos os buracos negros conhecidos. O universo é seu.',
      keys: best >= 0 ? [['T', 'Marcar destino'], ['M', 'Catálogo de exoplanetas']] : [['M', 'Mapa']],
      wp: best >= 0 ? { kind: 'star', index: best, label: galaxy.name(best).toUpperCase() } : null,
    };
  }
  return { idx, total: steps.length, ...steps[idx] };
}

// distância em km de um ponto galáctico (al) até a nave
export function galDistKm(p, g) {
  return Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z) * KM_PER_LY;
}
