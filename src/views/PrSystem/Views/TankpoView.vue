<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
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
const selectedStaff = ref(null)
const selectedType = ref('all') // 'all', 'po', 'ap'
const detailSearchQuery = ref('')
const displayDateRange = ref({ from: '', to: '' })
const chartRef = ref(null)
let chartInstance = null

const isOutOfSync = computed(() => {
  return displayDateRange.value.from !== trcloudDateFrom.value || 
         displayDateRange.value.to !== trcloudDateTo.value
})

// จัดกลุ่มข้อมูลตาม Staff จาก poRows พร้อมตัวกรองวันที่
const staffSummary = computed(() => {
  let rows = trcloudStore.poRows

  // Client-side Date Filter (Instant)
  if (displayDateRange.value.from && displayDateRange.value.to) {
    rows = rows.filter(r => {
      let docDate = r.issue_date || r.date || ''
      if (!docDate) return false
      if (docDate.includes(' ')) docDate = docDate.split(' ')[0]
      else if (docDate.includes('T')) docDate = docDate.split('T')[0]
      return docDate >= displayDateRange.value.from && docDate <= displayDateRange.value.to
    })
  }

  const summaryMap = {}

  rows.forEach(row => {
    const staffName = row.staff || 'ไม่ระบุชื่อ'
    const docId = row.document_number || row.po_id || row.id

    if (!summaryMap[staffName]) {
      summaryMap[staffName] = {
        name: staffName,
        uniqueDocIds: new Set(),
        uniquePoIds: new Set(),
        uniqueApIds: new Set(),
        totalAmount: 0,
        items: []
      }
    }
    
    // เก็บรายการทั้งหมดลงใน items เสมอ (สำหรับตารางรายละเอียด)
    summaryMap[staffName].items.push(row)

    // นับจำนวนแบบไม่ซ้ำตามเลขที่เอกสาร
    if (docId && !summaryMap[staffName].uniqueDocIds.has(docId)) {
      summaryMap[staffName].uniqueDocIds.add(docId)

      const hasAp = row.expense || row.ap_id || row.invoice_number?.includes('AP') || (row.status && row.status.includes('ชำระแล้ว'))
      if (hasAp) {
        summaryMap[staffName].uniqueApIds.add(docId)
      } else {
        summaryMap[staffName].uniquePoIds.add(docId)
      }
      
      // บวกมูลค่าเฉพาะเลขที่เอกสารที่ไม่ซ้ำ
      summaryMap[staffName].totalAmount += parseFloat(row.grand_total || 0)
    }
  })

  return Object.values(summaryMap).map(s => ({
    ...s,
    count: s.uniqueDocIds.size,
    passedCount: s.uniqueApIds.size,
    notPassedCount: s.uniquePoIds.size
  })).sort((a, b) => b.count - a.count)
})

