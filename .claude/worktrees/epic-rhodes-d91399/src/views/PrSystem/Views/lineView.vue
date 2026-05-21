<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(true)
const rows = ref([])
const searchText = ref('')
const viewMode = ref('pay') // pay | slip
const activeRowId = ref(null)
const editableText = ref('')
const messageDirty = ref(false)
const logging = ref(false)
const countsLoading = ref(false)
const statusCounts = ref({ pay: 0, paid: 0 })
// แยก status ตาม view_mode: { pay: { [rowId]: {...} }, slip: { [rowId]: {...} } }
const statusByMode = ref({ pay: {}, slip: {} })
const systemUsersById = ref({})

// ---- formatters ----
function formatThaiDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

function moneyText(amount, currency) {
  const a = formatNumber(amount)
  const c = String(currency || '').trim()
  return c ? `${a} ${c}` : a
}

function urgentDot(optionName) {
  const key = String(optionName || '').trim()
  if (!key) return { bg: '#94a3b8', border: '#cbd5e1' }
  if (key.includes('ด่วนมาก')) return { bg: '#ef4444', border: '#fecaca' }
  if (key.includes('ด่วน')) return { bg: '#f97316', border: '#fed7aa' }
  if (key.includes('ปกติ')) return { bg: '#22c55e', border: '#bbf7d0' }
  return { bg: '#0ea5e9', border: '#bae6fd' }
}

