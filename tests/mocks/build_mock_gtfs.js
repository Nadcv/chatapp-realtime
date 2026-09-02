const AdmZip = require('adm-zip');

// O servidor compara os horários GTFS com a hora de Lisboa (não com o fuso do
// processo) — por isso formatamos aqui também em hora de Lisboa, para o mock
// ficar coerente com o que o servidor vai calcular como "agora".
function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);
const later = new Date(now.getTime() + 2 * 3600000);
const past = new Date(now.getTime() - 60 * 60000);

const stops = 'stop_id,stop_name,stop_lat,stop_lon\nST_LISBOA,Lisboa Oriente,38.767,-9.099\nST_PORTO,Porto Campanha,41.149,-8.585\n';
const routes = 'route_id,route_short_name,route_long_name\nR1,AP,Alfa Pendular\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\nT1,R1,SVC_WEEKDAY,Porto Campanha\nT2,R1,SVC_WEEKDAY,Lisboa Oriente\nT3,R1,SVC_WEEKDAY,Porto Campanha\n';
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC_WEEKDAY,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  `T1,${fmt(past)},${fmt(past)},ST_LISBOA,1\n` +
  `T1,23:59:00,23:59:00,ST_PORTO,2\n` +
  `T2,${fmt(soon)},${fmt(soon)},ST_LISBOA,1\n` +
  `T2,23:58:00,23:58:00,ST_PORTO,2\n` +
  `T3,${fmt(later)},${fmt(later)},ST_LISBOA,1\n` +
  `T3,23:57:00,23:57:00,ST_PORTO,2\n`;

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_gtfs.zip');
console.log('mock GTFS zip written, soon=' + fmt(soon) + ' later=' + fmt(later) + ' past=' + fmt(past));
