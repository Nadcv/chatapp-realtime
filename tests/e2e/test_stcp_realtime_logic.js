// Valida a lógica de parsing de getStcpRealtimeArrivals (copiada de server.js, apontada
// para um mock local em vez de stcp.pt, que está inacessível a partir desta sandbox).
const BASE = 'http://localhost:3007';
async function getStcpRealtimeArrivals(stopId) {
  const resp = await fetch(`${BASE}/api/stops/${encodeURIComponent(stopId)}/realtime`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const arrivals = data.arrivals || [];
  return arrivals.map((a) => ({
    minutes: a.arrival_minutes,
    routeName: a.route_short_name || a.route_long_name || '',
    headsign: a.route_long_name || a.destination || ''
  }));
}

(async () => {
  const arrivals = await getStcpRealtimeArrivals('ST1');
  console.log('Devolve 2 chegadas:', arrivals.length === 2);
  console.log('Primeira usa o nome curto da rota (200):', arrivals[0].routeName === '200');
  console.log('Primeira mostra os minutos corretos (3):', arrivals[0].minutes === 3);
  console.log('Segunda, sem nome curto, usa o nome longo como routeName:', arrivals[1].routeName === 'Circular Centro');
  console.log('Headsign vem do nome longo da rota:', arrivals[0].headsign === 'Boavista - Aliados');
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
