// ============================================================================
// Tracking reconciliation helpers — ใช้ร่วมกันระหว่างฝั่ง AP และ EXP
// ----------------------------------------------------------------------------
// source_key  = "เลขเอกสาร ∥ ชื่อรายการ ∥ qty"  → ตัวตนของบรรทัด (กันซ้ำ/ติดป้าย/รีเฟรช)
// salvage_key = "เลขเอกสาร ∥ ชื่อรายการ"        → ใช้หา "ตัวที่ไม่ถูกตัด" เพื่อย้ายงานมือ
// ============================================================================

export const KEY_SEP = '∥'

// ฟิลด์ที่ "กรอกมือ" — ต้องเก็บไว้เสมอ ห้าม sync ทับ
export const MANUAL_FIELDS = [
  'option_name',     // ความเร่งด่วน
  'date_transfer',   // วันโอน (แผน)
  'qty_received',    // จำนวนรับแล้ว
  'desired_date',    // วันที่ต้องการ
  'remark',          // หมายเหตุ
  'amount_received', // ยอดรับแล้ว
  'amount_balance',  // ยอดคงเหลือ
]

// ฟิลด์ schema ใหม่ (เพิ่มโดย SQL migration) — ใช้แยก payload โหมด fallback
export const TRACKING_SCHEMA_FIELDS = ['source_key', 'is_orphaned', 'orphaned_at']

// ตรวจว่า error เกิดจาก "ยังไม่ได้รัน SQL migration" (คอลัมน์/constraint ยังไม่มี)
export function isMissingTrackingSchema(err) {
  const msg = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '')
  return (
    code === '42703' || // undefined_column
    code === '42P10' || // invalid ON CONFLICT specification
    msg.includes('source_key') ||
    msg.includes('is_orphaned') ||
    msg.includes('on conflict') ||
    msg.includes('no unique or exclusion constraint')
  )
}

// ตัดฟิลด์ schema ใหม่ออกจาก payload (สำหรับ insert/update แบบ legacy)
export function stripTrackingFields(obj) {
  const out = { ...obj }
  for (const f of TRACKING_SCHEMA_FIELDS) delete out[f]
  return out
}

