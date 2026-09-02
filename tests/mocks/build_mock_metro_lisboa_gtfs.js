const AdmZip = require('adm-zip');
function fmt(d) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d); }
const now = new Date();
const soon = new Date(now.getTime() + 5 * 60000);

const stops = 'stop_id,stop_name,stop_lat,stop_lon\nML1,Marques de Pombal,38.7255,-9.1500\nML2,Rossio,38.7145,-9.1394\n';
const routes = 'route_id,route_short_name,route_long_name\nAZ,Azul,Linha Azul\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\nT1,AZ,SVC,Reboleira\n';
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  `T1,${fmt(soon)},${fmt(soon)},ML1,1\n` +
  `T1,23:59:00,23:59:00,ML2,2\n`;

const zip = new AdmZip();
zip.addFile('agency.txt', Buffer.from('agency_id,agency_name,agency_url,agency_timezone\n1,Metro de Lisboa,https://www.metrolisboa.pt,Europe/Lisbon\n'));
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_metro_lisboa.zip');
console.log('wrote mock_metro_lisboa.zip, soon=' + fmt(soon));
