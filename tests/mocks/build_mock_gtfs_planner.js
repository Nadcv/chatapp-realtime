const AdmZip = require('adm-zip');

// GTFS separado do usado em test_train_schedules.js (que usa horários
// relativos a "agora" para testar "próximas partidas"). Aqui os horários são
// fixos porque o planeador precisa de uma viagem direta real (duração ~2h50,
// como o Alfa Pendular Lisboa-Porto), válida em qualquer dia da semana.
const stops = 'stop_id,stop_name,stop_lat,stop_lon\nST_LISBOA,Lisboa Oriente,38.767,-9.099\nST_PORTO,Porto Campanha,41.149,-8.585\n';
const routes = 'route_id,route_short_name,route_long_name\nR1,AP,Alfa Pendular\n';
const trips = 'trip_id,route_id,service_id,trip_headsign\nT1,R1,SVC_ALLDAYS,Porto Campanha\n';
const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSVC_ALLDAYS,1,1,1,1,1,1,1,20200101,20301231\n';
const calendarDates = 'service_id,date,exception_type\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  'T1,07:00:00,07:00:00,ST_LISBOA,1\n' +
  'T1,09:50:00,09:50:00,ST_PORTO,2\n';

const zip = new AdmZip();
zip.addFile('stops.txt', Buffer.from(stops));
zip.addFile('routes.txt', Buffer.from(routes));
zip.addFile('trips.txt', Buffer.from(trips));
zip.addFile('calendar.txt', Buffer.from(calendar));
zip.addFile('calendar_dates.txt', Buffer.from(calendarDates));
zip.addFile('stop_times.txt', Buffer.from(stopTimes));
zip.writeZip(__dirname + '/mock_gtfs_planner.zip');
console.log('mock GTFS (planner) zip written: Lisboa Oriente 07:00 -> Porto Campanha 09:50');
