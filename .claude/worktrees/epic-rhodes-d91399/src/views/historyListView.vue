<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import logoThaiDrill from '@/assets/thaidrill_company.png'
import logoThaiDrillLao from '@/assets/thaidrillLao_company.png'
import logoTDL_MVDC from '@/assets/tdl&mvdc_company.jpg'
import logoSunny from '@/assets/sunnycompany.png'

const loading = ref(true)
const exportingGroupKey = ref('')
const orders = ref([])
const transactions = ref([])
const searchText = ref('')
const exportBill = ref(null)

const isHistoryBillPreviewOpen = ref(false)
const historyBillPreviewLoading = ref(false)
const historyBillPreviewNotFound = ref(false)
const historyBillPreview = ref(null)

const companyOptions = ['รถเจาะไทย', 'ซั่นนี่ เฟอติไลเซอร์', 'ปู่รากหญ้า', 'ที่ดี พึกษ์', 'ที่ดี คอนแทรคเตอร์', 'ไทดริว ลาว', 'อื่นๆ แมชชีน']
const purposeOptions = [
  { key: 'broken', label: 'ขาดไม่ได้ระดับ' },
  { key: 'pm', label: 'ทำ PM วาระ' },
  { key: 'rust', label: 'มีอาการรั่วซึม' },
  { key: 'colorFade', label: 'สึกหรอตามอายุการใช้งาน' },
  { key: 'colorMismatch', label: 'เชื่อมพอกกันสึกหรอ' },
  { key: 'cracked', label: 'มีการแตกร้าว' },
  { key: 'reserve', label: 'เป็นอะไหล่สำรอง' },
  { key: 'damageLoss', label: 'อาไหล่สูญหาย' },
  { key: 'fromAccident', label: 'จากอุบัติเหตุ' },
  { key: 'changeOther', label: 'แก้ไข/ดัดแปลง' },
  { key: 'preventAccident', label: 'ป้องกันเกิดอุบัติเหตุ' },
  { key: 'clean', label: 'ทำความสะอาด' },
  { key: 'officeTool', label: 'อุปกรณ์สำนักงาน' },
  { key: 'other1', label: 'อื่นๆ' },
  { key: 'other2', label: 'อื่นๆ' }
]

async function fetchData() {
  loading.value = true
  try {
    const [{ data: ordersData, error: ordersError }, { data: txData, error: txError }] = await Promise.all([
      supabase
        .from('order_req')
        .select(`
          id,
          request_id,
          created_at,
          created_by,
          amount,
          unit,
          note,
          remark,
          status,
          updated_at,
          updated_by,
          mr_number,
          company,
          fixed_bill_number,
          metter_hour,
          metter_kilometter,
          withdraw_purpose,
          receive_by,
          inspector_by,
          is_return,
          items(item_code,item_name,unit),
          category(category_name),
          requester:system_users!created_by(fullname, position, department, emp_code),
          approver:system_users!updated_by(fullname, emp_code)
        `)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('order_id, amount, unit, return_date, created_at, created_by')
        .order('created_at', { ascending: false })
    ])

    if (ordersError) throw ordersError
    if (txError) throw txError

    orders.value = ordersData || []
    transactions.value = txData || []
  } catch (err) {
    alert('โหลดประวัติการเบิกไม่สำเร็จ: ' + err.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

// --- Barcode scanner state (History) ---
let barcodeBuffer = ''
let barcodeTimer = null
const BARCODE_TIMEOUT_MS = 80

function handleKeyDown(e) {
  const tag = document.activeElement?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return

  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 2) {
      processHistoryBarcodeInput(barcodeBuffer.trim())
    }
    barcodeBuffer = ''
    clearTimeout(barcodeTimer)
    return
  }

  if (e.key.length === 1) {
    barcodeBuffer += e.key
    clearTimeout(barcodeTimer)
    barcodeTimer = setTimeout(() => {
      barcodeBuffer = ''
    }, BARCODE_TIMEOUT_MS)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  clearTimeout(barcodeTimer)
})

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH')
}

function formatDateOnly(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH')
}

function txByOrderId(orderId) {
  return transactions.value.find((row) => row.order_id === orderId) || null
}