// ข้อมูลรายละเอียดของ Staff ที่เลือก
const staffDetails = computed(() => {
  if (!selectedStaff.value) return []
  let items = selectedStaff.value.items

  // กรองตามประเภทที่คลิก (PO หรือ AP)
  if (selectedType.value === 'po') {
    items = items.filter(row => {
      const hasAp = row.expense || row.ap_id || row.invoice_number?.includes('AP') || (row.status && row.status.includes('ชำระแล้ว'))
      return !hasAp
    })
  } else if (selectedType.value === 'ap') {
    items = items.filter(row => {
      const hasAp = row.expense || row.ap_id || row.invoice_number?.includes('AP') || (row.status && row.status.includes('ชำระแล้ว'))
      return hasAp
    })
  }

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

// สรุปยอดรวมทั้งหมด
const totalStats = computed(() => {
  const all = staffSummary.value
  return {
    staffCount: all.length,
    totalPO: all.reduce((s, x) => s + x.notPassedCount, 0),
    totalAP: all.reduce((s, x) => s + x.passedCount, 0),
    totalAmount: all.reduce((s, x) => s + x.totalAmount, 0)
  }
})

function buildChart() {
  if (!chartRef.value) return
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tickColor = isDark ? '#9ca3af' : '#6b7280'

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  // Plugin: แสดงตัวเลขปลายแท่ง
  const dataLabelPlugin = {
    id: 'dataLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      chart.data.datasets.forEach((dataset, dsIdx) => {
        const meta = chart.getDatasetMeta(dsIdx)
        if (meta.hidden) return
        meta.data.forEach((bar, idx) => {
          const val = dataset.data[idx]
          if (val === undefined || val === null) return
          
          const { x, y } = bar.tooltipPosition()
          ctx.save()
          // ถ้าค่าเป็น 0 ให้ใช้สีจางๆ
          ctx.fillStyle = val === 0 
            ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')
            : (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)')
          
          ctx.font = val === 0 ? '400 9px sans-serif' : 'bold 10px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          
          // ถ้าค่าเป็น 0 ให้แสดงเลข 0 เล็กๆ หรือจะไม่แสดงก็ได้ แต่ตามรูปเหมือนอยากให้เห็น
          ctx.fillText(val, x, y - 5)
          ctx.restore()
        })
      })
    }
  }

  // eslint-disable-next-line no-undef
  chartInstance = new Chart(chartRef.value, {
    type: 'bar',
    plugins: [dataLabelPlugin],
    data: {
      labels: staffSummary.value.map(s => s.name),
      datasets: [
        {
          label: 'PO',
          data: staffSummary.value.map(s => s.notPassedCount),
          backgroundColor: 'rgba(249,115,22,0.75)',
          borderColor: '#f97316',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'AP',
          data: staffSummary.value.map(s => s.passedCount),
          backgroundColor: 'rgba(34,211,238,0.70)',
          borderColor: '#22d3ee',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }
      ]
    },
    options: {
      indexAxis: 'x', // แนวตั้ง
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (item) => ` ${item.dataset.label}: ${item.raw} รายการ`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: tickColor,
            font: { size: 10 },
            autoSkip: false,
            maxRotation: 45,
            minRotation: 45,
            callback: function(val) {
              const label = this.getLabelForValue(val)
              return label.length > 12 ? label.slice(0, 11) + '…' : label
            }
          },
          grid: { display: false }
        },
        y: {
          ticks: { color: tickColor, font: { size: 10 } },
          grid: { color: gridColor }
        }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return
        const idx = elements[0].index
        const dsIdx = elements[0].datasetIndex // 0 สำหรับ PO, 1 สำหรับ AP
        const staff = staffSummary.value[idx]
        if (staff) {
          selectedStaff.value = staff
          selectedType.value = dsIdx === 0 ? 'po' : 'ap'
          detailSearchQuery.value = ''
          highlightBar(staff.name)
        }
      },
      onHover: (evt, elements) => {
        if (chartRef.value) {
          chartRef.value.style.cursor = elements.length ? 'pointer' : 'default'
        }
      }
    }
  })
}

// ไฮไลต์แท่งที่เลือก
function highlightBar(staffName) {
  if (!chartInstance) return
  const idx = staffSummary.value.findIndex(s => s.name === staffName)
  chartInstance.data.datasets.forEach((ds, dsIdx) => {
    ds.backgroundColor = staffSummary.value.map((s, i) => {
      if (i !== idx) return dsIdx === 0 ? 'rgba(249,115,22,0.35)' : 'rgba(34,211,238,0.35)'
      return dsIdx === 0 ? 'rgba(249,115,22,1)' : 'rgba(34,211,238,1)'
    })
    // เพิ่มความหนาเส้นขอบให้แท่งที่เลือก
    ds.borderWidth = staffSummary.value.map((s, i) => i === idx ? 2 : 1)
  })
  chartInstance.update('none')
}

function resetHighlight() {
  if (!chartInstance) return
  chartInstance.data.datasets[0].backgroundColor = staffSummary.value.map(() => 'rgba(249,115,22,0.75)')
  chartInstance.data.datasets[1].backgroundColor = staffSummary.value.map(() => 'rgba(34,211,238,0.70)')
  chartInstance.data.datasets.forEach(ds => {
    ds.borderWidth = 1
  })
  chartInstance.update('none')
}

function selectStaff(staff) {
  selectedStaff.value = staff
  selectedType.value = 'all' // ถ้าเลือกจากรายชื่อ ให้โชว์ทั้งหมด
  detailSearchQuery.value = ''
  highlightBar(staff.name)
}

function clearSelection() {
  selectedStaff.value = null
  selectedType.value = 'all'
  resetHighlight()
}

