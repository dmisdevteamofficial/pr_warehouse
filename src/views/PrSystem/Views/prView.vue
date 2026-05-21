<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTrcloudStore } from '@/stores/trcloud'

const props = defineProps({
  initialTab: { type: String, default: 'pr' },
  initialSource: { type: String, default: 'supabase' }
})

const auth = useAuthStore()
const trcloudStore = useTrcloudStore()

const loading = ref(true)
const saving = ref(false)
const rows = ref([])

// --- TRCLOUD API Integration ---
const trcloudRows = computed(() => trcloudStore.prRows)
const trcloudLoading = computed(() => trcloudStore.loading)
const trcloudDateFrom = computed({
  get: () => trcloudStore.dateFrom,
  set: (val) => trcloudStore.dateFrom = val
})
const trcloudDateTo = computed({
  get: () => trcloudStore.dateTo,
  set: (val) => trcloudStore.dateTo = val
})
const trcloudFilter = ref('')
const _viewMode = ref('all')

// ✅ เมื่อสลับไปหน้า 'tracking' ให้ rebuild frozenOrder ใหม่
//    → tracked rows ขึ้นบนสุด เรียงตามลำดับที่ติ๊กล่าสุด
//    เมื่อสลับกลับ 'all' ก็ rebuild ด้วยเพื่อรีเซ็ตลำดับปกติ
const viewMode = computed({
  get: () => _viewMode.value,
  set: (val) => {
    _viewMode.value = val
    // rebuild ด้วย rows ปัจจุบันทันที
    if (trcloudStore.prRows.length) {
      buildFrozenOrder(trcloudStore.prRows)
    }
  }
})
const projectFilter = ref('')
const statusFilter = ref('')
const monthFilter = ref('')
const monthOptions = [
  { value: '01', label: 'มกราคม' },
  { value: '02', label: 'กุมภาพันธ์' },
  { value: '03', label: 'มีนาคม' },
  { value: '04', label: 'เมษายน' },
  { value: '05', label: 'พฤษภาคม' },
  { value: '06', label: 'มิถุนายน' },
  { value: '07', label: 'กรกฎาคม' },
  { value: '08', label: 'สิงหาคม' },
  { value: '09', label: 'กันยายน' },
  { value: '10', label: 'ตุลาคม' },
  { value: '11', label: 'พฤศจิกายน' },
  { value: '12', label: 'ธันวาคม' }
]
const TRACK_STORAGE_KEY = 'trcloud_pr_tracked_rows'
const TRACK_TABLE = 'trcloud_tracking'
const TRACK_DOC_TYPE = 'pr'
const trackedRowIds = ref(loadTrackedRowIds())

// ─── frozenOrder: lock การเรียงลำดับระหว่าง session ───────────────────────────
// สร้างครั้งแรกตอน rows โหลดมา หรือตอน fetch ใหม่
// ตอนติ๊ก checkbox จะไม่ rebuild → row ไม่กระโดด
const frozenOrder = ref([])
const frozenOrderReady = ref(false)

function buildFrozenOrder(rows) {
  const tracked = trackedRowIds.value
  const isTracking = _viewMode.value === 'tracking'

  const sorted = [...rows].sort((a, b) => {
    const dA = a.issue_date || a.date || ''
    const dB = b.issue_date || b.date || ''

    if (!isTracking) {
      // "ข้อมูลทั้งหมด": เรียงวันที่ล่าสุดปกติ ไม่ดึง tracked ขึ้นบน
      return dB.localeCompare(dA)
    }

    // "ติดตามงาน": tracked ขึ้นบนสุด เรียงตามลำดับที่ติ๊กล่าสุดก่อน
    const idA = getRowIdentity(a)
    const idB = getRowIdentity(b)
    const tA = tracked.indexOf(idA)
    const tB = tracked.indexOf(idB)
    if (tA !== -1 && tB !== -1) return tA - tB
    if (tA !== -1) return -1
    if (tB !== -1) return 1
    return dB.localeCompare(dA)
  })

  frozenOrder.value = sorted.map(r => getRowIdentity(r))
  frozenOrderReady.value = true
}
// ──────────────────────────────────────────────────────────────────────────────

