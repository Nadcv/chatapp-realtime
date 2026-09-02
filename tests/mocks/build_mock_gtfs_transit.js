const AdmZip = require('adm-zip');

function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const now = new Date();
const add = (min) => new Date(now.getTime() + min * 60000);

// Estações com coordenadas conhecidas (para verificar a interpolação)
const stops = 'stop_id,stop_name,stop_lat,stop_lon\n' +
  'ST_A,Lisboa Oriente,38.767,-9.099\n' +
  'ST_B,Vila Franca de Xira,38.956,-8.989\n' +
  'ST_C,Porto Campanha,41.149,-8.585\n' +
  'ST_D,Coimbra B,40.181,-8.451\n';

const routes = 'route_id,route_short_name,route_long_name\nR1,AP,Alfa Pendular\n';

// T_TRAVELING: agora está EXATAMENTE a meio caminho entre A (partiu há 10min) e
// B (chega daqui a 10min) — deve dar progresso=0.5 (posição a meio das coordenadas).
// T_DWELLING: agora está parado em B (chegou há 2min, parte daqui a 2min).
// T_NOT_STARTED: só parte daqui a 1h — não deve aparecer.
// T_FINISHED: já chegou ao destino há 1h — não deve aparecer.
const trips = 'trip_id,route_id,service_id,trip_headsign\n' +
  'T_TRAVELING,R1,SVC_ALLDAYS,Porto Campanha\n' +
  'T_DWELLING,R1,SVC_ALLDAYS,Porto Campanha\n' +
  'T_NOT_STARTED,R1,SVC_ALLDAYS,Porto Campanha\n' +
  'T_FINISHED,R1,SVC_ALLDAYS,Porto Campanha\n';

const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'SVC_ALLDAYS,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';

const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  // T_TRAVELING: A (partiu há 10min) -> B (chega daqui a 10min) -> C (chega daqui a 60min)
  `T_TRAVELING,${fmt(add(-10))},${fmt(add(-10))},ST_A,1\n` +
  `T_TRAVELING,${fmt(add(10))},${fmt(add(12))},ST_B,2\n` +
  `T_TRAVELING,${fmt(add(60))},${fmt(add(60))},ST_C,3\n` +
  // T_DWELLING: A (partiu há 30min) -> B (chegou há 2min, parte daqui a 2min = AGORA está parado) -> C (chega daqui a 40min)
  `T_DWELLING,${fmt(add(-30))},${fmt(add(-30))},ST_A,1\n` +
  `T_DWELLING,${fmt(add(-2))},${fmt(add(2))},ST_B,2\n` +
  `T_DWELLING,${fmt(add(40))},${fmt(add(40))},ST_C,3\n` +
  // T_NOT_STARTED: só parte daqui a 60min
  `T_NOT_STARTED,${fmt(add(60))},${fmt(add(60))},ST_A,1\n` +
  `T_NOT_STARTED,${fmt(add(120))},${fmt(add(120))},ST_D,2\n` +
  // T_FINISHED: já chegou há muito tempo
  `T_FINISHED,${fmt(add(-180))},${fmt(add(-180))},ST_A,1\n` +
  `T_FINISHED,${fmt(add(-60))},${fmt(add(-60))},ST_D,2\n`;

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_gtfs_transit.zip');
console.log('mock GTFS (comboios em trânsito) zip escrito, now=' + fmt(now));
