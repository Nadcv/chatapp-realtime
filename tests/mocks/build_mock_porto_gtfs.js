const AdmZip = require('adm-zip');

function build(agencyName, stopPrefix, outFile) {
  const stops = 'stop_id,stop_name,stop_lat,stop_lon\n' +
    `${stopPrefix}1,Trindade,41.1496,-8.6109\n` +
    `${stopPrefix}2,Bolhao,41.1503,-8.6042\n`;
  const routes = 'route_id,route_short_name,route_long_name\nR1,A,Linha A\n';
  const trips = 'trip_id,route_id,service_id,trip_headsign\nT1,R1,SVC,Estadio do Dragao\n';
  const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC,1,1,1,1,1,1,1,20200101,20301231\n';
  const calendarDates = 'service_id,date,exception_type\n';
  const now = new Date();
  const soon = new Date(now.getTime() + 5 * 60000);
  // O servidor compara os horários GTFS com a hora de Lisboa (nowInTimeZone), não com o
  // fuso do processo — por isso o mock tem de formatar "soon" da mesma forma, ou fica
  // até 1h desalinhado (mesma classe de bug já corrigida para CP/Fertagus/Madrid/etc.).
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
    `T1,${fmt(soon)},${fmt(soon)},${stopPrefix}1,1\n` +
    `T1,23:59:00,23:59:00,${stopPrefix}2,2\n`;
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from(`agency_id,agency_name,agency_url,agency_timezone\n1,${agencyName},https://example.pt,Europe/Lisbon\n`));
  zip.addFile('stops.txt', Buffer.from(stops));
  zip.addFile('routes.txt', Buffer.from(routes));
  zip.addFile('trips.txt', Buffer.from(trips));
  zip.addFile('calendar.txt', Buffer.from(calendar));
  zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
  zip.addFile('stop_times.txt', Buffer.from(stopTimes));
  zip.writeZip(outFile);
  console.log('wrote', outFile, 'soon=' + fmt(soon));
}

build('Metro do Porto', 'MP', __dirname + '/mock_metro_porto.zip');
build('STCP', 'ST', __dirname + '/mock_stcp.zip');
