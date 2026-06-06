<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useUiStore } from '@/stores/ui'
import { useTrcloudStore } from '@/stores/trcloud'
import { reconcile, isMissingTrackingSchema } from '@/utils/trackingSync'
import Swal from 'sweetalert2'

const ui = useUiStore()
const trcloudStore = useTrcloudStore()
const syncing = ref(false)
const trackingSchemaReady = ref(true) // false = ยังไม่ได้รัน SQL migration (โหมด legacy)

const ROW_COLS_FULL = 'id, ap_number, po_id, po_date, supplier_name, item_ref, qty_order, department, po_created_by, date_transfer, option_name, total_price, currency_name, ap_status, qty_received, qty_auto, desired_date, remark, amount_received, amount_balance, source_key, is_orphaned, created_by, updated_by, created_at, updated_at'
const ROW_COLS_LEGACY = 'id, ap_number, po_id, po_date, supplier_name, item_ref, qty_order, department, po_created_by, date_transfer, option_name, total_price, currency_name, ap_status, qty_received, qty_auto, desired_date, remark, amount_received, amount_balance, created_by, updated_by, created_at, updated_at'
const emit = defineEmits(['editRow'])
const props = defineProps({
  refreshKey: { type: Number, default: 0 },
  type: { type: String, default: 'exp' },
})

const loading = ref(true)
const rows = ref([])
const selectionMode = ref(false)
const selectedIds = ref([])

const searchText = ref('')
const selectedUrgent = ref('all')
const selectedApStatus = ref('all')
const poDateFromInput = ref('')
const poDateToInput = ref('')
const poDateFromApplied = ref('')
const poDateToApplied = ref('')
const poDateFilterActive = computed(() => !!(poDateFromApplied.value || poDateToApplied.value))
const pageSize = 20
const page = ref(1)

function explainSupabasePolicyHint(err) {
  const msg = String(err?.message || '')
  const code = String(err?.code || '')
  const status = String(err?.status || '')

  if (
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('violates row-level security') ||
    code === '42501'
  ) {
    return (
      'ตาราง exp_requests เปิด RLS อยู่ แต่ยังไม่มี Policy อนุญาตให้ role: anon อ่านข้อมูลได้\n' +
      'ให้ไปที่ Supabase > Table Editor > exp_requests > RLS แล้วสร้าง Policy สำหรับ SELECT (หรือปิด RLS ถ้าต้องการให้เห็นได้เลย)'
    )
  }

  if (status === '401' || msg.includes('401')) {
    return (
      'Supabase ตอบกลับ 401 (Unauthorized)\n' +
      'สาเหตุที่พบบ่อย: ยังไม่มี apikey/JWT ที่ใช้งานได้ หรือ RLS/Policy ไม่อนุญาตให้เข้าถึงตารางนี้'
    )
  }

  return null
}

function getErrorText(err) {
  return explainSupabasePolicyHint(err) || String(err?.message || err || 'เกิดข้อผิดพลาด')
}

function formatThaiDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  return `${day}/${month}/${year}`
}

function formatThaiDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

function moneyText(amount, currency) {
  const a = formatNumber(amount)
  const c = String(currency || '').trim() || 'LAK'
  return `${a} ${c.toUpperCase()}`
}

function normalizeText(value) {
  return String(value || '').trim()
}

function parseYmdToLocalDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  return new Date(y, mo - 1, d)
}

