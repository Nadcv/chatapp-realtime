const http = require('http');
const { URL } = require('url');

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && u.pathname === '/api/fares/one-way') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { origin, destination, departure_date } = JSON.parse(body);
      const destPrice = destination === 'OPO' ? 89 : 30 + (destination.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 200);
      const result = {
        origin, destination, departure_date,
        itineraries: [
          {
            price: { amount: destPrice, currency: 'EUR', status: 'verified' },
            outbound: {
              carrier: 'TAP Air Portugal',
              duration_minutes: 60,
              segments: [{
                marketing_carrier_code: 'TP', flight_number: '1234',
                operating_carrier_name: 'TAP Air Portugal',
                departure_airport: origin, departure_time_local: `${departure_date}T08:00:00`,
                arrival_airport: destination, arrival_time_local: `${departure_date}T09:00:00`,
                duration_minutes: 60
              }]
            },
            cabin_class: 'economy',
            ignav_id: 'itin_direct_001'
          },
          {
            price: { amount: 45, currency: 'EUR', status: 'verified' },
            outbound: {
              carrier: 'Ryanair',
              duration_minutes: 180,
              segments: [
                { marketing_carrier_code: 'FR', flight_number: '5678', operating_carrier_name: 'Ryanair', departure_airport: origin, departure_time_local: `${departure_date}T10:00:00`, arrival_airport: 'XXX', arrival_time_local: `${departure_date}T11:30:00`, duration_minutes: 90 },
                { marketing_carrier_code: 'FR', flight_number: '5679', operating_carrier_name: 'Ryanair', departure_airport: 'XXX', arrival_time_local: `${departure_date}T13:00:00`, arrival_airport: destination, departure_time_local: `${departure_date}T12:00:00`, duration_minutes: 60 }
              ]
            },
            cabin_class: 'economy',
            ignav_id: 'itin_stop_002'
          }
        ]
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/fares/round-trip') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { origin, destination, departure_date, return_date } = JSON.parse(body);
      const result = {
        itineraries: [
          {
            price: { amount: 150, currency: 'EUR', status: 'verified' },
            outbound: {
              carrier: 'TAP Air Portugal',
              segments: [{ marketing_carrier_code: 'TP', operating_carrier_name: 'TAP Air Portugal', departure_airport: origin, departure_time_local: `${departure_date}T08:00:00`, arrival_airport: destination, arrival_time_local: `${departure_date}T09:00:00` }]
            },
            inbound: {
              carrier: 'TAP Air Portugal',
              segments: [{ marketing_carrier_code: 'TP', operating_carrier_name: 'TAP Air Portugal', departure_airport: destination, departure_time_local: `${return_date}T18:00:00`, arrival_airport: origin, arrival_time_local: `${return_date}T19:00:00` }]
            },
            ignav_id: 'itin_rt_001'
          }
        ]
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/fares/booking-links') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { ignav_id } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        booking_options: [
          { covers: [ignav_id], links: [{ url: `https://example-airline.test/book/${ignav_id}`, provider: 'TAP' }] }
        ]
      }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3011, () => console.log('mock Ignav server on :3011'));
