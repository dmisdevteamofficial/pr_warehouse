<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { supabase } from '@/lib/supabase'

Chart.register(...registerables)

// ─── State ────────────────────────────────────────────────────────────────────
const loading = ref(true)
const activeFilter = ref('this_month')
const customFrom = ref('')
const customTo = ref('')
const showCustomPicker = ref(false)

// KPI
const totalItems        = ref(0)
const totalCategories   = ref(0)
const importsInPeriod   = ref(0)
const txInPeriod        = ref(0)
const pendingOrders     = ref(0)
const approvedOrders    = ref(0)
const rejectedOrders    = ref(0)
const completedOrders   = ref(0)
const totalImportQty    = ref(0)
const totalTxQty        = ref(0)
const lowStockCount     = ref(0)
const outOfStockCount   = ref(0)
const uniqueRequesterCount = ref(0)

// Modal State
const isDetailModalOpen = ref(false)
const modalTitle = ref('')
const modalData = ref([])
const modalLoading = ref(false)
const modalSearchText = ref('')
const modalType = ref('') // 'items', 'imports', 'tx', 'pending', 'low_stock', 'approved', 'rejected', 'completed', 'all_orders', 'category_summary', 'items_by_category', 'picked_orders'
const selectedCategoryName = ref('')

// Trend
const trendImports  = ref({ text: '—', type: 'neutral' })
const trendTx       = ref({ text: '—', type: 'neutral' })
const trendPending  = ref({ text: '—', type: 'neutral' }) // รอเบิกสินค้า
const trendApproval = ref({ text: '—', type: 'neutral' }) // อัตราเบิกสำเร็จ

// Table & List data
const recentTransactions  = ref([])
const lowStockItems       = ref([])
const topWithdrawItems    = ref([])
const recentOrders        = ref([])

// Chart refs & instances
const lineChartRef   = ref(null)
const donutChartRef  = ref(null)
const barChartRef    = ref(null)
const orderPieRef    = ref(null)
let lineChart, donutChart, barChart, orderPie

const lineLabels         = ref([])
const lineImportsSeries  = ref([])
const lineTxSeries       = ref([])
const donutLabels        = ref([])
const donutData          = ref([])
const barLabels          = ref([])
const barSeries          = ref([])

const PALETTE = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#EC4899','#64748B','#F97316','#84CC16']

// ─── Date helpers ─────────────────────────────────────────────────────────────
function startOfDay(d) { const x=new Date(d); x.setHours(0,0,0,0); return x }
function endOfDay(d)   { const x=new Date(d); x.setHours(23,59,59,999); return x }
function startOfWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  x.setHours(0,0,0,0)
  return x
}
function endOfWeek(d) {
  const x = startOfWeek(d)
  x.setDate(x.getDate() + 6)
  x.setHours(23,59,59,999)
  return x
}
function fmtDate(d) {
  const x = new Date(d)
  return `${x.getDate()}/${x.getMonth()+1}`
}
function fmtDateFull(iso) {
  return new Date(iso).toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'numeric' })
}
function fmtDateTimeShort(iso) {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
function dayKey(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}

// ─── Period resolver ──────────────────────────────────────────────────────────
function getDateRange() {
  const now = new Date()
  switch (activeFilter.value) {
    case 'this_week':
      return { from: startOfWeek(now), to: endOfWeek(now), prevFrom: startOfWeek(new Date(now - 7*86400000)), prevTo: endOfWeek(new Date(now - 7*86400000)), label: 'สัปดาห์นี้', days: 7 }
    case 'last_week': {
      const lw = new Date(now - 7*86400000)
      return { from: startOfWeek(lw), to: endOfWeek(lw), prevFrom: startOfWeek(new Date(now - 14*86400000)), prevTo: endOfWeek(new Date(now - 14*86400000)), label: 'สัปดาห์ที่แล้ว', days: 7 }
    }
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const lme = new Date(now.getFullYear(), now.getMonth(), 0)
      const llm = new Date(now.getFullYear(), now.getMonth()-2, 1)
      const llme = new Date(now.getFullYear(), now.getMonth()-1, 0)
      return { from: startOfDay(lm), to: endOfDay(lme), prevFrom: startOfDay(llm), prevTo: endOfDay(llme), label: 'เดือนที่แล้ว', days: lme.getDate() }
    }
    case 'custom': {
      const f = customFrom.value ? new Date(customFrom.value) : new Date()
      const t = customTo.value ? new Date(customTo.value) : new Date()
      return { from: startOfDay(f), to: endOfDay(t), prevFrom: null, prevTo: null, label: 'กำหนดเอง', days: Math.ceil((endOfDay(t)-startOfDay(f))/(86400000))+1 }
    }
    default: { // this_month
      const ms = new Date(now.getFullYear(), now.getMonth(), 1)
      const lms = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const lme = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: startOfDay(ms), to: endOfDay(now), prevFrom: startOfDay(lms), prevTo: endOfDay(lme), label: 'เดือนนี้', days: now.getDate() }
    }
  }
}

