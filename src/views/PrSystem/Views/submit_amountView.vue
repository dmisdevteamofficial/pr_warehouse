<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const emit = defineEmits(['selectPage'])

const trcloudStore = useTrcloudStore()
const loading = computed(() => trcloudStore.loading)
const trcloudDateFrom = computed({
  get: () => trcloudStore.dateFrom,
  set: (val) => trcloudStore.dateFrom = val
})
const trcloudDateTo = computed({
  get: () => trcloudStore.dateTo,
  set: (val) => trcloudStore.dateTo = val
})

const activeFilter = ref('')
const selectedStaffName = ref(null)
const searchQuery = ref('')
const detailSearchQuery = ref('')
const displayDateRange = ref({ from: '', to: '' })

const isOutOfSync = computed(() => {
  return displayDateRange.value.from !== trcloudDateFrom.value || 
         displayDateRange.value.to !== trcloudDateTo.value
})

const staffSummary = computed(() => {
  let rows = trcloudStore.poRows

  // Client-side Date Filter (Instant filtering from memory)
  if (displayDateRange.value.from && displayDateRange.value.to) {
    rows = rows.filter(r => {
      let docDate = r.issue_date || r.date || ''
      if (!docDate) return false
      
      // Extract only YYYY-MM-DD in case there's a time string
      if (docDate.includes(' ')) {
        docDate = docDate.split(' ')[0]
      } else if (docDate.includes('T')) {
        docDate = docDate.split('T')[0]
      }
      
      return docDate >= displayDateRange.value.from && docDate <= displayDateRange.value.to
    })
  }

  const summaryMap = {}

  rows.forEach(row => {
    const staffName = row.staff || 'ไม่ระบุชื่อ'
    if (!summaryMap[staffName]) {
      summaryMap[staffName] = {
        name: staffName,
        count: 0,
        passedCount: 0,
        notPassedCount: 0,
        totalAmount: 0,
        items: []
      }
    }
    summaryMap[staffName].count++
    const hasAp = row.expense || row.ap_id || row.invoice_number?.includes('AP') || (row.status && row.status.includes('ชำระแล้ว'))
    if (hasAp) {
      summaryMap[staffName].passedCount++
    } else {
      summaryMap[staffName].notPassedCount++
    }
    summaryMap[staffName].totalAmount += parseFloat(row.grand_total || 0)
    summaryMap[staffName].items.push(row)
  })

  return Object.values(summaryMap).sort((a, b) => b.count - a.count)
})

const filteredStaffSummary = computed(() => {
  if (!searchQuery.value) return staffSummary.value
  const q = searchQuery.value.toLowerCase()
  return staffSummary.value.filter(s => s.name.toLowerCase().includes(q))
})

const selectedStaff = computed(() => {
  if (!selectedStaffName.value) return null
  return staffSummary.value.find(s => s.name === selectedStaffName.value) || null
})

const staffDetails = computed(() => {
  if (!selectedStaff.value) return []
  let items = selectedStaff.value.items
  if (detailSearchQuery.value) {
    const q = detailSearchQuery.value.toLowerCase().trim()
    items = items.filter(item => JSON.stringify(item).toLowerCase().includes(q))
  }
  return items.sort((a, b) => {
    const dateA = a.issue_date || a.date || ''
    const dateB = b.issue_date || b.date || ''
    return dateB.localeCompare(dateA)
  })
})

async function fetchData() {
  await trcloudStore.fetchTrcloudData('po')
  displayDateRange.value = {
    from: trcloudDateFrom.value,
    to: trcloudDateTo.value
  }
}

function selectStaff(staff) {
  selectedStaffName.value = staff.name
  detailSearchQuery.value = ''
}

function setToday() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`
  trcloudDateFrom.value = today
  trcloudDateTo.value = today
  displayDateRange.value = { from: today, to: today }
  activeFilter.value = 'today'
}

function setAllData(shouldFetch = false) {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`
  const allFrom = '2020-01-01'
  
  trcloudDateFrom.value = allFrom
  trcloudDateTo.value = today
  displayDateRange.value = { from: allFrom, to: today }
  activeFilter.value = 'all'
  if (shouldFetch) fetchData()
}

