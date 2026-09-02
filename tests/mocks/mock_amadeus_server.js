const http = require('http');
const { URL } = require('url');

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && u.pathname === '/v1/security/oauth2/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'mock-token-123', expires_in: 1800 }));
    return;
  }
  if (u.pathname === '/v1/reference-data/locations') {
    const q = (u.searchParams.get('keyword') || '').toLowerCase();
    const all = [
      { iataCode: 'LIS', name: 'LISBON', address: { cityName: 'Lisboa', countryName: 'Portugal' } },
      { iataCode: 'OPO', name: 'PORTO', address: { cityName: 'Porto', countryName: 'Portugal' } },
      { iataCode: 'MAD', name: 'MADRID', address: { cityName: 'Madrid', countryName: 'Espanha' } },
    ];
    const data = all.filter((a) => a.address.cityName.toLowerCase().includes(q));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data }));
    return;
  }
  if (u.pathname === '/v2/shopping/flight-offers') {
    const origin = u.searchParams.get('originLocationCode');
    const destination = u.searchParams.get('destinationLocationCode');
    const date = u.searchParams.get('departureDate');
    const body = {
      data: [
        {
          price: { total: '89.90', currency: 'EUR' },
          itineraries: [{
            segments: [{ carrierCode: 'TP', departure: { at: `${date}T08:30:00` }, arrival: { at: `${date}T10:00:00` } }]
          }]
        },
        {
          price: { total: '134.50', currency: 'EUR' },
          itineraries: [{
            segments: [
              { carrierCode: 'FR', departure: { at: `${date}T14:00:00` }, arrival: { at: `${date}T16:00:00` } },
              { carrierCode: 'FR', departure: { at: `${date}T17:00:00` }, arrival: { at: `${date}T18:30:00` } }
            ]
          }]
        }
      ],
      dictionaries: { carriers: { TP: 'TAP Air Portugal', FR: 'Ryanair' } }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3009, () => console.log('mock Amadeus server on :3009'));
