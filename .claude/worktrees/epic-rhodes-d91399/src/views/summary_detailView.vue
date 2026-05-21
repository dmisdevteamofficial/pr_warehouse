<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'

Chart.register(...registerables)

// --- State ---
const loading = ref(true)
const activeFilter = ref('this_month')
const customFrom = ref('')
const customTo = ref('')
const showCustomPicker = ref(false)
const selectedCategory = ref('all')
const selectedUsageType = ref('all')
const searchText = ref('')
const reportYear = ref(new Date().getFullYear())
const reportMonth = ref(new Date().getMonth() + 1)

const categories = ref([])
const userMap = ref({})
const categorySummary = ref([])
const itemSummary = ref([])
const usageTypeStock = ref([])
const withdrawalByPerson = ref([])
const withdrawalByDept = ref([])
const pendingWithdrawals = ref([])

const kpi = ref({
  totalItems: 0,
  totalQty: 0,
  lowStock: 0,
  importQty: 0,
  importRows: 0,
  exportQty: 0,
  exportRows: 0,
  pendingCount: 0,
  categoryCount: 0,
  uniqueWithdrawers: 0,
})

const dailyLabels = ref([])
const dailyWithdrawQty = ref([])
const dailyImportQty = ref([])

const lineChartRef = ref(null)
const barUsageRef = ref(null)
let lineChartInst = null
let barUsageInst = null

function destroyCharts() {
  lineChartInst?.destroy()
  barUsageInst?.destroy()
  lineChartInst = null
  barUsageInst = null
}

const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const endOfDay = (d) => {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function startOfWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfWeek(d) {
  const x = startOfWeek(d)
  x.setDate(x.getDate() + 6)
  x.setHours(23, 59, 59, 999)
  return x
}

function getDateRange() {
  const now = new Date()
  const today = startOfDay(now)

  switch (activeFilter.value) {
    case 'today':
      return { from: today, to: endOfDay(now), label: 'วันนี้' }
    case 'this_week':
      return { from: startOfWeek(now), to: endOfDay(now), label: 'สัปดาห์นี้' }
    case 'last_week': {
      const lw = new Date(now.getTime() - 7 * 86400000)
      const s = startOfWeek(lw)
      const e = endOfWeek(lw)
      return { from: s, to: e, label: 'สัปดาห์ที่แล้ว' }
    }
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now), label: 'เดือนนี้' }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: startOfDay(from), to: endOfDay(to), label: 'เดือนที่แล้ว' }
    }
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now), label: 'ปีนี้' }
    case 'by_month': {
      const y = reportYear.value
      const m = reportMonth.value - 1
      const from = new Date(y, m, 1)
      const to = new Date(y, m + 1, 0)
      return { from: startOfDay(from), to: endOfDay(to), label: `เดือน ${reportMonth.value}/${y}` }
    }
    case 'custom':
      return {
        from: customFrom.value ? startOfDay(new Date(customFrom.value)) : today,
        to: customTo.value ? endOfDay(new Date(customTo.value)) : endOfDay(now),
        label: 'กำหนดเอง',
      }
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now), label: 'เดือนนี้' }
  }
}

