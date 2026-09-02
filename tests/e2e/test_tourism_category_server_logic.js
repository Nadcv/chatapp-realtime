// Testa isoladamente a lógica de transformação da resposta do Overpass API
// usada em /api/tourism/category (a API real está bloqueada neste sandbox).

const TOURISM_CATEGORY_FILTERS = {
  praias: [['natural', 'beach']],
  museus: [['tourism', 'museum'], ['tourism', 'gallery']],
  atracoes: [['tourism', 'attraction'], ['tourism', 'viewpoint'], ['tourism', 'theme_park'], ['tourism', 'zoo'], ['tourism', 'aquarium']],
  parques: [['leisure', 'park'], ['place', 'square'], ['landuse', 'recreation_ground']]
};

function buildQuery(filters, lat, lon, radius) {
  const clauses = filters.map(([k, v]) => `node["${k}"="${v}"](around:${radius},${lat},${lon});\n  way["${k}"="${v}"](around:${radius},${lat},${lon});`).join('\n  ');
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout center 40;`;
}
const museumQuery = buildQuery(TOURISM_CATEGORY_FILTERS.museus, 38.7, -9.14, 8000);
console.log('Builds a valid Overpass query with both tag filters for "museus":', museumQuery.includes('tourism"="museum"') && museumQuery.includes('tourism"="gallery"'));
console.log('Query includes both node and way clauses (museums are often mapped as areas):', museumQuery.includes('node["tourism"="museum"]') && museumQuery.includes('way["tourism"="museum"]'));
console.log('Query embeds the given radius and coordinates:', museumQuery.includes('around:8000,38.7,-9.14'));

function shapeCategoryPoints(data) {
  return (data.elements || [])
    .filter((el) => el.tags?.name)
    .map((el) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      const wikiTag = el.tags.wikipedia;
      const wikiTitle = wikiTag ? wikiTag.split(':').slice(1).join(':') || wikiTag : null;
      return { title: el.tags.name, lat: elLat, lon: elLon, wikiTitle };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .slice(0, 40);
}

const fakeOverpassResponse = {
  elements: [
    { type: 'node', id: 1, lat: 38.6979, lon: -9.2065, tags: { name: 'Museu Nacional dos Coches', tourism: 'museum', wikipedia: 'pt:Museu Nacional dos Coches' } },
    { type: 'way', id: 2, center: { lat: 38.7223, lon: -9.1393 }, tags: { name: 'Museu Berardo', tourism: 'museum' } }, // sem tag wikipedia
    { type: 'node', id: 3, tags: { name: 'Sem coordenadas (não deveria aparecer)', tourism: 'museum' } }, // sem lat/lon nem center
    { type: 'node', id: 4, lat: 38.7, lon: -9.15, tags: { tourism: 'museum' } }, // sem nome — deve ser excluído
  ]
};
const points = shapeCategoryPoints(fakeOverpassResponse);
console.log('Shapes exactly the 2 valid named points with coordinates:', points.length === 2);
console.log('Keeps the real name and coordinates for a node result:', points[0].title === 'Museu Nacional dos Coches' && points[0].lat === 38.6979);
console.log('Extracts the Wikipedia title from the OSM "wikipedia" tag (pt:Título -> Título):', points[0].wikiTitle === 'Museu Nacional dos Coches');
console.log('A way result correctly uses its "center" coordinates instead of lat/lon:', points[1].lat === 38.7223 && points[1].lon === -9.1393);
console.log('A point without a "wikipedia" OSM tag gets wikiTitle=null (not a crash):', points[1].wikiTitle === null);
console.log('Excludes an element with no name tag:', !points.some(p => p.title === undefined));
console.log('Excludes an element with no usable coordinates:', !points.some(p => p.title === 'Sem coordenadas (não deveria aparecer)'));

// Título da Wikipédia com dois-pontos dentro do próprio nome (ex.: "Anexo:Lista de..."),
// para garantir que só o PRIMEIRO segmento (o código de língua) é removido.
const wikiWithColon = { elements: [{ type: 'node', id: 9, lat: 1, lon: 1, tags: { name: 'Teste', wikipedia: 'pt:Anexo:Exemplo' } }] };
console.log('A Wikipedia title containing its own colon is preserved correctly:', shapeCategoryPoints(wikiWithColon)[0].wikiTitle === 'Anexo:Exemplo');

const emptyElements = { elements: [] };
console.log('An empty Overpass result shapes to an empty array (not a crash):', shapeCategoryPoints(emptyElements).length === 0);

const malformed = {};
console.log('A malformed/missing elements key shapes to an empty array (not a crash):', shapeCategoryPoints(malformed).length === 0);

console.log('An unknown category is rejected (no filter list exists for it):', TOURISM_CATEGORY_FILTERS['inventado'] === undefined);
