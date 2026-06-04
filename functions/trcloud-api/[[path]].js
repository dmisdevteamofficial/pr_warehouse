let cachedCookie = null;
let cachedPasskey = null;
let cachedCompanyId = null;
let cachedTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeCompanyId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isDevMode(env) {
  return Boolean(env.TRCLOUD_COOKIE);
}

function cacheSession(session, timestamp) {
  cachedCookie = session.cookie ?? null;
  cachedPasskey = session.passkey ?? null;
  cachedCompanyId = session.companyId ?? null;
  cachedTimestamp = timestamp;
  return session;
}

function getEnvSession(env) {
  return {
    cookie: env.TRCLOUD_COOKIE || null,
    passkey: env.VITE_TRCLOUD_PASSKEY || null,
    companyId: normalizeCompanyId(env.VITE_TRCLOUD_COMPANY_ID)
  };
}

async function getLatestSession(env) {
  const now = Date.now();
  if (cachedTimestamp && now - cachedTimestamp < CACHE_TTL_MS) {
    return {
      cookie: cachedCookie,
      passkey: cachedPasskey,
      companyId: cachedCompanyId
    };
  }

  if (isDevMode(env)) {
    return cacheSession(getEnvSession(env), now);
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL_MWM;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY_MWM;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration for TRCloud session lookup.');
  }

  const url = `${supabaseUrl}/rest/v1/trcloud_session?is_active=eq.true&order=updated_at.desc&limit=1&select=cookie_value,passkey,company_id`;
  const res = await fetch(url, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${body}`);
  }

  const data = JSON.parse(body);
  if (!data || data.length === 0) {
    throw new Error(`No TRCloud session found. Response: ${body}`);
  }

  const latestRow = data[0];
  return cacheSession({
    cookie: latestRow.cookie_value || null,
    passkey: latestRow.passkey == null ? (env.VITE_TRCLOUD_PASSKEY || null) : latestRow.passkey,
    companyId: latestRow.company_id == null
      ? normalizeCompanyId(env.VITE_TRCLOUD_COMPANY_ID)
      : normalizeCompanyId(latestRow.company_id)
  }, now);
}

function clearCache() {
  cachedCookie = null;
  cachedPasskey = null;
  cachedCompanyId = null;
  cachedTimestamp = 0;
}

function injectSessionIntoObject(payload, session) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  payload.passkey = session.passkey;
  if (session.companyId === null || session.companyId === undefined) {
    delete payload.company_id;
  } else {
    payload.company_id = session.companyId;
  }

  return payload;
}

function injectSessionIntoSearchParams(params, session) {
  if (session.passkey === null || session.passkey === undefined) {
    params.delete('passkey');
  } else {
    params.set('passkey', session.passkey);
  }

  if (session.companyId === null || session.companyId === undefined) {
    params.delete('company_id');
  } else {
    params.set('company_id', String(session.companyId));
  }
}

async function buildForwardBody(request, session) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return null;
  }

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    const rawJson = params.get('json');

    if (rawJson) {
      try {
        const parsedJson = JSON.parse(rawJson);
        injectSessionIntoObject(parsedJson, session);
        params.set('json', JSON.stringify(parsedJson));
      } catch (err) {
        console.error('Failed to update form json payload:', err);
      }
    }

    injectSessionIntoSearchParams(params, session);
    return params.toString();
  }

  if (contentType.includes('application/json')) {
    const text = await request.text();
    if (!text) {
      return text;
    }

    try {
      return JSON.stringify(injectSessionIntoObject(JSON.parse(text), session));
    } catch (err) {
      console.error('Failed to update JSON payload:', err);
      return text;
    }
  }

  return await request.arrayBuffer();
}

export async function onRequest(context) {
  const { request, params, env } = context;
  const url = new URL(request.url);
  
  const path = params.path ? params.path.join('/') : '';
  const search = url.search;
  const targetUrl = `https://thaidrill.trcloud.co/${path}${search}`;
  
  const newHeaders = new Headers(request.headers);
  newHeaders.set('Origin', 'https://thaidrill.trcloud.co');
  
  const pathLower = path.toLowerCase();
  let referer = 'https://thaidrill.trcloud.co/application/';
  if (pathLower.includes('invoice_list.php')) {
    referer = 'https://thaidrill.trcloud.co/application/expense_report/invoice_list.php';
  } else if (pathLower.includes('invoice_by_supplier.php')) {
    referer = 'https://thaidrill.trcloud.co/application/expense_report/invoice_by_supplier.php';
  } else if (pathLower.includes('/engine-po/') || pathLower.includes('/engine-pr/') || pathLower.includes('/engine-expense/')) {
    referer = 'https://thaidrill.trcloud.co/application/expense/';
  } else if (pathLower.includes('/engine-payment/')) {
    referer = 'https://thaidrill.trcloud.co/application/finance/';
  }
  newHeaders.set('Referer', referer);
  newHeaders.set('X-Requested-With', 'XMLHttpRequest');
  newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  newHeaders.delete('Content-Length');

  const requestCookie = request.headers.get('x-trcloud-cookie');
  newHeaders.delete('x-trcloud-cookie');

  const doFetch = async (session) => {
    const headers = new Headers(newHeaders);
    if (requestCookie || session.cookie) {
      headers.set('Cookie', requestCookie || session.cookie);
    }
    const body = await buildForwardBody(request, session);
    const modReq = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: body,
      redirect: 'follow'
    });
    return fetch(modReq);
  };

  try {
    let session = await getLatestSession(env);
    let response = await doFetch(session);
    
    if (response.ok) {
      const clone = response.clone();
      const text = await clone.text();
      if (text.includes('mismatched') || text.includes('No data is received')) {
        clearCache();
        const freshSession = await getLatestSession(env);
        if ((freshSession.cookie && freshSession.cookie !== session.cookie) || freshSession.passkey !== session.passkey || freshSession.companyId !== session.companyId) {
          session = freshSession;
          response = await doFetch(session);
        }
      }
    }

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
