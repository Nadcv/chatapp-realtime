const AdmZip = require('adm-zip');

function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);
const add = (min) => new Date(now.getTime() + min * 60000);

function buildZip(filename, stopsCsv, routesCsv, tripsCsv, stopTimesCsv) {
  const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC,1,1,1,1,1,1,1,20200101,20301231\n';
  const calendarDates = 'service_id,date,exception_type\n';
  const zip = new AdmZip();
  zip.addFile('stops.txt', Buffer.from(stopsCsv));
  zip.addFile('routes.txt', Buffer.from(routesCsv));
  zip.addFile('trips.txt', Buffer.from(tripsCsv));
  zip.addFile('calendar.txt', Buffer.from(calendar));
  zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
  zip.addFile('stop_times.txt', Buffer.from(stopTimesCsv));
  zip.writeZip(__dirname + '/' + filename);
}

// Renfe Cercanías/Rodalies
// RCT1: partida "daqui a 5min" — para os testes de pesquisa/próximas partidas.
// RCT2: partiu há 5min, chega daqui a 5min (a meio caminho agora) — para
// aparecer em /api/trains/positions-estimated (comboios de Espanha no mapa).
buildZip(
  'mock_renfe_cercanias.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nRC1,Madrid Atocha Cercanias,40.406,-3.690\nRC2,Madrid Chamartin,40.472,-3.682\n',
  'route_id,route_short_name,route_long_name\nC3,C3,Cercanias C3\n',
  'trip_id,route_id,service_id,trip_headsign\nRCT1,C3,SVC,Madrid Chamartin\nRCT2,C3,SVC,Madrid Chamartin\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n` +
  `RCT1,${fmt(soon)},${fmt(soon)},RC1,1\nRCT1,23:59:00,23:59:00,RC2,2\n` +
  `RCT2,${fmt(add(-5))},${fmt(add(-5))},RC1,1\nRCT2,${fmt(add(5))},${fmt(add(7))},RC2,2\n`
);

// Renfe AVE/Larga Distancia (mesmo padrão: RAT1 "daqui a 5min", RAT2 "em trânsito agora")
buildZip(
  'mock_renfe_ave.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nRAVE1,Madrid Puerta de Atocha,40.406,-3.690\nRAVE2,Barcelona Sants,41.379,2.140\n',
  'route_id,route_short_name,route_long_name\nAVE,AVE,AVE Madrid-Barcelona\n',
  'trip_id,route_id,service_id,trip_headsign\nRAT1,AVE,SVC,Barcelona Sants\nRAT2,AVE,SVC,Barcelona Sants\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n` +
  `RAT1,${fmt(soon)},${fmt(soon)},RAVE1,1\nRAT1,23:59:00,23:59:00,RAVE2,2\n` +
  `RAT2,${fmt(add(-5))},${fmt(add(-5))},RAVE1,1\nRAT2,${fmt(add(5))},${fmt(add(7))},RAVE2,2\n`
);

console.log('mock Renfe GTFS zips written, soon=' + fmt(soon));
