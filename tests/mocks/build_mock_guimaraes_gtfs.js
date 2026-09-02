const AdmZip = require('adm-zip');

// Dados sintéticos (não os reais da GUIMABUS) — precisamos de uma partida
// "daqui a uns minutos" garantida, independentemente da hora do dia em que a
// suite corre; um excerto de horário real tem partidas fixas do dia e fica
// vazio a partir de uma certa hora (ex.: já não há autocarros de madrugada),
// o que tornava este teste inerentemente instável. Mantém nomes de paragens
// reais de Guimarães para o teste continuar a ler como "dados a sério".
function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);

const stops = 'stop_id,stop_name,stop_lat,stop_lon\n462,CAMPO DA FEIRA,41.441525,-8.290993\n999,CENTRAL DE CAMIONAGEM,41.439000,-8.294000\n';
const routes = 'route_id,route_short_name,route_long_name\nR003,003,LINHA CIDADE (VIA AZUREM E MADRE DEUS)\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\nGT1,R003,SVC,CENTRAL DE CAMIONAGEM (ALAMEDA)\n';
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  `GT1,${fmt(soon)},${fmt(soon)},462,1\n` +
  'GT1,23:59:00,23:59:00,999,2\n';

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_guimaraes.zip');
console.log('mock Guimarães GTFS zip written, soon=' + fmt(soon));
