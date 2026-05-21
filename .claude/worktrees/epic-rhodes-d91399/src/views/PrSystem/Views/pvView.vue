<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const trcloudStore = useTrcloudStore()
const trcloudPvRows = computed(() => trcloudStore.pvRows)
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

const trcloudKpi = computed(() => {
  const sum = (arr, key) => arr.reduce((s, x) => s + parseFloat(x[key] || 0), 0)
  const pvAmt = sum(trcloudPvRows.value, 'grand_total')
  return {
    pvCount: trcloudPvRows.value.length,
    pvAmt
  }
})

async function fetchTrcloudData() {
  await trcloudStore.fetchTrcloudData('pv')
}

onMounted(() => {
  // Only fetch if data is empty to avoid redundant calls
  if (trcloudPvRows.value.length === 0) {
    fetchTrcloudData()
  }
})

const filteredTrcloudRows = computed(() => {
  let rows = trcloudPvRows.value

  // Filter by Date (Client-side)
  if (trcloudDateFrom.value || trcloudDateTo.value) {
    rows = rows.filter(r => {
      const docDate = r.issue_date || r.date || r.issueDate
      if (!docDate) return true
      if (trcloudDateFrom.value && docDate < trcloudDateFrom.value) return false
      if (trcloudDateTo.value && docDate > trcloudDateTo.value) return false
      return true
    })
  }

  if (monthFilter.value) {
    rows = rows.filter(r => getDocMonth(r) === monthFilter.value)
  }

  const q = trcloudFilter.value.toLowerCase().trim()
  if (!q) {
    // Sort by Date Descending (Newest first)
    return [...rows].sort((a, b) => {
      const dateA = a.issue_date || a.date || ''
      const dateB = b.issue_date || b.date || ''
      return dateB.localeCompare(dateA)
    })
  }
  
  const filtered = rows.filter(r => 
    JSON.stringify(r).toLowerCase().includes(q)
  )

  // Sort by Date Descending (Newest first)
  return [...filtered].sort((a, b) => {
    const dateA = a.issue_date || a.date || ''
    const dateB = b.issue_date || b.date || ''
    return dateB.localeCompare(dateA)
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
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการ PV</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">จัดการข้อมูลใบสำคัญจ่ายจาก TRCLOUD</p>
    </div>

    <!-- KPI Card -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="p-4 rounded-xl border relative overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
        <div class="text-[12px] font-medium uppercase tracking-wider mb-2" style="color: var(--color-text-muted)">ใบสำคัญจ่าย (PV)</div>
        <div class="text-2xl font-bold font-mono" style="color: var(--color-text-primary)">{{ trcloudKpi.pvCount }}</div>
        <div class="text-[13px] mt-1" style="color: var(--color-text-muted)">
          มูลค่ารวม <span class="font-mono text-green-500 font-bold">{{ Number(trcloudKpi.pvAmt).toLocaleString('th-TH') }} ฿</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</label>
            <input v-model="trcloudDateFrom" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</label>
            <input v-model="trcloudDateTo" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
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
      </div>
      <div class="relative w-full">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="trcloudFilter" type="text" placeholder="ค้นหาใน PV..." class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[980px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อายุเอกสาร</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้ขาย/หน่วยงาน</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">Staff</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อ้างอิง</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">โครงการ</th>
              <th class="px-4 py-3 text-right font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">มูลค่า</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trcloudLoading">
              <td colspan="9" class="px-4 py-12 text-center">
                <div class="flex flex-col items-center gap-2">
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                  <span style="color: var(--color-text-muted)">กำลังดึงข้อมูลจาก TRCLOUD...</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="!filteredTrcloudRows.length">
              <td colspan="9" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล PV จาก TRCLOUD</td>
            </tr>
            <tr v-for="r in filteredTrcloudRows" :key="r.payment_id || r.id" class="hover:bg-gray-50/50 transition-colors border-bottom" style="border-bottom: 1px solid var(--color-border)">
              <td class="px-4 py-3 font-medium font-mono" style="color: #10b981; border-right: 1px solid var(--color-border)">{{ (r.company_format || '') + (r.document_number || r.payment_id || '-') }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.issue_date || '-' }}</td>
              <td class="px-4 py-3 font-medium" style="color: #3b82f6; border-right: 1px solid var(--color-border)">{{ calculateDocAge(r.issue_date || r.date) }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.organization || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ getStaffName(r) }}</td>
              <td class="px-4 py-3 font-mono" style="color: #94a3b8; border-right: 1px solid var(--color-border)">{{ r.reference || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.project || '-' }}</td>
              <td class="px-4 py-3 text-right font-mono" style="color: #f59e0b; border-right: 1px solid var(--color-border)">{{ Number(r.grand_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}) }}</td>
              <td class="px-4 py-3">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border" :style="{ backgroundColor: getTrcloudBadgeInfo(r.status).bg, color: getTrcloudBadgeInfo(r.status).color, borderColor: getTrcloudBadgeInfo(r.status).border }">
                  {{ getTrcloudBadgeInfo(r.status).text }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
