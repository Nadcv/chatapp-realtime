// Isolated unit test for fetchOverpass()'s mirror-fallback + timeout logic
// (server.js), since overpass-api.de / overpass.kumi.systems are blocked in
// this sandbox and can't be exercised through a real Playwright run.

let transportCache = {};
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OVERPASS_TIMEOUT_MS = 12000;
async function fetchOverpass(key, query, ttlMs) {
  const now = Date.now();
  if (transportCache[key] && (now - transportCache[key].t) < ttlMs) return transportCache[key].data;
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' ao consultar ' + endpoint); continue; }
      const data = await r.json();
      transportCache[key] = { t: now, data };
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass indisponível.');
}

(async () => {
  // 1. Primary endpoint works -> mirror is never called.
  {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ elements: [{ tags: { name: 'A' }, lat: 1, lon: 1 }] }) };
    };
    transportCache = {};
    const data = await fetchOverpass('k1', 'query', 3600000);
    console.log('When primary succeeds, only the primary endpoint is called:', calledUrls.length === 1 && calledUrls[0] === OVERPASS_ENDPOINTS[0]);
    console.log('Returns the primary endpoint\'s data:', data.elements[0].tags.name === 'A');
  }

  // 2. Primary fails (network error) -> falls back to mirror, which succeeds.
  {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      if (url === OVERPASS_ENDPOINTS[0]) throw new Error('network down');
      return { ok: true, json: async () => ({ elements: [{ tags: { name: 'FromMirror' }, lat: 2, lon: 2 }] }) };
    };
    transportCache = {};
    const data = await fetchOverpass('k2', 'query', 3600000);
    console.log('When primary throws, both endpoints are tried in order:', calledUrls.length === 2 && calledUrls[0] === OVERPASS_ENDPOINTS[0] && calledUrls[1] === OVERPASS_ENDPOINTS[1]);
    console.log('Falls back to the mirror\'s data when primary fails:', data.elements[0].tags.name === 'FromMirror');
  }

  // 3. Primary returns non-2xx (e.g. 429 rate-limited) -> falls back to mirror.
  {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      if (url === OVERPASS_ENDPOINTS[0]) return { ok: false, status: 429 };
      return { ok: true, json: async () => ({ elements: [] }) };
    };
    transportCache = {};
    const data = await fetchOverpass('k3', 'query', 3600000);
    console.log('A 429 (rate-limited) from primary falls back to the mirror instead of failing outright:', calledUrls.length === 2 && data.elements.length === 0);
  }

  // 4. Both endpoints fail -> throws a clear error (caught by the route handler as a 502).
  {
    global.fetch = async () => { throw new Error('both down'); };
    transportCache = {};
    let threw = false;
    try { await fetchOverpass('k4', 'query', 3600000); } catch (e) { threw = true; }
    console.log('When both endpoints fail, fetchOverpass throws (caller returns 502, not a hang):', threw);
  }

  // 5. A slow/hanging primary is aborted after the timeout, then falls back to the mirror.
  {
    const originalAbortController = global.AbortController;
    global.fetch = async (url, opts) => {
      if (url === OVERPASS_ENDPOINTS[0]) {
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return { ok: true, json: async () => ({ elements: [{ tags: { name: 'Recovered' } }] }) };
    };
    // Use a tiny timeout for this test instead of the real 12s.
    async function fetchOverpassFastTimeout(key, query, ttlMs) {
      const now = Date.now();
      let lastErr = null;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 100);
        try {
          const r = await fetch(endpoint, { method: 'POST', signal: controller.signal });
          clearTimeout(timeoutId);
          if (!r.ok) { lastErr = new Error('bad status'); continue; }
          return await r.json();
        } catch (err) {
          clearTimeout(timeoutId);
          lastErr = err;
        }
      }
      throw lastErr;
    }
    const data = await fetchOverpassFastTimeout('k5', 'query', 3600000);
    console.log('A hanging primary request is aborted by the timeout and falls back to the mirror:', data.elements[0].tags.name === 'Recovered');
    global.AbortController = originalAbortController;
  }

  // 6. Cache hit avoids calling fetch at all.
  {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({ elements: [] }) }; };
    transportCache = { k6: { t: Date.now(), data: { elements: [{ tags: { name: 'Cached' } }] } } };
    const data = await fetchOverpass('k6', 'query', 3600000);
    console.log('A fresh cache entry is served without calling fetch at all:', !called && data.elements[0].tags.name === 'Cached');
  }
})();
