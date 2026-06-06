// ============================================================================
// Mock Supabase client — จำลอง DB ในเครื่อง (localStorage) สำหรับ "ดูตัวอย่างทั้งหมด"
// โดยไม่ต้องยุ่งกับ Supabase จริง เปิดใช้ด้วย env: VITE_USE_MOCK_DB=true
// ข้อมูล TRCloud ยังดึงของจริงผ่าน proxy ได้ตามปกติ (คนละส่วนกับ DB)
// ----------------------------------------------------------------------------
// รองรับ: select/insert/update/upsert/delete + eq/neq/gt/gte/lt/lte/in/is/not/
//          or/match/order/limit/single/maybeSingle  (subset ที่แอปใช้จริง)
// ============================================================================
import bcrypt from 'bcryptjs'

const LS_KEY = 'mwm_mock_db_v1'

function nowIso() {
  return new Date().toISOString()
}

function seed() {
  const adminHash = bcrypt.hashSync('admin', 10)
  const userHash = bcrypt.hashSync('1234', 10)
  return {
    system_users: [
      { id: 1, username: 'admin', password_hash: adminHash, role: 'super_admin', fullname: 'ผู้ดูแลระบบ (เดโม)', emp_code: 'ADMIN', position: 'Super Admin', department: 'IT', profile_img: null, created_at: nowIso(), updated_at: nowIso() },
      { id: 2, username: 'store', password_hash: adminHash, role: 'admin_store', fullname: 'แอดมินคลัง (เดโม)', emp_code: 'STORE', position: 'Store Admin', department: 'คลังสินค้า', profile_img: null, created_at: nowIso(), updated_at: nowIso() },
      { id: 3, username: 'user', password_hash: userHash, role: 'user', fullname: 'ผู้ใช้งาน (เดโม)', emp_code: 'USER', position: 'Staff', department: 'จัดซื้อ', profile_img: null, created_at: nowIso(), updated_at: nowIso() },
    ],
    urgents: [
      { id: 1, option_name: 'ปกติ', created_at: nowIso() },
      { id: 2, option_name: 'ด่วน', created_at: nowIso() },
      { id: 3, option_name: 'ด่วนมาก', created_at: nowIso() },
    ],
    employees: [
      { id: 1, department: 'จัดซื้อ' },
      { id: 2, department: 'คลังสินค้า' },
      { id: 3, department: 'โครงการเซโปน-แท่งคำและนาลู' },
      { id: 4, department: 'ซ่อมบำรุง' },
    ],
    ap_requests: [],
    exp_requests: [],
    user_logs: [],
    trcloud_tracking: [],
    notifications: [],
    items: [],
    order_req: [],
    transactions: [],
    inventory_imports: [],
    category: [],
    inspections: [],
    inspection_items: [],
    purchasing_team: [],
    purchasing_req: [],
    purchasing_order: [],
    purchase_status: [],
    pre_job_status: [],
    store: [],
    po_items_sync: [],
    trcloud_session: [],
  }
}

function loadDb() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  const fresh = seed()
  saveDb(fresh)
  return fresh
}

function saveDb(db) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db))
  } catch (err) {
    console.warn('mock db save failed:', err?.message || err)
  }
}

let DB = loadDb()

export function resetMockDb() {
  DB = seed()
  saveDb(DB)
}

function tableRows(name) {
  if (!DB[name]) DB[name] = []
  return DB[name]
}

