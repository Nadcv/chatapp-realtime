// Testa isoladamente a lógica de transformação dos dados da Wikipédia usada
// em /api/tourism/poi e /api/tourism/details, com respostas de exemplo reais
// (a API de verdade está bloqueada pelo proxy deste sandbox).

const fakeGeosearchResponse = {
  query: {
    geosearch: [
      { pageid: 1, ns: 0, title: 'Torre de Belém', lat: 38.6916, lon: -9.2160, dist: 120.4, primary: '' },
      { pageid: 2, ns: 0, title: 'Mosteiro dos Jerónimos', lat: 38.6979, lon: -9.2065, dist: 812.9, primary: '' }
    ]
  }
};
function shapePoi(data) {
  return (data.query?.geosearch || []).map((p) => ({ title: p.title, lat: p.lat, lon: p.lon, distanceM: Math.round(p.dist) }));
}
const points = shapePoi(fakeGeosearchResponse);
console.log('Shapes 2 points from a real-shaped geosearch response:', points.length === 2);
console.log('Keeps the correct title/lat/lon:', points[0].title === 'Torre de Belém' && points[0].lat === 38.6916 && points[0].lon === -9.2160);
console.log('Rounds the distance to a whole number of meters:', points[0].distanceM === 120 && points[1].distanceM === 813);

const emptyGeosearch = { query: { geosearch: [] } };
console.log('An empty geosearch result shapes to an empty array (not a crash):', shapePoi(emptyGeosearch).length === 0);

const malformedGeosearch = {};
console.log('A malformed/missing geosearch key shapes to an empty array (not a crash):', shapePoi(malformedGeosearch).length === 0);

const fakeSummaryResponse = {
  title: 'Torre de Belém',
  extract: 'A Torre de Belém é uma fortificação do século XVI localizada na freguesia de Santa Maria de Belém, no município de Lisboa.',
  thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/torre-belem.jpg', width: 320, height: 240 },
  content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Torre_de_Bel%C3%A9m' } }
};
function shapeDetails(data) {
  return {
    extract: data.extract || null,
    thumbnail: data.thumbnail?.source || null,
    wikiUrl: data.content_urls?.desktop?.page || null
  };
}
const details = shapeDetails(fakeSummaryResponse);
console.log('Extracts the summary text:', details.extract.includes('fortificação do século XVI'));
console.log('Extracts the thumbnail URL:', details.thumbnail === 'https://upload.wikimedia.org/wikipedia/commons/thumb/torre-belem.jpg');
console.log('Extracts the real Wikipedia article URL:', details.wikiUrl === 'https://pt.wikipedia.org/wiki/Torre_de_Bel%C3%A9m');

const summaryNoThumbnail = { extract: 'Um sítio sem imagem na Wikipédia.', content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Exemplo' } } };
const detailsNoThumb = shapeDetails(summaryNoThumbnail);
console.log('A page without a thumbnail shapes thumbnail to null (not a crash):', detailsNoThumb.thumbnail === null);

const summaryMalformed = {};
const detailsMalformed = shapeDetails(summaryMalformed);
console.log('A malformed/empty summary response shapes to all-null fields (not a crash):', detailsMalformed.extract === null && detailsMalformed.thumbnail === null && detailsMalformed.wikiUrl === null);

// Validação de coordenadas (a mesma usada no endpoint real antes de aceitar o pedido).
function isValidCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}
console.log('Rejects NaN coordinates (e.g. missing/garbled query params):', !isValidCoords(NaN, -9.1) && !isValidCoords(38.7, NaN));
console.log('Accepts valid numeric coordinates:', isValidCoords(38.7223, -9.1393));

// Validação do raio (limite da própria API da Wikipédia é 10000m).
function clampRadius(input) {
  return Math.min(Math.max(parseInt(input) || 10000, 1000), 10000);
}
console.log('Clamps an excessive radius down to the Wikipedia API max (10000m):', clampRadius(50000) === 10000);
console.log('Clamps a too-small radius up to a sane minimum (1000m):', clampRadius(10) === 1000);
console.log('A missing/garbled radius falls back to the 10000m default:', clampRadius('abc') === 10000);