function dateOnly(value) {
  const parsed = parseYmdToLocalDate(value)
  if (parsed) return parsed
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(+d)) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function matchDateRange(dateValue, fromIso, toIso) {
  const d = dateOnly(dateValue)
  if (!d) return true
  const from = fromIso ? dateOnly(fromIso) : null
  const to = toIso ? dateOnly(toIso) : null
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

async function fetchRows() {
  loading.value = true
  try {
    let { data, error } = await supabase
      .from('exp_requests')
      .select(ROW_COLS_FULL)
      .order('created_at', { ascending: false })

    // ยังไม่ได้รัน SQL (ไม่มีคอลัมน์ source_key/is_orphaned) → โหลดแบบ legacy
    if (error && isMissingTrackingSchema(error)) {
      trackingSchemaReady.value = false
      ;({ data, error } = await supabase
        .from('exp_requests')
        .select(ROW_COLS_LEGACY)
        .order('created_at', { ascending: false }))
    } else {
      trackingSchemaReady.value = true
    }

    if (error) throw error
    rows.value = data || []
  } catch (err) {
    ui.showToast('โหลดข้อมูลตารางติดตามไม่สำเร็จ: ' + getErrorText(err), 'error')
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchRows)
watch(
  () => props.refreshKey,
  () => {
    fetchRows()
  }
)

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function rowLabel(r) {
  return escapeHtml(`${r.ap_number || r.po_id || '-'} : ${r.item_ref || '-'} (qty ${r.qty_order ?? '-'})`)
}

function buildSyncPreviewHtml(plan) {
  const { stats } = plan
  const section = (title, color, items) => {
    if (!items.length) return ''
    const lines = items.slice(0, 8).map((t) => `<li>${t}</li>`).join('')
    const more = items.length > 8 ? `<li>… และอีก ${items.length - 8} รายการ</li>` : ''
    return `<div class="mt-2"><div style="color:${color};font-weight:600">${title} (${items.length})</div><ul style="text-align:left;padding-left:18px;list-style:disc">${lines}${more}</ul></div>`
  }
  return [
    `<div style="text-align:left">`,
    `<div>รีเฟรชให้ตรง TRCloud: <b>${stats.refresh}</b> • ย้ายงานมือ: <b>${stats.migrate}</b> • ตัดออก: <b style="color:#ef4444">${stats.cut}</b> • ติดธงหลุด: <b style="color:#f59e0b">${stats.orphan}</b></div>`,
    section('จะตัดออก', '#ef4444', plan.cut.map(rowLabel)),
    section('ย้ายงานมือไปบรรทัดที่ตรง TRCloud', '#16a34a', plan.migrate.map((m) => `${rowLabel(m.from)} → ${rowLabel(m.to)}`)),
    section('หลุดจาก TRCloud (ติดธง ไม่ลบ)', '#f59e0b', plan.orphan.map(rowLabel)),
    `</div>`,
  ].join('')
}

async function applyReconcile(plan) {
  const nowIso = new Date().toISOString()
  const byId = new Map()
  const addPatch = (id, patch) => byId.set(id, { ...(byId.get(id) || {}), ...patch })
  for (const { row, patch } of plan.refresh) addPatch(row.id, patch)
  for (const { to, patch } of plan.migrate) if (Object.keys(patch).length) addPatch(to.id, patch)

  const updates = Array.from(byId.entries()).map(([id, patch]) => ({ id, patch: { ...patch, updated_at: nowIso } }))
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(updates.slice(i, i + 10).map((u) => supabase.from('exp_requests').update(u.patch).eq('id', u.id)))
  }

  const cutIds = plan.cut.map((r) => r.id)
  if (cutIds.length) {
    const { error } = await supabase.from('exp_requests').delete().in('id', cutIds)
    if (error) throw error
  }

  const orphanIds = plan.orphan.map((r) => r.id)
  if (orphanIds.length) {
    const { error } = await supabase.from('exp_requests').update({ is_orphaned: true, orphaned_at: nowIso }).in('id', orphanIds)
    if (error) throw error
  }
}

async function syncWithTrcloud() {
  if (!trackingSchemaReady.value) {
    Swal.fire('ยังใช้ซิงค์ไม่ได้', 'ต้องรัน SQL migration (เพิ่มคอลัมน์ source_key) ก่อนจึงจะซิงค์กับ TRCloud ได้', 'info')
    return
  }
  syncing.value = true
  try {
    if (!trcloudStore.expenseItemRows.length) {
      await trcloudStore.fetchTrcloudData('expense')
    }
    if (!trcloudStore.expenseItemRows.length) {
      ui.showToast('ยังไม่มีข้อมูล TRCloud ให้เทียบ (ตรวจสอบ cookie/ช่วงวันที่)', 'warning')
      return
    }

    const plan = reconcile(trcloudStore.expenseItemRows, rows.value, { includeStatus: false })
    const { stats } = plan
    if (!stats.refresh && !stats.migrate && !stats.cut && !stats.orphan) {
      Swal.fire('ตรงกับ TRCloud อยู่แล้ว', 'ไม่มีรายการต้องปรับ', 'success')
      return
    }

    const res = await Swal.fire({
      title: 'ยืนยันการซิงค์กับ TRCloud',
      html: buildSyncPreviewHtml(plan),
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ยืนยันซิงค์',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#2563eb',
      width: 560,
    })
    if (!res.isConfirmed) return

    loading.value = true
    await applyReconcile(plan)
    ui.showToast('ซิงค์กับ TRCloud สำเร็จ', 'success')
    await fetchRows()
  } catch (err) {
    Swal.fire('เกิดข้อผิดพลาด', getErrorText(err), 'error')
  } finally {
    loading.value = false
    syncing.value = false
  }
}

const filteredRows = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const list = rows.value || []
  const urgentKey = normalizeText(selectedUrgent.value)
  const statusKey = normalizeText(selectedApStatus.value)
  const from = poDateFromApplied.value || ''
  const to = poDateToApplied.value || ''

  return list.filter((r) => {
    const matchUrgent = urgentKey === 'all' || normalizeText(r.option_name) === urgentKey
    const matchStatus = statusKey === 'all' || normalizeText(r.ap_status) === statusKey
    const matchPoDate = matchDateRange(r.po_date, from, to)

    const haystack = [
      r.ap_number,
      r.po_id,
      r.supplier_name,
      r.item_ref,
      r.department,
      r.po_created_by,
      r.option_name,
      r.ap_status,
      r.currency_name,
      r.remark,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    const matchSearch = !key || haystack.includes(key)
    return matchUrgent && matchStatus && matchPoDate && matchSearch
  })
})