function nextId(name) {
  const rows = tableRows(name)
  let max = 0
  for (const r of rows) {
    const n = Number(r?.id)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

function valEq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined
  return String(a) === String(b)
}

function applyOp(row, col, op, val) {
  const cur = row[col]
  switch (op) {
    case 'eq': return valEq(cur, val)
    case 'neq': return !valEq(cur, val)
    case 'gt': return cur != null && cur > val
    case 'gte': return cur != null && cur >= val
    case 'lt': return cur != null && cur < val
    case 'lte': return cur != null && cur <= val
    case 'is':
      if (val === null || val === 'null') return cur === null || cur === undefined
      if (val === true || val === 'true') return cur === true
      if (val === false || val === 'false') return cur === false
      return valEq(cur, val)
    case 'in': return Array.isArray(val) && val.some((v) => valEq(cur, v))
    case 'like':
    case 'ilike': {
      const pat = String(val).replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pat}$`, op === 'ilike' ? 'i' : '').test(String(cur ?? ''))
    }
    default: return true
  }
}

function parseOrTerm(term) {
  // "col.op.val"
  const [col, op, ...rest] = term.split('.')
  let val = rest.join('.')
  if (val === 'null') val = null
  return { col, op, val }
}

class MockQuery {
  constructor(table) {
    this.table = table
    this.op = null // select | insert | update | upsert | delete
    this.payload = null
    this.conflictCol = null
    this.filters = [] // array of (row) => bool
    this._order = null
    this._limit = null
    this._single = null // 'single' | 'maybe'
  }

  select() { if (!this.op) this.op = 'select'; return this }
  insert(payload) { this.op = 'insert'; this.payload = payload; return this }
  upsert(payload, opts = {}) { this.op = 'upsert'; this.payload = payload; this.conflictCol = opts.onConflict || null; return this }
  update(payload) { this.op = 'update'; this.payload = payload; return this }
  delete() { this.op = 'delete'; return this }

  eq(col, val) { this.filters.push((r) => applyOp(r, col, 'eq', val)); return this }
  neq(col, val) { this.filters.push((r) => applyOp(r, col, 'neq', val)); return this }
  gt(col, val) { this.filters.push((r) => applyOp(r, col, 'gt', val)); return this }
  gte(col, val) { this.filters.push((r) => applyOp(r, col, 'gte', val)); return this }
  lt(col, val) { this.filters.push((r) => applyOp(r, col, 'lt', val)); return this }
  lte(col, val) { this.filters.push((r) => applyOp(r, col, 'lte', val)); return this }
  in(col, vals) { this.filters.push((r) => applyOp(r, col, 'in', vals)); return this }
  is(col, val) { this.filters.push((r) => applyOp(r, col, 'is', val)); return this }
  like(col, val) { this.filters.push((r) => applyOp(r, col, 'like', val)); return this }
  ilike(col, val) { this.filters.push((r) => applyOp(r, col, 'ilike', val)); return this }
  not(col, op, val) { this.filters.push((r) => !applyOp(r, col, op, val)); return this }
  match(obj) { for (const [k, v] of Object.entries(obj || {})) this.filters.push((r) => applyOp(r, k, 'eq', v)); return this }
  or(str) {
    const terms = String(str || '').split(',').map(parseOrTerm)
    this.filters.push((r) => terms.some((t) => applyOp(r, t.col, t.op, t.val)))
    return this
  }
  order(col, opts = {}) { this._order = { col, ascending: opts.ascending !== false }; return this }
  limit(n) { this._limit = n; return this }
  single() { this._single = 'single'; return this }
  maybeSingle() { this._single = 'maybe'; return this }

  _matchRows() {
    return tableRows(this.table).filter((r) => this.filters.every((f) => f(r)))
  }

  _run() {
    const name = this.table
    let result = []

    if (this.op === 'insert' || this.op === 'upsert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload]
      const rows = tableRows(name)
      for (const item of items) {
        const clone = { ...item }
        if (this.op === 'upsert' && this.conflictCol && clone[this.conflictCol] != null) {
          const idx = rows.findIndex((r) => valEq(r[this.conflictCol], clone[this.conflictCol]))
          if (idx !== -1) {
            rows[idx] = { ...rows[idx], ...clone, id: rows[idx].id }
            result.push(rows[idx])
            continue
          }
        }
        if (clone.id == null) clone.id = nextId(name)
        if (clone.created_at == null) clone.created_at = nowIso()
        rows.push(clone)
        result.push(clone)
      }
      saveDb(DB)
    } else if (this.op === 'update') {
      const matched = this._matchRows()
      for (const r of matched) Object.assign(r, this.payload)
      saveDb(DB)
      result = matched
    } else if (this.op === 'delete') {
      const matched = this._matchRows()
      const ids = new Set(matched)
      DB[name] = tableRows(name).filter((r) => !ids.has(r))
      saveDb(DB)
      result = matched
    } else {
      // select
      result = this._matchRows()
      if (this._order) {
        const { col, ascending } = this._order
        result = [...result].sort((a, b) => {
          const av = a[col], bv = b[col]
          if (av == null && bv == null) return 0
          if (av == null) return ascending ? -1 : 1
          if (bv == null) return ascending ? 1 : -1
          if (av < bv) return ascending ? -1 : 1
          if (av > bv) return ascending ? 1 : -1
          return 0
        })
      }
      if (this._limit != null) result = result.slice(0, this._limit)
    }

    // deep copy ผลลัพธ์เพื่อไม่ให้แก้กระทบ DB ภายในโดยตรง
    const data = result.map((r) => ({ ...r }))

    if (this._single === 'single') {
      if (data.length === 1) return { data: data[0], error: null }
      return { data: null, error: { code: 'PGRST116', message: 'Results contain 0 or multiple rows' } }
    }
    if (this._single === 'maybe') {
      if (data.length === 0) return { data: null, error: null }
      if (data.length === 1) return { data: data[0], error: null }
      return { data: null, error: { code: 'PGRST116', message: 'Multiple rows' } }
    }
    return { data, error: null }
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve().then(() => {
      try {
        return this._run()
      } catch (err) {
        return { data: null, error: { message: String(err?.message || err) } }
      }
    }).then(onFulfilled, onRejected)
  }
}

function createMockClient() {
  return {
    from(table) {
      return new MockQuery(table)
    },
    // stub auth/storage เผื่อมีการเรียก (แอปนี้ใช้ from() เป็นหลัก)
    auth: {
      async getUser() { return { data: { user: null }, error: null } },
      async signOut() { return { error: null } },
    },
    storage: {
      from() {
        return {
          async upload() { return { data: null, error: { message: 'storage ไม่รองรับในโหมด mock' } } },
          getPublicUrl(path) { return { data: { publicUrl: path } } },
        }
      },
    },
  }
}

export const mockSupabase = createMockClient()
export const mockSupabaseEmployee = mockSupabase