function trendDelta(cur, prev, labelPrev) {
  if (prev === 0 && cur === 0) return { text: `เท่าเดิม`, type: 'neutral' }
  if (prev === 0) return { text: `+${cur} vs ${labelPrev}`, type: 'up' }
  const diff = cur - prev
  const pct = Math.round((diff / prev) * 100)
  if (diff > 0) return { text: `▲ ${diff} (+${pct}%) vs ${labelPrev}`, type: 'up' }
  if (diff < 0) return { text: `▼ ${Math.abs(diff)} (${pct}%) vs ${labelPrev}`, type: 'down' }
  return { text: `เท่าเดิม vs ${labelPrev}`, type: 'neutral' }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchDashboardData() {
  loading.value = true
  destroyCharts()
  try {
    const { from, to, prevFrom, prevTo, label, days } = getDateRange()
    const fromISO = from.toISOString()
    const toISO   = to.toISOString()

    // Build time-series labels
    const dayKeys = []
    for (let i = 0; i < Math.min(days, 31); i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
      if (d > to) break
      dayKeys.push(dayKey(d))
    }

    const queries = [
      supabase.from('items').select('*', { count: 'exact', head: true }),
      supabase.from('category').select('*', { count: 'exact', head: true }),
      supabase.from('inventory_imports').select('*', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'approved').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'rejected').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('inventory_imports').select('amount').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('amount, created_by').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('items').select('id, item_name, current_stock, unit, category_id').lte('current_stock', 10).order('current_stock', { ascending: true }).limit(30),
      supabase.from('inventory_imports').select('created_at').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('created_at, item_id, amount').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('category').select('id, category_name').order('category_name'),
      supabase.from('items').select('category_id'),
      supabase.from('transactions').select('id, amount, unit, created_at, items(item_code, item_name), creator:system_users!created_by(fullname, emp_code)').order('created_at', { ascending: false }).limit(8),
      supabase.from('order_req').select('id, request_id, status, mr_number, company, created_at, items(item_name), creator:system_users!created_by(fullname)').order('created_at', { ascending: false }).limit(6),
    ]

    if (prevFrom) {
      queries.push(
        supabase.from('inventory_imports').select('*', { count: 'exact', head: true }).gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
        supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'pending').gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
      )
    }

    const results = await Promise.all(queries)
    const [
      itemsRes, catCountRes, impCountRes, txCountRes,
      pendingRes, approvedRes, rejectedRes, completedRes,
      impAmtRes, txAmtRes, lowStockRes,
      impRowsRes, txRowsRes,
      catNamesRes, itemCatRes,
      recentTxRes, recentOrdersRes,
      prevImpRes, prevTxRes, prevPendingRes
    ] = results

    // ── KPIs ──
    totalItems.value       = itemsRes.count ?? 0
    totalCategories.value  = catCountRes.count ?? 0
    importsInPeriod.value  = impCountRes.count ?? 0
    txInPeriod.value       = txCountRes.count ?? 0
    pendingOrders.value    = pendingRes.count ?? 0
    approvedOrders.value   = approvedRes.count ?? 0
    rejectedOrders.value   = rejectedRes.count ?? 0
    completedOrders.value  = completedRes.count ?? 0
    totalImportQty.value   = (impAmtRes.data || []).reduce((s,r) => s + (r.amount||0), 0)
    const txRows           = txAmtRes.data || []
    totalTxQty.value       = txRows.reduce((s,r) => s + (r.amount||0), 0)
    uniqueRequesterCount.value = new Set(txRows.map(r => r.created_by).filter(Boolean)).size

    // Stock status
    const allLow = lowStockRes.data || []
    outOfStockCount.value = allLow.filter(i => i.current_stock === 0).length
    lowStockCount.value   = allLow.filter(i => i.current_stock > 0 && i.current_stock <= 10).length
    lowStockItems.value   = allLow.slice(0, 20)

    // ── Trend ──
    const prevLabel = label
    if (prevImpRes) trendImports.value = trendDelta(impCountRes.count??0, prevImpRes.count??0, prevLabel)
    if (prevTxRes)  trendTx.value      = trendDelta(txCountRes.count??0, prevTxRes.count??0, prevLabel)
    if (prevPendingRes) trendPending.value = trendDelta(pendingRes.count??0, prevPendingRes.count??0, prevLabel)
    const approvalRate = (approvedRes.count??0) + (rejectedRes.count??0) > 0
      ? Math.round(((approvedRes.count??0) / ((approvedRes.count??0) + (rejectedRes.count??0))) * 100)
      : 0
    trendApproval.value = { text: `เบิกแล้ว ${approvalRate}%`, type: approvalRate >= 70 ? 'up' : approvalRate >= 40 ? 'neutral' : 'down' }

    // ── Time-series ──
    const impByDay = {}, txByDay = {}
    for (const k of dayKeys) { impByDay[k] = 0; txByDay[k] = 0 }
    for (const r of impRowsRes.data||[]) { const k=dayKey(r.created_at); if(impByDay[k]!==undefined) impByDay[k]++ }
    for (const r of txRowsRes.data||[])  { const k=dayKey(r.created_at); if(txByDay[k]!==undefined)  txByDay[k]++  }
    lineLabels.value        = dayKeys.map(k => { const[y,m,d]=k.split('-').map(Number); return fmtDate(new Date(y,m-1,d)) })
    lineImportsSeries.value = dayKeys.map(k => impByDay[k])
    lineTxSeries.value      = dayKeys.map(k => txByDay[k])

    // ── Donut: items by category ──
    const countByCat = {}
    for (const c of catNamesRes.data||[]) countByCat[c.id] = { name: c.category_name, n: 0 }
    for (const it of itemCatRes.data||[]) if (it.category_id && countByCat[it.category_id]) countByCat[it.category_id].n++
    const sorted = Object.values(countByCat).filter(x => x.n > 0).sort((a,b) => b.n - a.n)
    donutLabels.value = sorted.map(x => x.name)
    donutData.value   = sorted.map(x => x.n)

    // ── Bar: top withdrawn items ──
    const itemQty = {}
    for (const r of txRowsRes.data||[]) {
      const id = r.item_id
      if (!id) continue
      itemQty[id] = (itemQty[id] || 0) + (r.amount||0) // using amount from transactions select
    }
    // Need item names — fetch items matching top ids
    const topIds = Object.entries(itemQty).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0])
    let itemNames = {}
    if (topIds.length > 0) {
      const { data: itemNamesRes } = await supabase.from('items').select('id, item_name').in('id', topIds)
      for (const i of itemNamesRes||[]) itemNames[i.id] = i.item_name
    }
    const topEntries = topIds.map(id => ({ name: itemNames[id] || id.slice(0,8), qty: itemQty[id] }))
    topWithdrawItems.value = topEntries
    barLabels.value = topEntries.map(x => x.name.length > 14 ? x.name.slice(0,14)+'…' : x.name)
    barSeries.value = topEntries.map(x => x.qty)

    // ── Recent transactions ──
    recentTransactions.value = (recentTxRes.data||[]).map(t => ({
      id: t.id,
      item_code: t.items?.item_code || '—',
      item_name: t.items?.item_name || '—',
      amount: t.amount,
      unit: t.unit,
      created_by_name: t.creator?.fullname || '—',
      emp_code: t.creator?.emp_code || '',
      created_at: t.created_at,
    }))

    // ── Recent orders ──
    recentOrders.value = (recentOrdersRes.data||[]).map(o => ({
      id: o.id,
      request_id: o.request_id,
      item_name: o.items?.item_name || '—',
      mr_number: o.mr_number || '—',
      company: o.company || '—',
      status: o.status,
      creator: o.creator?.fullname || '—',
      created_at: o.created_at,
    }))

  } catch(e) {
    console.error('Dashboard fetch error', e)
  } finally {
    loading.value = false
    await nextTick()
    buildCharts()
  }
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function destroyCharts() {
  lineChart?.destroy(); donutChart?.destroy(); barChart?.destroy(); orderPie?.destroy()
  lineChart = donutChart = barChart = orderPie = null
}

