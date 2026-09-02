const AdmZip = require('adm-zip');

function fmt(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);

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

// EMT Valência (autocarros)
buildZip(
  'mock_emt_valencia.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nEVAL1,Plaza del Ayuntamiento,39.470,-0.377\nEVAL2,Estacion del Norte,39.464,-0.378\n',
  'route_id,route_short_name,route_long_name\nL9,9,Linea 9\n',
  'trip_id,route_id,service_id,trip_headsign\nEVT1,L9,SVC,Estacion del Norte\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nEVT1,${fmt(soon)},${fmt(soon)},EVAL1,1\nEVT1,23:59:00,23:59:00,EVAL2,2\n`
);

// Metrovalencia (metro/tram)
buildZip(
  'mock_metro_valencia.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nMVAL1,Xativa,39.466,-0.379\nMVAL2,Colon,39.470,-0.373\n',
  'route_id,route_short_name,route_long_name\nL3,3,Linea 3\n',
  'trip_id,route_id,service_id,trip_headsign\nMVT1,L3,SVC,Colon\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nMVT1,${fmt(soon)},${fmt(soon)},MVAL1,1\nMVT1,23:59:00,23:59:00,MVAL2,2\n`
);

console.log('mock Valencia GTFS zips written, soon=' + fmt(soon));