const totalRows = computed(() => filteredRows.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedRows = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredRows.value.slice(start, start + pageSize)
})

function onFilterChanged() {
  page.value = 1
}
function goPrev() {
  page.value = Math.max(1, page.value - 1)
}
function goNext() {
  page.value = Math.min(totalPages.value, page.value + 1)
}

function isPaidComplete(status) {
  return String(status || '').trim() === 'ชำระแล้ว'
}

function onEditRow(r) {
  emit('editRow', r)
}

async function removeRow(row) {
  const result = await Swal.fire({
    title: 'คุณต้องการลบข้อมูล?',
    text: `ต้องการลบรายการ Exp: ${row.ap_number || '-'} ใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ใช่, ลบเลย',
    cancelButtonText: 'ยกเลิก',
    reverseButtons: true,
  })

  if (!result.isConfirmed) return

  try {
    const { error } = await supabase.from('exp_requests').delete().eq('id', row.id)
    if (error) throw error

    Swal.fire({
      title: 'ลบสำเร็จ!',
      text: 'ข้อมูลถูกลบออกจากระบบแล้ว',
      icon: 'success',
      timer: 1500,
      showConfirmButton: false,
    })

    await fetchRows()
  } catch (err) {
    Swal.fire('เกิดข้อผิดพลาด!', getErrorText(err), 'error')
  }
}

async function removeSelectedRows() {
  if (selectedIds.value.length === 0) return

  const result = await Swal.fire({
    title: 'ลบหลายรายการ?',
    text: `คุณต้องการลบข้อมูลที่เลือกทั้งหมด ${selectedIds.value.length} รายการใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'ใช่, ลบทั้งหมด',
    cancelButtonText: 'ยกเลิก',
    reverseButtons: true,
  })

  if (!result.isConfirmed) return

  loading.value = true
  try {
    const { error } = await supabase.from('exp_requests').delete().in('id', selectedIds.value)
    if (error) throw error

    selectedIds.value = []
    selectionMode.value = false

    Swal.fire({
      title: 'ลบสำเร็จ!',
      text: 'ข้อมูลที่เลือกถูกลบออกแล้ว',
      icon: 'success',
      timer: 1500,
      showConfirmButton: false,
    })

    await fetchRows()
  } catch (err) {
    Swal.fire('เกิดข้อผิดพลาด!', getErrorText(err), 'error')
  } finally {
    loading.value = false
  }
}