function buildHistoryGroups(rows) {
  const groups = {}

  rows.forEach((row) => {
    const key = row.request_id ? `request-${row.request_id}` : `single-${row.id}`
    const tx = txByOrderId(row.id)
    const actualAmount = Number(tx?.amount ?? row.amount ?? 0)
    const actualUnit = tx?.unit || row.unit || row.items?.unit || ''

    if (!groups[key]) {
      groups[key] = {
        key,
        requestId: row.request_id || row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        requester: row.requester || null,
        approver: row.approver || null,
        receiveBy: row.receive_by || '',
        inspectorBy: row.inspector_by || '',
        mrNumber: row.mr_number || '',
        company: row.company || '',
        fixedBillNumber: row.fixed_bill_number || '',
        metterHour: row.metter_hour || '',
        metterKilometter: row.metter_kilometter || '',
        withdrawPurpose: row.withdraw_purpose || '',
        withdrawTypeForSale: false,
        withdrawTypeNew: false,
        machineNote: row.note || '',
        items: [],
        totalAmount: 0,
        returnDates: []
      }
    }

    groups[key].items.push({
      id: row.id,
      itemCode: row.items?.item_code || '-',
      itemName: row.items?.item_name || '-',
      amount: actualAmount,
      unit: actualUnit,
      note: row.note || '',
      remark: row.remark || '',
      isReturn: row.is_return,
      returnDate: tx?.return_date || null
    })
    groups[key].totalAmount += actualAmount

    if (tx?.return_date) {
      groups[key].returnDates.push(tx.return_date)
    }

    if (new Date(row.updated_at) > new Date(groups[key].updatedAt)) {
      groups[key].updatedAt = row.updated_at
    }
  })

  return Object.values(groups).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

const historyGroups = computed(() => buildHistoryGroups(orders.value))

const filteredHistoryGroups = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return historyGroups.value

  return historyGroups.value.filter((group) => {
    const requestId = String(group.requestId || '').toLowerCase()
    const mrNumber = (group.mrNumber || '').toLowerCase()
    const company = (group.company || '').toLowerCase()
    const requester = (group.requester?.fullname || '').toLowerCase()
    const itemText = group.items
      .map((item) => `${item.itemCode} ${item.itemName} ${item.note} ${item.remark}`)
      .join(' ')
      .toLowerCase()

    return requestId.includes(key) || mrNumber.includes(key) || company.includes(key) || requester.includes(key) || itemText.includes(key)
  })
})

function getGroupSubtitle(group) {
  return group.items
    .slice(0, 3)
    .map((item) => item.itemName)
    .join(', ')
}

function getReturnDateText(group) {
  if (!group.returnDates.length) return '-'
  return group.returnDates.map((date) => formatDate(date)).join(', ')
}

function getMachineNumber(note) {
  return note?.split('\nสาเหตุทดแทน: ')[0]?.replace('หมายเลขเครื่องจักร: ', '') || '-'
}

function getReplaceReason(note) {
  return note?.split('\nสาเหตุทดแทน: ')[1] || '-'
}

function isPurposeChecked(value, label) {
  if (!value) return false
  return value
    .split(',')
    .map((part) => part.trim())
    .some((part) => part.startsWith(label))
}

function getPurposeDetail(value, label) {
  if (!value) return ''
  const entry = value
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith(label))
  if (!entry) return ''
  return entry.slice(label.length).trim()
}

function getDisplayName(person) {
  if (!person?.fullname) return '-'
  return person.emp_code ? `${person.fullname} (${person.emp_code})` : person.fullname
}

function getPdfFileName(group) {
  return `withdraw-slip-${group.requestId || 'document'}.pdf`
}

function buildExportPayload(group) {
  return {
    ...group,
    items: group.items.map((item) => ({ ...item }))
  }
}

function closeHistoryBillPreview() {
  isHistoryBillPreviewOpen.value = false
  historyBillPreview.value = null
  historyBillPreviewNotFound.value = false
}

