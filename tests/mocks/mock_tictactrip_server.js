const http = require('http');
const { URL } = require('url');

const stopClusters = [
  { id: 'c|FRlyon____@u05kq', name: 'Lyon', city: 'Lyon', country: 'FR', transportTypes: ['train', 'bus'] },
  { id: 'c|FRparis___@u09tv', name: 'Paris', city: 'Paris', country: 'FR', transportTypes: ['train', 'bus'] },
  { id: 'c|BEbruxell@u155h', name: 'Bruxelles', city: 'Bruxelles', country: 'BE', transportTypes: ['train', 'bus'] },
  { id: 'c|PTlisboa__@eyckd', name: 'Lisboa', city: 'Lisboa', country: 'PT', transportTypes: ['train', 'bus'] },
  { id: 'c|PTporto___@eyxjb', name: 'Porto', city: 'Porto', country: 'PT', transportTypes: ['train', 'bus'] },
];

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && u.pathname === '/v2/stopClusters') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stopClusters));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/v2/results') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reqData = JSON.parse(body);
      const trips = {
        't1': {
          id: 't1',
          priceCents: 1420,
          durationMinutes: 73,
          departureLocalISO: '2026-09-19T06:32:00+02:00',
          arrivalLocalISO: '2026-09-19T07:45:00+02:00',
          transportType: 'BUS',
          providers: [{ name: 'Flixbus', transportType: 'bus' }],
          segments: [{ co2g: 669 }],
          direction: 'outboundTrip'
        },
        't2': {
          id: 't2',
          priceCents: 3299,
          durationMinutes: 277,
          departureLocalISO: '2026-09-19T09:00:00+02:00',
          arrivalLocalISO: '2026-09-19T13:37:00+02:00',
          transportType: 'TRAIN',
          providers: [{ name: 'OUIGO', transportType: 'train' }, { name: 'SNCF', transportType: 'train' }],
          segments: [{ co2g: 900 }, { co2g: 800 }],
          direction: 'outboundTrip'
        }
      };
      if (reqData.returnDate) {
        trips['t3'] = {
          id: 't3',
          priceCents: 1550,
          durationMinutes: 80,
          departureLocalISO: '2026-09-20T18:00:00+02:00',
          arrivalLocalISO: '2026-09-20T19:20:00+02:00',
          transportType: 'BUS',
          providers: [{ name: 'Flixbus', transportType: 'bus' }],
          segments: [{ co2g: 700 }],
          direction: 'inboundTrip'
        };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ trips }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3010, () => console.log('mock Tictactrip server on :3010'));
