// Hora GTFS "HH:MM:SS" de uma data, contada a partir da meia-noite do dia de
// HOJE no fuso indicado. Depois da meia-noite dá 24:xx, 25:xx… (como manda o
// GTFS para o serviço do próprio dia), em vez de voltar a 00:xx — senão uma
// partida "daqui a 30 minutos" gerada às 23:50 ficava ANTES de uma de há 10
// minutos e os testes falhavam perto da meia-noite. Horas de ontem ficam 00:00:00.
const REF = new Date(); // o mesmo "agora" para todas as horas de uma corrida

function minutesOfDay(d, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return (p.hour % 24) * 60 + p.minute + p.second / 60;
}
function gtfsTime(d, timeZone) {
  let min = minutesOfDay(REF, timeZone) + (d.getTime() - REF.getTime()) / 60000;
  if (min < 0) min = 0;
  const total = Math.round(min * 60);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}
module.exports = { gtfsTime };