// Watch for manual date changes to reset activeFilter
watch([trcloudDateFrom, trcloudDateTo], () => {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`

  if (trcloudDateFrom.value === today && trcloudDateTo.value === today) {
    activeFilter.value = 'today'
  } else if (trcloudDateFrom.value === '2020-01-01' && trcloudDateTo.value === today) {
    activeFilter.value = 'all'
  } else {
    activeFilter.value = ''
  }
  
  // Auto-apply filter if user changes dates manually and it's within current memory range?
  // No, let them press search or just update displayRange
})

function goToTankpo() {
  emit('selectPage', { itemId: '/#/tankpo', itemLabel: 'สรุปตามคนเปิด PO (แผนภูมิ)' })
}

function calculateDocAge(dateStr) {
  if (!dateStr) return '-'
  const docDate = new Date(dateStr)
  if (isNaN(docDate)) return '-'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  docDate.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((today - docDate) / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? `${diffDays} วัน` : 'วันนี้'
}

function getBadgeInfo(status) {
  if (!status) return { text: '—', bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' }
  const s = status.toString().toLowerCase()
  if (s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('complete') || s.includes('อนุมัติ')) {
    return { text: status, bg: 'rgba(16,185,129,0.1)', color: '#10b981' }
  }
  if (s.includes('ยังไม่') || s.includes('ค้าง') || s.includes('unpaid') || s.includes('cancel')) {
    return { text: status, bg: 'rgba(239,68,68,0.1)', color: '#ef4444' }
  }
  return { text: status, bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
}

onMounted(async () => {
  // Always set to All Data range and fetch to ensure memory has everything
  setAllData(true)
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="mb-6 flex justify-between items-end">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายงานสรุปตามคนเปิด PO</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงจำนวนเลขที่เอกสารและรายละเอียดแยกตามรายชื่อคนเปิด PO</p>
      </div>
      <div v-if="displayDateRange.from" class="flex flex-col items-end gap-1">
        <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wider">กำลังแสดงข้อมูลช่วงวันที่</div>
        <div class="text-[13px] px-4 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 shadow-sm" style="color: var(--color-blue-600)">
          <i class="fa-solid fa-filter mr-2 opacity-70"></i>
          <span class="font-bold">{{ displayDateRange.from }}</span> 
          <span class="mx-2 opacity-50">ถึง</span> 
          <span class="font-bold">{{ displayDateRange.to }}</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</label>
        <input v-model="trcloudDateFrom" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</label>
        <input v-model="trcloudDateTo" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>

      <div class="flex items-center gap-2 mr-2">
        <button
          @click="setToday"
          :class="[
            'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
            activeFilter === 'today' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          ]"
          :style="activeFilter !== 'today' ? { borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' } : {}"
        >
          วันนี้
        </button>
        <button
          @click="setAllData"
          :class="[
            'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
            activeFilter === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          ]"
          :style="activeFilter !== 'all' ? { borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' } : {}"
        >
          ข้อมูลทั้งหมด
        </button>
      </div>

      <button
        @click="fetchData"
        :disabled="loading"
        :class="[
          'px-6 py-1.5 rounded-lg text-[13px] font-bold transition-all shadow-sm flex items-center gap-2',
          isOutOfSync ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
        ]"
      >
        <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
        {{ isOutOfSync ? 'ดึงข้อมูลใหม่จาก Server' : 'อัปเดตข้อมูล' }}
      </button>
      <div class="relative flex-1 min-w-[200px]">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="searchQuery" type="text" placeholder="ค้นหาชื่อ Staff..." class="w-full pl-9 pr-4 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
      <!-- ปุ่มไปหน้าแผนภูมิ ชิดขวา -->
      <div class="ml-auto">
        <button @click="goToTankpo" class="px-4 py-1.5 rounded-lg text-[13px] font-medium border hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5" style="border-color: var(--color-border); color: var(--color-text-muted)">
          <i class="fa-solid fa-chart-bar"></i>
          ดูแผนภูมิ
          <i class="fa-solid fa-arrow-right text-[11px]"></i>
        </button>
      </div>
    </div>

    <div class="flex flex-1 gap-6 overflow-hidden min-h-0">
      <!-- Left Side: Staff List -->
      <div class="w-1/4 flex flex-col rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 font-semibold text-[14px] bg-gray-50 dark:bg-gray-900/50 flex justify-between items-center" style="color: var(--color-text-primary); border-bottom: 1px solid var(--color-border)">
          <span>รายชื่อคนเปิด PO ({{ filteredStaffSummary.length }})</span>
          <div class="flex gap-2 text-[10px]">
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-orange-400 rounded-full"></span> PO</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-cyan-400 rounded-full"></span> AP</span>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="loading" class="p-8 text-center">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500 mb-2"></i>
            <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลด...</p>
          </div>
          <div v-else-if="filteredStaffSummary.length === 0" class="p-8 text-center" style="color: var(--color-text-muted)">
            ไม่พบข้อมูล
          </div>
          <div
            v-for="staff in filteredStaffSummary"
            :key="staff.name"
            @click="selectStaff(staff)"
            :class="[
              'p-4 cursor-pointer border-b transition-all flex items-center gap-4',
              selectedStaff?.name === staff.name ? 'border-l-4 border-l-gray-900 dark:border-l-white' : 'border-l-4 border-l-transparent'
            ]"
            style="border-bottom-color: var(--color-border)"
          >
            <div class="flex items-end gap-1 h-10 w-8 flex-shrink-0">
              <div
                class="w-3 bg-orange-400 rounded-t-sm transition-all duration-500"
                :style="{ height: `${Math.max((staff.notPassedCount / staff.count) * 100, 10)}%` }"
                :title="`ไม่ผ่าน: ${staff.notPassedCount} รายการ`"
              ></div>
              <div
                class="w-3 bg-cyan-400 rounded-t-sm transition-all duration-500"
                :style="{ height: `${Math.max((staff.passedCount / staff.count) * 100, 10)}%` }"
                :title="`ผ่าน: ${staff.passedCount} รายการ`"
              ></div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-start mb-1">
                <span class="font-semibold text-[13px] truncate mr-2" :style="{ color: selectedStaff?.name === staff.name ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }">{{ staff.name }}</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400 whitespace-nowrap">
                  {{ staff.count }} รายการ
                </span>
              </div>
              <div class="flex justify-between items-center text-[11px]">
                <div style="color: var(--color-text-muted)">
                  มูลค่ารวม: <span class="font-mono font-medium">{{ staff.totalAmount.toLocaleString('th-TH', {minimumFractionDigits:2}) }}</span> ฿
                </div>
                <div class="flex gap-2 text-[10px] font-medium">
                  <span class="text-orange-500">PO: {{ staff.notPassedCount }}</span>
                  <span class="text-cyan-600">AP: {{ staff.passedCount }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Detail Table -->
      <div class="flex-1 flex flex-col rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 font-semibold text-[14px] bg-gray-50 dark:bg-gray-900/50 flex flex-col gap-3" style="color: var(--color-text-primary); border-bottom: 1px solid var(--color-border)">
          <div class="flex justify-between items-center">
            <span>รายละเอียดข้อมูล: {{ selectedStaff?.name || 'เลือก Staff เพื่อดูข้อมูล' }}</span>
            <span v-if="selectedStaff" class="text-[12px] font-normal" style="color: var(--color-text-muted)">
              พบทั้งหมด {{ staffDetails.length }} รายการ
            </span>
          </div>
          <div v-if="selectedStaff" class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="detailSearchQuery"
              type="text"
              placeholder="ค้นหาในตารางรายละเอียด (เลขที่เอกสาร, โครงการ, สถานะ...)"
              class="w-full pl-8 pr-4 py-1.5 bg-white dark:bg-gray-800 border rounded-lg text-[12px] focus:outline-none transition-all focus:ring-1 focus:ring-black dark:focus:ring-white"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <table v-if="selectedStaff" class="w-full text-[13px] border-collapse">
            <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900" style="border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">เลขที่เอกสาร</th>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">วันที่</th>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">อายุเอกสาร</th>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">อ้างอิง PR</th>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">โครงการ</th>
                <th class="px-4 py-3 text-right font-medium" style="color: var(--color-text-muted)">มูลค่า</th>
                <th class="px-4 py-3 text-center font-medium" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in staffDetails"
                :key="item.unique_id || item.po_id"
                class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                style="border-bottom: 1px solid var(--color-border)"
              >
                <td class="px-4 py-3 font-mono font-medium text-black dark:text-white">{{ item.document_number || item.po_id }}</td>
                <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ item.issue_date || item.date }}</td>
                <td class="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{{ calculateDocAge(item.issue_date || item.date) }}</td>
                <td class="px-4 py-3 font-mono text-gray-500">{{ item.pr || item.reference || '-' }}</td>
                <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ item.project || '-' }}</td>
                <td class="px-4 py-3 text-right font-mono font-bold text-black dark:text-white">
                  {{ Number(item.grand_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}
                </td>
                <td class="px-4 py-3 text-center">
                  <span
                    class="px-2 py-1 rounded-lg text-[11px] font-medium"
                    :style="{ backgroundColor: getBadgeInfo(item.status).bg, color: getBadgeInfo(item.status).color }"
                  >
                    {{ getBadgeInfo(item.status).text }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="h-full flex flex-col items-center justify-center p-12 text-center" style="color: var(--color-text-muted)">
            <i class="fa-solid fa-mouse-pointer text-4xl mb-4 opacity-20"></i>
            <p>กรุณาเลือกรายชื่อ Staff จากแถบด้านซ้ายมือ<br>เพื่อเรียกดูรายละเอียดเลขที่เอกสาร</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overflow-auto::-webkit-scrollbar { width: 6px; height: 6px; }
.overflow-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-auto::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
.overflow-auto::-webkit-scrollbar-thumb:hover { background: rgba(156,163,175,0.5); }
</style>