function dayKey(iso) {
  const x = new Date(iso)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

function fmtDayLabel(iso) {
  const x = new Date(iso)
  return `${x.getDate()}/${x.getMonth() + 1}`
}

function buildDayBuckets(from, to) {
  const keys = []
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  let guard = 0
  while (cur <= end && guard++ < 400) {
    keys.push(dayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

async function fetchData() {
  loading.value = true
  destroyCharts()
  const { from, to, label } = getDateRange()
  const fromISO = from.toISOString()
  const toISO = to.toISOString()

  try {
    const [categoriesRes, itemsRes, usersRes, importsRes, exportsRes, pendingRes] = await Promise.all([
      supabase.from('category').select('id, category_name').order('category_name'),
      supabase
        .from('items')
        .select('id, item_name, current_stock, min_stock, category_id, unit, usage_type')
        .order('item_name'),
      supabase.from('system_users').select('id, fullname, department'),
      supabase
        .from('inventory_imports')
        .select('amount, item_id, created_at, items(category_id)')
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      supabase
        .from('transactions')
        .select('amount, item_id, created_at, created_by, items(category_id, usage_type)')
        .gte('created_at', fromISO)
        .lte('created_at', toISO),
      supabase.from('order_req').select('id, mr_number, created_at, created_by, items(item_name, category_id)').eq('status', 'pending'),
    ])

    categories.value = categoriesRes.data || []
    const allItems = itemsRes.data || []
    const users = usersRes.data || []
    const um = {}
    users.forEach((u) => {
      um[u.id] = u
    })
    userMap.value = um

    const importsData = importsRes.data || []
    const exportsData = exportsRes.data || []
    const pendingData = pendingRes.data || []

    kpi.value.totalItems = allItems.length
    kpi.value.totalQty = allItems.reduce((s, i) => s + (Number(i.current_stock) || 0), 0)
    kpi.value.lowStock = allItems.filter((i) => (Number(i.current_stock) || 0) <= (Number(i.min_stock) || 10)).length
    kpi.value.importQty = importsData.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    kpi.value.importRows = importsData.length
    kpi.value.exportQty = exportsData.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    kpi.value.exportRows = exportsData.length
    kpi.value.pendingCount = pendingData.length
    kpi.value.categoryCount = categories.value.length
    kpi.value.uniqueWithdrawers = new Set(exportsData.map((r) => r.created_by).filter(Boolean)).size

    const dayKeys = buildDayBuckets(from, to)
    const wByDay = Object.fromEntries(dayKeys.map((k) => [k, 0]))
    const iByDay = Object.fromEntries(dayKeys.map((k) => [k, 0]))
    exportsData.forEach((r) => {
      const k = dayKey(r.created_at)
      if (wByDay[k] !== undefined) wByDay[k] += Number(r.amount) || 0
    })
    importsData.forEach((r) => {
      const k = dayKey(r.created_at)
      if (iByDay[k] !== undefined) iByDay[k] += Number(r.amount) || 0
    })
    dailyLabels.value = dayKeys.map((k) => {
      const [y, m, d] = k.split('-').map(Number)
      return fmtDayLabel(new Date(y, m - 1, d))
    })
    dailyWithdrawQty.value = dayKeys.map((k) => wByDay[k])
    dailyImportQty.value = dayKeys.map((k) => iByDay[k])

    const catMap = {}
    categories.value.forEach((cat) => {
      catMap[cat.id] = {
        id: cat.id,
        name: cat.category_name,
        remaining: 0,
        imported: 0,
        exported: 0,
      }
    })
    allItems.forEach((item) => {
      if (item.category_id && catMap[item.category_id]) {
        catMap[item.category_id].remaining += Number(item.current_stock) || 0
      }
    })
    importsData.forEach((imp) => {
      const catId = imp.items?.category_id
      if (catId && catMap[catId]) catMap[catId].imported += Number(imp.amount) || 0
    })
    exportsData.forEach((exp) => {
      const catId = exp.items?.category_id
      if (catId && catMap[catId]) catMap[catId].exported += Number(exp.amount) || 0
    })
    categorySummary.value = Object.values(catMap).sort((a, b) => b.remaining - a.remaining)

    itemSummary.value = allItems
      .map((i) => ({
        id: i.id,
        name: i.item_name,
        catId: i.category_id,
        catName: categories.value.find((c) => c.id === i.category_id)?.category_name || 'ไม่ระบุประเภท',
        usageType: String(i.usage_type ?? '').trim() || '—',
        remaining: Number(i.current_stock) || 0,
        unit: i.unit || 'หน่วย',
      }))
      .sort((a, b) => b.remaining - a.remaining)

    const usageAgg = {}
    allItems.forEach((i) => {
      const u = String(i.usage_type ?? '').trim() || '—'
      if (!usageAgg[u]) usageAgg[u] = { usageType: u, qty: 0, itemCount: 0 }
      usageAgg[u].qty += Number(i.current_stock) || 0
      usageAgg[u].itemCount += 1
    })
    usageTypeStock.value = Object.values(usageAgg).sort((a, b) => b.qty - a.qty)

    const personMap = {}
    const deptMap = {}
    exportsData.forEach((tx) => {
      if (selectedCategory.value !== 'all' && tx.items?.category_id !== selectedCategory.value) return
      const uid = tx.created_by
      const u = uid ? userMap.value[uid] : null
      const person = u?.fullname || 'ไม่ระบุ'
      const dept = u?.department || 'ไม่ระบุ'
      personMap[person] = (personMap[person] || 0) + (Number(tx.amount) || 0)
      deptMap[dept] = (deptMap[dept] || 0) + (Number(tx.amount) || 0)
    })
    withdrawalByPerson.value = Object.entries(personMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
    withdrawalByDept.value = Object.entries(deptMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)

    pendingWithdrawals.value = pendingData
      .map((p) => {
        const u = p.created_by ? userMap.value[p.created_by] : null
        return {
          id: p.id,
          mr: p.mr_number || '-',
          item: p.items?.item_name || '-',
          catId: p.items?.category_id,
          creator: u?.fullname || '-',
          dept: u?.department || '-',
          date: new Date(p.created_at).toLocaleDateString('th-TH'),
        }
      })
      .filter((p) => selectedCategory.value === 'all' || p.catId === selectedCategory.value)
  } catch (error) {
    console.error('Error fetching summary data:', error)
  } finally {
    loading.value = false
    await nextTick()
    buildCharts()
  }
}

function buildCharts() {
  destroyCharts()
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#e2e8f0'
  const text = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#64748b'
  const primary = '#3b82f6'
  const emerald = '#10b981'

  if (lineChartRef.value && dailyLabels.value.length) {
    lineChartInst = new Chart(lineChartRef.value, {
      type: 'line',
      data: {
        labels: dailyLabels.value,
        datasets: [
          {
            label: 'นำออก (เบิก) ตามวัน',
            data: dailyWithdrawQty.value,
            borderColor: primary,
            backgroundColor: 'rgba(59,130,246,0.08)',
            fill: true,
            tension: 0.25,
          },
          {
            label: 'นำเข้าตามวัน',
            data: dailyImportQty.value,
            borderColor: emerald,
            backgroundColor: 'rgba(16,185,129,0.06)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { ticks: { maxRotation: 45, color: text }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: text }, grid: { color: grid } },
        },
      },
    })
  }

  const topUsage = [...usageTypeStock.value].slice(0, 14)
  if (barUsageRef.value && topUsage.length) {
    barUsageInst = new Chart(barUsageRef.value, {
      type: 'bar',
      data: {
        labels: topUsage.map((r) => (r.usageType.length > 24 ? `${r.usageType.slice(0, 22)}…` : r.usageType)),
        datasets: [
          {
            label: 'จำนวนคงเหลือรวม (ตามประเภทที่ใช้)',
            data: topUsage.map((r) => r.qty),
            backgroundColor: 'rgba(245,158,11,0.75)',
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: text }, grid: { color: grid } },
          y: { ticks: { color: text, font: { size: 10 } }, grid: { display: false } },
        },
      },
    })
  }
}

const usageTypeOptions = computed(() => {
  const set = new Set(usageTypeStock.value.map((r) => r.usageType))
  return [...set].sort((a, b) => a.localeCompare(b, 'th'))
})

const filteredCategorySummary = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return categorySummary.value.filter((c) => {
    const matchSearch = !q || c.name.toLowerCase().includes(q)
    const matchCat = selectedCategory.value === 'all' || c.id === selectedCategory.value
    return matchSearch && matchCat
  })
})

const filteredItemSummary = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return itemSummary.value.filter((i) => {
    const matchUsage =
      selectedUsageType.value === 'all' ||
      i.usageType === selectedUsageType.value ||
      (selectedUsageType.value === '—' && i.usageType === '—')
    const matchSearch =
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.usageType.toLowerCase().includes(q) ||
      i.catName.toLowerCase().includes(q)
    const matchCat = selectedCategory.value === 'all' || i.catId === selectedCategory.value
    return matchSearch && matchCat && matchUsage
  })
})

const filteredUsageTypeStock = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return usageTypeStock.value.filter((r) => {
    if (selectedUsageType.value !== 'all' && r.usageType !== selectedUsageType.value) return false
    return !q || r.usageType.toLowerCase().includes(q)
  })
})

