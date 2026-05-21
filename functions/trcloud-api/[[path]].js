let cachedCookie = null;
let cachedTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getLatestCookie(env) {
  const now = Date.now();
  if (cachedCookie && now - cachedTimestamp < CACHE_TTL_MS) {
    return cachedCookie;
  }

  // ใช้ SUPABASE_URL และ SUPABASE_ANON_KEY จาก Environment ของ Cloudflare
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL_MWM;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY_MWM;

  if (!supabaseUrl || !supabaseKey) {
    // ถ้าไม่มี Supabase config ให้ใช้ TRCLOUD_COOKIE ตรงๆ (ถ้ามี)
    return env.TRCLOUD_COOKIE || null;
  }

  const url = `${supabaseUrl}/rest/v1/trcloud_session?is_active=eq.true&order=updated_at.desc&limit=1&select=cookie_value`;
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        cachedCookie = data[0].cookie_value;
        cachedTimestamp = now;
        return cachedCookie;
      }
    }
  } catch (err) {
    console.error('Fetch Supabase cookie failed:', err);
  }

  return env.TRCLOUD_COOKIE || null;
}

function clearCache() {
  cachedCookie = null;
  cachedTimestamp = 0;
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
  }
  newHeaders.set('Referer', referer);
  newHeaders.set('X-Requested-With', 'XMLHttpRequest');
  newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

  // จัดการเรื่อง Cookie
  let cookie = request.headers.get('x-trcloud-cookie');
  if (!cookie) {
    cookie = await getLatestCookie(env);
  }

  if (cookie) {
    newHeaders.set('Cookie', cookie);
    newHeaders.delete('x-trcloud-cookie');
  }

  const bodyBuffer = request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null;

  const doFetch = async (currentCookie) => {
    const headers = new Headers(newHeaders);
    if (currentCookie) {
      headers.set('Cookie', currentCookie);
    }
    const modReq = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: bodyBuffer,
      redirect: 'follow'
    });
    return fetch(modReq);
  };

  try {
    let response = await doFetch(cookie);
    
    // ถ้าเจอ "mismatched" หรือ "No data" อาจเป็นเพราะ Session หมดอายุ ให้ลองล้าง Cache แล้วดึงใหม่
    if (response.ok) {
      const clone = response.clone();
      const text = await clone.text();
      if (text.includes('mismatched') || text.includes('No data is received')) {
        clearCache();
        const freshCookie = await getLatestCookie(env);
        if (freshCookie && freshCookie !== cookie) {
          response = await doFetch(freshCookie);
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
