const AdmZip = require('adm-zip');

function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const now = new Date();
const add = (min) => new Date(now.getTime() + min * 60000);
const soon = add(5);

const stops = 'stop_id,stop_name,stop_lat,stop_lon\nFERT_ROMA,Roma-Areeiro,38.741,-9.131\nFERT_PRAGAL,Pragal,38.679,-9.166\nFERT_SETUBAL,Setúbal,38.524,-8.893\n';
const routes = 'route_id,route_short_name,route_long_name\nFR1,FT,Fertagus\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\n' +
  'FT1,FR1,SVC_WEEKDAY,Setúbal\n' +
  'FT2,FR1,SVC_WEEKDAY,Setúbal\n'; // FT2: em trânsito agora, para testar /api/trains/positions-estimated
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC_WEEKDAY,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  `FT1,${fmt(soon)},${fmt(soon)},FERT_ROMA,1\n` +
  `FT1,23:50:00,23:51:00,FERT_PRAGAL,2\n` +
  `FT1,23:58:00,23:58:00,FERT_SETUBAL,3\n` +
  // FT2: partiu de Roma-Areeiro há 5min, chega a Pragal daqui a 5min (a meio caminho agora)
  `FT2,${fmt(add(-5))},${fmt(add(-5))},FERT_ROMA,1\n` +
  `FT2,${fmt(add(5))},${fmt(add(7))},FERT_PRAGAL,2\n` +
  `FT2,${fmt(add(30))},${fmt(add(30))},FERT_SETUBAL,3\n`;

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_fertagus_gtfs.zip');
console.log('mock Fertagus GTFS zip written, soon=' + fmt(soon));
