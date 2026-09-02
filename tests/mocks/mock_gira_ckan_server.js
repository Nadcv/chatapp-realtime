const http = require('http');
const { URL } = require('url');

// Simula um portal CKAN (como dados.emel.pt): primeiro o package_show devolve
// os metadados do dataset com a lista de recursos, depois o recurso em si
// (aqui GeoJSON) tem os dados das estações. Nomes de campo variados de
// propósito, para testar a normalização defensiva do servidor.
const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-9.1459, 38.7167] },
      properties: { id: 1, name: 'Marquês de Pombal', bikes: 7, docks: 3, capacity: 10 }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-9.1393, 38.7223] },
      // Nomes alternativos comuns em datasets CKAN portugueses
      properties: { station_id: 2, designacao: 'Rossio', available_bikes: 4, empty_slots: 6 }
    },
    {
      type: 'Feature',
      // Sem coordenadas válidas — deve ser ignorada sem derrubar as restantes
      geometry: { type: 'Point', coordinates: [] },
      properties: { id: 3, name: 'Estação com dados inválidos' }
    }
  ]
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/3/action/package_show') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      result: {
        id: 'girastations',
        resources: [
          { id: 'res-1', format: 'GeoJSON', url: 'http://localhost:3014/resource/girastations.geojson' }
        ]
      }
    }));
    return;
  }
  if (u.pathname === '/resource/girastations.geojson') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(geojson));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3014, () => console.log('mock GIRA CKAN server on :3014'));
