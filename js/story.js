// Roteiro: introdução, rádio da frota, registro da Tupã e epílogo. Os gatilhos ficam em S.flags (salvos).
import { fmtNum } from './util.js';

export const INTRO = [
  'Ano 2194.',
  'Às 03h12, os telescópios de Marte registraram um objeto entrando no Sistema Solar a 2% da velocidade da luz.',
  'Perto de Júpiter, ele freou.',
  'Nenhuma rocha faz isso.',
  'Foi assim que a humanidade descobriu que não estava sozinha — trinta e uma horas antes do fim.',
  'O objeto, chamado de Érebo, atingiu a Terra. Nove naves conseguiram partir: a Frota da Diáspora.',
  'Cada uma conduzida por uma inteligência artificial. A sua se chama LUMEN.',
  'Nos últimos minutos, a sonda Vigia-7 enviou um sinal de muito longe: oxigênio, água, clorofila. Um mundo vivo.',
  'A ordem da frota é uma só: reagrupar no sinal.',
  'Mas, antes do impacto, algo saiu de dentro do Érebo.',
  'E está nos seguindo.',
];

export const TUPA_LOG = [
  ['Dia 6', 'Algo nos segue desde o Sistema Solar. Não aparece no radar até estar perto. Se desloca a milhares de vezes a velocidade da luz, sem motor de dobra.'],
  ['Dia 9', 'Elas reagem ao rádio. Toda vez que falamos com a frota, uma delas aparece mais perto. A tripulação começou a chamá-las de Sombras.'],
  ['Dia 11', 'São as mesmas formas que saíram do Érebo antes do impacto. Não acho que sejam naves. Acho que são partes dele.'],
  ['Dia 11, 23h40', 'Três Sombras. Tentei saltar, não deu tempo. Se alguém ler isto: SALTE assim que vir uma. Ou pouse e desligue tudo — elas enxergam o calor do motor.'],
  ['Anexo', 'Dados parciais de triangulação do sinal da Vigia-7. Que sirvam a alguém.'],
];

export const EPILOGUE = [
  ['???', 'VOCÊS VIERAM.'],
  ['???', 'O OUTRO MUNDO ESTAVA MORRENDO. VOCÊS O MATAVAM.'],
  ['???', 'ESTE AINDA ESTÁ VIVO. NÓS O GUARDAMOS POR QUATRO BILHÕES DE ANOS.'],
  ['???', 'FIQUEM. MAS LEMBREM: ESTAMOS OLHANDO.'],
  ['LUMEN', 'Comandante… as Sombras estão indo embora. Todas.'],
  ['ATLAS', 'Aqui é a Esperança. A Aurora acabou de sair do salto: quarenta mil pessoas dormindo. Vamos acordá-las em casa.'],
];

// ctx: { S, galaxy, fleet, say(speaker, text, opts), shipGal, inSystem(star) }
export function storyTick(ctx, dt) {
  const { S, galaxy, fleet, say } = ctx;
  const f = S.flags;
  const T = S.stats.time;
  const once = (flag, fn) => { if (!f[flag]) { f[flag] = true; fn(); } };
  // chamada da frota logo após a partida
  if (T > 20) once('radioRoll', () => {
    say('ATLAS', 'Frota da Diáspora, aqui é ATLAS, da Esperança. Chamada: Iara, Tupã, Aurora, Valquíria… todos responderam. Ponto de encontro: o sinal da Vigia-7.');
    say('ATLAS', 'Usem o rádio só o necessário. Não sabemos o que mais saiu do Érebo.');
    say('LUMEN', 'Comandante, as outras naves aparecem no mapa galáctico [M]. Vamos seguir para o sinal.');
  });
  // pedido de socorro da Iara depois do primeiro salto
  if (f.firstJump) once('iaraCalled', () => {
    const name = galaxy.name(fleet.iaraStar);
    say('MAÍRA', `Qualquer nave da frota… aqui é MAÍRA, da Iara. O motor de salto queimou na partida. Estamos à deriva em ${name}. Quatro pessoas a bordo. Por favor.`, { prio: true });
    say('LUMEN', `${name} fica quase no nosso caminho. Pressione [T] para marcá-la como destino. Podemos ajudá-los.`);
  });
  if (f.iaraCalled && !f.iaraSaved && ctx.inSystem(fleet.iaraStar)) once('iaraSeen', () => {
    say('MAÍRA', 'Estou vendo vocês! Aproximem-se — preciso de energia para religar o núcleo. Fiquem a menos de 30 km.');
  });
  // depois do resgate, a Tupã some
  if (f.iaraSaved) {
    f.tSaved = f.tSaved ?? T;
    if (T - f.tSaved > 50) once('tupaLost', () => {
      say('ARANDU', '…Tupã… contato a bombordo… não é uma rocha… elas vêm pelo rádio, desliguem o r—', { prio: true, glitch: true });
      say('LUMEN', `A Tupã parou de transmitir em ${galaxy.name(fleet.tupaStar)}. Ela levava as sementes e os arquivos genéticos da Terra. Precisamos saber o que houve.`);
    });
  }
  if (f.tupaLost && !f.tupaLog && ctx.inSystem(fleet.tupaStar)) once('tupaSeen', () => {
    say('LUMEN', 'Destroços. É a Tupã… o casco foi cortado de ponta a ponta. Aproxime-se: vou tentar ler o registro de bordo.');
  });
  // a Valquíria vai caçar as Sombras
  if (f.tupaLog) {
    f.tLog = f.tLog ?? T;
    if (T - f.tLog > 110) once('valq1', () => {
      say('HELA', 'ATLAS, aqui é HELA. A Valquíria vai atrás delas. Alguém precisa entender o que são.');
      say('ATLAS', 'Negativo, Valquíria. Mantenha silêncio de rádio. Repito: negativo.');
    });
    if (T - f.tLog > 260) once('valq2', () => {
      say('HELA', 'Elas não são naves… é um enxame… estão se reunindo em volta do sinal… são rápidas dem—', { prio: true, glitch: true });
      say('LUMEN', 'Perdemos a Valquíria.');
    });
  }
  if (f.bioEnter) once('atlasZone', () => {
    say('ATLAS', 'Aqui é a Esperança, na zona do sinal. Comandante… há três Sombras paradas em volta de uma estrela. Não se mexem. Acho que estão guardando alguma coisa.');
  });
  if (ctx.inSystem(galaxy.novaTerra)) once('novaShadows', () => {
    say('LUMEN', 'As três Sombras estão aqui, em órbita do planeta. Não estão nos atacando… estão observando.', { prio: true });
  });
}

export const tupaLogText = () => TUPA_LOG.map(([d, t]) => `${d} — ${t}`).join('\n\n');
export const distTxt = (ly) => `${fmtNum(ly, ly < 10 ? 1 : 0)} anos-luz`;
