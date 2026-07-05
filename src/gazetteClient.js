const BASE_URL = process.env.GAZETTE_API_BASE_URL || "https://api.gazette.gov.mv";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.GAZETTE_CLIENT_ID,
      client_secret: process.env.GAZETTE_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gazette token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  cachedTokenExpiresAt = Date.now() + expiresInMs - 30_000; // refresh 30s early

  return cachedToken;
}

async function gazetteGet(path) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Gazette API request failed (${path}): ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function fetchLatestIulaan() {
  const data = await gazetteGet("/iulaan");
  return data.data ?? data;
}

export async function fetchIulaanDetail(id) {
  const data = await gazetteGet(`/iulaan/${id}`);
  return data.data ?? data;
}