const filteredPersonSummary = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return withdrawalByPerson.value.filter((p) => !q || p.name.toLowerCase().includes(q))
})

const filteredDeptSummary = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return withdrawalByDept.value.filter((d) => !q || d.name.toLowerCase().includes(q))
})

const filteredPendingList = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  return pendingWithdrawals.value.filter((p) => {
    return !q || p.mr.toLowerCase().includes(q) || p.item.toLowerCase().includes(q) || p.creator.toLowerCase().includes(q)
  })
})

const periodLabel = computed(() => getDateRange().label)

const reportYearOptions = computed(() => {
  const y = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => y - i)
})

onMounted(fetchData)
onUnmounted(() => destroyCharts())

watch([activeFilter, selectedCategory, reportYear, reportMonth], () => {
  if (activeFilter.value !== 'custom') fetchData()
})

function applyCustomRange() {
  if (customFrom.value && customTo.value) {
    showCustomPicker.value = false
    fetchData()
  }
}

function onPeriodFilterClick(f) {
  activeFilter.value = f
  if (f === 'custom') showCustomPicker.value = true
}
</script>

<template>
  <AppLayout>
    <div class="space-y-6 pb-20">
      <div class="bg-white dark:bg-slate-900 p-6 rounded-2xl border shadow-sm" style="border-color: var(--color-border)">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 class="text-2xl font-bold flex items-center gap-3" style="color: var(--color-text-primary)">
                <i class="fa-solid fa-chart-line text-blue-600"></i>
                สรุปรายงานคลังและการเบิก
              </h1>
              <p class="text-sm mt-1" style="color: var(--color-text-muted)">
                KPI ช่วง <strong>{{ periodLabel }}</strong> — นำเข้า/นำออก แนวโน้มรายวัน ประเภทที่ใช้ และผู้เบิกตามหน่วยงาน
              </p>
            </div>

            <div class="flex flex-wrap items-end gap-3">
              <div v-if="activeFilter === 'by_month'" class="flex gap-2 items-center">
                <label class="text-xs font-semibold" style="color: var(--color-text-muted)">ปี</label>
                <select
                  v-model.number="reportYear"
                  class="px-3 py-2 rounded-xl border text-sm"
                  style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
                >
                  <option v-for="yr in reportYearOptions" :key="yr" :value="yr">{{ yr }}</option>
                </select>
                <label class="text-xs font-semibold" style="color: var(--color-text-muted)">เดือน</label>
                <select
                  v-model.number="reportMonth"
                  class="px-3 py-2 rounded-xl border text-sm"
                  style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
                >
                  <option v-for="m in 12" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <div class="relative flex-1 min-w-[200px] max-w-md">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                v-model="searchText"
                type="text"
                placeholder="ค้นหาชื่อสินค้า / ประเภทที่ใช้ / หมวดหมู่..."
                class="w-full pl-9 pr-4 py-2 rounded-xl border text-sm focus:outline-none transition-all"
                style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
              />
            </div>
            <select
              v-model="selectedCategory"
              class="px-4 py-2 rounded-xl border text-sm focus:outline-none"
              style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
            >
              <option value="all">ทุกประเภทสินค้า</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.category_name }}</option>
            </select>
            <select
              v-model="selectedUsageType"
              class="px-4 py-2 rounded-xl border text-sm focus:outline-none min-w-[160px]"
              style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
            >
              <option value="all">ทุกประเภทที่ใช้</option>
              <option v-for="ut in usageTypeOptions" :key="ut" :value="ut">{{ ut }}</option>
            </select>
          </div>

          <div class="flex flex-wrap gap-1.5 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              v-for="f in ['today', 'this_week', 'last_week', 'this_month', 'last_month', 'by_month', 'this_year', 'custom']"
              :key="f"
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              :class="
                activeFilter === f
                  ? 'bg-white dark:bg-slate-700 shadow text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              "
              @click="onPeriodFilterClick(f)"
            >
              {{
                {
                  today: 'วันนี้',
                  this_week: 'สัปดาห์นี้',
                  last_week: 'สัปดาห์ที่แล้ว',
                  this_month: 'เดือนนี้',
                  last_month: 'เดือนที่แล้ว',
                  by_month: 'เลือกปี/เดือน',
                  this_year: 'ปีนี้',
                  custom: 'ย้อนหลัง (กำหนด)',
                }[f]
              }}
            </button>
          </div>

          <div
            v-if="showCustomPicker && activeFilter === 'custom'"
            class="p-4 rounded-xl border border-dashed flex flex-wrap items-center gap-4"
            style="background: var(--color-bg-base); border-color: var(--color-border)"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold uppercase" style="color: var(--color-text-muted)">จาก</span>
              <input v-model="customFrom" type="date" class="px-3 py-1.5 rounded-lg border text-sm" style="border-color: var(--color-border)" />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold uppercase" style="color: var(--color-text-muted)">ถึง</span>
              <input v-model="customTo" type="date" class="px-3 py-1.5 rounded-lg border text-sm" style="border-color: var(--color-border)" />
            </div>
            <button type="button" class="px-6 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700" @click="applyCustomRange">
              ดึงข้อมูล
            </button>
            <button type="button" class="text-xs font-bold text-gray-400 hover:text-red-500" @click="showCustomPicker = false">ปิด</button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="py-20 flex flex-col items-center justify-center gap-4">
        <i class="fa-solid fa-circle-notch fa-spin text-4xl text-blue-600"></i>
        <p class="font-medium" style="color: var(--color-text-muted)">กำลังโหลดรายงาน...</p>
      </div>

      <template v-else>
        <!-- KPI -->
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">สินค้ายังเหลือ (รวม)</p>
            <p class="text-xl font-black text-emerald-600 mt-1">{{ kpi.totalQty.toLocaleString() }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ kpi.totalItems }} รายการ</p>
          </div>
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">นำเข้าในช่วง</p>
            <p class="text-xl font-black text-green-600 mt-1">{{ kpi.importQty.toLocaleString() }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ kpi.importRows }} บันทึก</p>
          </div>
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">นำออกในช่วง</p>
            <p class="text-xl font-black text-orange-600 mt-1">{{ kpi.exportQty.toLocaleString() }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ kpi.exportRows }} บันทึก</p>
          </div>
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">รอเบิกสินค้า</p>
            <p class="text-xl font-black text-amber-600 mt-1">{{ kpi.pendingCount }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">คำขอ pending</p>
          </div>
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">สต็อกต่ำ</p>
            <p class="text-xl font-black text-red-500 mt-1">{{ kpi.lowStock }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">≤ min หรือ ≤10</p>
          </div>
          <div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--color-text-muted)">ผู้เบิก (ไม่ซ้ำ)</p>
            <p class="text-xl font-black text-blue-600 mt-1">{{ kpi.uniqueWithdrawers }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">ในช่วงที่เลือก</p>
          </div>
        </div>

        <!-- Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="rounded-2xl border overflow-hidden shadow-sm p-4" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <h3 class="font-bold text-sm mb-3 flex items-center gap-2" style="color: var(--color-text-primary)">
              <i class="fa-solid fa-chart-area text-blue-500"></i>
              แนวโน้มนำเข้า / นำออกรายวัน (KPI ช่วงเวลา)
            </h3>
            <div class="h-64">
              <canvas ref="lineChartRef"></canvas>
            </div>
          </div>
          <div class="rounded-2xl border overflow-hidden shadow-sm p-4" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <h3 class="font-bold text-sm mb-3 flex items-center gap-2" style="color: var(--color-text-primary)">
              <i class="fa-solid fa-tags text-amber-500"></i>
              ประเภทที่ใช้ — จำนวนคงเหลือรวม (แท่ง)
            </h3>
            <div class="h-64">
              <canvas ref="barUsageRef"></canvas>
            </div>
          </div>
        </div>

        <!-- ประเภทที่ใช้ table -->
        <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
          <div class="px-5 py-3 border-b flex justify-between items-center" style="border-color: var(--color-border)">
            <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">ประเภทที่ใช้ × คงเหลือ</h3>
            <span class="text-xs font-mono px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{{ filteredUsageTypeStock.length }} กลุ่ม</span>
          </div>
          <div class="overflow-x-auto max-h-80">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10" style="background: var(--color-bg-body)">
                <tr class="text-left border-b" style="border-color: var(--color-border)">
                  <th class="px-5 py-3 font-bold" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
                  <th class="px-5 py-3 font-bold text-right" style="color: var(--color-text-muted)">จำนวนคงเหลือรวม</th>
                  <th class="px-5 py-3 font-bold text-right" style="color: var(--color-text-muted)">จำนวน SKU</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in filteredUsageTypeStock"
                  :key="row.usageType"
                  class="border-b hover:bg-gray-50/50 dark:hover:bg-slate-800/50"
                  style="border-color: var(--color-border)"
                >
                  <td class="px-5 py-2.5 font-medium" style="color: var(--color-text-primary)">{{ row.usageType }}</td>
                  <td class="px-5 py-2.5 text-right font-mono font-bold text-emerald-600">{{ row.qty.toLocaleString() }}</td>
                  <td class="px-5 py-2.5 text-right text-gray-500">{{ row.itemCount }}</td>
                </tr>
                <tr v-if="!filteredUsageTypeStock.length">
                  <td colspan="3" class="px-5 py-8 text-center text-gray-400">ไม่มีข้อมูล</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Category movement -->
        <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
          <div class="px-5 py-3 border-b" style="border-color: var(--color-border)">
            <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">สินค้าประเภท — นำเข้า / นำออก / คงเหลือ</h3>
            <p class="text-xs mt-1" style="color: var(--color-text-muted)">ช่วง {{ periodLabel }}</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left bg-gray-50 dark:bg-slate-800 border-b" style="border-color: var(--color-border)">
                  <th class="px-5 py-3 font-bold" style="color: var(--color-text-muted)">ประเภทสินค้า</th>
                  <th class="px-5 py-3 font-bold text-right text-green-600">นำเข้า (ช่วงนี้)</th>
                  <th class="px-5 py-3 font-bold text-right text-orange-600">นำออก (ช่วงนี้)</th>
                  <th class="px-5 py-3 font-bold text-right text-blue-600">คงเหลือปัจจุบัน</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="cat in filteredCategorySummary"
                  :key="cat.id"
                  class="border-b hover:bg-gray-50/50"
                  style="border-color: var(--color-border)"
                >
                  <td class="px-5 py-3 font-semibold" style="color: var(--color-text-primary)">{{ cat.name }}</td>
                  <td class="px-5 py-3 text-right font-mono text-green-600 font-bold">{{ cat.imported.toLocaleString() }}</td>
                  <td class="px-5 py-3 text-right font-mono text-orange-600 font-bold">{{ cat.exported.toLocaleString() }}</td>
                  <td class="px-5 py-3 text-right font-mono text-blue-600 font-bold bg-blue-50/30 dark:bg-blue-900/10">
                    {{ cat.remaining.toLocaleString() }}
                  </td>
                </tr>
                <tr class="bg-gray-100 dark:bg-slate-800 font-bold">
                  <td class="px-5 py-3">รวม (ตามตัวกรอง)</td>
                  <td class="px-5 py-3 text-right font-mono text-green-700">
                    {{ filteredCategorySummary.reduce((s, c) => s + c.imported, 0).toLocaleString() }}
                  </td>
                  <td class="px-5 py-3 text-right font-mono text-orange-700">
                    {{ filteredCategorySummary.reduce((s, c) => s + c.exported, 0).toLocaleString() }}
                  </td>
                  <td class="px-5 py-3 text-right font-mono text-blue-700">
                    {{ filteredCategorySummary.reduce((s, c) => s + c.remaining, 0).toLocaleString() }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Item detail -->
        <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
          <div class="px-5 py-3 border-b flex justify-between" style="border-color: var(--color-border)">
            <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">รายละเอียดสินค้า</h3>
            <span class="text-xs font-bold text-blue-600">{{ filteredItemSummary.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto max-h-[480px]">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-slate-800 shadow-sm">
                <tr class="text-left border-b" style="border-color: var(--color-border)">
                  <th class="px-5 py-3 font-bold" style="color: var(--color-text-muted)">สินค้า</th>
                  <th class="px-5 py-3 font-bold" style="color: var(--color-text-muted)">หมวดหมู่</th>
                  <th class="px-5 py-3 font-bold" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
                  <th class="px-5 py-3 font-bold text-right" style="color: var(--color-text-muted)">คงเหลือ</th>
                  <th class="px-5 py-3 font-bold text-center" style="color: var(--color-text-muted)">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in filteredItemSummary"
                  :key="item.id"
                  class="border-b hover:bg-gray-50/50"
                  style="border-color: var(--color-border)"
                >
                  <td class="px-5 py-2.5" style="color: var(--color-text-primary)">{{ item.name }}</td>
                  <td class="px-5 py-2.5 text-xs text-gray-500">{{ item.catName }}</td>
                  <td class="px-5 py-2.5 text-xs">{{ item.usageType }}</td>
                  <td class="px-5 py-2.5 text-right font-mono font-bold text-blue-600">{{ item.remaining.toLocaleString() }}</td>
                  <td class="px-5 py-2.5 text-center text-gray-400 text-xs">{{ item.unit }}</td>
                </tr>
                <tr v-if="!filteredItemSummary.length">
                  <td colspan="5" class="px-5 py-10 text-center text-gray-400">ไม่พบข้อมูล</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <div class="px-5 py-3 border-b bg-emerald-50/50 dark:bg-emerald-900/10" style="border-color: var(--color-border)">
              <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">บุคคลที่เบิกในช่วงนี้ (ยอดรวม)</h3>
            </div>
            <div class="overflow-x-auto max-h-[400px]">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-gray-50 dark:bg-slate-800">
                  <tr class="border-b" style="border-color: var(--color-border)">
                    <th class="px-5 py-2 font-bold text-left" style="color: var(--color-text-muted)">ชื่อ</th>
                    <th class="px-5 py-2 font-bold text-right" style="color: var(--color-text-muted)">จำนวนเบิก</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in filteredPersonSummary.slice(0, 40)" :key="p.name" class="border-b" style="border-color: var(--color-border)">
                    <td class="px-5 py-2">{{ p.name }}</td>
                    <td class="px-5 py-2 text-right font-mono font-semibold text-emerald-600">{{ p.amount.toLocaleString() }}</td>
                  </tr>
                  <tr v-if="!filteredPersonSummary.length">
                    <td colspan="2" class="px-5 py-8 text-center text-gray-400">ไม่มีข้อมูลการเบิกในช่วงนี้</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
            <div class="px-5 py-3 border-b bg-orange-50/50 dark:bg-orange-900/10" style="border-color: var(--color-border)">
              <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">หน่วยงานที่เบิก (ยอดรวม)</h3>
            </div>
            <div class="overflow-x-auto max-h-[400px]">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-gray-50 dark:bg-slate-800">
                  <tr class="border-b" style="border-color: var(--color-border)">
                    <th class="px-5 py-2 font-bold text-left" style="color: var(--color-text-muted)">หน่วยงาน</th>
                    <th class="px-5 py-2 font-bold text-right" style="color: var(--color-text-muted)">จำนวนเบิก</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in filteredDeptSummary" :key="d.name" class="border-b" style="border-color: var(--color-border)">
                    <td class="px-5 py-2">{{ d.name }}</td>
                    <td class="px-5 py-2 text-right font-mono font-semibold text-orange-600">{{ d.amount.toLocaleString() }}</td>
                  </tr>
                  <tr v-if="!filteredDeptSummary.length">
                    <td colspan="2" class="px-5 py-8 text-center text-gray-400">ไม่มีข้อมูล</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Pending -->
        <div class="rounded-2xl border overflow-hidden shadow-sm" style="border-color: var(--color-border); background: var(--color-bg-card)">
          <div class="px-5 py-3 border-b flex justify-between" style="border-color: var(--color-border)">
            <h3 class="font-bold text-[15px]" style="color: var(--color-text-primary)">รายการรอเบิก (Pending)</h3>
            <span class="text-xs font-bold text-amber-700">{{ filteredPendingList.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left bg-gray-50 dark:bg-slate-800 border-b" style="border-color: var(--color-border)">
                  <th class="px-5 py-2 font-bold" style="color: var(--color-text-muted)">วันที่</th>
                  <th class="px-5 py-2 font-bold" style="color: var(--color-text-muted)">MR</th>
                  <th class="px-5 py-2 font-bold" style="color: var(--color-text-muted)">สินค้า</th>
                  <th class="px-5 py-2 font-bold" style="color: var(--color-text-muted)">ผู้ขอ</th>
                  <th class="px-5 py-2 font-bold" style="color: var(--color-text-muted)">หน่วยงาน</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredPendingList" :key="item.id" class="border-b" style="border-color: var(--color-border)">
                  <td class="px-5 py-2 text-xs font-mono" style="color: var(--color-text-muted)">{{ item.date }}</td>
                  <td class="px-5 py-2 font-bold text-blue-600">{{ item.mr }}</td>
                  <td class="px-5 py-2">{{ item.item }}</td>
                  <td class="px-5 py-2">{{ item.creator }}</td>
                  <td class="px-5 py-2 text-xs" style="color: var(--color-text-muted)">{{ item.dept }}</td>
                </tr>
                <tr v-if="!filteredPendingList.length">
                  <td colspan="5" class="px-5 py-8 text-center text-gray-400">ไม่มีรายการค้างเบิก</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.divide-y > :not([hidden]) ~ :not([hidden]) {
  border-top-width: 1px;
}
</style>