async function fetchData() {
  await trcloudStore.fetchTrcloudData('po')
  displayDateRange.value = {
    from: trcloudDateFrom.value,
    to: trcloudDateTo.value
  }
  await nextTick()
  buildChart()
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
  
  // ตั้งค่าเป็นค่าว่างเพื่อให้แสดง "ข้อมูลทั้งหมด" ใน UI
  trcloudDateFrom.value = ''
  trcloudDateTo.value = ''
  displayDateRange.value = { from: '', to: '' }
  activeFilter.value = 'all'
  
  // แต่ถ้าต้อง Fetch จาก Server ให้ใช้ช่วงวันที่กว้างๆ (2020) ไปขอข้อมูล
  if (shouldFetch) {
    const originalFrom = trcloudDateFrom.value
    const originalTo = trcloudDateTo.value
    
    trcloudStore.dateFrom = '2020-01-01'
    trcloudStore.dateTo = today
    fetchData().then(() => {
      // หลัง Fetch เสร็จ ให้ UI กลับมาเป็นค่าว่างเหมือนเดิมเพื่อความสวยงาม
      trcloudDateFrom.value = ''
      trcloudDateTo.value = ''
      displayDateRange.value = { from: '', to: '' }
    })
  }
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
    } else if (!trcloudDateFrom.value && !trcloudDateTo.value) {
      activeFilter.value = 'all'
    } else {
      activeFilter.value = ''
    }
})

