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

// EMT Madrid (autocarros)
buildZip(
  'mock_emt_madrid.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nEMT1,Plaza de Callao,40.420,-3.705\nEMT2,Atocha,40.406,-3.690\n',
  'route_id,route_short_name,route_long_name\nL27,27,Linea 27\n',
  'trip_id,route_id,service_id,trip_headsign\nET1,L27,SVC,Atocha\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nET1,${fmt(soon)},${fmt(soon)},EMT1,1\nET1,23:59:00,23:59:00,EMT2,2\n`
);

// Metro de Madrid
buildZip(
  'mock_metro_madrid.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nMM1,Sol,40.417,-3.703\nMM2,Gran Via,40.420,-3.706\n',
  'route_id,route_short_name,route_long_name\nL1,L1,Linea 1\n',
  'trip_id,route_id,service_id,trip_headsign\nMT1,L1,SVC,Gran Via\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nMT1,${fmt(soon)},${fmt(soon)},MM1,1\nMT1,23:59:00,23:59:00,MM2,2\n`
);

// Metro Ligero
buildZip(
  'mock_metro_ligero_madrid.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nML1,Colonia Jardin,40.397,-3.766\nML2,Aravaca,40.462,-3.782\n',
  'route_id,route_short_name,route_long_name\nML,ML1,Metro Ligero 1\n',
  'trip_id,route_id,service_id,trip_headsign\nLT1,ML,SVC,Aravaca\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nLT1,${fmt(soon)},${fmt(soon)},ML1,1\nLT1,23:59:00,23:59:00,ML2,2\n`
);

// Cercanías Madrid
buildZip(
  'mock_cercanias_madrid.zip',
  'stop_id,stop_name,stop_lat,stop_lon\nCM1,Chamartin,40.472,-3.682\nCM2,Atocha Cercanias,40.406,-3.690\n',
  'route_id,route_short_name,route_long_name\nC1,C1,Cercanias C1\n',
  'trip_id,route_id,service_id,trip_headsign\nCT1,C1,SVC,Atocha Cercanias\n',
  `trip_id,arrival_time,departure_time,stop_id,stop_sequence\nCT1,${fmt(soon)},${fmt(soon)},CM1,1\nCT1,23:59:00,23:59:00,CM2,2\n`
);

console.log('mock Madrid GTFS zips written, soon=' + fmt(soon));