function loadTrackedRowIds() {
  try {
    const raw = localStorage.getItem(TRACK_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistTrackedRowIds() {
  localStorage.setItem(TRACK_STORAGE_KEY, JSON.stringify(trackedRowIds.value))
}

async function loadTrackedRowIdsFromCloud() {
  try {
    const { data, error } = await supabase
      .from(TRACK_TABLE)
      .select('doc_key')
      .eq('doc_type', TRACK_DOC_TYPE)
    if (error) throw error
    const cloudIds = (data || []).map((r) => String(r.doc_key || '')).filter(Boolean)
    
    // ใช้ข้อมูลจาก Cloud เป็นหลัก
    trackedRowIds.value = cloudIds
    
    // ล้างข้อมูลที่ไม่มีอยู่ในตารางแล้ว (Cleanup)
    cleanupTrackedIds()
    
    persistTrackedRowIds()
  } catch (err) {
    console.warn('PR track cloud load failed, fallback to local:', err?.message || err)
  }
}

// ฟังก์ชันสำหรับล้าง ID ที่ไม่มีอยู่ในข้อมูลปัจจุบันแล้ว
function cleanupTrackedIds() {
  if (trcloudStore.prRows.length === 0) return
  
  const currentIds = new Set(trcloudStore.prRows.map(r => getRowIdentity(r)))
  const validTrackedIds = trackedRowIds.value.filter(id => currentIds.has(id))
  
  if (validTrackedIds.length !== trackedRowIds.value.length) {
    trackedRowIds.value = validTrackedIds
    // ถ้ามีการเปลี่ยนแปลงลำดับ ให้ rebuild frozenOrder ด้วย
    if (frozenOrderReady.value) {
      buildFrozenOrder(trcloudStore.prRows)
    }
  }
}

async function setTrackedCloud(docKeys, checked) {
  try {
    const keys = Array.isArray(docKeys) ? docKeys : [docKeys]
    if (checked) {
      await supabase.from(TRACK_TABLE).delete().eq('doc_type', TRACK_DOC_TYPE).in('doc_key', keys)
      const inserts = keys.map(k => ({
        doc_type: TRACK_DOC_TYPE,
        doc_key: k,
        checked: true,
        updated_by: auth.user?.id || null
      }))
      const { error: insertError } = await supabase.from(TRACK_TABLE).insert(inserts)
      if (insertError) throw insertError
      return
    }
    const { error } = await supabase
      .from(TRACK_TABLE)
      .delete()
      .eq('doc_type', TRACK_DOC_TYPE)
      .in('doc_key', keys)
    if (error) throw error
  } catch (err) {
    console.warn('PR track cloud sync failed, keep local only:', err?.message || err)
  }
}

const availableProjects = computed(() => {
  const projects = trcloudStore.prRows.map(r => r.project).filter(Boolean)
  return [...new Set(projects)].sort()
})

const availableStatuses = computed(() => {
  const statuses = trcloudStore.prRows.map(r => r.status).filter(Boolean)
  return [...new Set(statuses)].sort()
})

const trcloudKpi = computed(() => {
  const sum = (arr, key) => arr.reduce((s, x) => s + parseFloat(x[key] || 0), 0)
  const prAmt = sum(trcloudRows.value, 'grand_total')
  return {
    prCount: trcloudRows.value.length,
    prAmt
  }
})

async function fetchTrcloudData() {
  // reset frozenOrder ก่อน fetch → จะ rebuild ใหม่หลังข้อมูลมา
  frozenOrderReady.value = false
  await trcloudStore.fetchTrcloudData('pr', { force: true })
  cleanupTrackedIds()
}

// ล้างข้อมูลทุกครั้งที่ข้อมูลใน Store เปลี่ยนแปลง
watch(() => trcloudStore.prRows, () => {
  cleanupTrackedIds()
}, { deep: true })

onMounted(() => {
  loadTrackedRowIdsFromCloud()
  if (trcloudRows.value.length === 0) {
    fetchTrcloudData()
  }
})

watch(
  () => trcloudStore.prRows,
  (rows) => {
    if (!rows.length) return

    const activeRowsById = new Map(rows.map((r) => [getRowIdentity(r), r]))
    const nextTracked = trackedRowIds.value.filter((id) => {
      const row = activeRowsById.get(id)
      if (!row) return false
      return !isSuccessStatus(row.status)
    })
    if (nextTracked.length !== trackedRowIds.value.length) {
      const removedIds = trackedRowIds.value.filter((id) => !nextTracked.includes(id))
      trackedRowIds.value = nextTracked
      persistTrackedRowIds()
      setTrackedCloud(removedIds, false)
    }

    // ✅ build frozenOrder เมื่อข้อมูลมาใหม่ (mount ครั้งแรก หรือ fetch ใหม่)
    // แต่จะไม่ถูกเรียกตอนแค่ติ๊ก checkbox เพราะ prRows ไม่เปลี่ยน
    buildFrozenOrder(rows)
  },
  { immediate: true, deep: true }
)

const filteredTrcloudRows = computed(() => {
  let result = trcloudStore.prRows

  // Filter by Date (Client-side)
  if (trcloudDateFrom.value || trcloudDateTo.value) {
    result = result.filter(r => {
      const docDate = r.issue_date || r.date || r.issueDate
      if (!docDate) return true
      if (trcloudDateFrom.value && docDate < trcloudDateFrom.value) return false
      if (trcloudDateTo.value && docDate > trcloudDateTo.value) return false
      return true
    })
  }

  // Filter by View Mode (Tracking: Show all non-success items)
  if (viewMode.value === 'tracking') {
    result = result.filter(r => {
      const s = (r.status || '').toLowerCase()
      const isSuccess = s.includes('success') || s.includes('เสร็จสิ้น') || s.includes('เรียบร้อย') || s.includes('สำเร็จ')
      return !isSuccess
    })
  }

  // Filter by Project
  if (projectFilter.value) {
    result = result.filter(r => r.project === projectFilter.value)
  }

  // Filter by Status
  if (statusFilter.value) {
    result = result.filter(r => r.status === statusFilter.value)
  }

  // Filter by Month
  if (monthFilter.value) {
    result = result.filter(r => getDocMonth(r) === monthFilter.value)
  }

  // Search filter
  const q = trcloudFilter.value.toLowerCase().trim()
  if (q) {
    result = result.filter(r =>
      JSON.stringify(r).toLowerCase().includes(q)
    )
  }

  // ✅ เรียงตาม frozenOrder (snapshot ตอน mount/fetch) → ติ๊กแล้วไม่กระโดด
  if (frozenOrderReady.value && frozenOrder.value.length) {
    const orderMap = new Map(frozenOrder.value.map((id, i) => [id, i]))
    return [...result].sort((a, b) => {
      const ia = orderMap.get(getRowIdentity(a)) ?? 99999
      const ib = orderMap.get(getRowIdentity(b)) ?? 99999
      if (ia !== ib) return ia - ib
      // rows ใหม่ที่ไม่อยู่ใน frozenOrder → เรียงตามวันที่
      const dA = a.issue_date || a.date || ''
      const dB = b.issue_date || b.date || ''
      return dB.localeCompare(dA)
    })
  }

  // fallback ถ้า frozenOrder ยังไม่พร้อม
  return [...result].sort((a, b) => {
    const dA = a.issue_date || a.date || ''
    const dB = b.issue_date || b.date || ''
    return dB.localeCompare(dA)
  })
})

function getTrcloudBadgeInfo(status) {
  if (!status) return { text: '—', bg: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: 'rgba(148,163,184,0.3)' }
  const s = status.toString().toLowerCase()
  if (s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('complete') || s.includes('อนุมัติ')) {
    return { text: status, bg: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'rgba(16,185,129,0.3)' }
  }
  if (s.includes('ยังไม่') || s.includes('ค้าง') || s.includes('unpaid') || s.includes('cancel')) {
    return { text: status, bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' }
  }
  if (s.includes('รอ') || s.includes('pending') || s.includes('draft') || s.includes('ส่ง')) {
    return { text: status, bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' }
  }
  return { text: status, bg: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: 'rgba(148,163,184,0.3)' }
}

function calculateDocAge(dateStr) {
  if (!dateStr) return '-'
  const docDate = new Date(dateStr)
  if (isNaN(docDate)) return '-'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  docDate.setHours(0, 0, 0, 0)
  const diffTime = today - docDate
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? `${diffDays} วัน` : 'วันนี้'
}

function getStaffName(row) {
  return row.staff || '-'
}

function getDocMonth(row) {
  const docDate = row.issue_date || row.date || row.issueDate
  if (!docDate) return ''
  const monthPart = String(docDate).split('-')[1]
  return monthPart && monthPart.length === 2 ? monthPart : ''
}

function getRowIdentity(row) {
  return String(row.unique_id || row.document_number || row.pr_id || row.id || '')
}

function isSuccessStatus(status) {
  const s = (status || '').toString().toLowerCase()
  return s.includes('success') || s.includes('เสร็จสิ้น') || s.includes('เรียบร้อย')
}

function isTracked(row) {
  const id = getRowIdentity(row)
  return id ? trackedRowIds.value.includes(id) : false
}

// ✅ toggleTracked: เลือก siblings อัตโนมัติเมื่อติ๊กถูก แต่ยกเลิกทีละรายการเมื่อติ๊กออก
// ลำดับแถวจะคงที่ (Frozen) จนกว่าจะโหลดหน้าใหม่
function toggleTracked(row, checked) {
  const currentId = getRowIdentity(row)
  const docNum = row.document_number || row.pr_id || ''
  if (!currentId) return

  if (checked) {
    // 1. ติ๊กถูก: เลือกทุกรายการที่มีเลขที่เอกสารเดียวกัน
    const siblings = trcloudStore.prRows.filter(r => (r.document_number || r.pr_id) === docNum)
    const siblingIds = siblings.map(r => getRowIdentity(r)).filter(Boolean)
    
    // เพิ่มเข้า trackedRowIds (ใหม่ขึ้นบนสุดของ list)
    trackedRowIds.value = [...new Set([...siblingIds, ...trackedRowIds.value])]
    
    // หมายเหตุ: ไม่แก้ frozenOrder ที่นี่ เพื่อให้แถวไม่กระโดด
    
    persistTrackedRowIds()
    setTrackedCloud(siblingIds, true)
  } else {
    // 2. ติ๊กออก: ยกเลิกเฉพาะรายการที่กดเท่านั้น
    trackedRowIds.value = trackedRowIds.value.filter((x) => x !== currentId)
    
    // หมายเหตุ: ไม่แก้ frozenOrder ที่นี่
    
    persistTrackedRowIds()
    setTrackedCloud(currentId, false)
  }
}

function getDisplayBadgeInfo(row) {
  const tracked = isTracked(row)
  if (tracked && !isSuccessStatus(row.status)) {
    return {
      text: getTrcloudBadgeInfo(row.status).text,
      bg: 'rgba(239,68,68,0.15)',
      color: '#ef4444',
      border: 'rgba(239,68,68,0.35)'
    }
  }
  return getTrcloudBadgeInfo(row.status)
}
</script>

<template>
  <div class="p-0 md:p-0">
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการ PR </h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">จัดการข้อมูลการขอซื้อจากระบบ TRCLOUD</p>
    </div>

    <!-- Mode Switcher -->
    <div class="flex items-center gap-1 p-1 rounded-lg mb-6 w-fit border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <button
        @click="viewMode = 'all'"
        :class="[
          'px-6 py-2 rounded-md text-[13px] font-medium transition-all',
          viewMode === 'all'
            ? 'bg-blue-600 text-white shadow-md'
            : 'text-gray-500 hover:text-gray-700'
        ]"
      >
        ข้อมูลทั้งหมด
      </button>
      <button
        @click="viewMode = 'tracking'"
        :class="[
          'px-6 py-2 rounded-md text-[13px] font-medium transition-all',
          viewMode === 'tracking'
            ? 'bg-blue-600 text-white shadow-md'
            : 'text-gray-500 hover:text-gray-700'
        ]"
      >
        ติดตามงาน
      </button>
    </div>

    <!-- KPI Card -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="p-4 rounded-xl border relative overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
        <div class="text-[12px] font-medium uppercase tracking-wider mb-2" style="color: var(--color-text-muted)">
          {{ viewMode === 'all' ? 'ใบขอซื้อ (ทั้งหมด)' : 'ใบขอซื้อ (ติดตามงาน)' }}
        </div>
        <div class="text-2xl font-bold font-mono" style="color: var(--color-text-primary)">{{ filteredTrcloudRows.length }}</div>
        <div class="text-[13px] mt-1" style="color: var(--color-text-muted)">
          มูลค่ารวม <span class="font-mono text-blue-500 font-bold">{{ Number(filteredTrcloudRows.reduce((s, x) => s + parseFloat(x.grand_total || 0), 0)).toLocaleString('th-TH') }} ฿</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</label>
          <input v-model="trcloudDateFrom" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</label>
          <input v-model="trcloudDateTo" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
        </div>

        <!-- Project Filter -->
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">โครงการ</label>
          <select v-model="projectFilter" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none min-w-[150px]" style="border-color: var(--color-border); color: var(--color-text-primary)">
            <option value="">ทั้งหมด</option>
            <option v-for="p in availableProjects" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <!-- Status Filter -->
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สถานะ</label>
          <select v-model="statusFilter" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none min-w-[120px]" style="border-color: var(--color-border); color: var(--color-text-primary)">
            <option value="">ทั้งหมด</option>
            <option v-for="s in availableStatuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">เดือน</label>
          <select v-model="monthFilter" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none min-w-[130px]" style="border-color: var(--color-border); color: var(--color-text-primary)">
            <option value="">ทุกเดือน</option>
            <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>

        <button @click="fetchTrcloudData" :disabled="trcloudLoading" class="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          <i class="fa-solid fa-rotate mr-1" :class="trcloudLoading ? 'fa-spin' : ''"></i>
          ดึงข้อมูล
        </button>
      </div>
      <div class="relative w-full">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="trcloudFilter" type="text" placeholder="ค้นหาใน TRCLOUD PR..." class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1060px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อายุเอกสาร</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้ขาย/หน่วยงาน</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">Staff</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">แผนก</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">โครงการ</th>
              <th class="px-4 py-3 text-right font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">มูลค่า</th>
              <th class="px-4 py-3 text-center font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ติดตาม</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trcloudLoading">
              <td colspan="10" class="px-4 py-12 text-center">
                <div class="flex flex-col items-center gap-2">
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                  <span style="color: var(--color-text-muted)">กำลังดึงข้อมูลจาก TRCLOUD...</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="!filteredTrcloudRows.length">
              <td colspan="10" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล PR จาก TRCLOUD</td>
            </tr>
            <!--
              ✅ key ใช้ getRowIdentity เพื่อให้ Vue track DOM node ตาม identity จริง
                 ไม่ใช่ index → Vue จะ reuse DOM node เดิม ไม่สร้างใหม่
                 ทำให้ checkbox focus/state ไม่กระโดดไปที่ row อื่น
            -->
            <tr
              v-for="r in filteredTrcloudRows"
              :key="getRowIdentity(r)"
              class="hover:bg-gray-50/50 transition-colors"
              style="border-bottom: 1px solid var(--color-border)"
            >
              <td class="px-4 py-3 font-medium font-mono" style="color: #00d4ff; border-right: 1px solid var(--color-border)">{{ r.document_number || r.pr_id || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.issue_date || '-' }}</td>
              <td class="px-4 py-3 font-medium" style="color: #3b82f6; border-right: 1px solid var(--color-border)">{{ calculateDocAge(r.issue_date || r.date) }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.organization || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ getStaffName(r) }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.department || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.project || '-' }}</td>
              <td class="px-4 py-3 text-right font-mono" style="color: #f59e0b; border-right: 1px solid var(--color-border)">{{ Number(r.grand_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}) }}</td>
              <td class="px-4 py-3 text-center" style="border-right: 1px solid var(--color-border)">
                <!--
                  ✅ @mousedown.prevent — ป้องกัน browser เลื่อน focus อัตโนมัติ
                     หลัง DOM re-order (Vue reuse node แล้ว แต่ mousedown ยิงก่อน click)
                  ✅ :checked แทน v-model — ควบคุม checked state จาก trackedRowIds โดยตรง
                     ไม่ให้ Vue binding ทำงานก่อน handler ของเรา
                -->
                <input
                  type="checkbox"
                  :checked="isTracked(r)"
                  class="w-4 h-4 accent-red-600 cursor-pointer"
                  @mousedown.prevent
                  @change="toggleTracked(r, $event.target.checked)"
                />
              </td>
              <td class="px-4 py-3">
                <span
                  class="px-3 py-1 rounded-full text-[11px] font-semibold border"
                  :style="{ backgroundColor: getDisplayBadgeInfo(r).bg, color: getDisplayBadgeInfo(r).color, borderColor: getDisplayBadgeInfo(r).border }"
                >
                  {{ getDisplayBadgeInfo(r).text }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-right-enter-active, .slide-right-leave-active { transition: all 0.3s ease; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%); opacity: 0; }
</style>