function goToSubmitAmount() {
  emit('selectPage', { itemId: '/#/submit_amount', itemLabel: 'สรุปจำนวนตาม Staff' })
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

// โหลด Chart.js ถ้ายังไม่มี
function loadChartJs() {
  return new Promise((resolve) => {
    if (window.Chart) { resolve(); return }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
    script.onload = resolve
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  await loadChartJs()
  await nextTick()
  // Always fetch All Data on mount to ensure memory is ready for instant switching
  setAllData(true)
})

onBeforeUnmount(() => {
  if (chartInstance) chartInstance.destroy()
})

// watch staffSummary: เพื่ออัปเดตกราฟเมื่อมีการกรองข้อมูล (เช่น กดปุ่ม วันนี้/ทั้งหมด)
watch(
  () => staffSummary.value,
  async (newSummary) => {
    await nextTick()
    buildChart()
  },
  { deep: true }
)

// watch chartRef: กรณี canvas DOM render ช้ากว่าข้อมูล
watch(chartRef, async (el) => {
  if (!el) return
  await nextTick()
  if (staffSummary.value.length > 0) buildChart()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="mb-4 flex justify-between items-end">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายงานสรุปตามคนเปิด PO (แผนภูมิ)</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงจำนวน PO และ AP แยกตามรายชื่อคนเปิด — คลิกแท่งเพื่อดูรายละเอียด</p>
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
      <div v-else class="flex flex-col items-end gap-1">
        <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wider">กำลังแสดงข้อมูล</div>
        <div class="text-[13px] px-4 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 shadow-sm text-green-600">
          <i class="fa-solid fa-list-check mr-2 opacity-70"></i>
          <span class="font-bold">ข้อมูลทั้งหมดในระบบ</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-4 mb-4 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
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

      <div class="ml-auto">
        <button @click="goToSubmitAmount" class="px-4 py-1.5 rounded-lg text-[13px] font-medium border hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style="border-color: var(--color-border); color: var(--color-text-muted)">
          <i class="fa-solid fa-arrow-left mr-1"></i>
          กลับคืน
        </button>
      </div>
    </div>

    <!-- Main Content: Chart TOP + Table BOTTOM (Stack vertically to give chart more width) -->
    <div class="flex flex-col flex-1 gap-4 overflow-hidden min-h-0">

      <!-- TOP: Vertical Bar Chart (Wide) -->
      <div class="flex flex-col rounded-xl border overflow-hidden shrink-0" style="height: 380px; background: var(--color-bg-card); border-color: var(--color-border)">
        <!-- Chart Header -->
        <div class="px-4 pt-3 pb-2 flex items-center justify-between" style="border-bottom: 1px solid var(--color-border)">
          <span class="text-[13px] font-semibold" style="color: var(--color-text-primary)">จำนวนเอกสารตาม Staff (รายคน)</span>
          <div class="flex gap-4 text-[11px]" style="color: var(--color-text-muted)">
            <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-orange-400 shadow-sm"></span>PO</span>
            <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-cyan-400 shadow-sm"></span>AP</span>
          </div>
        </div>

        <div class="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div v-if="loading" class="flex flex-col items-center justify-center h-full gap-2">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
            <span class="text-[13px]" style="color: var(--color-text-muted)">กำลังดึงข้อมูล...</span>
          </div>
          <div v-else-if="staffSummary.length === 0" class="flex items-center justify-center h-full" style="color: var(--color-text-muted)">
            ไม่พบข้อมูลในช่วงวันที่เลือก
          </div>
          <!-- Vertical Bar Chart Canvas (Scrollable width if many staff) -->
          <div v-else :style="{ position: 'relative', height: '100%', width: `${Math.max(staffSummary.length * 60, 800)}px` }">
            <canvas ref="chartRef" role="img" aria-label="แผนภูมิแท่งแนวตั้งแสดงจำนวน PO และ AP ของแต่ละพนักงาน"></canvas>
          </div>
        </div>
      </div>

      <!-- RIGHT: Detail Table -->
      <div class="flex-1 flex flex-col rounded-xl border overflow-hidden min-w-0" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <!-- Table Header -->
        <div class="p-3 flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/50" style="border-bottom: 1px solid var(--color-border)">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-[14px]" style="color: var(--color-text-primary)">
                {{ selectedStaff ? selectedStaff.name : 'คลิกแท่งกราฟเพื่อดูรายละเอียด' }}
              </span>
              <template v-if="selectedStaff">
                <button 
                  @click="selectedType = 'all'"
                  :class="['text-[11px] px-2 py-0.5 rounded-full font-medium transition-all', selectedType === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200']"
                >
                  ทั้งหมด: {{ selectedStaff.count }}
                </button>
                <button 
                  @click="selectedType = 'po'"
                  :class="['text-[11px] px-2 py-0.5 rounded-full font-medium transition-all', selectedType === 'po' ? 'bg-orange-500 text-white shadow-sm' : 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 hover:bg-orange-100']"
                >
                  เฉพาะ PO: {{ selectedStaff.notPassedCount }}
                </button>
                <button 
                  @click="selectedType = 'ap'"
                  :class="['text-[11px] px-2 py-0.5 rounded-full font-medium transition-all', selectedType === 'ap' ? 'bg-cyan-500 text-white shadow-sm' : 'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400 hover:bg-cyan-100']"
                >
                  เฉพาะ AP: {{ selectedStaff.passedCount }}
                </button>
              </template>
            </div>
            <div class="flex items-center gap-2">
              <div v-if="selectedStaff" class="flex items-center gap-3 mr-2">
                <span class="text-[12px]" style="color: var(--color-text-muted)">
                  จำนวนทั้งหมด <span class="font-bold text-orange-600">{{ staffDetails.length }}</span> รายการ
                </span>
              </div>
              <button v-if="selectedStaff" @click="clearSelection" class="text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-gray-100 dark:hover:bg-gray-800" style="border-color: var(--color-border); color: var(--color-text-muted)">
                <i class="fa-solid fa-xmark mr-1"></i>ล้าง
              </button>
            </div>
          </div>
          <div v-if="selectedStaff" class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
            <input v-model="detailSearchQuery" type="text" placeholder="ค้นหาในตาราง (เลขที่เอกสาร, โครงการ, สถานะ...)" class="w-full pl-8 pr-4 py-1.5 bg-white dark:bg-gray-800 border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
          </div>
        </div>

        <div class="flex-1 overflow-auto">
          <table v-if="selectedStaff" class="w-full text-[13px] border-collapse">
            <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900" style="border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="px-3 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">เลขที่เอกสาร</th>
                <th class="px-3 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">วันที่</th>
                <th class="px-3 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">อายุเอกสาร</th>
                <th class="px-3 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">อ้างอิง PR</th>
                <th class="px-3 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">โครงการ</th>
                <th class="px-3 py-2.5 text-right font-medium" style="color: var(--color-text-muted)">มูลค่า</th>
                <th class="px-3 py-2.5 text-center font-medium" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in staffDetails"
                :key="item.unique_id || item.po_id"
                class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                style="border-bottom: 1px solid var(--color-border)"
              >
                <td class="px-3 py-2.5 font-mono font-medium text-black dark:text-white">{{ item.document_number || item.po_id }}</td>
                <td class="px-3 py-2.5" style="color: var(--color-text-primary)">{{ item.issue_date || item.date }}</td>
                <td class="px-3 py-2.5 font-medium text-gray-600 dark:text-gray-400">{{ calculateDocAge(item.issue_date || item.date) }}</td>
                <td class="px-3 py-2.5 font-mono text-gray-500">{{ item.pr || item.reference || '-' }}</td>
                <td class="px-3 py-2.5" style="color: var(--color-text-primary)">{{ item.project || '-' }}</td>
                <td class="px-3 py-2.5 text-right font-mono font-bold text-black dark:text-white">
                  {{ Number(item.grand_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}
                </td>
                <td class="px-3 py-2.5 text-center">
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
            <i class="fa-solid fa-hand-pointer text-4xl mb-4 opacity-20"></i>
            <p class="text-[13px]">คลิกแท่งกราฟด้านบน<br>เพื่อดูรายละเอียดเลขที่เอกสารของ Staff</p>
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