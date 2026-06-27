// Loads the Lemma client SDK at runtime (it is served by the pod host, not bundled)
// and exposes a singleton LemmaClient instance.

let clientPromise = null;

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.LemmaClient) return resolve(window.LemmaClient);
    const cfg = window.__LEMMA_CONFIG__ || {};
    const base = (cfg.apiUrl || window.location.origin).replace(/\/$/, "");
    const s = document.createElement("script");
    s.src = base + "/public/sdk/lemma-client.js";
    s.onload = () =>
      window.LemmaClient
        ? resolve(window.LemmaClient)
        : reject(new Error("Lemma SDK loaded but LemmaClient is missing."));
    s.onerror = () => reject(new Error("Couldn't load the Lemma SDK from " + s.src));
    document.head.appendChild(s);
  });
}

// Returns a promise that resolves to an initialized client plus the auth result.
// Call once on boot; subsequent callers reuse the same instance.
export function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const sdk = await loadSdk();
      const client = new sdk.LemmaClient({ timeoutMs: 120000 });
      const auth = await client.initialize();
      return { client, auth };
    })();
  }
  return clientPromise;
}