function buildCharts() {
  // Line chart
  if (lineChartRef.value) {
    lineChart = new Chart(lineChartRef.value, {
      type: 'line',
      data: {
        labels: lineLabels.value.length ? lineLabels.value : ['—'],
        datasets: [
          { label: 'นำเข้า', data: lineImportsSeries.value.length ? lineImportsSeries.value : [0], borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6 },
          { label: 'เบิกจ่าย', data: lineTxSeries.value.length ? lineTxSeries.value : [0], borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } }, tooltip: { padding: 10, cornerRadius: 8 } },
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      },
    })
  }

  // Donut
  if (donutChartRef.value) {
    donutChart = new Chart(donutChartRef.value, {
      type: 'doughnut',
      data: {
        labels: donutLabels.value.length ? donutLabels.value : ['ไม่มีข้อมูล'],
        datasets: [{ data: donutData.value.length ? donutData.value : [1], backgroundColor: donutData.value.length ? PALETTE : ['#E5E7EB'], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } } },
    })
  }

  // Bar chart
  if (barChartRef.value && barSeries.value.length) {
    barChart = new Chart(barChartRef.value, {
      type: 'bar',
      data: {
        labels: barLabels.value,
        datasets: [{ label: 'จำนวนเบิก', data: barSeries.value, backgroundColor: PALETTE.slice(0, barSeries.value.length), borderRadius: 6, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { padding: 10, cornerRadius: 8 } },
        scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } },
      },
    })
  }

  // Order status pie
  if (orderPieRef.value) {
    const pieData = [pendingOrders.value, (approvedOrders.value + completedOrders.value)]
    orderPie = new Chart(orderPieRef.value, {
      type: 'doughnut',
      data: {
        labels: ['รอเบิก', 'เบิกแล้ว'],
        datasets: [{ data: pieData, backgroundColor: ['#F59E0B', '#10B981'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }],
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        cutout: '60%', 
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } } },
        onClick: (evt, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index
            if (index === 0) openDetailModal('pending')
            else openDetailModal('picked_orders')
          }
        }
      },
    })
  }
}

// ─── Filter handlers ──────────────────────────────────────────────────────────
function setFilter(f) {
  if (f === 'custom') { showCustomPicker.value = true; return }
  showCustomPicker.value = false
  activeFilter.value = f
  fetchDashboardData()
}
function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  activeFilter.value = 'custom'
  showCustomPicker.value = false
  fetchDashboardData()
}

// ─── Computed ─────────────────────────────────────────────────────────────────
const approvalRate = computed(() => {
  const total = (approvedOrders.value + rejectedOrders.value)
  return total > 0 ? Math.round((approvedOrders.value / total) * 100) : 0
})
const stockUtilRate = computed(() => {
  if (totalItems.value === 0) return 0
  return Math.round(((totalItems.value - outOfStockCount.value - lowStockCount.value) / totalItems.value) * 100)
})

function statusColor(s) {
  const m = { pending: '#F59E0B', approved: '#10B981', rejected: '#EF4444', completed: '#3B82F6' }
  return m[s] || '#64748B'
}
function statusLabel(s) {
  const m = { pending: 'รอเบิก', approved: 'เบิกแล้ว', rejected: 'ปฏิเสธ', completed: 'เบิกแล้ว' }
  return m[s] || s
}

// ─── Modal Computed ───────────────────────────────────────────────────────────
const filteredModalData = computed(() => {
  if (!modalSearchText.value) return modalData.value
  const search = modalSearchText.value.toLowerCase()
  
  return modalData.value.filter(item => {
    // Search based on common fields across different types
    const itemCode = (item.item_code || item.items?.item_code || '').toLowerCase()
    const itemName = (item.item_name || item.items?.item_name || '').toLowerCase()
    const creator = (item.creator?.fullname || '').toLowerCase()
    const remark = (item.remark || '').toLowerCase()
    const company = (item.company || '').toLowerCase()
    const requestId = String(item.request_id || '').toLowerCase()

    return itemCode.includes(search) || 
           itemName.includes(search) || 
           creator.includes(search) || 
           remark.includes(search) ||
           company.includes(search) ||
           requestId.includes(search)
  })
})

