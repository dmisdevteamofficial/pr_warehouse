let cachedCookie = null
let cachedPasskey = null
let cachedCompanyId = null
let cachedTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

function normalizeCompanyId(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isInteger(parsed) ? parsed : null
}

function isDevMode(env) {
  return Boolean(env.TRCLOUD_COOKIE)
}

function cacheSession(session, timestamp) {
  cachedCookie = session.cookie ?? null
  cachedPasskey = session.passkey ?? null
  cachedCompanyId = session.companyId ?? null
  cachedTimestamp = timestamp
  return session
}

function getEnvSession(env) {
  return {
    cookie: env.TRCLOUD_COOKIE || null,
    passkey: env.VITE_TRCLOUD_PASSKEY || null,
    companyId: normalizeCompanyId(env.VITE_TRCLOUD_COMPANY_ID)
  }
}

async function getLatestSession(env) {
  const now = Date.now()
  if (cachedTimestamp && now - cachedTimestamp < CACHE_TTL_MS) {
    return {
      cookie: cachedCookie,
      passkey: cachedPasskey,
      companyId: cachedCompanyId
    }
  }

  if (isDevMode(env)) {
    return cacheSession(getEnvSession(env), now)
  }

  const url = `${env.SUPABASE_URL}/rest/v1/trcloud_session?is_active=eq.true&order=updated_at.desc&limit=1&select=cookie_value,passkey,company_id`
  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
    }
  })

  const body = await res.text()

  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${body} | URL used: ${url.substring(0, 80)}`)
  }

  const data = JSON.parse(body)

  if (!data || data.length === 0) {
    throw new Error(`No cookie found in trcloud_session table. Response: ${body}`)
  }

  const latestRow = data[0]
  return cacheSession(
    {
      cookie: latestRow.cookie_value || null,
      passkey: latestRow.passkey == null ? (env.VITE_TRCLOUD_PASSKEY || null) : latestRow.passkey,
      companyId: latestRow.company_id == null
        ? normalizeCompanyId(env.VITE_TRCLOUD_COMPANY_ID)
        : normalizeCompanyId(latestRow.company_id)
    },
    now
  )
}

function clearCache() {
  cachedCookie = null
  cachedPasskey = null
  cachedCompanyId = null
  cachedTimestamp = 0
}

function injectSessionIntoObject(payload, session) {
  if (!payload || typeof payload !== 'object') {
    return payload
  }

  payload.passkey = session.passkey

  if (session.companyId === null || session.companyId === undefined) {
    delete payload.company_id
  } else {
    payload.company_id = session.companyId
  }

  return payload
}

function injectSessionIntoSearchParams(params, session) {
  if (session.passkey === null || session.passkey === undefined) {
    params.delete('passkey')
  } else {
    params.set('passkey', session.passkey)
  }

  if (session.companyId === null || session.companyId === undefined) {
    params.delete('company_id')
  } else {
    params.set('company_id', String(session.companyId))
  }
}

async function buildForwardBody(request, session) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return null
  }

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text())
    const rawJson = params.get('json')

    if (rawJson) {
      try {
        const parsedJson = JSON.parse(rawJson)
        injectSessionIntoObject(parsedJson, session)
        params.set('json', JSON.stringify(parsedJson))
      } catch (error) {
        console.log('Failed to update form json payload:', error)
      }
    }

    injectSessionIntoSearchParams(params, session)
    return params.toString()
  }

  if (contentType.includes('application/json')) {
    const text = await request.text()
    if (!text) {
      return text
    }

    try {
      return JSON.stringify(injectSessionIntoObject(JSON.parse(text), session))
    } catch (error) {
      console.log('Failed to update JSON payload:', error)
      return text
    }
  }

  return await request.arrayBuffer()
}

async function forwardRequest(env, request, pathStr, session) {
  const trcloudBaseUrl = env.TRCLOUD_BASE_URL
  const url = new URL(request.url)
  const targetURL = `${trcloudBaseUrl}/${pathStr}${url.search}`

  console.log('path received:', pathStr)
  console.log('targetURL:', targetURL)

  const newHeaders = new Headers(request.headers)
  newHeaders.set('Origin', new URL(trcloudBaseUrl).origin)
  newHeaders.set('Referer', `${trcloudBaseUrl}/`)
  newHeaders.set('X-Requested-With', 'XMLHttpRequest')
  newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  newHeaders.delete('Content-Length')

  if (session.cookie) {
    newHeaders.set('Cookie', session.cookie)
  }

  const requestBody = await buildForwardBody(request, session)

  const modifiedRequest = new Request(targetURL, {
    method: request.method,
    headers: newHeaders,
    body: requestBody,
    redirect: 'follow',
  })

  return fetch(modifiedRequest)
}

export async function onRequest(context) {
  try {
    const { request, env, params } = context

    const missing = []
    if (!env.TRCLOUD_BASE_URL) missing.push('TRCLOUD_BASE_URL')
    if (!isDevMode(env)) {
      if (!env.SUPABASE_URL) missing.push('SUPABASE_URL')
      if (!env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY')
    }
    if (missing.length > 0) {
      return Response.json(
        {
          error: 'Missing env vars',
          missing
        },
        {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const pathSegments = params.path
    const pathStr = Array.isArray(pathSegments)
      ? pathSegments.join('/')
      : (pathSegments || '')

    let session = await getLatestSession(env)
    let response = await forwardRequest(env, request, pathStr, session)

    if (response.ok) {
      const text = await response.text()
      if (text.includes('mismatched')) {
        clearCache()
        session = await getLatestSession(env)
        response = await forwardRequest(env, request, pathStr, session)
      } else {
        const newResponse = new Response(text, response)
        newResponse.headers.set('Access-Control-Allow-Origin', '*')
        newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type')
        return newResponse
      }
    }

    const newResponse = new Response(response.body, response)
    newResponse.headers.set('Access-Control-Allow-Origin', '*')
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    return newResponse
  } catch (err) {
    return Response.json(
      {
        error: err.message,
        stack: err.stack,
        type: err.constructor.name
      },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
}