function normPart(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

// แปลง qty ให้เป็นสตริงมาตรฐาน (ตรงกับ to_char ใน SQL backfill)
export function normQty(v) {
  if (v === null || v === undefined || v === '') return ''
  const cleaned = String(v).replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? String(n) : normPart(v)
}

export function buildSourceKey(doc, name, qty) {
  return [normPart(doc), normPart(name), normQty(qty)].join(KEY_SEP)
}

export function buildSalvageKey(doc, name) {
  return [normPart(doc), normPart(name)].join(KEY_SEP)
}

export function isoDateFromAny(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(+d)) return null
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function mapApStatus(status) {
  const s = String(status || '').trim()
  if (s === 'รอชำระ') return 'ยังไม่ชำระ'
  if (s === 'จ่ายครบ') return 'ชำระแล้ว'
  return s
}

// คีย์/ฟิลด์ของบรรทัด TRCloud (apItemRows / expenseItemRows) → คอลัมน์ของ *_requests
export function trcloudItemKeys(row) {
  const doc = row?.doc_number || row?.invoice_number || ''
  return {
    source_key: buildSourceKey(doc, row?.item_name, row?.quantity),
    salvage_key: buildSalvageKey(doc, row?.item_name),
  }
}

// ค่าฝั่ง TRCloud ที่ใช้รีเฟรช (เฉพาะฟิลด์ที่ TRCloud เป็นเจ้าของ)
export function trcloudOwnedValues(row, { includeStatus = false } = {}) {
  const out = {
    supplier_name: normPart(row?.organization) || null,
    po_id: normPart(row?.ref_po) || null,
    po_date: isoDateFromAny(row?.issue_date),
    po_created_by: normPart(row?.staff) || null,
    currency_name: String(row?.currency || 'LAK').toUpperCase(),
  }
  const rawPrice = row?.item_total ?? row?.total ?? row?.price
  const price = Number(String(rawPrice ?? '').replace(/,/g, ''))
  out.total_price = Number.isFinite(price) ? price : null
  if (includeStatus) out.ap_status = mapApStatus(row?.status)
  return out
}

// สร้าง patch สำหรับ refresh: เอาเฉพาะฟิลด์ TRCloud ที่ "มีค่า" และ "ต่างจากเดิม"
export function buildRefreshPatch(dbRow, trcloudRow, opts = {}) {
  const owned = trcloudOwnedValues(trcloudRow, opts)
  const patch = {}
  for (const [k, v] of Object.entries(owned)) {
    if (v === null || v === '' || v === undefined) continue // ไม่ลบค่าเดิมด้วยค่าว่าง
    const cur = dbRow?.[k]
    const same =
      (typeof v === 'number' && Number(cur) === v) ||
      String(cur ?? '') === String(v ?? '')
    if (!same) patch[k] = v
  }
  return patch
}

export function hasManualData(row) {
  return MANUAL_FIELDS.some((f) => {
    const v = row?.[f]
    return v !== null && v !== undefined && String(v).trim() !== ''
  })
}

// เก็บเฉพาะฟิลด์งานมือ "ที่มีค่า" จากบรรทัดต้นทาง
export function pickManualData(row) {
  const out = {}
  for (const f of MANUAL_FIELDS) {
    const v = row?.[f]
    if (v !== null && v !== undefined && String(v).trim() !== '') out[f] = v
  }
  return out
}

// ฟิลด์ปลายทางที่ "ยังว่าง" เท่านั้น จึงรับงานมือที่ย้ายมา (ไม่ทับงานที่ทำไว้แล้ว)
export function manualMigrationPatch(targetRow, manual) {
  const patch = {}
  for (const [k, v] of Object.entries(manual)) {
    const cur = targetRow?.[k]
    const empty = cur === null || cur === undefined || String(cur).trim() === ''
    if (empty) patch[k] = v
  }
  return patch
}

/**
 * เทียบบรรทัด TRCloud (ของจริง) กับแถวใน *_requests แล้วจัดกลุ่มผลลัพธ์
 * @returns { refresh, migrate, cut, orphan, stats }
 *   refresh: [{ row, patch }]            แถวที่ตรง TRCloud → อัปเดตฟิลด์ TRCloud
 *   migrate: [{ from, to, patch }]       แถวหลุด → ย้ายงานมือไปแถวที่ยังอยู่ แล้วตัด from
 *   cut:     [row]                       แถวหลุด ไม่มีงานมือ (หรือย้ายแล้ว) → ตัดได้
 *   orphan:  [row]                       แถวหลุด มีงานมือ หาปลายทางไม่ได้ → ติดธง ไม่ลบ
 */
export function reconcile(trcloudItemRows, dbRows, opts = {}) {
  const tcByKey = new Map()
  for (const it of trcloudItemRows || []) {
    const { source_key } = trcloudItemKeys(it)
    if (source_key && !tcByKey.has(source_key)) tcByKey.set(source_key, it)
  }

  const active = (dbRows || []).filter((r) => !r.is_orphaned)

  // index แถว DB ที่ "ยังตรง TRCloud" ตาม salvage_key → ใช้เป็นปลายทางย้ายงานมือ
  const validBySalvage = new Map()
  for (const r of active) {
    if (!r.source_key || !tcByKey.has(r.source_key)) continue
    const salvage = salvageOfDbRow(r)
    if (!validBySalvage.has(salvage)) validBySalvage.set(salvage, [])
    validBySalvage.get(salvage).push(r)
  }

  const refresh = []
  const migrate = []
  const cut = []
  const orphan = []

  for (const r of active) {
    const tc = r.source_key ? tcByKey.get(r.source_key) : null
    if (tc) {
      const patch = buildRefreshPatch(r, tc, opts)
      if (Object.keys(patch).length) refresh.push({ row: r, patch })
      continue
    }

    // แถวหลุดจาก TRCloud
    const salvage = salvageOfDbRow(r)
    const targets = (validBySalvage.get(salvage) || []).filter((t) => t.id !== r.id)
    const manual = pickManualData(r)

    if (Object.keys(manual).length === 0) {
      cut.push(r) // ไม่มีงานมือ → ตัดได้เลย
      continue
    }

    const target = targets[0]
    if (target) {
      const patch = manualMigrationPatch(target, manual)
      migrate.push({ from: r, to: target, patch })
      cut.push(r)
    } else {
      orphan.push(r) // มีงานมือแต่ไม่มีปลายทาง → ติดธง ไม่ลบ
    }
  }

  return {
    refresh,
    migrate,
    cut,
    orphan,
    stats: {
      refresh: refresh.length,
      migrate: migrate.length,
      cut: cut.length,
      orphan: orphan.length,
    },
  }
}

// salvage_key ของแถว DB: เอกสารอาจเก็บใน ap_number หรือ po_id
function salvageOfDbRow(r) {
  const doc = (r.ap_number && String(r.ap_number).trim()) || (r.po_id && String(r.po_id).trim()) || ''
  return buildSalvageKey(doc, r.item_ref)
}
