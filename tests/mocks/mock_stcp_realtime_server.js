const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/api/stops/ST1/realtime') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data_source: 'live',
      arrivals: [
        { route_short_name: '200', route_long_name: 'Boavista - Aliados', arrival_minutes: 3, trip_id: 't1' },
        { route_short_name: '', route_long_name: 'Circular Centro', arrival_minutes: 12, trip_id: 't2' }
      ]
    }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3007, () => console.log('mock stcp realtime server on :3007'));