function toggleSelectAll() {
  if (selectedIds.value.length === pagedRows.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = pagedRows.value.map((r) => r.id)
  }
}

function toggleSelection(id) {
  const idx = selectedIds.value.indexOf(id)
  if (idx > -1) {
    selectedIds.value.splice(idx, 1)
  } else {
    selectedIds.value.push(id)
  }
}

function applyPoDateFilter() {
  poDateFromApplied.value = poDateFromInput.value || ''
  poDateToApplied.value = poDateToInput.value || ''
  onFilterChanged()
}

function clearPoDateFilter() {
  poDateFromInput.value = ''
  poDateToInput.value = ''
  poDateFromApplied.value = ''
  poDateToApplied.value = ''
  onFilterChanged()
}

const apStatusOptions = ['ยังไม่ชำระ', 'ชำระแล้ว']
const urgentOptions = computed(() => {
  const set = new Set()
  for (const r of rows.value || []) {
    const v = normalizeText(r?.option_name)
    if (v) set.add(v)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))
})

function countByStatus(list) {
  const map = new Map()
  for (const s of apStatusOptions) map.set(s, 0)
  for (const r of list || []) {
    const k = normalizeText(r?.ap_status)
    if (!k) continue
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

function countByUrgent(list) {
  const map = new Map()
  for (const r of list || []) {
    const k = normalizeText(r?.option_name)
    if (!k) continue
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

const filteredStatusCounts = computed(() => countByStatus(filteredRows.value))
const filteredUrgentCounts = computed(() => countByUrgent(filteredRows.value))

const currencyTotals = computed(() => {
  const map = new Map()
  for (const r of filteredRows.value || []) {
    const c = (normalizeText(r?.currency_name) || 'LAK').toUpperCase()
    const v = Number(r?.total_price ?? 0)
    if (!Number.isFinite(v)) continue
    map.set(c, (map.get(c) || 0) + v)
  }
  const out = Array.from(map.entries()).map(([currency, total]) => ({ currency, total }))
  out.sort((a, b) => b.total - a.total)
  return out
})
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
      <div class="flex items-center gap-3">
        <div>
          <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ตารางติดตาม Exp</h1>
          <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ข้อมูลจากตาราง exp_requests</p>
        </div>
        <button
          type="button"
          :disabled="syncing || loading"
          @click="syncWithTrcloud"
          class="px-3 py-1.5 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
          title="เทียบกับ TRCloud แล้วรีเฟรช/ตัดรายการที่ไม่ตรง"
        >
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': syncing }"></i>
          ซิงค์กับ TRCloud
        </button>
        <div class="relative group">
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            @click="selectionMode = !selectionMode; selectedIds = []"
          >
            <i class="fa-solid fa-ellipsis-vertical text-[16px]" style="color: var(--color-text-muted)"></i>
          </button>
          <div class="absolute left-0 mt-1 hidden group-hover:block z-20">
            <div class="bg-white border rounded-lg shadow-lg py-1 min-w-[150px]">
              <button
                type="button"
                class="w-full px-4 py-2 text-left text-[13px] hover:bg-gray-50 flex items-center gap-2"
                @click="selectionMode = !selectionMode; selectedIds = []"
              >
                <i :class="selectionMode ? 'fa-solid fa-xmark' : 'fa-solid fa-check-double'"></i>
                {{ selectionMode ? 'ยกเลิกการเลือก' : 'เลือกหลายรายการ' }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="selectionMode && selectedIds.length > 0" class="flex items-center gap-3">
        <span class="text-[13px] font-medium" style="color: var(--color-text-primary)">เลือกแล้ว {{ selectedIds.length }} รายการ</span>
        <button
          type="button"
          class="px-4 py-1.5 rounded-lg bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 transition-colors shadow-sm flex items-center gap-2"
          @click="removeSelectedRows"
        >
          <i class="fa-solid fa-trash-can"></i>
          ลบที่เลือก
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
      <div class="rounded-xl border px-3 py-2.5" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[11px] font-medium" style="color: var(--color-text-muted)">รายการทั้งหมด</div>
        <div class="text-[22px] font-semibold leading-7" style="color: var(--color-text-primary)">{{ totalRows }}</div>
      </div>
      <div class="rounded-xl border px-3 py-2.5" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[11px] font-medium" style="color: var(--color-text-muted)">ยังไม่ชำระ</div>
        <div class="text-[22px] font-semibold leading-7" style="color: #ef4444">{{ filteredStatusCounts.get('ยังไม่ชำระ') || 0 }}</div>
      </div>
      <div class="rounded-xl border px-3 py-2.5" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[11px] font-medium" style="color: var(--color-text-muted)">ชำระแล้ว</div>
        <div class="text-[22px] font-semibold leading-7" style="color: #16a34a">{{ filteredStatusCounts.get('ชำระแล้ว') || 0 }}</div>
      </div>
    </div>

    <div class="rounded-xl border p-3 mb-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-4">
          <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">ความเร่งด่วน</div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="px-2.5 py-1 rounded-full border text-[12px] font-medium"
              :style="selectedUrgent === 'all' ? { background: '#111827', color: '#ffffff', borderColor: '#111827' } : { background: 'transparent', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }"
              @click="selectedUrgent = 'all'; onFilterChanged()"
            >
              ทั้งหมด ({{ totalRows }})
            </button>
            <button
              v-for="u in urgentOptions"
              :key="u"
              type="button"
              class="px-2.5 py-1 rounded-full border text-[12px] font-medium"
              :style="selectedUrgent === u ? { background: '#111827', color: '#ffffff', borderColor: '#111827' } : { background: 'transparent', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }"
              @click="selectedUrgent = u; onFilterChanged()"
            >
              {{ u }} ({{ filteredUrgentCounts.get(u) || 0 }})
            </button>
          </div>
        </div>

        <div class="lg:col-span-4">
          <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">สถานะ Exp</div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="px-2.5 py-1 rounded-full border text-[12px] font-medium"
              :style="selectedApStatus === 'all' ? { background: '#111827', color: '#ffffff', borderColor: '#111827' } : { background: 'transparent', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }"
              @click="selectedApStatus = 'all'; onFilterChanged()"
            >
              ทั้งหมด ({{ totalRows }})
            </button>
            <button
              v-for="s in apStatusOptions"
              :key="s"
              type="button"
              class="px-2.5 py-1 rounded-full border text-[12px] font-medium"
              :style="selectedApStatus === s ? { background: '#111827', color: '#ffffff', borderColor: '#111827' } : { background: 'transparent', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }"
              @click="selectedApStatus = s; onFilterChanged()"
            >
              {{ s }} ({{ filteredStatusCounts.get(s) || 0 }})
            </button>
          </div>
        </div>

        <div class="lg:col-span-2">
          <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">ค้นหา</div>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="searchText"
              @input="onFilterChanged"
              type="text"
              placeholder="เลข AP (Exp) / PO / ผู้ขาย / รายการ..."
              class="w-full pl-9 pr-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>

        <div class="lg:col-span-2">
          <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">วันที่สร้าง PO</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">จาก</div>
              <input
                v-model="poDateFromInput"
                type="date"
                class="w-full px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
                style="border-color: var(--color-border); color: var(--color-text-primary)"
              />
            </div>
            <div>
              <div class="text-[11px] font-medium mb-1" style="color: var(--color-text-muted)">ถึง</div>
              <input
                v-model="poDateToInput"
                type="date"
                class="w-full px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
                style="border-color: var(--color-border); color: var(--color-text-primary)"
              />
            </div>
          </div>
          <div class="mt-2">
            <button
              v-if="!poDateFilterActive"
              type="button"
              class="w-full px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
              @click="applyPoDateFilter"
            >
              ค้นหา
            </button>
            <button
              v-else
              type="button"
              class="w-full px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
              style="border-color: #ef4444; color: #ef4444"
              @click="clearPoDateFilter"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      </div>

      <div v-if="currencyTotals.length" class="mt-3 pt-2 border-t" style="border-color: var(--color-border)">
        <div class="flex items-center justify-between gap-3">
          <div class="text-[11px] font-medium" style="color: var(--color-text-muted)">ยอดรวม (แยกสกุลเงิน)</div>
          <div class="flex flex-wrap items-center gap-2">
            <div
              v-for="c in currencyTotals.slice(0, 3)"
              :key="c.currency"
              class="px-2 py-0.5 rounded-full border text-[11px] font-medium"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
            >
              {{ c.currency }}: {{ formatNumber(c.total) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedRows.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="goPrev"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ก่อนหน้า
          </button>
          <div class="text-[12px]" style="color: var(--color-text-muted)">หน้า {{ page }} / {{ totalPages }}</div>
          <button
            @click="goNext"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ถัดไป
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1540px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th v-if="selectionMode" class="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  :checked="pagedRows.length > 0 && selectedIds.length === pagedRows.length"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">หมายเลข</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">รายการ</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้ขาย</th>
              <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอด</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ความเร่งด่วน</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">AP Status (Exp)</th>
              <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สั่ง</th>
              <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">รับแล้ว</th>
              <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: #ef4444)">ค้างรับ</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ต้องการ</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">หมายเหตุ</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">คนเปิด PO</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้เพิ่ม/วันที่เวลา</th>
              <th class="px-3 py-2 text-left font-medium" style="color: var(--color-text-muted)">โอน (แผน)</th>
              <th class="px-3 py-2 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สลิป</th>
              <th class="px-3 py-2 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in pagedRows"
              :key="r.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              :class="{ 'bg-blue-50/50': selectedIds.includes(r.id) }"
              :style="{ borderColor: 'var(--color-border)', ...(r.is_orphaned ? { boxShadow: 'inset 3px 0 0 #f59e0b', background: 'rgba(245,158,11,0.07)' } : {}) }"
            >
              <td v-if="selectionMode" class="px-4 py-3 text-center align-top">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  :checked="selectedIds.includes(r.id)"
                  @change="toggleSelection(r.id)"
                />
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <div class="font-semibold" style="color: #2563eb">AP(Exp): {{ r.ap_number || '-' }}</div>
                <div class="font-medium" style="color: var(--color-text-primary)">PO: {{ r.po_id || '-' }}</div>
                <div class="text-[12px]" style="color: var(--color-text-muted)">{{ formatThaiDate(r.po_date) }}</div>
                <span v-if="r.is_orphaned" class="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: rgba(245,158,11,0.15); color: #b45309" title="ไม่พบรายการนี้ใน TRCloud แล้ว แต่มีงานมือ จึงไม่ถูกลบ">
                  <i class="fa-solid fa-triangle-exclamation"></i> หลุดจาก TRCloud
                </span>
              </td>
              <td class="px-4 py-3 align-top" style="color: var(--color-text-primary)">
                <div
                  :title="r.item_ref || ''"
                  style="white-space: normal; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden"
                >
                  {{ r.item_ref || '-' }}
                </div>
              </td>
              <td class="px-4 py-3 align-top" style="color: var(--color-text-primary); white-space: normal; word-break: break-word">
                {{ r.supplier_name || '-' }}
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap text-right" style="color: var(--color-text-primary)">{{ moneyText(r.total_price, r.currency_name) }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium border" style="border-color: rgba(239, 68, 68, 0.35); color: #ef4444">
                  {{ r.option_name || '-' }}
                </span>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border inline-block text-center w-full" :style="{
                  backgroundColor: isPaidComplete(r.ap_status) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  color: isPaidComplete(r.ap_status) ? '#16a34a' : '#ef4444',
                  borderColor: isPaidComplete(r.ap_status) ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
                }">
                  {{ r.ap_status || '-' }}
                </span>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap text-right" style="color: var(--color-text-primary)">{{ formatNumber(r.qty_order) }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap text-right" style="color: var(--color-text-primary)">{{ formatNumber(r.qty_received) }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap text-right" style="color: #ef4444">{{ formatNumber(r.qty_auto) }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatThaiDate(r.desired_date) }}</td>
              <td class="px-4 py-3 align-top" style="color: var(--color-text-primary)">
                <div
                  :title="r.remark || ''"
                  style="white-space: normal; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden"
                >
                  {{ r.remark || '-' }}
                </div>
              </td>
              <td class="px-4 py-3 align-top" style="color: var(--color-text-primary); white-space: normal; word-break: break-word">
                {{ r.po_created_by || '-' }}
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap" style="color: var(--color-text-muted)">
                <div class="font-medium" style="color: var(--color-text-primary)">{{ r.created_by || '-' }}</div>
                <div class="text-[11px]">{{ formatThaiDateTime(r.created_at) }}</div>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatThaiDate(r.date_transfer) }}</td>
              <td class="px-3 py-3 align-top text-center">
                <span
                  v-if="isPaidComplete(r.ap_status)"
                  class="inline-flex items-center justify-center w-8 h-8 rounded-full border"
                  style="background: #dcfce7; color: #16a34a; border-color: #86efac"
                  title="มีสลิป"
                >
                  <i class="fa-solid fa-file-circle-check text-[14px]"></i>
                </span>
                <span
                  v-else
                  class="inline-flex items-center justify-center w-8 h-8 rounded-full border"
                  style="background: #f8fafc; color: #94a3b8; border-color: #e2e8f0"
                  title="ไม่มีสลิป"
                >
                  <i class="fa-solid fa-minus text-[12px]"></i>
                </span>
              </td>
              <td class="px-3 py-3 align-top text-center relative group">
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 transition-all hover:bg-gray-50 hover:shadow-sm"
                  title="จัดการ"
                >
                  <i class="fa-solid fa-ellipsis text-[14px]"></i>
                </button>
                <div class="absolute right-full mr-1 top-3 hidden group-hover:block z-30">
                  <div class="bg-white border rounded-lg shadow-xl py-1 min-w-[100px] overflow-hidden">
                    <button
                      @click="onEditRow(r)"
                      class="w-full px-3 py-2 text-left text-[13px] hover:bg-orange-50 text-orange-600 flex items-center gap-2 transition-colors"
                    >
                      <i class="fa-solid fa-pen-to-square"></i>
                      แก้ไข
                    </button>
                    <button
                      @click="removeRow(r)"
                      class="w-full px-3 py-2 text-left text-[13px] hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors border-t border-gray-50"
                    >
                      <i class="fa-solid fa-trash-can"></i>
                      ลบ
                    </button>
                  </div>
                </div>
              </td>
            </tr>
            <tr v-if="loading">
              <td :colspan="selectionMode ? 17 : 16" class="px-4 py-10 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td :colspan="selectionMode ? 17 : 16" class="px-4 py-10 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
