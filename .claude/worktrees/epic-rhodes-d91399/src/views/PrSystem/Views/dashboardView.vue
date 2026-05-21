<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Chart, registerables } from 'chart.js'
import { supabase } from '@/lib/supabase'
import { useTrcloudStore } from '@/stores/trcloud'

Chart.register(...registerables)

const trcloudStore = useTrcloudStore()
const loading = ref(true)
const errorText = ref('')
const filterMode = ref('all')
const filterFromInput = ref('')
const filterToInput = ref('')
const appliedFrom = ref('')
const appliedTo = ref('')

const prCount = computed(() => trcloudStore.prRows.length)
const poCount = computed(() => trcloudStore.poRows.length)
const apCount = computed(() => trcloudStore.apRows.length)
const pvCount = computed(() => trcloudStore.pvRows.length)

// Tracking counts (items that are not finished/paid)
const prTrackingCount = computed(() => {
  return trcloudStore.prRows.filter(r => {
    const s = (r.status || '').toLowerCase()
    return !s.includes('success') && !s.includes('เสร็จสิ้น') && !s.includes('เรียบร้อย')
  }).length
})

const poTrackingCount = computed(() => {
  return trcloudStore.poRows.filter(r => {
    const s = (r.status || '').toLowerCase()
    return !s.includes('success') && !s.includes('เสร็จสิ้น') && !s.includes('เรียบร้อย')
  }).length
})

const apTrackingCount = computed(() => {
  return trcloudStore.apRows.filter(r => {
    const s = (r.payment_status || '').toLowerCase()
    return s.includes('ยังไม่') || s.includes('unpaid') || s.includes('ค้าง')
  }).length
})

const pvTrackingCount = computed(() => {
  return trcloudStore.pvRows.filter(r => {
    const s = (r.status || '').toLowerCase()
    // Tracking means it's not finished, not paid, and not cancelled
    return !s.includes('ชำระแล้ว') && !s.includes('paid') && !s.includes('complete') && 
           !s.includes('อนุมัติ') && !s.includes('ยกเลิก') && !s.includes('cancel')
  }).length
})

const apPayCount = computed(() => trcloudStore.apRows.filter(x => (x.payment_status || '').includes('ยังไม่')).length)
const apPaidCount = computed(() => trcloudStore.apRows.filter(x => (x.payment_status || '').includes('ชำระแล้ว')).length)

const prTotalAmt = computed(() => trcloudStore.prRows.reduce((s, x) => s + parseFloat(x.grand_total || 0), 0))
const poTotalAmt = computed(() => trcloudStore.poRows.reduce((s, x) => s + parseFloat(x.grand_total || 0), 0))
const apTotalAmt = computed(() => trcloudStore.apRows.reduce((s, x) => s + parseFloat(x.grand_total || 0), 0))
const pvTotalAmt = computed(() => trcloudStore.pvRows.reduce((s, x) => s + parseFloat(x.grand_total || 0), 0))

const apRecentRows = computed(() => [...trcloudStore.apRows].sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date)).slice(0, 10))
const prRecentRows = computed(() => [...trcloudStore.prRows].sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date)).slice(0, 10))

const statusPieRef = ref(null)
const prTrendLineRef = ref(null)
const poTrendLineRef = ref(null)

let statusPieChart = null
let prTrendLineChart = null
let poTrendLineChart = null

const departmentOptions = ref([])
const selectedDepartment = ref('all')
const searchApText = ref('')
const searchUrgentPrText = ref('')
const prMonthInput = ref('')
const prRowsForCharts = ref([])
const poRowsForCharts = ref([])
const teamNameById = ref({})
const urgentNameById = ref({})
const urgentPrRows = ref([])

const trendLineRef = ref(null)
const currencyPendingBarRef = ref(null)
const currencyPaidBarRef = ref(null)
const urgentBarRef = ref(null)
const receiverBarRef = ref(null)
const purchaseStatusBarRef = ref(null)
const monthlyComparisonBarRef = ref(null)

let trendLineChart = null
let currencyPendingBarChart = null
let currencyPaidBarChart = null
let urgentBarChart = null
let receiverBarChart = null
let purchaseStatusBarChart = null
let monthlyComparisonBarChart = null
let renderChartsTimer = null