function buildHistoryGroupFromRows(rows, txRows) {
  const txLookup = (orderId) => txRows.find((row) => row.order_id === orderId) || null
  const groups = {}

  rows.forEach((row) => {
    const key = row.request_id ? `request-${row.request_id}` : `single-${row.id}`
    const tx = txLookup(row.id)
    const actualAmount = Number(tx?.amount ?? row.amount ?? 0)
    const actualUnit = tx?.unit || row.unit || row.items?.unit || ''

    if (!groups[key]) {
      groups[key] = {
        key,
        requestId: row.request_id || row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        requester: row.requester || null,
        approver: row.approver || null,
        receiveBy: row.receive_by || '',
        inspectorBy: row.inspector_by || '',
        mrNumber: row.mr_number || '',
        company: row.company || '',
        fixedBillNumber: row.fixed_bill_number || '',
        metterHour: row.metter_hour || '',
        metterKilometter: row.metter_kilometter || '',
        withdrawPurpose: row.withdraw_purpose || '',
        withdrawTypeForSale: false,
        withdrawTypeNew: false,
        machineNote: row.note || '',
        items: [],
        totalAmount: 0,
        returnDates: []
      }
    }

    groups[key].items.push({
      id: row.id,
      itemCode: row.items?.item_code || '-',
      itemName: row.items?.item_name || '-',
      amount: actualAmount,
      unit: actualUnit,
      note: row.note || '',
      remark: row.remark || '',
      isReturn: row.is_return,
      returnDate: tx?.return_date || null
    })
    groups[key].totalAmount += actualAmount

    if (tx?.return_date) {
      groups[key].returnDates.push(tx.return_date)
    }

    if (new Date(row.updated_at) > new Date(groups[key].updatedAt)) {
      groups[key].updatedAt = row.updated_at
    }
  })

  return Object.values(groups).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

function loadHtml2Pdf() {
  return new Promise((resolve, reject) => {
    if (window.html2pdf) {
      resolve(window.html2pdf)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
    s.onload = () => resolve(window.html2pdf)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function loadJsBarcode() {
  return new Promise((resolve, reject) => {
    if (window.JsBarcode) {
      resolve(window.JsBarcode)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js'
    s.onload = () => resolve(window.JsBarcode)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

async function renderExportBarcode(requestId) {
  if (!requestId) return
  const barcodeLib = await loadJsBarcode()
  const barcodeElement = document.querySelector('#pdf-bill-barcode')
  if (!barcodeElement) return
  barcodeLib('#pdf-bill-barcode', String(requestId), {
    format: 'CODE128',
    width: 1.2,
    height: 35,
    displayValue: true,
    fontSize: 10,
    margin: 0
  })
}

async function renderHistoryPreviewBarcode(requestId) {
  if (!requestId) return
  const barcodeLib = await loadJsBarcode()
  const barcodeElement = document.querySelector('#history-bill-barcode')
  if (!barcodeElement) return
  barcodeLib('#history-bill-barcode', String(requestId), {
    format: 'CODE128',
    width: 1.2,
    height: 35,
    displayValue: true,
    fontSize: 10,
    margin: 0
  })
}

async function processHistoryBarcodeInput(code) {
  const requestId = parseInt(code, 10)
  if (isNaN(requestId)) return

  isHistoryBillPreviewOpen.value = true
  historyBillPreviewLoading.value = true
  historyBillPreviewNotFound.value = false
  historyBillPreview.value = null

  try {
    const existingGroup = historyGroups.value.find((g) => String(g.requestId) === String(requestId))
    let group = existingGroup || null

    if (!group) {
      const { data: ordersData, error: ordersError } = await supabase
        .from('order_req')
        .select(`
          id,
          request_id,
          created_at,
          created_by,
          amount,
          unit,
          note,
          remark,
          status,
          updated_at,
          updated_by,
          mr_number,
          company,
          fixed_bill_number,
          metter_hour,
          metter_kilometter,
          withdraw_purpose,
          receive_by,
          inspector_by,
          is_return,
          items(item_code,item_name,unit),
          category(category_name),
          requester:system_users!created_by(fullname, position, department, emp_code),
          approver:system_users!updated_by(fullname, emp_code)
        `)
        .eq('request_id', requestId)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })

      if (ordersError) throw ordersError

      if (!ordersData || ordersData.length === 0) {
        historyBillPreviewNotFound.value = true
        return
      }

      const orderIds = ordersData.map((o) => o.id)
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('order_id, amount, unit, return_date, created_at, created_by')
        .in('order_id', orderIds)

      if (txError) throw txError

      const built = buildHistoryGroupFromRows(ordersData, txData || [])
      group = built[0] || null
    }

    if (!group) {
      historyBillPreviewNotFound.value = true
      return
    }

    historyBillPreview.value = buildExportPayload(group)
    await nextTick()
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    await renderHistoryPreviewBarcode(group.requestId)
  } catch (err) {
    alert('ค้นหาใบบินไม่สำเร็จ: ' + err.message)
    closeHistoryBillPreview()
  } finally {
    historyBillPreviewLoading.value = false
  }
}

async function downloadPdf(group) {
  exportingGroupKey.value = group.key
  exportBill.value = buildExportPayload(group)

  try {
    await nextTick()
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    await renderExportBarcode(group.requestId)
    const html2pdf = await loadHtml2Pdf()
    const element = document.getElementById('pdf-bill-area')
    if (!element) throw new Error('ไม่พบพื้นที่สำหรับสร้าง PDF')

    await html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        filename: getPdfFileName(group),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .from(element)
      .save()
  } catch (err) {
    alert('ดาวน์โหลด PDF ไม่สำเร็จ: ' + err.message)
  } finally {
    exportBill.value = null
    exportingGroupKey.value = ''
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ประวัติการเบิก</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะรายการที่ “เบิกแล้ว” (completed)</p>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isHistoryBillPreviewOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeHistoryBillPreview"></div>
        <div class="relative w-full max-w-[1040px] h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <div>
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-barcode text-[16px]" style="color: var(--color-text-muted)"></i>
                <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">ใบบิน (จากการสแกน)</h2>
                <span v-if="historyBillPreview" class="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-800/20 dark:border-blue-800/20 dark:text-blue-500 border border-blue-100">
                  Request #{{ historyBillPreview.requestId }}
                </span>
              </div>
              <p class="text-[12px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะรายการที่ “เบิกแล้ว”</p>
            </div>
            <button @click="closeHistoryBillPreview" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-6">
            <div v-if="historyBillPreviewLoading" class="flex items-center justify-center py-16">
              <div class="flex flex-col items-center gap-3">
                <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังค้นหา...</p>
              </div>
            </div>

            <div v-else-if="historyBillPreviewNotFound" class="flex flex-col items-center justify-center py-16 gap-3">
              <i class="fa-solid fa-circle-xmark text-[40px] text-red-400"></i>
              <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">ไม่พบใบบินเลขที่นี้ในประวัติ “เบิกแล้ว”</p>
              <p class="text-[13px]" style="color: var(--color-text-muted)">กรุณาตรวจสอบบาร์โค้ดและลองใหม่อีกครั้ง</p>
            </div>

            <div v-else-if="historyBillPreview" class="paper-scroll-wrap">
              <div class="paper-sheet bg-white text-gray-900 shadow-xl rounded-lg overflow-hidden font-['Niramit',sans-serif] text-[9px] relative ring-4 ring-blue-500/25" style="color: #111; font-family: 'Niramit', sans-serif;">
                <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div class="rotate-[-12deg] border-[6px] border-blue-600/25 bg-blue-600/5 px-10 py-6">
                    <div class="text-[78px] font-extrabold tracking-widest text-blue-700/15 leading-none whitespace-nowrap">เบิกแล้ว</div>
                  </div>
                </div>

                <div class="p-6 pb-4 pt-4 relative">
                  <div class="relative flex items-stretch gap-3 mb-0">
                    <div class="flex-1 min-w-0 flex flex-col z-10">
                      <div class="flex items-center gap-3">
                        <div class="w-[55px] h-[36px] overflow-hidden flex items-center justify-center bg-white">
                          <img :src="logoThaiDrill" alt="ThaiDrill" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[69px] h-[59px] overflow-hidden flex items-center justify-center bg-white">
                          <img :src="logoThaiDrillLao" alt="ThaiDrill Lao" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[60px] h-[32px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                          <img :src="logoTDL_MVDC" alt="TDLAO & MVDC" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[45px] h-[45px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                          <img :src="logoSunny" alt="SUNNY" class="max-w-full max-h-full object-contain" />
                        </div>
                      </div>

                      <div class="mt-0.3 space-y-1">
                        <div class="flex items-center gap-2">
                          <span class="font-semibold whitespace-nowrap text-[9px]">เลขที่ MR</span>
                          <input :value="historyBillPreview.mrNumber || '-'" readonly class="flex-1 max-w-[189px] border-b border-gray-400 outline-none text-[9px] px-1 bg-transparent" />
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="font-semibold whitespace-nowrap text-[9px]">วันที่</span>
                          <input :value="formatDateOnly(historyBillPreview.createdAt)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 w-52 bg-transparent" />
                        </div>
                      </div>

                      <div class="flex items-center gap-5 mt-auto pt-0.3 text-[9px]">
                        <label class="flex items-center gap-1.5">
                          <input type="checkbox" disabled :checked="historyBillPreview.withdrawTypeForSale" class="w-3 h-3 accent-gray-700" />
                          เบิกเพื่อขาย
                        </label>
                        <label class="flex items-center gap-1.5">
                          <input type="checkbox" disabled :checked="historyBillPreview.withdrawTypeNew" class="w-3 h-3 accent-gray-700" />
                          เบิกใหม่
                        </label>
                        <div class="flex items-center gap-1.5">
                          <span class="whitespace-nowrap">ทดแทนของเก่า : สาเหตุ</span>
                          <input :value="getReplaceReason(historyBillPreview.machineNote)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 flex-1 min-w-[276px] bg-transparent" />
                        </div>
                      </div>
                    </div>

                    <div class="absolute left-1/2 top-[18px] -translate-x-1/2 pointer-events-none z-0 w-[220px] text-center">
                      <h1 class="text-[18px] font-bold leading-none whitespace-nowrap" style="color: #111;">ใบเบิกพัสดุ</h1>
                    </div>

                    <div class="shrink-0 z-10">
                      <div class="text-[9px] text-gray-500 mb-0.2 text-right">FM-MT-ST01-02 REV 03 - 09/04/2669</div>
                      <div class="border border-gray-400 p-0.5 text-[9px] min-w-[150px]">
                        <div v-for="(label, idx) in companyOptions" :key="idx" class="flex items-center gap-1.5 leading-[1.2]">
                          <input type="radio" disabled :checked="historyBillPreview.company === label" class="w-2 h-2 accent-gray-700" />
                          <span>{{ label }}</span>
                        </div>
                        <div class="flex items-center gap-1 mt-0.2 pt-0.3 border-t border-gray-300">
                          <span class="text-[10px]">CONST CENTER</span>
                          <div class="flex gap-1 ml-1">
                            <div v-for="i in 5" :key="i" class="w-3 h-3 border border-gray-400 text-center text-[9px]">-</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 mt-2 text-[9px]">
                    <div class="flex items-center gap-1">
                      <span class="font-semibold">รหัสใบสั่งช่อม</span>
                      <input :value="historyBillPreview.fixedBillNumber || '-'" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>หมายเลขเครื่องจักร</span>
                      <input :value="getMachineNumber(historyBillPreview.machineNote)" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>มิเตอร์ (ชม.)</span>
                      <input :value="historyBillPreview.metterHour || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>มิเตอร์ (กม.)</span>
                      <input :value="historyBillPreview.metterKilometter || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
                    </div>
                  </div>

                  <div class="border border-gray-300 rounded p-0.5 mb-0.8">
                    <div class="font-semibold mb-1 text-[9px]">จุดประสงค์การเบิก</div>
                    <div class="grid grid-cols-5 gap-x-4 gap-y-1 text-[9px]">
                      <div v-for="col in 5" :key="col" class="space-y-1">
                        <div v-for="opt in purposeOptions.slice((col - 1) * 3, col * 3)" :key="opt.key" class="flex items-end gap-1.5 min-h-[18px]">
                          <input type="checkbox" disabled :checked="isPurposeChecked(historyBillPreview.withdrawPurpose, opt.label)" class="w-3 h-3 accent-gray-700 shrink-0" />
                          <span class="whitespace-nowrap pb-0.5">{{ opt.label }}</span>
                          <div v-if="opt.key === 'pm' || opt.key.startsWith('other')" class="border-b border-gray-300 flex-1 min-w-[20px] px-1 pb-0.5 h-[16px]">
                            {{ getPurposeDetail(historyBillPreview.withdrawPurpose, opt.label) }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <table class="w-full border-collapse text-[9px] mb-0.5">
                    <thead>
                      <tr>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-5 bg-gray-300">ลำดับ</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-21 bg-gray-300">รหัสสินค้า</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-29 bg-gray-300">รายการ</th>
                        <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-26 bg-gray-300">จำนวน (เบิก)</th>
                        <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-28 bg-gray-300">จำนวนเงิน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">คืน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">ไม่คืน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-20 bg-gray-300">หมายเหตุ</th>
                      </tr>
                      <tr>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">จำนวน</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">หน่วย</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">ราคา / หน่วย</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, idx) in historyBillPreview.items" :key="item.id" class="bg-blue-50/40">
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ idx + 1 }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center font-mono text-[9px]">{{ item.itemCode }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.itemName }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center font-bold text-blue-700 text-[9px]">{{ item.amount }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.unit }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]"><input type="checkbox" disabled :checked="item.isReturn === true" class="w-3 h-3 accent-blue-600" /></td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]"><input type="checkbox" disabled :checked="item.isReturn === false" class="w-3 h-3 accent-blue-600" /></td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.remark || '-' }}</td>
                      </tr>
                      <tr v-for="n in Math.max(0, 4 - historyBillPreview.items.length)" :key="'preview-empty-' + n">
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400">{{ historyBillPreview.items.length + n }}</td>
                        <td v-for="i in 9" :key="i" class="border border-gray-400 px-1 py-1"></td>
                      </tr>
                      <tr class="bg-gray-50 font-semibold">
                        <td colspan="3" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-200">รวม</td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center text-blue-700">{{ historyBillPreview.totalAmount }}</td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                      </tr>
                    </tbody>
                  </table>

                  <table class="w-full border-collapse text-[9px] mb-1">
                    <thead>
                      <tr>
                        <th v-for="h in ['ผู้เบิก', 'ผู้อนุมัต', 'ผู้จ่าย', 'ผู้รับ', 'ผู้ตรวจสอบ/หน.พัสดุ']" :key="h" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">{{ h }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ historyBillPreview.requester?.fullname || '' }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ historyBillPreview.approver?.fullname || '' }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ historyBillPreview.approver?.fullname || '' }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ historyBillPreview.receiveBy || '' }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ historyBillPreview.inspectorBy || '' }}</td>
                      </tr>
                      <tr>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ historyBillPreview.requester?.fullname || '' }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ historyBillPreview.approver?.fullname || '' }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ historyBillPreview.approver?.fullname || '' }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ historyBillPreview.receiveBy || '' }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ historyBillPreview.inspectorBy || '' }}</div>
                        </td>
                      </tr>
                      <tr>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(historyBillPreview.createdAt) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(historyBillPreview.updatedAt) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(historyBillPreview.updatedAt) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(historyBillPreview.updatedAt) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(historyBillPreview.updatedAt) }}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div class="flex items-end justify-between mt-2">
                    <div class="text-[10px]">
                      <span class="font-bold underline whitespace-nowrap leading-none">หมายเหตุ : กรณีเบิกใช้งานช่อมต้องแนบใบแจ้งช่อมทุกครั้ง</span>
                    </div>
                    <div class="flex flex-col items-center">
                      <svg id="history-bill-barcode" class="w-[180px] h-[55px]"></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="p-6 border-t flex justify-end gap-3" style="border-color: var(--color-border)">
            <button @click="closeHistoryBillPreview" class="px-5 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
              ปิด
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          type="text"
          placeholder="ค้นหาเลขที่ใบบิน, MR, ชื่อสินค้า, ผู้เบิก..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">วันที่เบิก</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">เลขที่ใบบิน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รายการสินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวนรวม</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้เบิก / ผู้จ่าย</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">สถานะ</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">PDF</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in filteredHistoryGroups"
              :key="group.key"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                {{ formatDateTime(group.updatedAt) }}
              </td>
              <td class="px-4 py-3">
                <p class="font-medium" style="color: var(--color-text-primary)">#{{ group.requestId }}</p>
                <p class="text-[11px]" style="color: var(--color-text-muted)">MR: {{ group.mrNumber || '-' }}</p>
              </td>
              <td class="px-4 py-3">
                <p class="font-medium" style="color: var(--color-text-primary)">{{ group.items.length }} รายการ</p>
                <p class="text-[11px]" style="color: var(--color-text-muted)">
                  {{ getGroupSubtitle(group) || '-' }}<span v-if="group.items.length > 3">...</span>
                </p>
              </td>
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">
                {{ group.totalAmount }}
              </td>
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                <p>{{ getDisplayName(group.requester) }}</p>
                <p class="mt-0.5">{{ getDisplayName(group.approver) }}</p>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                  เบิกแล้ว
                </span>
              </td>
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                <button
                  @click="downloadPdf(group)"
                  :disabled="exportingGroupKey === group.key"
                  class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <i class="fa-solid fa-file-pdf"></i>
                  {{ exportingGroupKey === group.key ? 'กำลังสร้าง...' : 'ดาวน์โหลด PDF' }}
                </button>
              </td>
            </tr>

            <tr v-if="loading">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="filteredHistoryGroups.length === 0">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบประวัติการเบิก</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="exportBill" class="pdf-export-stage" aria-hidden="true">
      <div class="paper-sheet bg-white text-gray-900 shadow-xl rounded-lg overflow-hidden font-['Niramit',sans-serif] text-[9px]" style="color: #111; font-family: 'Niramit', sans-serif;">
        <div id="pdf-bill-area" class="p-6 pb-4 pt-4" style="font-family: 'Niramit', sans-serif;">
          <div class="relative flex items-stretch gap-3 mb-0">
            <div class="flex-1 min-w-0 flex flex-col z-10">
              <div class="flex items-center gap-3">
                <div class="w-[55px] h-[36px] overflow-hidden flex items-center justify-center bg-white">
                  <img :src="logoThaiDrill" alt="ThaiDrill" class="max-w-full max-h-full object-contain" />
                </div>
                <div class="w-[69px] h-[59px] overflow-hidden flex items-center justify-center bg-white">
                  <img :src="logoThaiDrillLao" alt="ThaiDrill Lao" class="max-w-full max-h-full object-contain" />
                </div>
                <div class="w-[60px] h-[32px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                  <img :src="logoTDL_MVDC" alt="TDLAO & MVDC" class="max-w-full max-h-full object-contain" />
                </div>
                <div class="w-[45px] h-[45px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                  <img :src="logoSunny" alt="SUNNY" class="max-w-full max-h-full object-contain" />
                </div>
              </div>

              <div class="mt-0.3 space-y-1">
                <div class="flex items-center gap-2">
                  <span class="font-semibold whitespace-nowrap text-[9px]">เลขที่ MR</span>
                  <input :value="exportBill.mrNumber || '-'" readonly class="flex-1 max-w-[189px] border-b border-gray-400 outline-none text-[9px] px-1 bg-transparent" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-semibold whitespace-nowrap text-[9px]">วันที่</span>
                  <input :value="formatDateOnly(exportBill.createdAt)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 w-52 bg-transparent" />
                </div>
              </div>

              <div class="flex items-center gap-5 mt-auto pt-0.3 text-[9px]">
                <label class="flex items-center gap-1.5">
                  <input type="checkbox" disabled :checked="exportBill.withdrawTypeForSale" class="w-3 h-3 accent-gray-700" />
                  เบิกเพื่อขาย
                </label>
                <label class="flex items-center gap-1.5">
                  <input type="checkbox" disabled :checked="exportBill.withdrawTypeNew" class="w-3 h-3 accent-gray-700" />
                  เบิกใหม่
                </label>
                <div class="flex items-center gap-1.5">
                  <span class="whitespace-nowrap">ทดแทนของเก่า : สาเหตุ</span>
                  <input :value="getReplaceReason(exportBill.machineNote)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 flex-1 min-w-[276px] bg-transparent" />
                </div>
              </div>
            </div>

            <div class="absolute left-1/2 top-[18px] -translate-x-1/2 pointer-events-none z-0 w-[220px] text-center">
              <h1 class="text-[18px] font-bold leading-none whitespace-nowrap" style="color: #111;">ใบเบิกพัสดุ</h1>
            </div>

            <div class="shrink-0 z-10">
              <div class="text-[9px] text-gray-500 mb-0.2 text-right">FM-MT-ST01-02 REV 03 - 09/04/2669</div>
              <div class="border border-gray-400 p-0.5 text-[9px] min-w-[150px]">
                <div v-for="(label, idx) in companyOptions" :key="idx" class="flex items-center gap-1.5 leading-[1.2]">
                  <input type="radio" disabled :checked="exportBill.company === label" class="w-2 h-2 accent-gray-700" />
                  <span>{{ label }}</span>
                </div>
                <div class="flex items-center gap-1 mt-0.2 pt-0.3 border-t border-gray-300">
                  <span class="text-[10px]">CONST CENTER</span>
                  <div class="flex gap-1 ml-1">
                    <div v-for="i in 5" :key="i" class="w-3 h-3 border border-gray-400 text-center text-[9px]">-</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 mt-2 text-[9px]">
            <div class="flex items-center gap-1">
              <span class="font-semibold">รหัสใบสั่งช่อม</span>
              <input :value="exportBill.fixedBillNumber || '-'" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
            </div>
            <div class="flex items-center gap-1">
              <span>หมายเลขเครื่องจักร</span>
              <input :value="getMachineNumber(exportBill.machineNote)" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
            </div>
            <div class="flex items-center gap-1">
              <span>มิเตอร์ (ชม.)</span>
              <input :value="exportBill.metterHour || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
            </div>
            <div class="flex items-center gap-1">
              <span>มิเตอร์ (กม.)</span>
              <input :value="exportBill.metterKilometter || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
            </div>
          </div>

          <div class="border border-gray-300 rounded p-0.5 mb-0.8">
            <div class="font-semibold mb-1 text-[9px]">จุดประสงค์การเบิก</div>
            <div class="grid grid-cols-5 gap-x-4 gap-y-1 text-[9px]">
              <div v-for="col in 5" :key="col" class="space-y-1">
                <div v-for="opt in purposeOptions.slice((col - 1) * 3, col * 3)" :key="opt.key" class="flex items-end gap-1.5 min-h-[18px]">
                  <input type="checkbox" disabled :checked="isPurposeChecked(exportBill.withdrawPurpose, opt.label)" class="w-3 h-3 accent-gray-700 shrink-0" />
                  <span class="whitespace-nowrap pb-0.5">{{ opt.label }}</span>
                  <div v-if="opt.key === 'pm' || opt.key.startsWith('other')" class="border-b border-gray-300 flex-1 min-w-[20px] px-1 pb-0.5 h-[16px]">
                    {{ getPurposeDetail(exportBill.withdrawPurpose, opt.label) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <table class="w-full border-collapse text-[9px] mb-0.5">
            <thead>
              <tr>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-5 bg-gray-300">ลำดับ</th>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-21 bg-gray-300">รหัสสินค้า</th>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-29 bg-gray-300">รายการ</th>
                <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-26 bg-gray-300">จำนวน (เบิก)</th>
                <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-28 bg-gray-300">จำนวนเงิน</th>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">คืน</th>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">ไม่คืน</th>
                <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-20 bg-gray-300">หมายเหตุ</th>
              </tr>
              <tr>
                <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">จำนวน</th>
                <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">หน่วย</th>
                <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">ราคา / หน่วย</th>
                <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">รวม</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in exportBill.items" :key="item.id" class="bg-blue-50/40">
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ idx + 1 }}</td>
                <td class="border border-gray-400 px-1 py-1 text-center font-mono text-[9px]">{{ item.itemCode }}</td>
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.itemName }}</td>
                <td class="border border-gray-400 px-1 py-1 text-center font-bold text-blue-700 text-[9px]">{{ item.amount }}</td>
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.unit }}</td>
                <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]"><input type="checkbox" disabled :checked="item.isReturn === true" class="w-3 h-3 accent-blue-600" /></td>
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]"><input type="checkbox" disabled :checked="item.isReturn === false" class="w-3 h-3 accent-blue-600" /></td>
                <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.remark || '-' }}</td>
              </tr>
              <tr v-for="n in Math.max(0, 4 - exportBill.items.length)" :key="'empty-' + n">
                <td class="border border-gray-400 px-1 py-1 text-center text-gray-400">{{ exportBill.items.length + n }}</td>
                <td v-for="i in 9" :key="i" class="border border-gray-400 px-1 py-1"></td>
              </tr>
              <tr class="bg-gray-50 font-semibold">
                <td colspan="3" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-200">รวม</td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center text-blue-700">{{ exportBill.totalAmount }}</td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                <td class="border border-gray-400 px-0.5 py-0.5"></td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
              </tr>
            </tbody>
          </table>

          <table class="w-full border-collapse text-[9px] mb-1">
            <thead>
              <tr>
                <th v-for="h in ['ผู้เบิก', 'ผู้อนุมัต', 'ผู้จ่าย', 'ผู้รับ', 'ผู้ตรวจสอบ/หน.พัสดุ']" :key="h" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ exportBill.requester?.fullname || '' }}</td>
                <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ exportBill.approver?.fullname || '' }}</td>
                <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ exportBill.approver?.fullname || '' }}</td>
                <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ exportBill.receiveBy || '' }}</td>
                <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ exportBill.inspectorBy || '' }}</td>
              </tr>
              <tr>
                <td class="border border-gray-400 px-0.5 py-0.2">
                  <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                  <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ exportBill.requester?.fullname || '' }}</div>
                </td>
                <td class="border border-gray-400 px-0.5 py-0.2">
                  <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                  <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ exportBill.approver?.fullname || '' }}</div>
                </td>
                <td class="border border-gray-400 px-0.5 py-0.2">
                  <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                  <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ exportBill.approver?.fullname || '' }}</div>
                </td>
                <td class="border border-gray-400 px-0.5 py-0.2">
                  <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                  <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ exportBill.receiveBy || '' }}</div>
                </td>
                <td class="border border-gray-400 px-0.5 py-0.2">
                  <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                  <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ exportBill.inspectorBy || '' }}</div>
                </td>
              </tr>
              <tr>
                <td class="border border-gray-400 px-0.2 py-0.1">
                  <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                  <div class="text-[9px]">{{ formatDateOnly(exportBill.createdAt) }}</div>
                </td>
                <td class="border border-gray-400 px-0.2 py-0.1">
                  <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                  <div class="text-[9px]">{{ formatDateOnly(exportBill.updatedAt) }}</div>
                </td>
                <td class="border border-gray-400 px-0.2 py-0.1">
                  <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                  <div class="text-[9px]">{{ formatDateOnly(exportBill.updatedAt) }}</div>
                </td>
                <td class="border border-gray-400 px-0.2 py-0.1">
                  <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                  <div class="text-[9px]">{{ formatDateOnly(exportBill.updatedAt) }}</div>
                </td>
                <td class="border border-gray-400 px-0.2 py-0.1">
                  <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                  <div class="text-[9px]">{{ formatDateOnly(exportBill.updatedAt) }}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="flex items-end justify-between mt-2">
            <div class="text-[10px]">
              <span class="font-bold underline">หมายเหตุ : กรณีเบิกใช้งานช่อมต้องแนบใบแจ้งช่อมทุกครั้ง</span>
            </div>
            <div class="flex flex-col items-center">
              <svg id="pdf-bill-barcode"></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.paper-scroll-wrap {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  overflow-x: auto;
  overflow-y: visible;
  padding-bottom: 0;
  -webkit-overflow-scrolling: touch;
}

.paper-sheet {
  width: 960px;
  min-width: 960px;
}

.pdf-export-stage {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 960px;
  background: white;
  z-index: -1;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.bg-gray-300 {
  background-color: #d1d5db !important;
}

.bg-gray-200 {
  background-color: #e5e7eb !important;
}
</style>