// ─── Modal Logic ──────────────────────────────────────────────────────────────
async function openDetailModal(type, filterId = null, filterName = '') {
  modalType.value = type
  isDetailModalOpen.value = true
  modalLoading.value = true
  modalData.value = []
  modalSearchText.value = ''
  selectedCategoryName.value = filterName
  
  const { from, to } = getDateRange()
  const fromISO = from.toISOString()
  const toISO = to.toISOString()

  try {
    let query
    switch (type) {
      case 'items':
        modalTitle.value = 'รายการสินค้าทั้งหมด'
        query = supabase.from('items').select('*, category(category_name), creator:system_users!created_by(fullname)').order('item_name')
        break
      case 'items_by_category':
        modalTitle.value = `รายการสินค้าในหมวด: ${filterName}`
        query = supabase.from('items').select('*, category(category_name), creator:system_users!created_by(fullname)')
                .eq('category_id', filterId).order('item_name')
        break
      case 'imports':
        modalTitle.value = `รายการนำเข้า (${getDateRange().label})`
        query = supabase.from('inventory_imports').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)')
                .gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'tx':
        modalTitle.value = `รายการเบิกจ่าย (${getDateRange().label})`
        query = supabase.from('transactions').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)')
                .gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'pending':
        modalTitle.value = 'รายการคำขอรอเบิกสินค้า'
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)')
                .eq('status', 'pending').order('created_at', { ascending: false })
        break
      case 'low_stock':
        modalTitle.value = 'สินค้าสต็อกต่ำ/หมด'
        query = supabase.from('items').select('*, category(category_name)')
                .lte('current_stock', 10).order('current_stock', { ascending: true })
        break
      case 'approved':
        modalTitle.value = `คำขอที่อนุมัติ (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)')
                .eq('status', 'approved').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'rejected':
        modalTitle.value = `คำขอที่ปฏิเสธ (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)')
                .eq('status', 'rejected').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'completed':
        modalTitle.value = `คำขอที่เสร็จสิ้น (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)')
                .eq('status', 'completed').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'all_orders':
        modalTitle.value = `รายการคำขอทั้งหมด (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)')
                .gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'picked_orders':
        modalTitle.value = `รายการที่เบิกแล้ว (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)')
                .in('status', ['approved', 'completed']).gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'category_summary':
        modalTitle.value = 'สรุปรายการสินค้าตามหมวดหมู่'
        // We'll handle data processing after fetching
        query = supabase.from('category').select('*, items(current_stock)')
        break
    }

    const { data, error } = await query
    if (error) throw error
    
    if (type === 'category_summary') {
      // Process category data to include counts
      modalData.value = data.map(cat => ({
        id: cat.id,
        category_name: cat.category_name,
        sku_count: cat.items?.length || 0,
        total_stock: (cat.items || []).reduce((sum, item) => sum + (item.current_stock || 0), 0),
        remark: cat.remark
      })).sort((a, b) => b.sku_count - a.sku_count)
    } else {
      modalData.value = data
    }
  } catch (err) {
    console.error('Error fetching modal data:', err.message)
  } finally {
    modalLoading.value = false
  }
}

onMounted(() => fetchDashboardData())
onUnmounted(() => destroyCharts())
</script>

<template>
  <AppLayout>
    <!-- ── Header & Filter Bar ───────────────────────────────────────────── -->
    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-bold tracking-tight" style="color: var(--color-text-primary)">
          <i class="fa-solid fa-chart-line mr-2" style="color: var(--color-primary)"></i>แดชบอร์ดภาพรวม
        </h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ระบบจัดการคลังพัสดุ — ข้อมูลเชิงธุรกิจสำหรับผู้บริหาร</p>
      </div>

      <!-- Filter Tabs -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg overflow-hidden border text-[12px] font-medium" style="border-color: var(--color-border)">
          <button v-for="f in [
            { key:'this_week',  label:'สัปดาห์นี้' },
            { key:'last_week',  label:'สัปดาห์ก่อน' },
            { key:'this_month', label:'เดือนนี้' },
            { key:'last_month', label:'เดือนก่อน' },
          ]" :key="f.key"
            @click="setFilter(f.key)"
            class="px-3 py-1.5 transition-colors"
            :style="activeFilter === f.key
              ? 'background: var(--color-bg-blue); color: var(--color-text-primary)'
              : 'background: var(--color-bg-card); color: var(--color-text-secondary)'"
          >{{ f.label }}</button>
          <button @click="setFilter('custom')"
            class="px-3 py-1.5 transition-colors"
            :style="activeFilter === 'custom'
              ? 'background: var(--color-primary); color: var(--color-text-primary)'
              : 'background: var(--color-bg-card); color: var(--color-text-secondary)'"
          ><i class="fa-regular fa-calendar mr-1"></i>กำหนดเอง</button>
        </div>
        <button @click="fetchDashboardData" class="p-1.5 rounded-lg border text-[12px] transition-colors hover:opacity-70" style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-secondary)">
          <i class="fa-solid fa-rotate-right"></i>
        </button>
      </div>
    </div>

    <!-- Custom Date Picker -->
    <div v-if="showCustomPicker" class="mb-5 flex flex-wrap items-end gap-3 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div>
        <label class="text-[11px] font-medium block mb-1" style="color: var(--color-text-muted)">วันที่เริ่มต้น</label>
        <input type="date" v-model="customFrom" class="rounded-lg border px-3 py-1.5 text-[13px]" style="border-color: var(--color-border); background: var(--color-bg); color: var(--color-text-primary)" />
      </div>
      <div>
        <label class="text-[11px] font-medium block mb-1" style="color: var(--color-text-muted)">วันที่สิ้นสุด</label>
        <input type="date" v-model="customTo" class="rounded-lg border px-3 py-1.5 text-[13px]" style="border-color: var(--color-border); background: var(--color-bg); color: var(--color-text-primary)" />
      </div>
      <button @click="applyCustom" class="px-4 py-1.5 rounded-lg text-[13px] font-medium text-white" style="background: var(--color-primary)">ดูข้อมูล</button>
      <button @click="showCustomPicker=false" class="px-3 py-1.5 rounded-lg text-[13px]" style="color: var(--color-text-muted)">ยกเลิก</button>
    </div>

    <!-- Loading overlay -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-center">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-3" style="color: var(--color-primary)"></i>
        <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</p>
      </div>
    </div>

    <template v-else>
      <!-- ── Row 1: KPI Cards (8 cards) ──────────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        <!-- สินค้าทั้งหมด -->
        <div @click="openDetailModal('items')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">สินค้าทั้งหมด</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(59,130,246,0.1)">
              <i class="fa-solid fa-boxes-stacked text-[11px]" style="color:#3B82F6"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: var(--color-text-primary)">{{ totalItems.toLocaleString() }}</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">{{ totalCategories }} หมวดหมู่</p>
        </div>

        <!-- นำเข้าช่วงนี้ -->
        <div @click="openDetailModal('imports')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">นำเข้าช่วงนี้</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(16,185,129,0.1)">
              <i class="fa-solid fa-arrow-down-to-bracket text-[11px]" style="color:#10B981"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: var(--color-text-primary)">{{ importsInPeriod.toLocaleString() }}</p>
          <p class="text-[10px] truncate" :style="trendImports.type==='up'?'color:#10B981':trendImports.type==='down'?'color:#EF4444':'color: var(--color-text-muted)'">{{ trendImports.text }}</p>
        </div>

        <!-- เบิกจ่ายช่วงนี้ -->
        <div @click="openDetailModal('tx')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">เบิกจ่ายช่วงนี้</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(245,158,11,0.1)">
              <i class="fa-solid fa-arrow-up-from-bracket text-[11px]" style="color:#F59E0B"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: var(--color-text-primary)">{{ txInPeriod.toLocaleString() }}</p>
          <p class="text-[10px] truncate" :style="trendTx.type==='up'?'color:#10B981':trendTx.type==='down'?'color:#EF4444':'color: var(--color-text-muted)'">{{ trendTx.text }}</p>
        </div>

        <!-- คำขอรอเบิกสินค้า -->
        <div @click="openDetailModal('pending')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">รอเบิกสินค้า</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(245,158,11,0.1)">
              <i class="fa-solid fa-clock text-[11px]" style="color:#F59E0B"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: #F59E0B">{{ pendingOrders.toLocaleString() }}</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">คำขอรอเบิกสินค้า</p>
        </div>

        <!-- ปริมาณนำเข้า -->
        <div @click="openDetailModal('imports')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">ปริมาณนำเข้า</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(6,182,212,0.1)">
              <i class="fa-solid fa-layer-group text-[11px]" style="color:#06B6D4"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: var(--color-text-primary)">{{ totalImportQty.toLocaleString() }}</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">หน่วยรวม</p>
        </div>

        <!-- ปริมาณเบิก -->
        <div @click="openDetailModal('tx')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">ปริมาณเบิก</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(236,72,153,0.1)">
              <i class="fa-solid fa-dolly text-[11px]" style="color:#EC4899"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: var(--color-text-primary)">{{ totalTxQty.toLocaleString() }}</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">{{ uniqueRequesterCount }} ผู้เบิก</p>
        </div>

        <!-- สต็อกต่ำ -->
        <div @click="openDetailModal('low_stock')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" :style="`background: var(--color-bg-card); border-color: ${lowStockCount+outOfStockCount > 0 ? '#FCA5A5' : 'var(--color-border)'}`">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">สต็อกต่ำ</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(239,68,68,0.1)">
              <i class="fa-solid fa-triangle-exclamation text-[11px]" style="color:#EF4444"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" style="color: #EF4444">{{ lowStockCount }}</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">หมด {{ outOfStockCount }} รายการ</p>
        </div>

        <!-- อัตราอนุมัติ -->
        <div @click="openDetailModal('all_orders')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium" style="color: var(--color-text-muted)">อัตราอนุมัติ</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(139,92,246,0.1)">
              <i class="fa-solid fa-check-circle text-[11px]" style="color:#8B5CF6"></i>
            </div>
          </div>
          <p class="text-[26px] font-bold leading-none" :style="`color: ${approvalRate>=70?'#10B981':approvalRate>=40?'#F59E0B':'#EF4444'}`">{{ approvalRate }}%</p>
          <p class="text-[10px]" style="color: var(--color-text-muted)">{{ approvedOrders }} / {{ approvedOrders+rejectedOrders }} รายการ</p>
        </div>
      </div>

      <!-- ── Row 2: Secondary KPI Summary Bar ────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <!-- Order status summary -->
        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[11px] font-medium mb-2" style="color: var(--color-text-muted)">สถานะ Order</p>
          <div class="flex gap-2 flex-wrap">
            <div @click="openDetailModal('pending')" class="flex-1 min-w-[44px] rounded-lg p-2 text-center cursor-pointer hover:opacity-70 transition-all" style="background: #F59E0B18">
              <p class="text-[18px] font-bold" style="color:#F59E0B">{{ pendingOrders }}</p>
              <p class="text-[9px] font-medium" style="color:#F59E0B">รอเบิก</p>
            </div>
            <div @click="openDetailModal('picked_orders')" class="flex-1 min-w-[44px] rounded-lg p-2 text-center cursor-pointer hover:opacity-70 transition-all" style="background: #10B98118">
              <p class="text-[18px] font-bold" style="color:#10B981">{{ approvedOrders + completedOrders }}</p>
              <p class="text-[9px] font-medium" style="color:#10B981">เบิกแล้ว</p>
            </div>
          </div>
        </div>

        <!-- Stock health -->
        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[11px] font-medium mb-2" style="color: var(--color-text-muted)">สุขภาพสต็อก</p>
          <div class="flex items-center gap-2 mb-2">
            <div class="flex-1 h-2 rounded-full overflow-hidden" style="background: var(--color-border)">
              <div class="h-full rounded-full transition-all" :style="`width: ${stockUtilRate}%; background: ${stockUtilRate>=70?'#10B981':stockUtilRate>=40?'#F59E0B':'#EF4444'}`"></div>
            </div>
            <span class="text-[12px] font-bold" :style="`color: ${stockUtilRate>=70?'#10B981':stockUtilRate>=40?'#F59E0B':'#EF4444'}`">{{ stockUtilRate }}%</span>
          </div>
          <div class="flex justify-between text-[10px]" style="color: var(--color-text-muted)">
            <span>ปกติ {{ totalItems - lowStockCount - outOfStockCount }}</span>
            <span style="color:#F59E0B">ต่ำ {{ lowStockCount }}</span>
            <span style="color:#EF4444">หมด {{ outOfStockCount }}</span>
          </div>
        </div>

        <!-- Import vs Withdraw ratio -->
        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[11px] font-medium mb-2" style="color: var(--color-text-muted)">สัดส่วนนำเข้า/เบิก</p>
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <p class="text-[10px] mb-1" style="color:#3B82F6">นำเข้า</p>
              <div class="h-6 rounded" style="background:rgba(59,130,246,0.15)">
                <div class="h-full rounded flex items-center px-2" :style="`width: ${totalImportQty+totalTxQty>0 ? Math.round(totalImportQty/(totalImportQty+totalTxQty)*100) : 50}%; background:#3B82F6; min-width:24px`">
                  <span class="text-[10px] text-white font-bold">{{ totalImportQty }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-end gap-2 mt-1">
            <div class="flex-1">
              <p class="text-[10px] mb-1" style="color:#F59E0B">เบิก</p>
              <div class="h-6 rounded" style="background:rgba(245,158,11,0.15)">
                <div class="h-full rounded flex items-center px-2" :style="`width: ${totalImportQty+totalTxQty>0 ? Math.round(totalTxQty/(totalImportQty+totalTxQty)*100) : 50}%; background:#F59E0B; min-width:24px`">
                  <span class="text-[10px] text-white font-bold">{{ totalTxQty }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Requester activity -->
        <div @click="openDetailModal('tx')" class="rounded-xl border p-3 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[11px] font-medium mb-2" style="color: var(--color-text-muted)">กิจกรรมการเบิก</p>
          <div class="grid grid-cols-2 gap-1">
            <div class="rounded-lg p-2" style="background:rgba(59,130,246,0.08)">
              <p class="text-[18px] font-bold" style="color:#3B82F6">{{ txInPeriod }}</p>
              <p class="text-[9px]" style="color: var(--color-text-muted)">รายการทั้งหมด</p>
            </div>
            <div class="rounded-lg p-2" style="background:rgba(16,185,129,0.08)">
              <p class="text-[18px] font-bold" style="color:#10B981">{{ uniqueRequesterCount }}</p>
              <p class="text-[9px]" style="color: var(--color-text-muted)">ผู้เบิกทั้งหมด</p>
            </div>
            <div class="rounded-lg p-2 col-span-2" style="background:rgba(139,92,246,0.08)">
              <p class="text-[16px] font-bold" style="color:#8B5CF6">{{ txInPeriod > 0 && uniqueRequesterCount > 0 ? (txInPeriod/uniqueRequesterCount).toFixed(1) : 0 }}</p>
              <p class="text-[9px]" style="color: var(--color-text-muted)">เฉลี่ยต่อคน</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Row 3: Charts ──────────────────────────────────────────────── -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-5">
        <!-- Line chart (trend) -->
        <div class="lg:col-span-7 rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-[13px] font-semibold" style="color: var(--color-text-primary)">แนวโน้มการนำเข้า & เบิกจ่าย</p>
              <p class="text-[11px]" style="color: var(--color-text-muted)">จำนวนรายการแต่ละวัน</p>
            </div>
            <div class="flex gap-3 text-[11px]">
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-1 rounded" style="background:#3B82F6"></span>นำเข้า</span>
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-1 rounded" style="background:#F59E0B"></span>เบิก</span>
            </div>
          </div>
          <div class="h-52"><canvas ref="lineChartRef"></canvas></div>
        </div>

        <!-- Donut + Order Pie side by side -->
        <div class="lg:col-span-5 grid grid-cols-2 gap-4">
          <div @click="openDetailModal('category_summary')" class="rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
            <p class="text-[12px] font-semibold mb-1" style="color: var(--color-text-primary)">สินค้าตามหมวด</p>
            <p class="text-[10px] mb-2" style="color: var(--color-text-muted)">จำนวน SKU</p>
            <div class="h-36"><canvas ref="donutChartRef"></canvas></div>
          </div>
          <div @click="openDetailModal('all_orders')" class="rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
            <p class="text-[12px] font-semibold mb-1" style="color: var(--color-text-primary)">สถานะ Order</p>
            <p class="text-[10px] mb-2" style="color: var(--color-text-muted)">ช่วงที่เลือก</p>
            <div class="h-36"><canvas ref="orderPieRef"></canvas></div>
          </div>
        </div>
      </div>

      <!-- ── Row 4: Bar chart (top items) ────────────────────────────────── -->
      <div v-if="barSeries.length" class="rounded-xl border p-4 mb-5" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="flex items-center justify-between mb-3">
          <div>
            <p class="text-[13px] font-semibold" style="color: var(--color-text-primary)">Top สินค้าที่เบิกมากที่สุด</p>
            <p class="text-[11px]" style="color: var(--color-text-muted)">เรียงตามปริมาณการเบิก</p>
          </div>
        </div>
        <div class="h-52"><canvas ref="barChartRef"></canvas></div>
      </div>

      <!-- ── Row 5: Tables ─────────────────────────────────────────────── -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <!-- Recent Transactions -->
        <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background:#F59E0B"></span>
              <p class="text-[13px] font-semibold" style="color: var(--color-text-primary)">รายการเบิกล่าสุด</p>
            </div>
            <span class="text-[11px] px-2 py-0.5 rounded-full" style="background:rgba(245,158,11,0.1); color:#F59E0B">{{ recentTransactions.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[12px]">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-3 py-2 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
                  <th class="text-right px-3 py-2 font-medium" style="color: var(--color-text-muted)">จำนวน</th>
                  <th class="text-left px-3 py-2 font-medium hidden sm:table-cell" style="color: var(--color-text-muted)">ผู้เบิก</th>
                  <th class="text-left px-3 py-2 font-medium" style="color: var(--color-text-muted)">วันที่</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="recentTransactions.length===0">
                  <td colspan="4" class="px-3 py-6 text-center text-[12px]" style="color: var(--color-text-muted)">ไม่มีรายการ</td>
                </tr>
                <tr v-for="t in recentTransactions" :key="t.id"
                  class="border-b last:border-b-0 hover:opacity-80 transition-opacity"
                  style="border-color: var(--color-border)">
                  <td class="px-3 py-2">
                    <p class="font-medium leading-tight" style="color: var(--color-text-primary)">{{ t.item_name }}</p>
                    <p class="text-[10px] font-mono" style="color: var(--color-text-muted)">{{ t.item_code }}</p>
                  </td>
                  <td class="px-3 py-2 text-right">
                    <span class="font-bold" style="color: var(--color-text-primary)">{{ t.amount }}</span>
                    <span class="text-[10px] ml-0.5" style="color: var(--color-text-muted)">{{ t.unit }}</span>
                  </td>
                  <td class="px-3 py-2 hidden sm:table-cell">
                    <p style="color: var(--color-text-secondary)">{{ t.created_by_name }}</p>
                    <p class="text-[10px] font-mono" style="color: var(--color-text-muted)">{{ t.emp_code }}</p>
                  </td>
                  <td class="px-3 py-2 text-[11px]" style="color: var(--color-text-muted)">{{ fmtDateTimeShort(t.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Orders -->
        <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background:#3B82F6"></span>
              <p class="text-[13px] font-semibold" style="color: var(--color-text-primary)">คำขอเบิกล่าสุด</p>
            </div>
            <span class="text-[11px] px-2 py-0.5 rounded-full" style="background:rgba(59,130,246,0.1); color:#3B82F6">{{ recentOrders.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[12px]">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-3 py-2 font-medium" style="color: var(--color-text-muted)">#</th>
                  <th class="text-left px-3 py-2 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
                  <th class="text-left px-3 py-2 font-medium hidden sm:table-cell" style="color: var(--color-text-muted)">หน่วยงาน</th>
                  <th class="text-center px-3 py-2 font-medium" style="color: var(--color-text-muted)">สถานะ</th>
                  <th class="text-left px-3 py-2 font-medium" style="color: var(--color-text-muted)">วันที่</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="recentOrders.length===0">
                  <td colspan="5" class="px-3 py-6 text-center text-[12px]" style="color: var(--color-text-muted)">ไม่มีรายการ</td>
                </tr>
                <tr v-for="o in recentOrders" :key="o.id"
                  class="border-b last:border-b-0 hover:opacity-80 transition-opacity"
                  style="border-color: var(--color-border)">
                  <td class="px-3 py-2 font-mono text-[11px]" style="color: var(--color-text-muted)">#{{ o.request_id }}</td>
                  <td class="px-3 py-2">
                    <p class="font-medium leading-tight" style="color: var(--color-text-primary)">{{ o.item_name }}</p>
                    <p class="text-[10px]" style="color: var(--color-text-muted)">{{ o.creator }}</p>
                  </td>
                  <td class="px-3 py-2 hidden sm:table-cell">
                    <p class="text-[11px]" style="color: var(--color-text-secondary)">{{ o.company }}</p>
                    <p class="text-[10px] font-mono" style="color: var(--color-text-muted)">{{ o.mr_number }}</p>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold" :style="`background: ${statusColor(o.status)}18; color: ${statusColor(o.status)}`">{{ statusLabel(o.status) }}</span>
                  </td>
                  <td class="px-3 py-2 text-[11px]" style="color: var(--color-text-muted)">{{ fmtDateTimeShort(o.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── Row 6: Low Stock Alert ─────────────────────────────────────── -->
      <div class="rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation" style="color:#EF4444"></i>
            <p class="text-[13px] font-semibold" style="color: var(--color-text-primary)">แจ้งเตือนสต็อกต่ำ <span class="text-[11px] font-normal ml-1" style="color: var(--color-text-muted)">(≤ 10 หน่วย)</span></p>
          </div>
          <div class="flex gap-2 text-[11px]">
            <span class="px-2 py-0.5 rounded-full" style="background:rgba(239,68,68,0.1);color:#EF4444">วิกฤต (0-2): {{ lowStockItems.filter(i=>i.current_stock<=2).length }}</span>
            <span class="px-2 py-0.5 rounded-full" style="background:rgba(245,158,11,0.1);color:#F59E0B">ต่ำ (3-10): {{ lowStockItems.filter(i=>i.current_stock>2&&i.current_stock<=10).length }}</span>
          </div>
        </div>
        <div v-if="lowStockItems.length === 0" class="px-4 py-6 text-center text-[13px]" style="color: var(--color-text-muted)">
          <i class="fa-solid fa-check-circle mr-2" style="color:#10B981"></i>สต็อกทุกรายการอยู่ในระดับปกติ
        </div>
        <div v-else class="p-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            <div v-for="item in lowStockItems" :key="item.id"
              class="rounded-xl border p-3 text-center relative overflow-hidden"
              :style="`border-color: ${item.current_stock===0?'#FCA5A5':item.current_stock<=2?'#FCA5A5':'#FDE68A'}; background: ${item.current_stock===0?'rgba(239,68,68,0.05)':item.current_stock<=2?'rgba(239,68,68,0.04)':'rgba(245,158,11,0.04)'}`">
              <p class="text-[10px] leading-tight mb-1 line-clamp-2" style="color: var(--color-text-secondary); min-height:28px">{{ item.item_name }}</p>
              <p class="text-[28px] font-black leading-none"
                :style="`color: ${item.current_stock===0?'#DC2626':item.current_stock<=2?'#DC2626':'#D97706'}`">
                {{ item.current_stock }}
              </p>
              <p class="text-[10px] mt-0.5" style="color: var(--color-text-muted)">{{ item.unit }}</p>
              <span class="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                :style="item.current_stock===0?'background:#FEE2E2;color:#DC2626':item.current_stock<=2?'background:#FEE2E2;color:#DC2626':'background:#FEF3C7;color:#D97706'">
                {{ item.current_stock===0 ? 'หมด' : item.current_stock<=2 ? 'วิกฤต' : 'ต่ำ' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Detail Modal ─────────────────────────────────────────────────── -->
    <div v-if="isDetailModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isDetailModalOpen = false"></div>
      <div class="relative w-full max-w-5xl max-h-[85vh] shadow-2xl rounded-2xl flex flex-col overflow-hidden" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[16px] font-bold" style="color: var(--color-text-primary)">
            <i class="fa-solid fa-list-ul mr-2 text-blue-500"></i>{{ modalTitle }}
          </h2>
          <div class="flex items-center gap-4">
            <div v-if="!modalLoading && modalData.length > 0" class="relative">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-gray-400"></i>
              <input 
                v-model="modalSearchText"
                type="text" 
                placeholder="ค้นหาในตาราง..." 
                class="pl-9 pr-4 py-1.5 border rounded-lg text-[12px] focus:outline-none focus:ring-1 transition-all w-48 sm:w-64"
                style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
              />
            </div>
            <button @click="isDetailModalOpen = false" class="p-2 hover:bg-gray-100 dark:hover:bg-slate-700/50 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-auto p-4 sm:p-6">
          <div v-if="modalLoading" class="flex flex-col items-center justify-center py-20">
            <i class="fa-solid fa-spinner fa-spin text-2xl mb-3 text-blue-500"></i>
            <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</p>
          </div>
          
          <div v-else-if="filteredModalData.length === 0" class="flex flex-col items-center justify-center py-20">
            <i class="fa-solid fa-magnifying-glass text-2xl mb-3 text-gray-300"></i>
            <p class="text-[13px]" style="color: var(--color-text-muted)">ไม่พบข้อมูลที่ค้นหา</p>
          </div>

          <div v-else class="overflow-x-auto border rounded-xl" style="border-color: var(--color-border)">
            <table class="w-full text-[13px]">
              <thead class="bg-gray-50 dark:bg-slate-800/50">
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <!-- Columns based on modalType -->
                  <template v-if="modalType === 'items' || modalType === 'low_stock' || modalType === 'items_by_category'">
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ประเภท</th>
                    <th class="text-right px-4 py-3 font-semibold" style="color: var(--color-text-muted)">จำนวนคงเหลือ</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">หน่วย</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
                  </template>
                  
                  <template v-else-if="modalType === 'imports' || modalType === 'tx'">
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">วันที่</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
                    <th class="text-right px-4 py-3 font-semibold" style="color: var(--color-text-muted)">จำนวน</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">หน่วย</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ผู้ดำเนินการ</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">หมายเหตุ</th>
                  </template>

                  <template v-else-if="['pending', 'approved', 'rejected', 'completed', 'all_orders', 'picked_orders'].includes(modalType)">
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">เลขที่</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
                    <th class="text-right px-4 py-3 font-semibold" style="color: var(--color-text-muted)">จำนวน</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">หน่วยงาน</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ผู้ขอเบิก</th>
                    <th class="text-center px-4 py-3 font-semibold" style="color: var(--color-text-muted)">สถานะ</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">วันที่ขอ</th>
                  </template>

                  <template v-else-if="modalType === 'category_summary'">
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">ชื่อหมวดหมู่</th>
                    <th class="text-right px-4 py-3 font-semibold" style="color: var(--color-text-muted)">จำนวนรายการ (SKU)</th>
                    <th class="text-right px-4 py-3 font-semibold" style="color: var(--color-text-muted)">สต็อกรวมในหมวด</th>
                    <th class="text-left px-4 py-3 font-semibold" style="color: var(--color-text-muted)">หมายเหตุ</th>
                  </template>
                </tr>
              </thead>
              <tbody class="divide-y" style="border-color: var(--color-border)">
                <tr v-for="row in filteredModalData" :key="row.id" class="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <!-- Data cells based on modalType -->
                  <template v-if="modalType === 'items' || modalType === 'low_stock' || modalType === 'items_by_category'">
                    <td class="px-4 py-3 font-mono text-[12px]" style="color: var(--color-text-muted)">{{ row.item_code }}</td>
                    <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ row.item_name }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.category?.category_name || '-' }}</td>
                    <td class="px-4 py-3 text-right font-bold" :class="row.current_stock <= 10 ? 'text-red-500' : 'text-green-500'">{{ row.current_stock }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.unit }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.usage_type || '-' }}</td>
                  </template>

                  <template v-else-if="modalType === 'imports' || modalType === 'tx'">
                    <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">{{ fmtDateTimeShort(row.created_at) }}</td>
                    <td class="px-4 py-3 font-mono text-[12px]" style="color: var(--color-text-muted)">{{ row.items?.item_code || '-' }}</td>
                    <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ row.items?.item_name || '-' }}</td>
                    <td class="px-4 py-3 text-right font-bold text-blue-500">{{ row.amount }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.unit }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.creator?.fullname || '-' }}</td>
                    <td class="px-4 py-3 max-w-[150px] truncate" style="color: var(--color-text-muted)" :title="row.remark">{{ row.remark || '-' }}</td>
                  </template>

                  <template v-else-if="['pending', 'approved', 'rejected', 'completed', 'all_orders', 'picked_orders'].includes(modalType)">
                    <td class="px-4 py-3 font-mono text-[12px]" style="color: var(--color-text-muted)">#{{ row.request_id }}</td>
                    <td class="px-4 py-3 font-mono text-[12px]" style="color: var(--color-text-muted)">{{ row.items?.item_code || '-' }}</td>
                    <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ row.items?.item_name || '-' }}</td>
                    <td class="px-4 py-3 text-right font-bold text-blue-500">{{ row.amount }} {{ row.unit }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.company || '-' }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.creator?.fullname || '-' }}</td>
                    <td class="px-4 py-3 text-center">
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" :style="`background: ${statusColor(row.status)}18; color: ${statusColor(row.status)}`">{{ statusLabel(row.status) }}</span>
                    </td>
                    <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">{{ fmtDateTimeShort(row.created_at) }}</td>
                  </template>

                  <template v-else-if="modalType === 'category_summary'">
                    <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">
                      <button @click="openDetailModal('items_by_category', row.id, row.category_name)" class="hover:text-blue-500 hover:underline transition-colors text-left">
                        {{ row.category_name }}
                      </button>
                    </td>
                    <td class="px-4 py-3 text-right font-bold text-blue-500">{{ row.sku_count }}</td>
                    <td class="px-4 py-3 text-right font-bold text-emerald-500">{{ row.total_stock }}</td>
                    <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ row.remark || '-' }}</td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="px-6 py-4 border-t flex justify-between items-center" style="border-color: var(--color-border); background: var(--color-bg-body)">
          <p class="text-[12px]" style="color: var(--color-text-muted)">
            <span v-if="modalSearchText">พบ {{ filteredModalData.length }} จาก </span>
            แสดงทั้งหมด {{ modalData.length }} รายการ
          </p>
          <button @click="isDetailModalOpen = false" class="px-4 py-1.5 rounded-lg text-[13px] font-medium text-white transition-all active:scale-95" style="background: var(--color-primary)">
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