function formatThaiDateBuddhist(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`
}

function formatThaiTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  return d.toLocaleString('th-TH')
}

function shortId(value) {
  if (!value) return '-'
  const s = String(value)
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s
}

function userLabel(userId) {
  const id = userId ?? null
  if (!id) return '-'
  if (auth.user?.id && id === auth.user.id) {
    const name = auth.user?.fullname || auth.user?.username || '-'
    const code = auth.user?.emp_code || ''
    return code ? `${name} (${code})` : name
  }
  const u = systemUsersById.value[id]
  if (!u) return shortId(id)
  const code = u.emp_code || ''
  const name = u.fullname || u.username || '-'
  return code ? `${name} (${code})` : name
}

// ---- fetch ----
async function fetchRows() {
  loading.value = true
  try {
    fetchCounts()
    const base = supabase
      .from('ap_requests')
      .select('id, ap_number, po_id, supplier_name, item_ref, qty_order, qty_received, total_price, currency_name, desired_date, remark, option_name, ap_status')

    const q =
      viewMode.value === 'slip'
        ? base.in('ap_status', ['จ่ายครบ', 'รอชำระ']).order('ap_status', { ascending: true }).order('desired_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
        : base.eq('ap_status', 'รอชำระ').order('desired_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })

    const { data, error } = await q
    if (error) throw error
    rows.value = data || []
    // if (activeRowId.value == null && rows.value.length) {
    //   activeRowId.value = rows.value[0]?.id ?? null
    // }
    await fetchStatuses()
  } catch (err) {
    alert('โหลดข้อมูลไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
    rows.value = []
    statusByMode.value = { pay: {}, slip: {} }
    systemUsersById.value = {}
  } finally {
    loading.value = false
  }
}

async function fetchCounts() {
  countsLoading.value = true
  try {
    const [payRes, paidRes] = await Promise.all([
      supabase.from('ap_requests').select('*', { count: 'exact', head: true }).eq('ap_status', 'รอชำระ'),
      supabase.from('ap_requests').select('*', { count: 'exact', head: true }).eq('ap_status', 'จ่ายครบ'),
    ])
    statusCounts.value = { pay: payRes.count ?? 0, paid: paidRes.count ?? 0 }
  } catch {
  } finally {
    countsLoading.value = false
  }
}

onMounted(() => {
  fetchCounts()
  fetchRows()
})

// ---- filtered rows ----
const filteredRows = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const list = rows.value || []
  if (!key) return list
  return list.filter((r) => {
    const haystack = [r.ap_number, r.po_id, r.supplier_name, r.item_ref, r.option_name]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(key)
  })
})

// ---- active row ----
const activeRow = computed(() => (rows.value || []).find((r) => r.id === activeRowId.value) ?? null)

// slip mode: แสดงเฉพาะ row ที่เลือกแถวเดียว
const activeSlipRows = computed(() => {
  const r = activeRow.value
  if (!r) return []
  return [r]
})

const slipHeaderText = computed(() => {
  const r = activeRow.value
  if (!r) return ''
  const ap = String(r.ap_number || '').trim() || '-'
  const status = String(r.ap_status || '').trim() || '-'
  return `AP: ${ap} | ${status}`
})

function selectRow(id) {
  if (activeRowId.value === id) {
    // ติ๊กซ้ำ = ยกเลิก
    activeRowId.value = null
    messageDirty.value = false
    editableText.value = ''
  } else {
    activeRowId.value = id
    messageDirty.value = false
  }
}

// status ของ mode ปัจจุบัน
const currentModeStatus = computed(() => statusByMode.value[viewMode.value] || {})

// ---- message builders ----
function urgentTag(optionName) {
  const key = String(optionName || '').trim()
  if (key.includes('ด่วนมาก')) return '(ด่วนมาก)'
  if (key.includes('ด่วน')) return '(ด่วน)'
  return ''
}

function urgencyBucket(optionName) {
  const key = String(optionName || '').trim()
  if (key.includes('ด่วนมาก')) return 'urgent_max'
  if (key.includes('ด่วน')) return 'urgent'
  return 'normal'
}

function paymentSectionTitle(optionName) {
  const b = urgencyBucket(optionName)
  if (b === 'urgent_max') return '🔴 ด่วนมาก (ต้องชำระ 1-2 วัน)'
  if (b === 'urgent') return '🟠 ด่วน (ต้องชำระ 3-4 วัน)'
  return '🟡 ปกติ (ต้องชำระ ภายใน 7 วัน)'
}

function currencySumText(sumByCurrency) {
  const entries = Object.entries(sumByCurrency || {}).filter(([, v]) => Number(v) !== 0)
  if (!entries.length) return '-'
  entries.sort(([a], [b]) => String(a).localeCompare(String(b)))
  return entries.map(([cur, amt]) => `${cur || '-'}: ${formatNumber(amt)}`).join('  ')
}

function buildPendingPaymentMessage(r) {
  if (!r) return ''
  const now = new Date()
  const headerDate = formatThaiDateBuddhist(now)
  const blocks = []
  blocks.push(`📋 สรุปรายการขอชำระเงิน [จัดซื้อ สปป.ลาว]`)
  blocks.push(`วันที่: ${headerDate}`)
  blocks.push(`————————`)
  blocks.push(``)
  blocks.push(paymentSectionTitle(r.option_name))
  blocks.push(``)

  const ap = String(r.ap_number || '').trim() || '-'
  const po = String(r.po_id || '').trim() || '-'
  const supplier = String(r.supplier_name || '').trim() || '-'
  const item = String(r.item_ref || '').trim() || '-'
  const qty = r.qty_order === null || r.qty_order === undefined || r.qty_order === '' ? '-' : String(r.qty_order)
  const total = moneyText(r.total_price, r.currency_name)
  const desiredIso = r.desired_date ? String(r.desired_date).slice(0, 10) : '-'
  const remark = String(r.remark || '').trim() || '-'

  const ordered = Number(r.qty_order || 0)
  const received = Number(r.qty_received || 0)
  const pendingItemCount = Number.isFinite(ordered) && Number.isFinite(received) && ordered > received ? 1 : 0
  const sumByCurrency = {}
  const cur = String(r.currency_name || '').trim() || '-'
  const amt = Number(r.total_price || 0)
  if (Number.isFinite(amt)) sumByCurrency[cur] = (sumByCurrency[cur] || 0) + amt

  blocks.push(`1. ${ap} | ${po}`)
  blocks.push(`  • ${item}  |  จำนวน: ${qty}  |  ยอด: ${total}`)
  blocks.push(``)
  blocks.push(`🏪 ร้านค้า: ${supplier}`)
  blocks.push(`📅 ต้องการของ: ${desiredIso}`)
  blocks.push(`✍️ เหตุผล: ${remark}`)
  blocks.push(`💰 ยอดรวม: ${currencySumText(sumByCurrency)}  📦 ของค้างรับ: ${formatNumber(pendingItemCount)} รายการ`)
  blocks.push(``)
  blocks.push(`————————`)
  blocks.push(`📊 สรุปรวมยอดรอชำระ`)
  blocks.push(`💰 ${currencySumText(sumByCurrency)}`)
  blocks.push(`📦 ของค้างรับ PO เดิม: ${formatNumber(pendingItemCount)} รายการ — โปรดตามซัพพลายเออร์`)
  blocks.push(`————————`)
  blocks.push(`กรุณาแจ้งยืนยัน หรือโอนพร้อมระบุเลข AP ในหมายเหตุ`)
  return blocks.join('\n')
}

function buildSlipConfirmMessageFromRows(list) {
  const rowsAll = list || []
  const now = new Date()
  const dateText = formatThaiDateBuddhist(now)
  const timeText = formatThaiTime(now)

  const matchedRaw = rowsAll.filter((x) => String(x?.ap_status || '').trim() === 'จ่ายครบ')
  const pendingRaw = rowsAll.filter((x) => String(x?.ap_status || '').trim() === 'รอชำระ')

  const seenMatched = new Set()
  const matched = matchedRaw.filter((r) => {
    if (seenMatched.has(r.id)) return false
    seenMatched.add(r.id)
    return true
  })

  const seenPending = new Set()
  const pending = pendingRaw.filter((r) => {
    if (seenPending.has(r.id)) return false
    seenPending.add(r.id)
    return true
  })

  const blocks = []
  blocks.push(`✅ ยืนยันรับสลิปโอน`)
  blocks.push(`วันที่รับ: ${dateText} เวลา: ${timeText}`)
  blocks.push(`————————`)
  blocks.push(``)

  if (matched.length) {
    blocks.push(`รายการที่ match แล้ว:`)
    for (const r of matched) {
      const ap = String(r.ap_number || '').trim() || '-'
      const po = String(r.po_id || '').trim() || '-'
      const item = String(r.item_ref || '').trim() || '-'
      const amount = moneyText(r.total_price, r.currency_name)
      blocks.push(`✔ ${ap} | ${po}  ${item} — ${amount} ✅`)
    }
    blocks.push(``)
  }

  if (pending.length) {
    blocks.push(`รายการที่ยังไม่ได้รับการโอน:`)
    for (const r of pending) {
      const ap = String(r.ap_number || '').trim() || '-'
      const po = String(r.po_id || '').trim() || '-'
      const item = String(r.item_ref || '').trim() || '-'
      const amount = moneyText(r.total_price, r.currency_name)
      const urgency = urgentTag(r.option_name)
      blocks.push(`❌ ${ap} | ${po}  ${item} — ${amount}${urgency ? ` ${urgency}` : ''}`)
    }
    blocks.push(``)
  }

  blocks.push(`————————`)
  blocks.push(`📌 PO ที่มีของค้างรับ — โปรดช่วยตามกับซัพพลายเออร์:`)

  const pendingMap = new Map()
  for (const r of rowsAll) {
    const ordered = Number(r.qty_order || 0)
    const received = Number(r.qty_received || 0)
    const pendingQty = Number.isFinite(ordered) && Number.isFinite(received) ? Math.max(0, ordered - received) : 0
    if (pendingQty <= 0) continue
    const ap = String(r.ap_number || '').trim() || '-'
    const po = String(r.po_id || '').trim() || '-'
    const supplier = String(r.supplier_name || '').trim() || '-'
    const key = `${ap}|${po}|${supplier}`
    const prev = pendingMap.get(key) ?? 0
    if (pendingQty > prev) pendingMap.set(key, pendingQty)
  }

  if (!pendingMap.size) {
    blocks.push(`• -`)
  } else {
    for (const [key, qty] of pendingMap.entries()) {
      const [ap, po, supplier] = key.split('|')
      blocks.push(`• ${ap} | ${po} ค้างอีก ${formatNumber(qty)} ชิ้น (ผู้ขาย: ${supplier})`)
    }
  }

  blocks.push(`————————`)
  blocks.push(`กรุณาตรวจสอบและยืนยันกลับด้วยครับ/ค่ะ`)
  return blocks.join('\n')
}

function buildMessageForRow(r) {
  return viewMode.value === 'slip'
    ? buildSlipConfirmMessageFromRows(activeSlipRows.value)
    : buildPendingPaymentMessage(r)
}

const generatedMessageText = computed(() => buildMessageForRow(activeRow.value))

watch(
  () => generatedMessageText.value,
  (text) => {
    if (messageDirty.value) return
    if (activeRowId.value == null) {
      editableText.value = ''
      return
    }
    editableText.value = text || ''
  },
  { immediate: true }
)

function resetMessage() {
  messageDirty.value = false
  editableText.value = generatedMessageText.value || ''
}

// ---- statuses — query view_mode แยกกัน ----
async function fetchStatuses() {
  const ids = new Set((rows.value || []).map((r) => r?.id).filter((x) => x != null))
  if (!ids.size) {
    statusByMode.value = { pay: {}, slip: {} }
    systemUsersById.value = {}
    return
  }

  try {
    const { data: logs, error } = await supabase
      .from('user_logs')
      .select('id, system_user_id, action, view_mode, old_value, created_at')
      .in('action', ['line_copy_ap_request', 'line_read_ap_request'])
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) throw error

    const nextStatus = { pay: {}, slip: {} }
    const userIds = new Set()

    for (const l of logs || []) {
      const reqId = l?.old_value?.ap_request_id
      if (reqId == null) continue
      if (!ids.has(reqId)) continue

      // log เก่าที่ไม่มี view_mode ถือเป็น 'pay' (backward compat)
      const mode = l.view_mode === 'slip' ? 'slip' : 'pay'
      const entry = nextStatus[mode][reqId] || {}

      if (l.action === 'line_copy_ap_request' && !entry.copiedAt) {
        entry.copiedAt = l.created_at
        entry.copiedBy = l.system_user_id
      }
      if (l.action === 'line_read_ap_request' && !entry.readAt) {
        entry.readAt = l.created_at
        entry.readBy = l.system_user_id
      }
      nextStatus[mode][reqId] = entry
      if (l.system_user_id) userIds.add(l.system_user_id)
    }

    statusByMode.value = nextStatus

    const needIds = Array.from(userIds).filter((id) => id && !systemUsersById.value[id])
    if (needIds.length) {
      const { data: users, error: usersError } = await supabase
        .from('system_users')
        .select('id, emp_code, fullname, username')
        .in('id', needIds)
      if (!usersError) {
        const byId = { ...systemUsersById.value }
        for (const u of users || []) byId[u.id] = u
        systemUsersById.value = byId
      }
    }
  } catch {
    statusByMode.value = statusByMode.value || { pay: {}, slip: {} }
  }
}

// ---- log action — บันทึก view_mode ทุกครั้ง ----
async function logActionForRow(rowId, action) {
  const r = (rows.value || []).find((x) => x.id === rowId)
  if (!r) return
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่')

  logging.value = true
  try {
    const { error } = await supabase.from('user_logs').insert([{
      system_user_id: auth.user.id,
      action,
      view_mode: viewMode.value,
      user_agent: navigator.userAgent,
      old_value: {
        ap_request_id: r.id,
        ap_number: r.ap_number || null,
        po_id: r.po_id || null,
      },
    }])
    if (error) throw error
    await fetchStatuses()
  } catch (err) {
    alert('บันทึกสถานะไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  } finally {
    logging.value = false
  }
}

async function logActionForRows(rowIds, action) {
  const ids = Array.from(new Set((rowIds || []).filter((x) => x != null)))
  if (!ids.length) return
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่')

  const picked = (rows.value || []).filter((r) => ids.includes(r.id))
  if (!picked.length) return

  logging.value = true
  try {
    const payload = picked.slice(0, 200).map((r) => ({
      system_user_id: auth.user.id,
      action,
      view_mode: viewMode.value,
      user_agent: navigator.userAgent,
      old_value: {
        ap_request_id: r.id,
        ap_number: r.ap_number || null,
        po_id: r.po_id || null,
      },
    }))
    const { error } = await supabase.from('user_logs').insert(payload)
    if (error) throw error
    await fetchStatuses()
  } catch (err) {
    alert('บันทึกสถานะไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  } finally {
    logging.value = false
  }
}

async function copyMessage() {
  const text = editableText.value || ''
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    if (viewMode.value === 'slip') {
      await logActionForRows((activeSlipRows.value || []).map((r) => r.id), 'line_copy_ap_request')
    } else if (activeRowId.value != null) {
      await logActionForRow(activeRowId.value, 'line_copy_ap_request')
    }
    alert('คัดลอกข้อความแล้ว')
  } catch (err) {
    alert('คัดลอกไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  }
}

async function copyRow(r) {
  selectRow(r.id)
  const text = buildMessageForRow(r)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    await logActionForRow(r.id, 'line_copy_ap_request')
    alert('คัดลอกข้อความแล้ว')
  } catch (err) {
    alert('คัดลอกไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  }
}

async function markReadRow(r) {
  selectRow(r.id)
  await logActionForRow(r.id, 'line_read_ap_request')
}
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ส่งข้อความ LINE</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          <span v-if="viewMode === 'slip'">แสดงรายการ AP Status: จ่ายครบ และ รอชำระ</span>
          <span v-else>แสดงเฉพาะรายการ AP Status: รอชำระ</span>
        </p>
        <div class="mt-2 flex items-center gap-2">
          <span class="text-[12px] font-medium" style="color: var(--color-text-muted)">ประเภทรายการ:</span>
          <button
            type="button"
            class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
            :class="viewMode === 'pay' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
            :style="viewMode === 'pay' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
            @click="viewMode = 'pay'; activeRowId = null; messageDirty = false; editableText = ''; fetchRows()"
          >
            แจ้งขอชำระเงิน ({{ countsLoading ? '-' : statusCounts.pay }})
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
            :class="viewMode === 'slip' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
            :style="viewMode === 'slip' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
            @click="viewMode = 'slip'; activeRowId = null; messageDirty = false; editableText = ''; fetchRows()"
          >
            ยืนยันรับสลิป ({{ countsLoading ? '-' : (statusCounts.paid + statusCounts.pay) }})
          </button>
        </div>
      </div>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all self-start md:self-auto"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
        @click="fetchRows"
      >
        รีเฟรช
      </button>
    </div>

    <div class="flex flex-col lg:flex-row gap-4">
      <!-- LEFT: รายการ -->
      <div class="flex-1">
        <div class="flex flex-col md:flex-row gap-3 mb-4 p-3 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex-1 relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="searchText"
              type="text"
              placeholder="ค้นหา เลข AP, เลข PO, ผู้ขาย, รายการ..."
              class="w-full pl-9 pr-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>

        <div class="space-y-2">
          <div v-if="loading" class="rounded-xl border px-4 py-10 text-center" style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-muted)">
            กำลังโหลดข้อมูล...
          </div>
          <div v-else-if="!loading && filteredRows.length === 0" class="rounded-xl border px-4 py-10 text-center" style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-muted)">
            ไม่พบข้อมูล
          </div>

          <div
            v-for="r in filteredRows"
            :key="r.id"
            class="rounded-xl border px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
            style="background: var(--color-bg-card); border-color: var(--color-border)"
          >
            <div class="flex items-start gap-3">
              <input type="checkbox" class="w-4 h-4 mt-1" :checked="activeRowId === r.id" @change="selectRow(r.id)" />

              <div class="flex-1 min-w-0">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[14px] font-semibold" style="color: #2563eb">{{ r.ap_number || '-' }}</div>
                    <div class="mt-1 text-[12px]" style="color: var(--color-text-muted)">
                      <span class="font-medium">PO:</span> {{ r.po_id || '-' }}
                    </div>
                    <div class="mt-0.5 text-[12px]" style="color: var(--color-text-muted)">
                      <span class="font-medium">ผู้ขาย:</span> {{ r.supplier_name || '-' }}
                    </div>
                    <div class="mt-0.5 text-[12px]" style="color: var(--color-text-muted)">
                      <span class="font-medium">รายการ:</span> {{ r.item_ref || '-' }}
                    </div>
                  </div>

                  <div class="flex-shrink-0 w-full lg:w-[280px]">
                    <div class="flex flex-col items-end gap-1 text-[12px]" style="color: var(--color-text-muted)">
                      <div class="inline-flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full border" :style="{ background: urgentDot(r.option_name).bg, borderColor: urgentDot(r.option_name).border }"></span>
                        <span class="font-medium">{{ r.option_name || '-' }}</span>
                        <span
                          class="ml-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                          :style="{
                            borderColor: 'var(--color-border)',
                            color: r.ap_status === 'จ่ายครบ' ? '#16a34a' : '#f97316',
                            background: r.ap_status === 'จ่ายครบ' ? 'rgba(34, 197, 94, 0.10)' : 'rgba(249, 115, 22, 0.10)',
                          }"
                        >
                          {{ r.ap_status || '-' }}
                        </span>
                      </div>
                      <div class="inline-flex items-center gap-2">
                        <i class="fa-solid fa-coins text-[12px]"></i>
                        <span>ยอดรวม: {{ moneyText(r.total_price, r.currency_name) }}</span>
                      </div>
                      <div class="inline-flex items-center gap-2">
                        <i class="fa-solid fa-calendar-days text-[12px]"></i>
                        <span>ต้องการ: {{ r.desired_date ? formatThaiDate(r.desired_date) : '-' }}</span>
                      </div>

                      <!-- ปุ่ม pay mode เท่านั้น -->
                      <div v-if="viewMode === 'pay'" class="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          class="px-2.5 py-1 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style="border-color: var(--color-border); color: #2563eb"
                          :disabled="logging"
                          @click="markReadRow(r)"
                        >
                          อ่านแล้ว
                        </button>
                        <button
                          type="button"
                          class="px-2.5 py-1 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style="border-color: var(--color-border); color: var(--color-text-secondary)"
                          :disabled="logging"
                          @click="copyRow(r)"
                        >
                          คัดลอก
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- สถานะ copy/read แยกตาม viewMode ปัจจุบัน -->
                <div
                  v-if="currentModeStatus[r.id]?.copiedAt || currentModeStatus[r.id]?.readAt"
                  class="mt-2 text-[12px] space-y-0.5"
                  style="color: #2563eb"
                >
                  <div v-if="currentModeStatus[r.id]?.copiedAt" class="flex items-center gap-1">
                    <i class="fa-solid fa-circle-check text-[12px]"></i>
                    <span>คัดลอกแล้ว {{ formatDateTime(currentModeStatus[r.id]?.copiedAt) }} โดย {{ userLabel(currentModeStatus[r.id]?.copiedBy) }}</span>
                  </div>
                  <div v-if="currentModeStatus[r.id]?.readAt" class="flex items-center gap-1">
                    <i class="fa-solid fa-eye text-[12px]"></i>
                    <span>อ่านแล้ว {{ formatDateTime(currentModeStatus[r.id]?.readAt) }} โดย {{ userLabel(currentModeStatus[r.id]?.readBy) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: ข้อความ -->
      <div class="w-full lg:w-[420px]">
        <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">
              ข้อความ
              <span v-if="viewMode === 'slip'" class="ml-2 text-[12px] font-normal" style="color: var(--color-text-muted)">{{ slipHeaderText }}</span>
              <span v-else-if="activeRow" class="ml-2 text-[12px] font-normal" style="color: var(--color-text-muted)">AP: {{ activeRow.ap_number }} ({{ activeRow.ap_status || '-' }})</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[13px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style="border-color: var(--color-border); color: var(--color-text-secondary)"
                :disabled="!editableText.trim() || logging"
                @click="copyMessage"
                title="คัดลอก"
                aria-label="คัดลอก"
              >
                <i class="fa-solid fa-copy"></i>
              </button>
            </div>
          </div>
          <textarea
            v-model="editableText"
            rows="18"
            class="w-full px-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none"
            style="border-color: var(--color-border); color: var(--color-text-primary)"
            placeholder="ติ๊กเลือกรายการทางซ้าย ข้อความจะขึ้นที่นี่"
            @keydown="messageDirty = true"
            @paste="messageDirty = true"
          ></textarea>
          <div class="mt-2 text-[12px]" style="color: var(--color-text-muted)">
            แก้ไขข้อความได้ แล้วกด "คัดลอก" เพื่อส่งใน LINE
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>