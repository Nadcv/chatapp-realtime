// Testa a lógica de cache/renovação do token OAuth2 (copiada de server.js, apontada para
// o mock local em vez de api.metrolisboa.pt, que está inacessível a partir desta sandbox).
const BASE = 'http://localhost:3004';
let metroLisboaAccessToken = null;
let metroLisboaAccessTokenExpiresAt = 0;
async function getMetroLisboaAccessToken() {
  if (metroLisboaAccessToken && Date.now() < metroLisboaAccessTokenExpiresAt) return metroLisboaAccessToken;
  const basicAuth = 'Basic ZmFrZTpmYWtl';
  const resp = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Authorization': basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('sem access_token');
  metroLisboaAccessToken = data.access_token;
  const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
  metroLisboaAccessTokenExpiresAt = Date.now() + Math.max(expiresInMs - 5 * 60000, 60000);
  return metroLisboaAccessToken;
}
async function getStatus() {
  const token = await getMetroLisboaAccessToken();
  const resp = await fetch(`${BASE}/estadoServicoML/1.0.1/estadoLinha/todos`, {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

(async () => {
  const d1 = await getStatus();
  console.log('Primeira chamada devolve os dados corretos (linhas e estados):', d1.resposta.azul === 'Serviço Normal' && d1.resposta.amarela === 'Circulação Perturbada' && d1.resposta.vermelha === 'Serviço Normal' && d1.resposta.verde === 'Serviço Normal');
  const tokenAfterFirst = metroLisboaAccessToken;

  const d2 = await getStatus();
  console.log('Segunda chamada reutiliza o mesmo token em cache (não pede um novo):', metroLisboaAccessToken === tokenAfterFirst);

  // Simula o token ter expirado (força a próxima chamada a pedir um novo)
  metroLisboaAccessTokenExpiresAt = Date.now() - 1;
  const d3 = await getStatus();
  console.log('Depois de expirar, pede e usa mesmo um token novo (dados continuam corretos):', metroLisboaAccessToken !== tokenAfterFirst && d3.resposta.verde === 'Serviço Normal');

  // Simula um Basic auth errado (o mock devolve 401 sem access_token)
  metroLisboaAccessToken = null;
  metroLisboaAccessTokenExpiresAt = 0;
  try {
    const resp = await fetch(`${BASE}/token`, { method: 'POST', headers: { 'Authorization': 'Basic invalido' }, body: 'grant_type=client_credentials' });
    console.log('Basic auth inválido devolve HTTP não-OK (o código trataria isto como erro claro, não crash):', !resp.ok);
  } catch (e) { console.log('Erro inesperado:', e.message); }
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
