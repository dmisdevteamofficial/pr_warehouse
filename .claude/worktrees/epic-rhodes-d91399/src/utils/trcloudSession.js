const STORAGE_KEY = 'mw_trcloud_proxy_cookie'

/**
 * Cookie string สำหรับส่งผ่าน Vite dev proxy (header X-TRCloud-Cookie)
 * ไม่ควรใช้ prefix VITE_ — เก็บใน localStorage ของผู้ใช้เครื่องนั้นเท่านั้น
 */
export function getTrcloudProxyCookie() {
  if (typeof window === 'undefined') return ''
  try {
    return (localStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setTrcloudProxyCookie(raw) {
  if (typeof window === 'undefined') return
  const v = String(raw || '').trim()
  if (v) localStorage.setItem(STORAGE_KEY, v)
  else localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('mw-trcloud-proxy-cookie-changed'))
}

export function clearTrcloudProxyCookie() {
  setTrcloudProxyCookie('')
}

/** Header ที่ proxy อ่านแล้วแปลงเป็น Cookie ไปยัง TRCloud */
export function trcloudProxyExtraHeaders() {
  const c = getTrcloudProxyCookie()
  if (!c) return {}
  return { 'X-TRCloud-Cookie': c }
}
