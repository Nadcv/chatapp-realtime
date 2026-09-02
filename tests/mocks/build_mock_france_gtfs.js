const AdmZip = require('adm-zip');

// O servidor compara os horários GTFS com a hora local de França (Europe/Paris,
// mesma zona horária que Espanha) — por isso formatamos aqui também nesse fuso,
// para o mock ficar coerente com o que o servidor vai calcular como "agora".
function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);
const later = new Date(now.getTime() + 2 * 3600000);
const past = new Date(now.getTime() - 60 * 60000);

const stops = 'stop_id,stop_name,stop_lat,stop_lon\nFR_GARENORD,Paris Gare du Nord,48.880,2.355\nFR_MITRY,Mitry - Claye,48.964,2.610\n';
const routes = 'route_id,route_short_name,route_long_name\nRER_B,B,RER B\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\nFR1,RER_B,SVC_WEEKDAY,Mitry - Claye\nFR2,RER_B,SVC_WEEKDAY,Mitry - Claye\nFR3,RER_B,SVC_WEEKDAY,Mitry - Claye\n';
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC_WEEKDAY,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  `FR1,${fmt(past)},${fmt(past)},FR_GARENORD,1\n` +
  `FR1,23:59:00,23:59:00,FR_MITRY,2\n` +
  `FR2,${fmt(soon)},${fmt(soon)},FR_GARENORD,1\n` +
  `FR2,23:58:00,23:58:00,FR_MITRY,2\n` +
  `FR3,${fmt(later)},${fmt(later)},FR_GARENORD,1\n` +
  `FR3,23:57:00,23:57:00,FR_MITRY,2\n`;

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_france_gtfs.zip');
console.log('mock GTFS (França/Transilien) zip written, soon=' + fmt(soon) + ' later=' + fmt(later) + ' past=' + fmt(past));