const currencyValueLabelsPlugin = {
  id: 'currencyValueLabelsPlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart?.ctx
    if (!ctx) return
    ctx.save()
    ctx.font = '12px sans-serif'
    ctx.fillStyle = 'rgba(100, 116, 139, 0.95)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    const topY = chart.chartArea?.top ?? 0
    for (let di = 0; di < chart.data.datasets.length; di += 1) {
      const ds = chart.data.datasets[di]
      const meta = chart.getDatasetMeta(di)
      if (!meta || meta.hidden) continue
      for (let i = 0; i < meta.data.length; i += 1) {
        const v = Number(ds.data?.[i] ?? 0)
        if (!Number.isFinite(v) || v <= 0) continue
        const el = meta.data[i]
        if (!el) continue
        const cur = String(chart?.data?.labels?.[i] || '').trim()
        const pos = el.tooltipPosition()
        const y = Math.max(topY + 12, pos.y - 6)
        ctx.fillText(cur ? `${formatCompactNumber(v)} ${cur}` : formatCompactNumber(v), pos.x, y)
      }
    }
    ctx.restore()
  },
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

function formatCompactNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs < 10000) return n.toLocaleString('th-TH')
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

function moneyText(amount, currency) {
  const a = formatNumber(amount)
  const c = String(currency || '').trim()
  return c ? `${a} ${c}` : a
}

function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  return d.toLocaleString('th-TH')
}

function parseYmdToLocalDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  return new Date(y, mo - 1, d)
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function ymd(d) {
  const x = new Date(d)
  const yyyy = String(x.getFullYear())
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function ym(d) {
  const x = new Date(d)
  const yyyy = String(x.getFullYear())
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function getRollingFourMonthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  return {
    from: ymd(from),
    to: ymd(now),
  }
}

function parseYm(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null
  return { y, mo }
}

function monthStartEndFromYm(value) {
  const p = parseYm(value)
  if (!p) return null
  const start = new Date(p.y, p.mo - 1, 1)
  const end = new Date(p.y, p.mo, 0)
  return { start, end }
}

function setRangeToMonth(value) {
  const out = monthStartEndFromYm(value)
  if (!out) return
  filterMode.value = 'custom'
  filterFromInput.value = ymd(out.start)
  filterToInput.value = ymd(out.end)
  appliedFrom.value = filterFromInput.value
  appliedTo.value = filterToInput.value
  prMonthInput.value = String(value)
  fetchDashboard()
}

function shiftMonth(value, delta) {
  const p = parseYm(value)
  if (!p) return null
  const d = new Date(p.y, p.mo - 1, 1)
  d.setMonth(d.getMonth() + delta)
  return ym(d)
}

function goPrevPrMonth() {
  const next = shiftMonth(prMonthInput.value, -1)
  if (!next) return
  setRangeToMonth(next)
}

function goNextPrMonth() {
  const next = shiftMonth(prMonthInput.value, 1)
  if (!next) return
  setRangeToMonth(next)
}

function applyPrMonthInput() {
  if (!prMonthInput.value) return
  setRangeToMonth(prMonthInput.value)
}

function applyPreset(mode) {
  const now = new Date()
  const end = startOfDay(now)
  let start = startOfDay(now)
  if (mode === 'all') {
    start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  } else if (mode === 'last7') {
    start = new Date(end)
    start.setDate(start.getDate() - 6)
  } else {
    start = new Date(end)
    start.setDate(start.getDate() - 29)
  }
  filterFromInput.value = ymd(start)
  filterToInput.value = ymd(end)
  appliedFrom.value = filterFromInput.value
  appliedTo.value = filterToInput.value
}

function applyFilters() {
  const f = parseYmdToLocalDate(filterFromInput.value)
  const t = parseYmdToLocalDate(filterToInput.value)
  if (!f || !t) return
  appliedFrom.value = filterFromInput.value
  appliedTo.value = filterToInput.value
  fetchDashboard()
}

function resetFilters() {
  selectedDepartment.value = 'all'
  filterMode.value = 'last30'
  applyPreset('last30')
  fetchDashboard()
}

function dayKey(value) {
  const d = new Date(value)
  if (Number.isNaN(+d)) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lastNDaysKeys(n, endDate = null) {
  const out = []
  const now = endDate ? new Date(endDate) : new Date()
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(dayKey(d))
  }
  return out
}

function dayKeysBetween(fromYmd, toYmd, maxDays = 120) {
  const f = parseYmdToLocalDate(fromYmd)
  const t = parseYmdToLocalDate(toYmd)
  if (!f || !t) return []
  const start = startOfDay(f)
  const end = startOfDay(t)
  if (+end < +start) return []
  const out = []
  let cur = new Date(start)
  while (+cur <= +end && out.length < maxDays) {
    out.push(dayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

const rangeFromIso = computed(() => {
  const f = parseYmdToLocalDate(appliedFrom.value)
  return f ? startOfDay(f).toISOString() : null
})
const rangeToIso = computed(() => {
  const t = parseYmdToLocalDate(appliedTo.value)
  return t ? endOfDay(t).toISOString() : null
})

async function fetchDepartmentOptions() {
  try {
    const { data, error } = await supabase.from('system_users').select('department').order('department', { ascending: true })
    if (error) throw error
    const set = new Set()
    for (const r of data || []) {
      const d = String(r?.department || '').trim()
      if (d) set.add(d)
    }
    departmentOptions.value = Array.from(set)
  } catch {
    departmentOptions.value = []
  }
}

async function fetchUrgentMap() {
  try {
    const { data, error } = await supabase.from('urgents').select('id, option_name').order('created_at', { ascending: true })
    if (error) throw error
    const map = {}
    for (const r of data || []) {
      if (!r?.id) continue
      map[r.id] = String(r.option_name || '').trim() || '-'
    }
    urgentNameById.value = map
  } catch {
    urgentNameById.value = {}
  }
}

async function fetchTeamMap() {
  try {
    const { data, error } = await supabase.from('purchasing_team').select('id, team_name').order('created_at', { ascending: true })
    if (error) throw error
    const map = {}
    for (const r of data || []) {
      if (!r?.id) continue
      map[r.id] = String(r.team_name || '').trim() || '-'
    }
    teamNameById.value = map
  } catch {
    teamNameById.value = {}
  }
}

function destroyCharts() {
  for (const c of [statusPieChart, trendLineChart, currencyPendingBarChart, currencyPaidBarChart, urgentBarChart, prTrendLineChart, receiverBarChart, purchaseStatusBarChart, monthlyComparisonBarChart]) {
    try {
      c?.destroy?.()
    } catch {
    }
  }
  statusPieChart = null
  trendLineChart = null
  currencyPendingBarChart = null
  currencyPaidBarChart = null
  urgentBarChart = null
  prTrendLineChart = null
  receiverBarChart = null
  purchaseStatusBarChart = null
  monthlyComparisonBarChart = null
}

async function fetchDashboard() {
  loading.value = true
  errorText.value = ''
  try {
    // Sync store dates
    const rolling = getRollingFourMonthRange()
    trcloudStore.dateFrom = appliedFrom.value || rolling.from
    trcloudStore.dateTo = appliedTo.value || rolling.to

    // If data already exists and it's within 5 minutes, use it instead of full fetch
    const now = new Date()
    const fiveMinutes = 5 * 60 * 1000
    const isCacheFresh = trcloudStore.lastFetched && (now - trcloudStore.lastFetched < fiveMinutes)
    
    // Check if any major data is missing
    const isAnyDataMissing = trcloudStore.prRows.length === 0 || 
                             trcloudStore.poRows.length === 0 || 
                             trcloudStore.apRows.length === 0 || 
                             trcloudStore.pvRows.length === 0

    if (!isCacheFresh || isAnyDataMissing) {
      // Fetch data from TRCLOUD via store
      await trcloudStore.fetchAll({ skipApStatusSync: true })
    }

    // Update charts data
    prRowsForCharts.value = trcloudStore.prRows
    poRowsForCharts.value = trcloudStore.poRows
    chartSourceRows.value = trcloudStore.apRows

    // Urgent PRs
    urgentPrRows.value = trcloudStore.prRows.slice(0, 10)
    await renderCharts()

  } catch (err) {
    errorText.value = String(err?.message || err || 'เกิดข้อผิดพลาด')
  } finally {
    loading.value = false
  }
}

const chartSourceRows = ref([])

const statusChart = computed(() => {
  const labels = ['ยังไม่ชำระ', 'ชำระแล้ว']
  const data = [apPayCount.value, apPaidCount.value]
  return { labels, data }
})

const trendChart = computed(() => {
  const keys = lastNDaysKeys(14)
  const countByDay = {}
  for (const k of keys) countByDay[k] = 0
  for (const r of chartSourceRows.value || []) {
    const k = dayKey(r.issue_date || r.date)
    if (!k || !(k in countByDay)) continue
    countByDay[k] += 1
  }
  return {
    labels: keys.map((k) => k.slice(5)),
    data: keys.map((k) => countByDay[k] ?? 0),
  }
})

const currencyChart = computed(() => {
  const sumPending = {}
  const sumPaid = {}
  for (const r of chartSourceRows.value || []) {
    const cur = String(r.currency || 'THB').trim().toUpperCase()
    if (!cur) continue
    const amt = Number(r.grand_total || 0)
    if (!Number.isFinite(amt)) continue
    const st = String(r.payment_status || '').trim()
    if (st.includes('ชำระแล้ว') || st.includes('Paid')) sumPaid[cur] = (sumPaid[cur] || 0) + amt
    else sumPending[cur] = (sumPending[cur] || 0) + amt
  }
  const currencies = Array.from(new Set([...Object.keys(sumPending), ...Object.keys(sumPaid)])).sort((a, b) => a.localeCompare(b))
  return {
    labels: currencies,
    pending: currencies.map((c) => sumPending[c] || 0),
    paid: currencies.map((c) => sumPaid[c] || 0),
  }
})

const currencyTableRows = computed(() => {
  const labels = currencyChart.value?.labels || []
  const pending = currencyChart.value?.pending || []
  const paid = currencyChart.value?.paid || []
  return labels.map((cur, i) => ({
    cur,
    pending: Number(pending[i] || 0),
    paid: Number(paid[i] || 0),
  }))
})

const hasCurrencyData = computed(() => {
  return (currencyTableRows.value || []).some((r) => (Number(r.pending) || 0) > 0 || (Number(r.paid) || 0) > 0)
})

const prTrendChart = computed(() => {
  const keys = dayKeysBetween(appliedFrom.value, appliedTo.value, 120)
  const safeKeys = keys.length ? keys : lastNDaysKeys(30)
  const countByDay = {}
  for (const k of safeKeys) countByDay[k] = 0
  for (const r of prRowsForCharts.value || []) {
    const k = dayKey(r.issue_date || r.date)
    if (!k || !(k in countByDay)) continue
    countByDay[k] += 1
  }
  return {
    labels: safeKeys.map((k) => k.slice(5)),
    data: safeKeys.map((k) => countByDay[k] ?? 0),
  }
})

const prUrgentChart = computed(() => {
  const count = {}
  for (const r of prRowsForCharts.value || []) {
    const status = r.status || 'ปกติ'
    count[status] = (count[status] || 0) + 1
  }
  const entries = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const labels = entries.map((x) => x[0])
  const data = entries.map((x) => x[1])
  const colors = labels.map((l) => {
    if (String(l).includes('ชำระแล้ว') || String(l).includes('Paid') || String(l).includes('อนุมัติ')) return 'rgba(34, 197, 94, 0.78)'
    if (String(l).includes('ยังไม่') || String(l).includes('ค้าง')) return 'rgba(239, 68, 68, 0.78)'
    if (String(l).includes('รอ') || String(l).includes('Pending')) return 'rgba(249, 115, 22, 0.78)'
    return 'rgba(100, 116, 139, 0.78)'
  })
  return { labels, data, colors }
})

const urgentOnlyFiltered = computed(() => {
  const key = searchUrgentPrText.value.trim().toLowerCase()
  const list = urgentPrRows.value || []
  if (!key) return list
  return list.filter((r) => {
    const haystack = [r.document_number, r.organization, r.project, r.status].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(key)
  })
})

const apRecentFiltered = computed(() => {
  const key = searchApText.value.trim().toLowerCase()
  const list = apRecentRows.value || []
  if (!key) return list
  return list.filter((r) => {
    const haystack = [r.invoice_number, r.document_number, r.organization, r.po, r.payment_status].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(key)
  })
})

const receiverChart = computed(() => {
  const count = {}
  for (const r of poRowsForCharts.value || []) {
    const name = String(r.project || '').trim() || '-'
    count[name] = (count[name] || 0) + 1
  }
  const entries = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 8)
  return {
    labels: entries.map((x) => x[0]),
    data: entries.map((x) => x[1]),
  }
})

const purchaseStatusChart = computed(() => {
  const count = {}
  for (const r of poRowsForCharts.value || []) {
    const s = String(r.status || '').trim()
    if (!s) continue
    count[s] = (count[s] || 0) + 1
  }
  const entries = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 10)
  return {
    labels: entries.map((x) => x[0]),
    data: entries.map((x) => x[1]),
  }
})

const hasPurchaseStatusChart = computed(() => {
  const labels = purchaseStatusChart.value?.labels || []
  const data = purchaseStatusChart.value?.data || []
  if (!labels.length || !data.length) return false
  return data.some((n) => Number(n) > 0)
})

const purchaseTeamTable = computed(() => {
  const count = {}
  for (const r of prRowsForCharts.value || []) {
    const id = r.purchase_team_id
    const name = teamNameById.value?.[id] || (id ? String(id) : '-')
    count[name] = (count[name] || 0) + 1
  }
  return Object.entries(count)
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
})

const monthlyComparisonChart = computed(() => {
  const prs = trcloudStore.prRows
  const pos = trcloudStore.poRows
  const aps = trcloudStore.apRows
  const pvs = trcloudStore.pvRows

  const getMonthKey = (dateStr) => {
    if (!dateStr) return null
    return dateStr.substring(0, 7) // "YYYY-MM"
  }

  // Generate 12 months of the current year
  const currentYear = new Date().getFullYear()
  const monthsMap = {}
  for (let m = 1; m <= 12; m++) {
    const monthStr = `${currentYear}-${String(m).padStart(2, '0')}`
    monthsMap[monthStr] = { month: monthStr, pr: 0, po: 0, ap: 0, pv: 0 }
  }

  const processRows = (rows, type) => {
    for (const r of rows) {
      const month = getMonthKey(r.issue_date || r.date)
      if (!month || !monthsMap[month]) continue
      monthsMap[month][type]++
    }
  }

  processRows(prs, 'pr')
  processRows(pos, 'po')
  processRows(aps, 'ap')
  processRows(pvs, 'pv')

  const sortedMonths = Object.values(monthsMap).sort((a, b) => a.month.localeCompare(b.month))
  
  // Mapping month numbers to Thai names for better readability
  const monthNames = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ]

  return {
    labels: sortedMonths.map(m => {
      const monthNum = parseInt(m.month.split('-')[1])
      return monthNames[monthNum - 1]
    }),
    prData: sortedMonths.map(m => m.pr),
    poData: sortedMonths.map(m => m.po),
    apData: sortedMonths.map(m => m.ap),
    pvData: sortedMonths.map(m => m.pv)
  }
})

async function renderCharts() {
  await nextTick()
  destroyCharts()

  if (statusPieRef.value) {
    statusPieChart = new Chart(statusPieRef.value, {
      type: 'doughnut',
      data: {
        labels: statusChart.value.labels,
        datasets: [
          {
            data: statusChart.value.data,
            backgroundColor: ['#f97316', '#f59e0b', '#22c55e'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        cutout: '65%',
      },
    })
  }

  if (trendLineRef.value) {
    trendLineChart = new Chart(trendLineRef.value, {
      type: 'line',
      data: {
        labels: trendChart.value.labels,
        datasets: [
          {
            label: 'AP Requests (14 วัน)',
            data: trendChart.value.data,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }

  if (currencyPendingBarRef.value) {
    currencyPendingBarChart = new Chart(currencyPendingBarRef.value, {
      type: 'bar',
      plugins: [currencyValueLabelsPlugin],
      data: {
        labels: currencyChart.value.labels,
        datasets: [
          {
            label: 'รอชำระ/บางส่วน',
            data: currencyChart.value.pending,
            backgroundColor: 'rgba(249, 115, 22, 0.75)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx?.parsed?.y ?? 0)
                const cur = String(ctx?.label || '').trim()
                const base = `${ctx.dataset?.label || ''}: ${formatNumber(v)}`
                return cur ? `${base} ${cur}` : base
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => formatCompactNumber(v) } },
        },
      },
    })
  }

  if (currencyPaidBarRef.value) {
    currencyPaidBarChart = new Chart(currencyPaidBarRef.value, {
      type: 'bar',
      plugins: [currencyValueLabelsPlugin],
      data: {
        labels: currencyChart.value.labels,
        datasets: [
          {
            label: 'จ่ายครบ',
            data: currencyChart.value.paid,
            backgroundColor: 'rgba(34, 197, 94, 0.75)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx?.parsed?.y ?? 0)
                const cur = String(ctx?.label || '').trim()
                const base = `${ctx.dataset?.label || ''}: ${formatNumber(v)}`
                return cur ? `${base} ${cur}` : base
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => formatCompactNumber(v) } },
        },
      },
    })
  }

  if (urgentBarRef.value) {
    urgentBarChart = new Chart(urgentBarRef.value, {
      type: 'bar',
      data: {
        labels: prUrgentChart.value.labels,
        datasets: [
          {
            label: 'จำนวน PR (Top 8)',
            data: prUrgentChart.value.data,
            backgroundColor: prUrgentChart.value.colors,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }

  if (prTrendLineRef.value) {
    prTrendLineChart = new Chart(prTrendLineRef.value, {
      type: 'line',
      data: {
        labels: prTrendChart.value.labels,
        datasets: [
          {
            label: 'PR เปิด (30 วัน)',
            data: prTrendChart.value.data,
            borderColor: '#0ea5e9',
            backgroundColor: 'rgba(14, 165, 233, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }

  if (receiverBarRef.value) {
    receiverBarChart = new Chart(receiverBarRef.value, {
      type: 'bar',
      data: {
        labels: receiverChart.value.labels,
        datasets: [
          {
            label: 'PO เปิด (คนรับงาน)',
            data: receiverChart.value.data,
            backgroundColor: 'rgba(37, 99, 235, 0.75)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }

  if (purchaseStatusBarRef.value) {
    purchaseStatusBarChart = new Chart(purchaseStatusBarRef.value, {
      type: 'bar',
      data: {
        labels: purchaseStatusChart.value.labels,
        datasets: [
          {
            label: 'สถานะการซื้อ (PO)',
            data: purchaseStatusChart.value.data,
            backgroundColor: 'rgba(100, 116, 139, 0.75)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }

  if (monthlyComparisonBarRef.value) {
    monthlyComparisonBarChart = new Chart(monthlyComparisonBarRef.value, {
      type: 'bar',
      data: {
        labels: monthlyComparisonChart.value.labels,
        datasets: [
          {
            label: 'PR',
            data: monthlyComparisonChart.value.prData,
            backgroundColor: 'rgba(54, 162, 235, 0.75)', // Blue
          },
          {
            label: 'PO',
            data: monthlyComparisonChart.value.poData,
            backgroundColor: 'rgba(153, 102, 255, 0.75)', // Purple
          },
          {
            label: 'AP',
            data: monthlyComparisonChart.value.apData,
            backgroundColor: 'rgba(255, 159, 64, 0.75)', // Orange
          },
          {
            label: 'PV',
            data: monthlyComparisonChart.value.pvData,
            backgroundColor: 'rgba(75, 192, 192, 0.75)', // Green
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom'
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
  }
}

function scheduleRenderCharts() {
  if (renderChartsTimer) clearTimeout(renderChartsTimer)
  renderChartsTimer = setTimeout(() => {
    renderCharts()
    renderChartsTimer = null
  }, 180)
}

watch([statusChart, trendChart, currencyChart, prUrgentChart, prTrendChart, receiverChart, purchaseStatusChart, monthlyComparisonChart], () => {
  if (loading.value) return
  scheduleRenderCharts()
})

onMounted(async () => {
  // Set default filter mode to "All"
  filterMode.value = 'all'
  applyPreset('all')
  
  prMonthInput.value = appliedTo.value ? String(appliedTo.value).slice(0, 7) : ym(new Date())
  await Promise.all([fetchDepartmentOptions(), fetchUrgentMap(), fetchTeamMap()])
  await fetchDashboard()
})

onUnmounted(() => {
  if (renderChartsTimer) clearTimeout(renderChartsTimer)
  destroyCharts()
})
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-5">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">แดชบอร์ด</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          สรุประบบ PR/PO/AP พร้อมกราฟ และรายงาน (ตามช่วงวันที่ที่เลือก)
        </p>
        <div class="mt-3 flex flex-col lg:flex-row lg:items-end gap-3">
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-medium" style="color: var(--color-text-muted)">ช่วงวันที่:</span>
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
              :class="filterMode === 'all' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
              :style="filterMode === 'all' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
              @click="filterMode = 'all'; applyPreset('all'); fetchDashboard()"
            >
              4 เดือนล่าสุด
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
              :class="filterMode === 'last7' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
              :style="filterMode === 'last7' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
              @click="filterMode = 'last7'; applyPreset('last7'); fetchDashboard()"
            >
              7 วัน
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
              :class="filterMode === 'last30' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
              :style="filterMode === 'last30' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
              @click="filterMode = 'last30'; applyPreset('last30'); fetchDashboard()"
            >
              30 วัน
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
              :class="filterMode === 'custom' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'"
              :style="filterMode === 'custom' ? { borderColor: '#2563eb' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }"
              @click="filterMode = 'custom'"
            >
              กำหนดเอง
            </button>
          </div>

          <div class="flex flex-col sm:flex-row gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</span>
              <input
                v-model="filterFromInput"
                type="date"
                class="px-3 py-1.5 rounded-lg text-[12px] border"
                style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
              />
              <span class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</span>
              <input
                v-model="filterToInput"
                type="date"
                class="px-3 py-1.5 rounded-lg text-[12px] border"
                style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
              />
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[12px] font-medium" style="color: var(--color-text-muted)">หน่วยงาน</span>
              <select
                v-model="selectedDepartment"
                class="px-3 py-1.5 rounded-lg text-[12px] border"
                style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
              >
                <option value="all">ทั้งหมด</option>
                <option v-for="d in departmentOptions" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all"
                style="border-color: var(--color-border); color: var(--color-text-secondary)"
                :disabled="loading"
                @click="applyFilters"
              >
                ใช้ตัวกรอง
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all"
                style="border-color: var(--color-border); color: var(--color-text-secondary)"
                :disabled="loading"
                @click="resetFilters"
              >
                ล้าง
              </button>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all self-start"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
        :disabled="loading"
        @click="fetchDashboard"
      >
        รีเฟรช
      </button>
    </div>

    <div v-if="errorText" class="mb-4 rounded-xl border p-3 text-[13px]" style="border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.06); color: #b91c1c">
      {{ errorText }}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] font-medium" style="color: var(--color-text-muted)">PR ทั้งหมด / ติดตามงาน</div>
        <div class="mt-1 text-[22px] font-semibold" style="color: var(--color-text-primary)">
          {{ loading ? '-' : prCount }} / <span class="text-red-500">{{ loading ? '-' : prTrackingCount }}</span>
        </div>
        <div class="mt-1 text-[12px]" style="color: var(--color-text-muted)">มูลค่ารวม: {{ formatNumber(prTotalAmt) }} ฿</div>
      </div>
      <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] font-medium" style="color: var(--color-text-muted)">PO ทั้งหมด / ติดตามงาน</div>
        <div class="mt-1 text-[22px] font-semibold" style="color: var(--color-text-primary)">
          {{ loading ? '-' : poCount }} / <span class="text-red-500">{{ loading ? '-' : poTrackingCount }}</span>
        </div>
        <div class="mt-1 text-[12px]" style="color: var(--color-text-muted)">มูลค่ารวม: {{ formatNumber(poTotalAmt) }} ฿</div>
      </div>
      <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] font-medium" style="color: var(--color-text-muted)">AP ทั้งหมด / ติดตามงาน (ยังไม่ชำระ)</div>
        <div class="mt-1 text-[22px] font-semibold" style="color: var(--color-text-primary)">
          {{ loading ? '-' : apCount }} / <span class="text-red-500">{{ loading ? '-' : apTrackingCount }}</span>
        </div>
        <div class="mt-1 text-[12px]" style="color: var(--color-text-muted)">มูลค่ารวม: {{ formatNumber(apTotalAmt) }} ฿</div>
      </div>
      <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] font-medium" style="color: var(--color-text-muted)">PV ทั้งหมด / ติดตามงาน</div>
        <div class="mt-1 text-[22px] font-semibold" style="color: var(--color-text-primary)">
          {{ loading ? '-' : pvCount }} / <span class="text-red-500">{{ loading ? '-' : pvTrackingCount }}</span>
        </div>
        <div class="mt-1 text-[12px]" style="color: var(--color-text-muted)">มูลค่ารวม: {{ formatNumber(pvTotalAmt) }} ฿</div>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
      <div class="rounded-xl border p-3 xl:col-span-1" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">สัดส่วนสถานะ AP</div>
        </div>
        <div class="h-[200px]">
          <canvas ref="statusPieRef"></canvas>
        </div>
      </div>

      <div class="rounded-xl border p-3 xl:col-span-2" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">แนวโน้มการสร้าง AP (14 วัน)</div>
        </div>
        <div class="h-[200px]">
          <canvas ref="trendLineRef"></canvas>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
      <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[13px] font-semibold mb-3" style="color: var(--color-text-primary)">ยอดรวมแยกตามสกุลเงิน (AP)</div>
        <div v-if="hasCurrencyData">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="rounded-lg border p-3" style="border-color: var(--color-border)">
              <div class="text-[12px] font-semibold mb-2" style="color: var(--color-text-secondary)">รอชำระ/บางส่วน</div>
              <div class="h-[200px]">
                <canvas ref="currencyPendingBarRef"></canvas>
              </div>
            </div>
            <div class="rounded-lg border p-3" style="border-color: var(--color-border)">
              <div class="text-[12px] font-semibold mb-2" style="color: var(--color-text-secondary)">จ่ายครบ</div>
              <div class="h-[200px]">
                <canvas ref="currencyPaidBarRef"></canvas>
              </div>
            </div>
          </div>

          <div class="mt-3 overflow-x-auto">
            <table class="w-full text-[13px] min-w-[520px]">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-3 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สกุลเงิน</th>
                  <th class="text-right px-3 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">รอชำระ/บางส่วน</th>
                  <th class="text-right px-3 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จ่ายครบ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in currencyTableRows" :key="r.cur" style="border-bottom: 1px solid var(--color-border)">
                  <td class="px-3 py-2 font-semibold whitespace-nowrap" style="color: var(--color-text-primary)">{{ r.cur }}</td>
                  <td class="px-3 py-2 text-right whitespace-nowrap" style="color: var(--color-text-primary)">{{ formatNumber(r.pending) }} {{ r.cur }}</td>
                  <td class="px-3 py-2 text-right whitespace-nowrap" style="color: var(--color-text-primary)">{{ formatNumber(r.paid) }} {{ r.cur }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="rounded-lg border p-4 text-[13px] text-center" style="border-color: var(--color-border); color: var(--color-text-muted)">
          ไม่พบข้อมูลสกุลเงินในช่วงวันที่/หน่วยงานที่เลือก
        </div>
      </div>
      <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[13px] font-semibold mb-3" style="color: var(--color-text-primary)">ความเร่งด่วน (Top 8, เปิด PR)</div>
        <div class="h-[220px]">
          <canvas ref="urgentBarRef"></canvas>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
      <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">แนวโน้มการเปิด PR (รายวัน)</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="w-9 h-9 rounded-lg border hover:bg-gray-50 transition-all inline-flex items-center justify-center"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
              :disabled="loading"
              @click="goPrevPrMonth"
              title="เดือนก่อนหน้า"
            >
              <i class="fa-solid fa-chevron-left text-[12px]"></i>
            </button>
            <input
              v-model="prMonthInput"
              type="month"
              class="px-3 py-2 rounded-lg text-[12px] border"
              style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
              :disabled="loading"
              @change="applyPrMonthInput"
              title="เลือกเดือน"
            />
            <button
              type="button"
              class="w-9 h-9 rounded-lg border hover:bg-gray-50 transition-all inline-flex items-center justify-center"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
              :disabled="loading"
              @click="goNextPrMonth"
              title="เดือนถัดไป"
            >
              <i class="fa-solid fa-chevron-right text-[12px]"></i>
            </button>
          </div>
        </div>
        <div class="h-[220px]">
          <canvas ref="prTrendLineRef"></canvas>
        </div>
      </div>
      <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[13px] font-semibold mb-3" style="color: var(--color-text-primary)">รายการเปิด PO (คนรับงาน, Top 8)</div>
        <div class="h-[220px]">
          <canvas ref="receiverBarRef"></canvas>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
      <div
        v-if="hasPurchaseStatusChart"
        class="rounded-xl border p-3"
        style="background: var(--color-bg-card); border-color: var(--color-border)"
      >
        <div class="text-[13px] font-semibold mb-3" style="color: var(--color-text-primary)">สถานะการซื้อ (PO)</div>
        <div class="h-[220px]">
          <canvas ref="purchaseStatusBarRef"></canvas>
        </div>
      </div>
      <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[13px] font-semibold mb-3" style="color: var(--color-text-primary)">เปรียบเทียบจำนวนเอกสารรายเดือน (PR, PO, AP, PV)</div>
        <div class="h-[250px]">
          <canvas ref="monthlyComparisonBarRef"></canvas>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- ตาราง: รายการเร่งด่วน (เฉพาะ "ด่วน")                        -->
    <!-- header sticky — scroll เฉพาะ tbody                          -->
    <!-- ============================================================ -->
    <div class="rounded-xl border mt-4 overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">รายการเร่งด่วน (เฉพาะ "ด่วน")</div>
          <div class="relative w-full sm:w-[360px]">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="searchUrgentPrText"
              type="text"
              placeholder="ค้นหา PR, รายการ, หน่วย..."
              class="w-full pl-9 pr-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>
      </div>
      <!-- scroll container: x และ y อยู่ที่ div นี้ -->
      <div class="overflow-x-auto" style="max-height: 380px; overflow-y: auto">
        <table class="w-full text-[13px] min-w-[900px]">
          <!-- thead sticky ติดด้านบนของ scroll container -->
          <thead style="position: sticky; top: 0; z-index: 10; background: var(--color-bg-card)">
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลข PR</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รายละเอียด</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">โครงการ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && urgentOnlyFiltered.length === 0">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
            <tr v-for="r in urgentOnlyFiltered.slice(0, 10)" :key="r.id || r.document_number" class="border-b last:border-b-0" style="border-color: var(--color-border)">
              <td class="px-4 py-3 font-semibold whitespace-nowrap" style="color: #2563eb">{{ r.document_number || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); white-space: normal; word-break: break-word">{{ r.organization || r.department || '-' }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ r.project || '-' }}</td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ r.issue_date || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- ตาราง: รายการ AP ล่าสุด                                      -->
    <!-- header sticky — scroll เฉพาะ tbody                          -->
    <!-- ============================================================ -->
    <div class="rounded-xl border mt-4 overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">รายการ AP ล่าสุด</div>
          <div class="relative w-full sm:w-[360px]">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="searchApText"
              type="text"
              placeholder="ค้นหา AP, PO, ผู้ขาย, รายการ..."
              class="w-full pl-9 pr-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>
      </div>
      <!-- scroll container: x และ y อยู่ที่ div นี้ -->
      <div class="overflow-x-auto" style="max-height: 380px; overflow-y: auto">
        <table class="w-full text-[13px] min-w-[980px]">
          <!-- thead sticky ติดด้านบนของ scroll container -->
          <thead style="position: sticky; top: 0; z-index: 10; background: var(--color-bg-card)">
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลขที่เอกสาร</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลข PO</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้ขาย/หน่วยงาน</th>
              <th class="text-right px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอด</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะการชำระ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && apRecentFiltered.length === 0">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
            <tr
              v-for="r in apRecentFiltered.slice(0, 10)"
              :key="r.id || r.invoice_number"
              class="border-b last:border-b-0 hover:bg-gray-50 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 font-semibold whitespace-nowrap" style="color: #2563eb">{{ r.invoice_number || r.document_number || '-' }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-primary)">{{ r.po || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); white-space: normal; word-break: break-word">{{ r.organization || '-' }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap" style="color: var(--color-text-primary)">{{ moneyText(r.grand_total, r.currency) }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ r.payment_status || '-' }}</td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ r.issue_date || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
button:focus,
input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>