<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import logoThaiDrill from '@/assets/thaidrill_company.png'
import logoSunnyFertilizer from '@/assets/sunny_fertilizer.png'
import logoPuiRakYa from '@/assets/puirakyar.png'
import logoTdFix from '@/assets/tdfix.png'
import logoTdContractor from '@/assets/tdcontractor.png'
import logoSunnyGreenFarm from '@/assets/sunny_green_farm.png'
import logoThaiDrillLao from '@/assets/thaidrillLao_company.png'
import logoSunny from '@/assets/sunnycompany.png'
import logoTDL_MVDC from '@/assets/tdl&mvdc_company.jpg'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

const ui = useUiStore()
const auth = useAuthStore()
const todayISO = new Date().toISOString().slice(0, 10)

const loading = ref(true)
const orders = ref([])
const transactions = ref([])
const searchText = ref('')
const barcodeInput = ref('')
const barcodeField = ref(null)
const currentRequestId = ref(null)
const previewPaperRef = ref(null)
const isGeneratingPDF = ref(false)

// --- Barcode scanner global state ---
let barcodeBuffer = ''
let barcodeTimer = null
const BARCODE_TIMEOUT_MS = 80

function handleKeyDown(e) {
  const tag = document.activeElement?.tagName?.toLowerCase()
  if ((tag === 'input' || tag === 'textarea' || tag === 'select') && document.activeElement !== barcodeField.value) return

  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 2) {
      processBarcodeInput(barcodeBuffer.trim())
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

async function processBarcodeInput(code) {
  const cleanCode = code.replace(/^#/, '').trim()
  if (!cleanCode) return

  if (currentRequestId.value && String(currentRequestId.value) !== cleanCode) {
    ui.showToast(`มีข้อมูลใบเบิก #${currentRequestId.value} อยู่แล้ว กรุณาล้างข้อมูลก่อนสแกนใบใหม่`, 'warning')
    barcodeInput.value = ''
    return
  }

  const group = historyGroups.value.find(g => String(g.requestId) === cleanCode)
  if (group) {
    addToInspection(group)
    barcodeInput.value = ''
    return
  }

  try {
    const isNumeric = /^\d+$/.test(cleanCode)
    let query = supabase
      .from('order_req')
      .select(`
        id, request_id, created_at, created_by, amount, unit, note, remark, status, updated_at, updated_by, mr_number, company, fixed_bill_number,
        items(item_code,item_name,unit),
        requester:system_users!created_by(fullname, position, department, emp_code)
      `)
      .eq('status', 'completed')

    if (isNumeric) {
      query = query.or(`request_id.eq.${cleanCode},id.eq.${cleanCode}`)
    } else {
      ui.showToast('รหัสบาร์โค้ดไม่ถูกต้อง (ต้องเป็นตัวเลขรหัสใบเบิก)', 'warning')
      return
    }

    const { data, error } = await query

    if (error) throw error
    if (data && data.length > 0) {
      const tempGroups = buildHistoryGroups(data)
      if (tempGroups.length > 0) {
        addToInspection(tempGroups[0])
        barcodeInput.value = ''
      }
    } else {
      ui.showToast(`ไม่พบข้อมูลใบเบิก #${cleanCode} หรือใบเบิกยังไม่เสร็จสมบูรณ์`, 'error')
    }
  } catch (err) {
    console.error('Barcode Search Error:', err)
    ui.showToast('เกิดข้อผิดพลาดในการค้นหาข้อมูล', 'error')
  }
}

const companyTypeOptions = [
  'รถเจาะไทย',
  'ซันนี่ เฟอติไลเซอร์',
  'ปุ๋ยรากหญ้า',
  'ทีดี ฟิกซ์',
  'ทีดี คอนแทรคเตอร์',
  'ซันนี่ กรีน ฟาร์ม',
  'ไทยดิว ลาว',
  'ซันนี่ แมชีนเนอรี่'
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
          items(item_code,item_name,unit),
          requester:system_users!created_by(fullname, position, department, emp_code)
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

onMounted(() => {
  fetchData()
  if (barcodeField.value) {
    barcodeField.value.focus()
  }
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keydown', handleEscKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keydown', handleEscKey)
  document.body.style.overflow = ''
})

function handleEscKey(e) {
  if (e.key === 'Escape' && showPrintPreview.value) {
    handleClosePreview()
  }
}

function txByOrderId(orderId) {
  return transactions.value.find((row) => row.order_id === orderId) || null
}

async function handleBarcodeScan() {
  const code = barcodeInput.value.trim()
  if (!code) return
  await processBarcodeInput(code)
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
        updatedAt: row.updated_at,
        requester: row.requester || null,
        mrNumber: row.mr_number || '',
        company: row.company || '',
        items: []
      }
    }
    groups[key].items.push({
      id: row.id,
      itemCode: row.items?.item_code || '-',
      itemName: row.items?.item_name || '-',
      amount: actualAmount,
      unit: actualUnit
    })
  })
  return Object.values(groups).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

const historyGroups = computed(() => buildHistoryGroups(orders.value))
const filteredHistoryGroups = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return historyGroups.value
  return historyGroups.value.filter((group) => {
    const requestId = String(group.requestId || '').toLowerCase()
    const itemText = group.items.map((item) => `${item.itemCode} ${item.itemName}`).join(' ').toLowerCase()
    return requestId.includes(key) || itemText.includes(key)
  })
})

const qualityOptions = [
  { key: 'good', label: 'ดี' },
  { key: 'fair', label: 'พอใช้' },
  { key: 'improve', label: 'ควรปรับปรุง' }
]

const docType = reactive({
  goods: false,
  hire: false,
  rent: false,
  service: false
})

const companyTopOptions = companyTypeOptions

const companyTop = reactive(Object.fromEntries(companyTopOptions.map((t) => [t, false])))

const imageFiles = ref([])

function handleImageChange(event) {
  const files = Array.from(event.target.files || [])
  const newImages = files.map((file) => ({
    file,
    url: URL.createObjectURL(file)
  }))
  imageFiles.value = [...imageFiles.value, ...newImages]
}

const form = reactive({
  inspectionDate: todayISO,
  repairBillNo: '',
  vendorSource: '',
  poNumber: '',
  vendorInvoiceNo: '',
  goodsReceiptNo: '',
  deliveryPlace: '',
  receivingDept: '',

  items: Array.from({ length: 10 }, () => ({
    itemCode: '',
    itemName: '',
    unit: '',
    receivedQty: '',
    unitPrice: '',
    orderedQty: '',
    remainingQty: '',
    totalPrice: '',
    note: ''
  })),

  valuation: {
    beforeVat: '0.00',
    vat: '0.00',
    total: '0.00'
  },

  evaluationRows: [
    { text: 'คุณภาพของสินค้า หรือ คุณภาพของงาน', good: false, fair: false, improve: false, note: '' },
    { text: 'การส่งมอบตรงตามเวลาที่กำหนด ได้ของครบตามใบสั่งซื้อ', good: false, fair: false, improve: false, note: '' },
    { text: 'การให้บริการ', good: false, fair: false, improve: false, note: '' }
  ],

  sign: {
    receiver: { name: '', printedName: auth.user?.fullname || '', date: todayISO },
    inspector: { name: '', printedName: '', date: todayISO },
    documentReceiver: { name: '', printedName: '', date: todayISO }
  }
})

const receiverRoleLabel = computed(() => {
  const dept = auth.user?.department || 'แผนกคลังสินค้า/พัสดุ'
  return `ผู้ตรวจรับของ (แผนก${dept})`
})

function addToInspection(group) {
  if (currentRequestId.value && currentRequestId.value !== group.requestId) {
    ui.showToast(`มีข้อมูลใบเบิก #${currentRequestId.value} อยู่แล้ว กรุณาล้างข้อมูลก่อนเพิ่มใบใหม่`, 'warning')
    return
  }

  group.items.forEach(item => {
    const emptyIndex = form.items.findIndex(it => !it.itemName && !it.itemCode)
    const newItem = {
      itemCode: item.itemCode || '',
      itemName: item.itemName || '',
      unit: item.unit || '',
      receivedQty: item.amount || '',
      unitPrice: '',
      orderedQty: item.amount || '',
      remainingQty: '0',
      totalPrice: '',
      note: `จากใบเบิก #${group.requestId}`
    }

    if (emptyIndex !== -1) {
      form.items[emptyIndex] = newItem
    } else {
      form.items.push(newItem)
    }
  })

  currentRequestId.value = group.requestId
  ui.showToast(`เพิ่มรายการจากใบเบิก #${group.requestId} เรียบร้อยแล้ว`, 'success')
}

function clearForm() {
  if (confirm('ล้างข้อมูลใบตรวจรับใช่หรือไม่?')) {
    Object.assign(form, {
      inspectionDate: todayISO,
      repairBillNo: '', vendorSource: '', poNumber: '', vendorInvoiceNo: '', goodsReceiptNo: '', deliveryPlace: '', receivingDept: '',
      items: Array.from({ length: 10 }, () => ({ itemCode: '', itemName: '', unit: '', receivedQty: '', unitPrice: '', orderedQty: '', remainingQty: '', totalPrice: '', note: '' })),
      valuation: { beforeVat: '0.00', vat: '0.00', total: '0.00', vatPercent: 0, currency: 'บาท' },
      sign: {
        receiver: { name: '', printedName: auth.user?.fullname || '', date: todayISO },
        inspector: { name: '', printedName: '', date: todayISO },
        documentReceiver: { name: '', printedName: '', date: todayISO }
      }
    })
    Object.keys(docType).forEach(k => docType[k] = false)
    Object.keys(companyTop).forEach(k => companyTop[k] = false)
    currentRequestId.value = null
    imageFiles.value = []
  }
}

function formatInputNumber(obj, key) {
  let val = String(obj[key]).replace(/,/g, '')
  const n = parseFloat(val)
  if (!isNaN(n)) {
    obj[key] = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

watch(() => [form.items, form.valuation.vatPercent, form.valuation.vat], ([newItems, newVatPercent, newVatAmount], [oldItems, oldVatPercent, oldVatAmount]) => {
  let subtotal = 0
  form.items.forEach(it => {
    const q = parseFloat(String(it.receivedQty).replace(/,/g, ''))
    const p = parseFloat(String(it.unitPrice).replace(/,/g, ''))

    if (!isNaN(q) && !isNaN(p)) {
      const line = q * p
      it.totalPrice = line.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    const lineTotal = parseFloat(String(it.totalPrice).replace(/,/g, ''))
    if (!isNaN(lineTotal)) {
      subtotal += lineTotal
    }
  })

  form.valuation.beforeVat = subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  let vatValue = 0
  if (newVatPercent !== oldVatPercent) {
    const vPercent = parseFloat(newVatPercent) || 0
    vatValue = subtotal * (vPercent / 100)
    form.valuation.vat = vatValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } else {
    vatValue = parseFloat(String(form.valuation.vat).replace(/,/g, '')) || 0
  }

  const total = subtotal + vatValue
  form.valuation.total = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}, { deep: true })

function formatDateOnly(v) {
  if (!v) return '-'
  return new Date(v).toLocaleDateString('th-TH')
}

// --- Print Preview Modal ---
const showPrintPreview = ref(false)

function handleOpenPreview() {
  showPrintPreview.value = true
  document.body.style.overflow = 'hidden'
}

function handleClosePreview() {
  showPrintPreview.value = false
  document.body.style.overflow = ''
}

function handlePrint() {
  handleClosePreview()
  nextTick(() => { window.print() })
}

// ============================================================
// ฟังก์ชันดาวน์โหลด PDF จริงๆ โดยใช้ html2canvas + jsPDF
// แปลง preview paper ที่แสดงอยู่ใน modal เป็นรูปแล้วบันทึกเป็น PDF
// ============================================================
async function handleDownloadPDF() {
  if (!previewPaperRef.value) {
    ui.showToast('ไม่พบข้อมูลสำหรับสร้าง PDF', 'error')
    return
  }

  isGeneratingPDF.value = true

  try {
    // รอให้ DOM render เสร็จก่อน
    await nextTick()

    const element = previewPaperRef.value

    // ใช้ html2canvas แปลง element เป็น canvas
    const canvas = await html2canvas(element, {
      scale: 2,                    // ความละเอียดสูง (2x) เพื่อให้ PDF คมชัด
      useCORS: true,               // รองรับรูปภาพจาก domain อื่น
      allowTaint: true,
      backgroundColor: '#ffffff',  // พื้นหลังขาว
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight,
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
    })

    // แปลง canvas เป็น base64 image
    const imgData = canvas.toDataURL('image/jpeg', 0.95)

    // สร้าง PDF ขนาด A4
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    })

    const pageWidth = 210   // A4 กว้าง 210mm
    const pageHeight = 297  // A4 สูง 297mm

    // คำนวณสัดส่วนความสูงของรูป
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * pageWidth) / canvas.width

    if (imgHeight <= pageHeight) {
      // เนื้อหาพอดีหน้าเดียว
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight)
    } else {
      // เนื้อหายาวเกิน 1 หน้า — แบ่งหน้าอัตโนมัติ
      let yOffset = 0
      let pageNum = 0
      while (yOffset < imgHeight) {
        if (pageNum > 0) pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, imgWidth, imgHeight)
        yOffset += pageHeight
        pageNum++
      }
    }

    // ตั้งชื่อไฟล์ตาม OR number หรือวันที่
    const fileName = currentRequestId.value
      ? `inspection-memo-OR${currentRequestId.value}.pdf`
      : `inspection-memo-${form.inspectionDate}.pdf`

    pdf.save(fileName)
    ui.showToast('ดาวน์โหลด PDF สำเร็จ', 'success')

  } catch (err) {
    console.error('PDF Generation Error:', err)
    ui.showToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + err.message, 'error')
  } finally {
    isGeneratingPDF.value = false
  }
}
</script>

<template>
  <AppLayout title="แบบฟอร์มใบตรวจรับพัสดุ">
    <div class="flex flex-col xl:flex-row gap-6 h-[calc(100vh-120px)] overflow-hidden p-4">

      <!-- 1. Left Side: Inspection Form (A4 Style) - Width 9/12 (75%) -->
      <div class="xl:w-[75%] h-full overflow-y-auto bg-gray-100 p-4 rounded-xl border border-gray-200">
        <div class="flex justify-between items-center mb-4 px-2 print:hidden">
          <h2 class="text-lg font-bold text-gray-800">แบบฟอร์มใบตรวจรับพัสดุ</h2>
          <div class="flex gap-2">
            <button
              @click="clearForm"
              class="px-4 py-1.5 bg-white border border-red-300 rounded-lg shadow-sm hover:bg-red-50 text-sm font-bold text-red-600 flex items-center gap-2"
            >
              <i class="fa-solid fa-trash-can"></i> ล้างข้อมูล
            </button>
            <button
              @click="handleOpenPreview"
              class="px-4 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-bold flex items-center gap-2"
            >
              <i class="fa-solid fa-print"></i> พิมพ์ / PDF
            </button>
          </div>
        </div>

        <div class="paper mx-auto">
          <div class="sheet">
            <div class="border border-gray-300 overflow-hidden bg-white">
              <!-- Header Section -->
              <div class="pb-1 bg-white">
                <div class="flex items-start justify-between px-2 py-1">
                  <div class="flex items-center gap-2 flex-nowrap overflow-hidden">
                    <img :src="logoThaiDrill" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoSunnyFertilizer" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoPuiRakYa" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoTdFix" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoTdContractor" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoSunnyGreenFarm" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoThaiDrillLao" alt="" class="h-8 w-auto object-contain" />
                    <img :src="logoSunny" alt="" class="h-8 w-auto object-contain" />
                  </div>
                  <div class="text-[7px] font-medium text-gray-500 text-right pt-0.5 leading-tight">
                    FM-HO-PC01-07<br/>
                    REV.01 - 17/10/2567
                  </div>
                </div>

                <div class="text-center mt-1">
                  <div class="text-[13px] font-bold text-gray-800 tracking-wide uppercase leading-none">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
                  <div class="text-[10px] font-bold text-gray-800 leading-tight">(Inspection Memo)</div>
                </div>

                <div class="flex items-center justify-between mt-2 px-2 text-[8px] text-gray-600 border-t border-gray-300 pt-1">
                  <label v-for="t in companyTopOptions" :key="t" class="flex items-center gap-1">
                    <div class="w-2.5 h-2.5 border border-gray-300 flex items-center justify-center bg-white">
                      <input type="checkbox" v-model="companyTop[t]" class="opacity-0 absolute w-2.5 h-2.5 cursor-pointer" />
                      <i v-if="companyTop[t]" class="fa-solid fa-check text-[7px] text-blue-600"></i>
                    </div>
                    <span class="whitespace-nowrap">{{ t }}</span>
                  </label>
                </div>
              </div>

              <!-- Doc Type & Dates -->
              <div class="flex p-2 border-t border-gray-300">
                <div class="w-[55%]">
                  <div class="grid grid-cols-2 gap-y-1">
                    <label v-for="(val, key) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="key" class="flex items-center text-[10px] text-black">
                      <div class="w-3 h-3 border border-gray-300 flex items-center justify-center mr-2 bg-white">
                        <input type="checkbox" v-model="docType[key]" class="opacity-0 absolute w-3 h-3 cursor-pointer" />
                        <i v-if="docType[key]" class="fa-solid fa-check text-[10px]"></i>
                      </div>
                      <span>{{ val }}</span>
                    </label>
                  </div>
                </div>
                <div class="w-[45%] text-[10px] text-black pl-4">
                  <div class="flex items-end justify-between mb-1">
                    <span class="whitespace-nowrap">วันที่ตรวจรับ</span>
                    <input v-model="form.inspectionDate" type="text" class="border-b border-gray-300 flex-1 mx-2 text-center outline-none bg-transparent h-4" />
                  </div>
                  <div class="flex items-end justify-between">
                    <span class="whitespace-nowrap">เลขที่ใบแจ้งซ่อม</span>
                    <input v-model="form.repairBillNo" type="text" class="border-b border-gray-300 flex-1 mx-2 text-center outline-none bg-transparent h-4" />
                  </div>
                </div>
              </div>

              <!-- Seller & Order Info -->
              <div class="text-[10px] text-black pb-1">
                <div class="flex p-1">
                  <div class="w-1/2 flex items-end pr-4">
                    <span class="mr-2 whitespace-nowrap">สินค้ามาจากผู้ขาย</span>
                    <input v-model="form.vendorSource" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                  <div class="w-1/2 flex items-end pl-4">
                    <span class="mr-2 whitespace-nowrap">หมายเลขใบสั่งซื้อ</span>
                    <input v-model="form.poNumber" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                </div>
                <div class="flex p-1">
                  <div class="w-1/2 flex items-end pr-4">
                    <span class="mr-2 whitespace-nowrap">ใบแจ้งหนี้ผู้ขาย</span>
                    <input v-model="form.vendorInvoiceNo" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                  <div class="w-1/2 flex items-end pl-4">
                    <span class="mr-2 whitespace-nowrap">หมายเลขใบรับสินค้า</span>
                    <input v-model="form.goodsReceiptNo" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                </div>
                <div class="flex p-1">
                  <div class="w-1/2 flex items-end pr-4">
                    <span class="mr-2 whitespace-nowrap">สถานที่จัดส่ง/ให้บริการ</span>
                    <input v-model="form.deliveryPlace" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                  <div class="w-1/2 flex items-end pl-4">
                    <span class="mr-2 whitespace-nowrap">แผนกที่ตรวจรับ</span>
                    <input v-model="form.receivingDept" type="text" class="border-b border-gray-300 flex-1 outline-none bg-transparent px-1 h-4" />
                  </div>
                </div>
              </div>

              <!-- Table Section -->
              <div class="overflow-x-auto">
                <table class="w-full text-[9px] border-collapse border border-gray-300">
                  <thead>
                    <tr class="text-center font-bold bg-gray-50 text-black">
                      <th class="border border-gray-300 p-0.5" style="width: 25px">ลาดับ</th>
                      <th class="border border-gray-300 p-0.5" style="width: 100px">รหัสสินค้า</th>
                      <th class="border border-gray-300 p-0.5">รายการ</th>
                      <th class="border border-gray-300 p-0.5" style="width: 40px">รับจริง</th>
                      <th class="border border-gray-300 p-0.5" style="width: 40px">หน่วย</th>
                      <th class="border border-gray-300 p-0.5" style="width: 50px">ราคา/หน่วย</th>
                      <th class="border border-gray-300 p-0.5" style="width: 60px">ราคารวม</th>
                      <th class="border border-gray-300 p-0.5" style="width: 40px">สั่งซื้อ</th>
                      <th class="border border-gray-300 p-0.5" style="width: 40px">คงเหลือ</th>
                      <th class="border border-gray-300 p-0.5" style="width: 80px">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(it, idx) in form.items" :key="idx" class="h-6 text-black">
                      <td class="border border-gray-300 text-center p-0.5">{{ idx + 1 }}</td>
                      <td class="border border-gray-300 p-0.5"><input v-model="it.itemCode" class="w-full border-none outline-none bg-transparent text-center" /></td>
                      <td class="border border-gray-300 p-0.5"><input v-model="it.itemName" class="w-full border-none outline-none bg-transparent px-1" /></td>
                      <td class="border border-gray-300 p-0.5 text-center"><input v-model="it.receivedQty" class="w-full border-none outline-none bg-transparent text-center" /></td>
                      <td class="border border-gray-300 p-0.5 text-center"><input v-model="it.unit" class="w-full border-none outline-none bg-transparent text-center" /></td>
                      <td class="border border-gray-300 p-0.5 text-right"><input v-model="it.unitPrice" class="w-full border-none outline-none bg-transparent text-right px-1" @blur="formatInputNumber(it, 'unitPrice')" /></td>
                      <td class="border border-gray-300 p-0.5 text-right"><input v-model="it.totalPrice" class="w-full border-none outline-none bg-transparent text-right px-1" @blur="formatInputNumber(it, 'totalPrice')" /></td>
                      <td class="border border-gray-300 p-0.5 text-center"><input v-model="it.orderedQty" class="w-full border-none outline-none bg-transparent text-center" /></td>
                      <td class="border border-gray-300 p-0.5 text-center"><input v-model="it.remainingQty" class="w-full border-none outline-none bg-transparent text-center" /></td>
                      <td class="border border-gray-300 p-0.5"><input v-model="it.note" class="w-full border-none outline-none bg-transparent px-1" /></td>
                    </tr>
                    <!-- Valuation -->
                    <tr class="text-black">
                      <td colspan="6" class="text-right p-0.5 font-bold">มูลค่าสินค้าก่อน VAT</td>
                      <td class="border border-gray-300 text-right p-0.5 font-bold">{{ form.valuation.beforeVat }}</td>
                      <td colspan="3" class="border border-gray-300 p-1">
                        <input v-model="form.valuation.currency" class="w-full border-none outline-none bg-transparent" />
                      </td>
                    </tr>
                    <tr class="text-black">
                      <td colspan="6" class="text-right p-0.5 font-bold">ภาษีมูลค่าเพิ่ม <input v-model="form.valuation.vatPercent" class="w-8 border-none outline-none bg-transparent text-center underline" /> %(VAT)</td>
                      <td class="border border-gray-300 text-right p-0.5 font-bold">
                        <input v-model="form.valuation.vat" class="w-full border-none outline-none bg-transparent text-right font-bold" @blur="formatInputNumber(form.valuation, 'vat')" />
                      </td>
                      <td colspan="3" class="border border-gray-300 p-1">
                        <input v-model="form.valuation.currency" class="w-full border-none outline-none bg-transparent" />
                      </td>
                    </tr>
                    <tr class="text-black bg-gray-50">
                      <td colspan="6" class="text-right p-0.5 font-bold">รวมเป็นเงินทั้งสิ้น</td>
                      <td class="border border-gray-300 text-right p-0.5 font-bold">{{ form.valuation.total }}</td>
                      <td colspan="3" class="border border-gray-300 p-1 font-bold">
                        <input v-model="form.valuation.currency" class="w-full border-none outline-none bg-transparent" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Evaluation -->
              <div class="border-b border-gray-300 overflow-hidden">
                <div class="bg-gray-100 text-center py-1 border-b border-gray-300 font-bold text-[10px] uppercase text-black">แบบประเมินผู้ขาย / ผู้ให้บริการ</div>
                <table class="w-full text-[9px] border-collapse text-black border-t border-gray-300">
                  <thead>
                    <tr class="text-center font-bold bg-gray-50">
                      <th rowspan="2" class="border-r border-b border-gray-300 p-1" style="width: 40px">ลำดับ</th>
                      <th rowspan="2" class="border-r border-b border-gray-300 p-1 text-left pl-2">รายการ</th>
                      <th colspan="3" class="border-r border-b border-gray-300 p-1">ประเมินผล</th>
                      <th rowspan="2" class="border-b border-gray-300 p-1" style="width: 150px">หมายเหตุ</th>
                    </tr>
                    <tr class="text-center font-bold bg-gray-50">
                      <th class="border-r border-b border-gray-300 p-1" style="width: 50px">ดี</th>
                      <th class="border-r border-b border-gray-300 p-1" style="width: 50px">พอใช้</th>
                      <th class="border-r border-b border-gray-300 p-1" style="width: 80px">ควรปรับปรุง</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, idx) in form.evaluationRows" :key="idx" class="h-8">
                      <td class="border-r border-b border-gray-300 text-center p-0.5">{{ idx + 1 }}</td>
                      <td class="border-r border-b border-gray-300 p-0.5 px-2">{{ r.text }}</td>
                      <td class="border-r border-b border-gray-300 text-center p-0.5">
                        <div class="w-4 h-4 border border-gray-400 mx-auto flex items-center justify-center cursor-pointer bg-white" @click="r.good=!r.good; if(r.good){r.fair=false;r.improve=false}">
                          <i v-if="r.good" class="fa-solid fa-check text-[10px]"></i>
                        </div>
                      </td>
                      <td class="border-r border-b border-gray-300 text-center p-0.5">
                        <div class="w-4 h-4 border border-gray-400 mx-auto flex items-center justify-center cursor-pointer bg-white" @click="r.fair=!r.fair; if(r.fair){r.good=false;r.improve=false}">
                          <i v-if="r.fair" class="fa-solid fa-check text-[10px]"></i>
                        </div>
                      </td>
                      <td class="border-r border-b border-gray-300 text-center p-0.5">
                        <div class="w-4 h-4 border border-gray-400 mx-auto flex items-center justify-center cursor-pointer bg-white" @click="r.improve=!r.improve; if(r.improve){r.good=false;r.fair=false}">
                          <i v-if="r.improve" class="fa-solid fa-check text-[10px]"></i>
                        </div>
                      </td>
                      <td class="border-b border-gray-300 p-0.5"><input v-model="r.note" class="w-full border-none outline-none bg-transparent px-1" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Attach Images Section -->
              <div class="border-b border-gray-300">
                <div class="bg-gray-100 text-center py-1 border-b border-gray-300 font-bold text-[10px] uppercase text-black">แนบรูปภาพการตรวจรับ</div>
                <div class="p-3 min-h-[120px]">
                  <div class="flex flex-wrap gap-3 justify-center items-center">
                    <div v-for="(img, idx) in imageFiles" :key="idx" class="relative group">
                      <img :src="img.url" class="h-36 w-52 object-cover border border-gray-300 rounded shadow-sm" />
                      <button
                        @click="imageFiles.splice(idx, 1)"
                        class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] shadow-md opacity-0 group-hover:opacity-100 transition-opacity print:hidden"
                      >
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </div>

                    <!-- Add More Button -->
                    <label class="h-36 w-52 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 rounded hover:border-blue-400 hover:text-blue-400 transition-all cursor-pointer print:hidden">
                      <i class="fa-solid fa-plus text-2xl mb-2"></i>
                      <span class="text-[10px] font-bold">เพิ่มรูปภาพ</span>
                      <input type="file" multiple accept="image/*" class="hidden" @change="handleImageChange" />
                    </label>
                  </div>
                  <div v-if="imageFiles.length === 0" class="text-center text-gray-400 text-[10px] mt-2 hidden print:block">
                    - ไม่มีรูปภาพแนบ -
                  </div>
                </div>
              </div>

              <!-- Signatures -->
              <div class="p-4 grid grid-cols-3 gap-4 text-[9px] bg-white text-black">
                <div v-for="(role, key) in {
                  receiver: receiverRoleLabel,
                  inspector: 'ผู้ตรวจสอบ (หัวหน้าหน่วย)',
                  documentReceiver: 'ผู้รับเอกสาร (จนท.จัดซื้อ/การเงิน)'
                }" :key="key" class="flex flex-col items-center">
                  <div class="w-full flex items-end gap-1 mb-1">
                    <span class="font-bold">ลงชื่อ</span>
                    <input v-model="form.sign[key].name" class="border-b border-dotted border-gray-300 flex-1 text-center font-handwriting text-blue-800 outline-none bg-transparent h-4" />
                  </div>
                  <div class="text-[8px] text-black mb-1 italic flex items-center gap-1">
                    <span>ชื่อตัวบรรจง</span>
                    <input v-model="form.sign[key].printedName" class="border-b border-dotted border-gray-300 flex-1 text-center outline-none bg-transparent h-4" placeholder="..................................." />
                  </div>
                  <div class="font-bold text-center leading-tight mb-2">{{ role }}</div>
                  <div class="w-full flex items-center justify-center gap-1">
                    <span>วันที่</span>
                    <input v-model="form.sign[key].date" class="border-b border-dotted border-gray-300 w-20 text-center outline-none bg-transparent h-4" />
                  </div>
                </div>
              </div>
            </div>
            <div class="footer text-[8px] text-center py-1 text-black mt-1">FM-HO-PC01-07 REV.01 - 17/10/2567</div>
          </div>
        </div>
      </div>

      <!-- 2. Right Side: Withdrawal History Table - Width 3/12 (25%) -->
      <div class="xl:w-[25%] h-full flex flex-col gap-4 overflow-hidden print:hidden">
        <!-- Barcode Scanner Input -->
        <div class="p-4 rounded-xl border bg-white shadow-sm mb-2" style="border-color: var(--color-border)">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 text-gray-700">
              <i class="fa-solid fa-barcode text-lg"></i>
              <span class="font-bold">สแกนบาร์โค้ดใบเบิก</span>
            </div>
            <div v-if="currentRequestId" class="px-2 py-0.5 bg-green-50 text-green-600 text-[10px] font-bold rounded-full border border-green-200 animate-pulse">
              กำลังกรอก OR #{{ currentRequestId }}
            </div>
          </div>
          <div class="relative">
            <input
              v-model="barcodeInput"
              type="text"
              placeholder="สแกนที่นี่..."
              class="w-full pl-4 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg text-black text-sm focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all outline-none"
              @keyup.enter="handleBarcodeScan"
              ref="barcodeField"
            />
            <button
              @click="handleBarcodeScan"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors"
            >
              <i class="fa-solid fa-arrow-right-to-bracket"></i>
            </button>
          </div>
          <p class="text-[10px] mt-2 text-gray-400">* สแกนเลขที่ใบเบิก (OR) เพื่อดึงข้อมูลอัตโนมัติ</p>
        </div>

        <div class="flex flex-col gap-3 p-4 rounded-xl border bg-white shadow-sm" style="border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-bold text-gray-800">ประวัติการเบิก</h2>
          </div>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            <input
              v-model="searchText"
              type="text"
              placeholder="ค้นหา..."
              class="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        <div class="flex-1 overflow-y-auto rounded-xl border bg-white shadow-sm" style="border-color: var(--color-border)">
          <table class="w-full text-xs text-left border-collapse">
            <thead class="sticky top-0 bg-gray-50 z-10 border-b" style="border-color: var(--color-border)">
              <tr>
                <th class="px-3 py-3 font-semibold text-gray-600">รายการเบิก (OR)</th>
                <th class="px-3 py-3 font-semibold text-gray-600 text-center">เพิ่ม</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in filteredHistoryGroups" :key="group.key">
                <tr class="border-b last:border-b-0 hover:bg-blue-50/30 transition-colors">
                  <td class="px-3 py-3">
                    <div class="text-[10px] text-gray-500">{{ formatDateOnly(group.updatedAt) }}</div>
                    <div class="font-bold text-blue-600">#{{ group.requestId }}</div>
                    <div class="text-[10px] text-gray-400 mt-1">
                      <div v-for="item in group.items" :key="item.id" class="truncate max-w-[150px]">
                        • {{ item.itemName }} ({{ item.amount }} {{ item.unit }})
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-3 text-center">
                    <button
                      @click="addToInspection(group)"
                      :disabled="currentRequestId && currentRequestId !== group.requestId"
                      class="p-2 rounded-lg transition-all shadow-sm"
                      :class="[
                        currentRequestId && currentRequestId !== group.requestId
                          ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'
                      ]"
                      :title="currentRequestId && currentRequestId !== group.requestId ? 'กรุณาล้างข้อมูลเดิมก่อนเพิ่มใบเบิกอื่น' : 'เพิ่มรายการทั้งหมดในใบเบิกนี้'"
                    >
                      <i class="fa-solid fa-plus-circle"></i>
                    </button>
                  </td>
                </tr>
              </template>
              <tr v-if="loading">
                <td colspan="2" class="px-4 py-10 text-center text-gray-400 italic">กำลังโหลด...</td>
              </tr>
              <tr v-else-if="filteredHistoryGroups.length === 0">
                <td colspan="2" class="px-4 py-10 text-center text-gray-400 italic">ไม่พบข้อมูล</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 3. Hidden Printable Bill (Only visible during print) -->
    <div class="printable-bill-container hidden print:block">
      <div class="printable-bill mx-auto bg-white">
        <div class="printable-sheet flex flex-col font-thai text-[10px] leading-normal text-black">
          <!-- Main Outer Border -->
          <div style="border: 1.5px solid black; width: 100%; height: 100%; display: flex; flex-direction: column;">

            <!-- Header Section -->
            <div style="border-bottom: 0.8px solid black; padding: 4px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="display: flex; gap: 4px; align-items: center;">
                  <img :src="logoThaiDrill" style="height: 22px; width: auto;" />
                  <img :src="logoSunnyFertilizer" style="height: 22px; width: auto;" />
                  <img :src="logoPuiRakYa" style="height: 22px; width: auto;" />
                  <img :src="logoTdFix" style="height: 22px; width: auto;" />
                  <img :src="logoTdContractor" style="height: 22px; width: auto;" />
                  <img :src="logoSunnyGreenFarm" style="height: 22px; width: auto;" />
                  <img :src="logoThaiDrillLao" style="height: 22px; width: auto;" />
                  <img :src="logoSunny" style="height: 22px; width: auto;" />
                </div>
                <div style="text-align: right; font-size: 6px; line-height: 1.2;">
                  FM-HO-PC01-07<br/>
                  REV.01 - 17/10/2567
                </div>
              </div>
              <div style="text-align: center; margin-top: 2px;">
                <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
                <div style="font-size: 10px; font-weight: bold;">(Inspection Memo)</div>
              </div>
              <!-- Checkbox Top Row -->
              <div style="display: flex; justify-content: space-between; font-size: 7.5px; margin-top: 6px; border-top: 0.5px solid black; padding-top: 3px;">
                <div v-for="t in companyTopOptions" :key="t" style="display: flex; align-items: center; gap: 3px;">
                  <div style="width: 9px; height: 9px; border: 0.5px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                    <i v-if="companyTop[t]" class="fa-solid fa-check" style="font-size: 7px;"></i>
                  </div>
                  <span>{{ t }}</span>
                </div>
              </div>
            </div>

            <!-- Doc Type & Info Section -->
            <div style="display: flex; border-bottom: 0.8px solid black;">
              <div style="width: 50%; padding: 6px; border-right: 0.8px solid black; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                <div v-for="(val, key) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="key" style="display: flex; align-items: center; gap: 6px;">
                  <div style="width: 10px; height: 10px; border: 0.5px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                    <i v-if="docType[key]" class="fa-solid fa-check" style="font-size: 8px;"></i>
                  </div>
                  <span style="font-size: 10px;">{{ val }}</span>
                </div>
              </div>
              <div style="width: 50%; padding: 6px; font-size: 10px;">
                <div style="display: flex; margin-bottom: 4px;">
                  <span style="width: 80px;">วันที่ตรวจรับ</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; text-align: center; font-weight: bold;">{{ formatDateOnly(form.inspectionDate) }}</div>
                </div>
                <div style="display: flex;">
                  <span style="width: 80px;">เลขที่ใบแจ้งซ่อม</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; text-align: center; font-weight: bold;">{{ form.repairBillNo }}</div>
                </div>
              </div>
            </div>

            <!-- Seller & Order Info -->
            <div style="display: flex; border-bottom: 0.8px solid black; font-size: 10px;">
              <div style="width: 50%; padding: 6px; border-right: 0.8px solid black;">
                <div style="display: flex; margin-bottom: 4px;">
                  <span style="width: 110px;">สินค้ามาจากผู้ขาย</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.vendorSource }}</div>
                </div>
                <div style="display: flex; margin-bottom: 4px;">
                  <span style="width: 110px;">ใบแจ้งหนี้ผู้ขาย</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.vendorInvoiceNo }}</div>
                </div>
                <div style="display: flex;">
                  <span style="width: 110px;">สถานที่จัดส่ง/ให้บริการ</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.deliveryPlace }}</div>
                </div>
              </div>
              <div style="width: 50%; padding: 6px;">
                <div style="display: flex; margin-bottom: 4px;">
                  <span style="width: 110px;">หมายเลขใบสั่งซื้อ</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.poNumber }}</div>
                </div>
                <div style="display: flex; margin-bottom: 4px;">
                  <span style="width: 110px;">หมายเลขใบรับสินค้า</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.goodsReceiptNo }}</div>
                </div>
                <div style="display: flex;">
                  <span style="width: 110px;">แผนกที่ตรวจรับ</span>
                  <div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.receivingDept }}</div>
                </div>
              </div>
            </div>

            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
              <thead>
                <tr style="background: #f3f4f6; font-weight: bold; text-align: center; font-size: 9px;">
                  <th style="border: 0.5px solid black; width: 25px;">ลำดับ</th>
                  <th style="border: 0.5px solid black; width: 100px;">รหัสสินค้า</th>
                  <th style="border: 0.5px solid black;">รายการ</th>
                  <th style="border: 0.5px solid black; width: 40px;">รับจริง</th>
                  <th style="border: 0.5px solid black; width: 40px;">หน่วย</th>
                  <th style="border: 0.5px solid black; width: 50px;">ราคา/หน่วย</th>
                  <th style="border: 0.5px solid black; width: 60px;">ราคารวม</th>
                  <th style="border: 0.5px solid black; width: 40px;">สั่งซื้อ</th>
                  <th style="border: 0.5px solid black; width: 40px;">คงเหลือ</th>
                  <th style="border: 0.5px solid black; width: 80px;">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, idx) in form.items" :key="idx" style="height: 22px; font-size: 9px;">
                  <td style="border: 0.5px solid black; text-align: center;">{{ idx + 1 }}</td>
                  <td style="border: 0.5px solid black; text-align: center; font-weight: bold;">{{ it.itemCode }}</td>
                  <td style="border: 0.5px solid black; padding-left: 4px;">{{ it.itemName }}</td>
                  <td style="border: 0.5px solid black; text-align: center;">{{ it.receivedQty }}</td>
                  <td style="border: 0.5px solid black; text-align: center;">{{ it.unit }}</td>
                  <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ it.unitPrice }}</td>
                  <td style="border: 0.5px solid black; text-align: right; padding-right: 4px; font-weight: bold;">{{ it.totalPrice }}</td>
                  <td style="border: 0.5px solid black; text-align: center;">{{ it.orderedQty }}</td>
                  <td style="border: 0.5px solid black; text-align: center;">{{ it.remainingQty }}</td>
                  <td style="border: 0.5px solid black; padding-left: 4px; font-size: 8px;">{{ it.note }}</td>
                </tr>

                <tr style="font-weight: bold; font-size: 9px;">
                  <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">มูลค่าสินค้าก่อน VAT</td>
                  <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.beforeVat }}</td>
                  <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                </tr>
                <tr style="font-weight: bold; font-size: 9px;">
                  <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">ภาษีมูลค่าเพิ่ม {{ form.valuation.vatPercent }}%(VAT)</td>
                  <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.vat }}</td>
                  <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                </tr>
                <tr style="font-weight: bold; font-size: 9px;">
                  <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">รวมเป็นเงินทั้งสิ้น</td>
                  <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.total }}</td>
                  <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                </tr>
              </tbody>
            </table>

            <!-- Evaluation Section Header -->
            <div style="width: 100%; border: 0.8px solid black; background: #f3f4f6; text-align: center; padding: 4px; font-weight: bold; font-size: 10px;">
              แบบประเมินผู้ขาย / ผู้ให้บริการ
            </div>

            <table style="width: 100%; border-collapse: collapse; table-layout: fixed; border: 0.8px solid black; border-top: none;">
              <thead>
                <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 9px;">
                  <th rowspan="2" style="border: 0.5px solid black; width: 40px;">ลำดับ</th>
                  <th rowspan="2" style="border: 0.5px solid black; text-align: left; padding-left: 8px;">รายการ</th>
                  <th colspan="3" style="border: 0.5px solid black;">ประเมินผล</th>
                  <th rowspan="2" style="border: 0.5px solid black; width: 150px;">หมายเหตุ</th>
                </tr>
                <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 9px;">
                  <th style="border: 0.5px solid black; width: 50px;">ดี</th>
                  <th style="border: 0.5px solid black; width: 50px;">พอใช้</th>
                  <th style="border: 0.5px solid black; width: 80px;">ควรปรับปรุง</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, idx) in form.evaluationRows" :key="idx" style="height: 28px; font-size: 9px;">
                  <td style="border: 0.5px solid black; text-align: center;">{{ idx + 1 }}</td>
                  <td style="border: 0.5px solid black; padding-left: 8px;">{{ r.text }}</td>
                  <td style="border: 0.5px solid black; text-align: center;">
                    <div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;">
                      <span v-if="r.good" style="font-weight: bold; font-size: 11px;">✓</span>
                    </div>
                  </td>
                  <td style="border: 0.5px solid black; text-align: center;">
                    <div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;">
                      <span v-if="r.fair" style="font-weight: bold; font-size: 11px;">✓</span>
                    </div>
                  </td>
                  <td style="border: 0.5px solid black; text-align: center;">
                    <div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;">
                      <span v-if="r.improve" style="font-weight: bold; font-size: 11px;">✓</span>
                    </div>
                  </td>
                  <td style="border: 0.5px solid black; padding-left: 4px;">{{ r.note }}</td>
                </tr>
              </tbody>
            </table>

            <!-- Images Section -->
            <div style="background: #f3f4f6; text-align: center; padding: 2px; border-bottom: 0.5px solid black; font-weight: bold; font-size: 10px;">แนบรูปภาพการตรวจรับ</div>
            <div style="flex: 1; padding: 8px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; min-height: 120px; border-bottom: 0.5px solid black;">
              <div v-for="(img, idx) in imageFiles" :key="idx" style="border: 0.5px solid #ccc; padding: 2px;">
                <img :src="img.url" style="height: 120px; width: auto;" />
              </div>
              <div v-if="imageFiles.length === 0" style="color: #9ca3af; font-size: 10px; margin-top: 40px;">- ไม่มีรูปภาพแนบ -</div>
            </div>

            <!-- Signatures Section -->
            <div style="padding: 12px 6px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
              <div v-for="(role, key) in {
                receiver: receiverRoleLabel,
                inspector: 'ผู้ตรวจสอบ (หัวหน้างาน)',
                documentReceiver: 'ผู้รับเอกสาร (จนท.จัดซื้อ/การเงิน)'
              }" :key="key" style="text-align: left; display: flex; flex-direction: column; font-size: 8.5px; line-height: 1.6;">
                <div style="display: flex; align-items: flex-end; position: relative; width: 100%;">
                  <span style="white-space: nowrap;">ลงชื่อ</span>
                  <div style="flex: 1; border-bottom: 0.5px dotted black; margin-left: 2px; height: 14px; position: relative;">
                    <div v-if="form.sign[key].name" style="position: absolute; bottom: 2px; left: 0; right: 0; text-align: center; font-weight: bold; color: #1e40af; font-size: 11px;">
                      {{ form.sign[key].name }}
                    </div>
                    <span v-else style="color: transparent;">.</span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; margin-top: 2px; width: 100%;">
                  <span style="white-space: nowrap;">ชื่อตัวบรรจง</span>
                  <div style="margin-left: 4px; border-bottom: 0.5px dotted black; font-weight: bold; min-width: 120px; padding: 0 4px; text-align: left;">
                    {{ form.sign[key].printedName }}
                  </div>
                </div>
                <div style="margin-top: 2px; font-weight: bold; padding-left: 4px;">
                  {{ role }}
                </div>
                <div style="display: flex; align-items: center; margin-top: 2px; width: 100%;">
                  <span style="white-space: nowrap;">วันที่</span>
                  <div style="margin-left: 8px; font-weight: bold;">
                    {{ formatDateOnly(form.sign[key].date) }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Bottom Footer Text -->
            <div style="text-align: center; font-size: 6px; padding-bottom: 1px;">FM-HO-PC01-07 REV.01 - 17/10/2567</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================
         PRINT PREVIEW MODAL
         ============================================================ -->
    <Teleport to="body">
      <Transition name="preview-fade">
        <div
          v-if="showPrintPreview"
          class="fixed inset-0 z-[9999] flex flex-col"
          style="background: rgba(15,23,42,0.85); backdrop-filter: blur(4px); height: 100vh; overflow: hidden;"
        >
          <!-- Top Bar -->
          <div
            class="flex-none flex items-center justify-between px-6 py-3 print:hidden"
            style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid rgba(255,255,255,0.08);"
          >
            <!-- Left: Title -->
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <i class="fa-solid fa-file-lines text-blue-400 text-sm"></i>
              </div>
              <div>
                <div class="text-white font-bold text-sm leading-tight">ตัวอย่างใบตรวจรับพัสดุ</div>
                <div class="text-slate-400 text-[10px] leading-tight">
                  Inspection Memo Preview
                  <span v-if="currentRequestId" class="ml-2 text-blue-400 font-semibold">· OR #{{ currentRequestId }}</span>
                </div>
              </div>
            </div>

            <!-- Right: Action Buttons -->
            <div class="flex items-center gap-2">
              <!-- Download PDF — ใช้ handleDownloadPDF จริงๆ แล้ว -->
              <button
                @click="handleDownloadPDF"
                :disabled="isGeneratingPDF"
                class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; box-shadow: 0 2px 8px rgba(59,130,246,0.4);"
              >
                <i v-if="!isGeneratingPDF" class="fa-solid fa-file-pdf"></i>
                <i v-else class="fa-solid fa-spinner fa-spin"></i>
                {{ isGeneratingPDF ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF' }}
              </button>

              <!-- Print -->
              <button
                @click="handlePrint"
                class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                style="background: linear-gradient(135deg, #10b981, #059669); color: white; box-shadow: 0 2px 8px rgba(16,185,129,0.4);"
              >
                <i class="fa-solid fa-print"></i>
                พิมพ์
              </button>

              <!-- Divider -->
              <div class="w-px h-6 bg-slate-600 mx-1"></div>

              <!-- Close -->
              <button
                @click="handleClosePreview"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
              >
                <i class="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>
          </div>

          <!-- Preview Area: scrollable, centered -->
          <div class="flex-1 overflow-y-auto py-6 px-4" style="background: #1e293b;">
            <div style="display: flex; justify-content: center; align-items: flex-start; min-height: 100%;">

              <!-- Paper Shadow Wrapper — ผูก ref ไว้ตรงนี้เพื่อให้ html2canvas แคปได้ -->
              <div
                ref="previewPaperRef"
                class="preview-paper-wrapper"
                style="width: 210mm; flex-shrink: 0; border-radius: 4px; overflow: visible; box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4); margin-bottom: 24px;"
              >
                <!-- ===== BILL CONTENT ===== -->
                <div
                  style="
                    width: 210mm;
                    background: white;
                    padding: 5mm;
                    box-sizing: border-box;
                    font-family: 'Noto Sans Thai', ui-sans-serif, system-ui, sans-serif;
                    font-size: 10px;
                    line-height: 1.3;
                    color: black;
                    display: flex;
                    flex-direction: column;
                  "
                >
                  <div style="border: 1.5px solid black; width: 100%; display: flex; flex-direction: column;">

                    <!-- Header -->
                    <div style="border-bottom: 0.8px solid black; padding: 4px;">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="display: flex; gap: 4px; align-items: center;">
                          <img :src="logoThaiDrill" style="height: 22px; width: auto;" />
                          <img :src="logoSunnyFertilizer" style="height: 22px; width: auto;" />
                          <img :src="logoPuiRakYa" style="height: 22px; width: auto;" />
                          <img :src="logoTdFix" style="height: 22px; width: auto;" />
                          <img :src="logoTdContractor" style="height: 22px; width: auto;" />
                          <img :src="logoSunnyGreenFarm" style="height: 22px; width: auto;" />
                          <img :src="logoThaiDrillLao" style="height: 22px; width: auto;" />
                          <img :src="logoSunny" style="height: 22px; width: auto;" />
                        </div>
                        <div style="text-align: right; font-size: 6px; line-height: 1.2;">FM-HO-PC01-07<br/>REV.01 - 17/10/2567</div>
                      </div>
                      <div style="text-align: center; margin-top: 2px;">
                        <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
                        <div style="font-size: 10px; font-weight: bold;">(Inspection Memo)</div>
                      </div>
                      <div style="display: flex; justify-content: space-between; font-size: 7.5px; margin-top: 6px; border-top: 0.5px solid black; padding-top: 3px;">
                        <div v-for="t in companyTopOptions" :key="t" style="display: flex; align-items: center; gap: 3px;">
                          <div style="width: 9px; height: 9px; border: 0.5px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                            <i v-if="companyTop[t]" class="fa-solid fa-check" style="font-size: 7px;"></i>
                          </div>
                          <span>{{ t }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Doc Type & Info -->
                    <div style="display: flex; border-bottom: 0.8px solid black;">
                      <div style="width: 50%; padding: 6px; border-right: 0.8px solid black; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                        <div v-for="(val, key) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="key" style="display: flex; align-items: center; gap: 6px;">
                          <div style="width: 10px; height: 10px; border: 0.5px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                            <i v-if="docType[key]" class="fa-solid fa-check" style="font-size: 8px;"></i>
                          </div>
                          <span style="font-size: 10px;">{{ val }}</span>
                        </div>
                      </div>
                      <div style="width: 50%; padding: 6px; font-size: 10px;">
                        <div style="display: flex; margin-bottom: 4px;">
                          <span style="width: 80px;">วันที่ตรวจรับ</span>
                          <div style="flex: 1; border-bottom: 0.5px solid black; text-align: center; font-weight: bold;">{{ formatDateOnly(form.inspectionDate) }}</div>
                        </div>
                        <div style="display: flex;">
                          <span style="width: 80px;">เลขที่ใบแจ้งซ่อม</span>
                          <div style="flex: 1; border-bottom: 0.5px solid black; text-align: center; font-weight: bold;">{{ form.repairBillNo }}</div>
                        </div>
                      </div>
                    </div>

                    <!-- Seller & Order Info -->
                    <div style="display: flex; border-bottom: 0.8px solid black; font-size: 10px;">
                      <div style="width: 50%; padding: 6px; border-right: 0.8px solid black;">
                        <div style="display: flex; margin-bottom: 4px;"><span style="width: 110px;">สินค้ามาจากผู้ขาย</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.vendorSource }}</div></div>
                        <div style="display: flex; margin-bottom: 4px;"><span style="width: 110px;">ใบแจ้งหนี้ผู้ขาย</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.vendorInvoiceNo }}</div></div>
                        <div style="display: flex;"><span style="width: 110px;">สถานที่จัดส่ง/ให้บริการ</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; padding-left: 4px;">{{ form.deliveryPlace }}</div></div>
                      </div>
                      <div style="width: 50%; padding: 6px;">
                        <div style="display: flex; margin-bottom: 4px;"><span style="width: 110px;">หมายเลขใบสั่งซื้อ</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.poNumber }}</div></div>
                        <div style="display: flex; margin-bottom: 4px;"><span style="width: 110px;">หมายเลขใบรับสินค้า</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.goodsReceiptNo }}</div></div>
                        <div style="display: flex;"><span style="width: 110px;">แผนกที่ตรวจรับ</span><div style="flex: 1; border-bottom: 0.5px solid black; font-weight: bold; text-align: center;">{{ form.receivingDept }}</div></div>
                      </div>
                    </div>

                    <!-- Items Table -->
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                      <thead>
                        <tr style="background: #f3f4f6; font-weight: bold; text-align: center; font-size: 9px;">
                          <th style="border: 0.5px solid black; width: 25px;">ลำดับ</th>
                          <th style="border: 0.5px solid black; width: 100px;">รหัสสินค้า</th>
                          <th style="border: 0.5px solid black;">รายการ</th>
                          <th style="border: 0.5px solid black; width: 40px;">รับจริง</th>
                          <th style="border: 0.5px solid black; width: 40px;">หน่วย</th>
                          <th style="border: 0.5px solid black; width: 50px;">ราคา/หน่วย</th>
                          <th style="border: 0.5px solid black; width: 60px;">ราคารวม</th>
                          <th style="border: 0.5px solid black; width: 40px;">สั่งซื้อ</th>
                          <th style="border: 0.5px solid black; width: 40px;">คงเหลือ</th>
                          <th style="border: 0.5px solid black; width: 80px;">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(it, idx) in form.items" :key="idx" style="height: 22px; font-size: 9px;">
                          <td style="border: 0.5px solid black; text-align: center;">{{ idx + 1 }}</td>
                          <td style="border: 0.5px solid black; text-align: center; font-weight: bold;">{{ it.itemCode }}</td>
                          <td style="border: 0.5px solid black; padding-left: 4px;">{{ it.itemName }}</td>
                          <td style="border: 0.5px solid black; text-align: center;">{{ it.receivedQty }}</td>
                          <td style="border: 0.5px solid black; text-align: center;">{{ it.unit }}</td>
                          <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ it.unitPrice }}</td>
                          <td style="border: 0.5px solid black; text-align: right; padding-right: 4px; font-weight: bold;">{{ it.totalPrice }}</td>
                          <td style="border: 0.5px solid black; text-align: center;">{{ it.orderedQty }}</td>
                          <td style="border: 0.5px solid black; text-align: center;">{{ it.remainingQty }}</td>
                          <td style="border: 0.5px solid black; padding-left: 4px; font-size: 8px;">{{ it.note }}</td>
                        </tr>
                        <tr style="font-weight: bold; font-size: 9px;">
                          <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">มูลค่าสินค้าก่อน VAT</td>
                          <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.beforeVat }}</td>
                          <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                        </tr>
                        <tr style="font-weight: bold; font-size: 9px;">
                          <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">ภาษีมูลค่าเพิ่ม {{ form.valuation.vatPercent }}%(VAT)</td>
                          <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.vat }}</td>
                          <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                        </tr>
                        <tr style="font-weight: bold; font-size: 9px;">
                          <td colspan="6" style="border: none; text-align: right; padding-right: 6px;">รวมเป็นเงินทั้งสิ้น</td>
                          <td style="border: 0.5px solid black; text-align: right; padding-right: 4px;">{{ form.valuation.total }}</td>
                          <td colspan="3" style="border: 0.5px solid black; padding-left: 5px;">{{ form.valuation.currency }}</td>
                        </tr>
                      </tbody>
                    </table>

                    <!-- Evaluation -->
                    <div style="width: 100%; border: 0.8px solid black; background: #f3f4f6; text-align: center; padding: 4px; font-weight: bold; font-size: 10px;">แบบประเมินผู้ขาย / ผู้ให้บริการ</div>
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed; border: 0.8px solid black; border-top: none;">
                      <thead>
                        <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 9px;">
                          <th rowspan="2" style="border: 0.5px solid black; width: 40px;">ลำดับ</th>
                          <th rowspan="2" style="border: 0.5px solid black; text-align: left; padding-left: 8px;">รายการ</th>
                          <th colspan="3" style="border: 0.5px solid black;">ประเมินผล</th>
                          <th rowspan="2" style="border: 0.5px solid black; width: 150px;">หมายเหตุ</th>
                        </tr>
                        <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 9px;">
                          <th style="border: 0.5px solid black; width: 50px;">ดี</th>
                          <th style="border: 0.5px solid black; width: 50px;">พอใช้</th>
                          <th style="border: 0.5px solid black; width: 80px;">ควรปรับปรุง</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(r, idx) in form.evaluationRows" :key="idx" style="height: 28px; font-size: 9px;">
                          <td style="border: 0.5px solid black; text-align: center;">{{ idx + 1 }}</td>
                          <td style="border: 0.5px solid black; padding-left: 8px;">{{ r.text }}</td>
                          <td style="border: 0.5px solid black; text-align: center;"><div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;"><span v-if="r.good" style="font-weight: bold; font-size: 11px;">✓</span></div></td>
                          <td style="border: 0.5px solid black; text-align: center;"><div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;"><span v-if="r.fair" style="font-weight: bold; font-size: 11px;">✓</span></div></td>
                          <td style="border: 0.5px solid black; text-align: center;"><div style="width: 12px; height: 12px; border: 0.5px solid black; margin: auto; display: flex; align-items: center; justify-content: center;"><span v-if="r.improve" style="font-weight: bold; font-size: 11px;">✓</span></div></td>
                          <td style="border: 0.5px solid black; padding-left: 4px;">{{ r.note }}</td>
                        </tr>
                      </tbody>
                    </table>

                    <!-- Images -->
                    <div style="background: #f3f4f6; text-align: center; padding: 2px; border-bottom: 0.5px solid black; font-weight: bold; font-size: 10px;">แนบรูปภาพการตรวจรับ</div>
                    <div style="padding: 8px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; min-height: 80px; border-bottom: 0.5px solid black;">
                      <div v-for="(img, idx) in imageFiles" :key="idx" style="border: 0.5px solid #ccc; padding: 2px;">
                        <img :src="img.url" style="height: 100px; width: auto;" />
                      </div>
                      <div v-if="imageFiles.length === 0" style="color: #9ca3af; font-size: 10px; display: flex; align-items: center;">- ไม่มีรูปภาพแนบ -</div>
                    </div>

                    <!-- Signatures -->
                    <div style="padding: 10px 6px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
                      <div v-for="(role, key) in {
                        receiver: receiverRoleLabel,
                        inspector: 'ผู้ตรวจสอบ (หัวหน้างาน)',
                        documentReceiver: 'ผู้รับเอกสาร (จนท.จัดซื้อ/การเงิน)'
                      }" :key="key" style="text-align: left; display: flex; flex-direction: column; font-size: 8.5px; line-height: 1.6;">
                        <div style="display: flex; align-items: flex-end; width: 100%;">
                          <span style="white-space: nowrap;">ลงชื่อ</span>
                          <div style="flex: 1; border-bottom: 0.5px dotted black; margin-left: 2px; height: 14px; position: relative;">
                            <div v-if="form.sign[key].name" style="position: absolute; bottom: 2px; left: 0; right: 0; text-align: center; font-weight: bold; color: #1e40af; font-size: 11px;">{{ form.sign[key].name }}</div>
                            <span v-else style="color: transparent;">.</span>
                          </div>
                        </div>
                        <div style="display: flex; align-items: center; margin-top: 2px;">
                          <span style="white-space: nowrap;">ชื่อตัวบรรจง</span>
                          <div style="margin-left: 4px; border-bottom: 0.5px dotted black; font-weight: bold; min-width: 100px; padding: 0 4px;">{{ form.sign[key].printedName }}</div>
                        </div>
                        <div style="margin-top: 2px; font-weight: bold; padding-left: 4px;">{{ role }}</div>
                        <div style="display: flex; align-items: center; margin-top: 2px;">
                          <span style="white-space: nowrap;">วันที่</span>
                          <div style="margin-left: 8px; font-weight: bold;">{{ formatDateOnly(form.sign[key].date) }}</div>
                        </div>
                      </div>
                    </div>

                    <!-- Footer -->
                    <div style="text-align: center; font-size: 6px; padding-bottom: 1px;">FM-HO-PC01-07 REV.01 - 17/10/2567</div>
                  </div>
                </div>
                <!-- ===== END BILL CONTENT ===== -->
              </div>

            </div>
          </div>

          <!-- Bottom hint -->
          <div class="flex-none py-2 text-center text-slate-500 text-[11px] print:hidden">
            กด <kbd class="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px] font-mono">Esc</kbd> เพื่อปิด
          </div>
        </div>
      </Transition>
    </Teleport>

  </AppLayout>
</template>

<style scoped>
.paper {
  width: 210mm;
  background-color: white;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  margin: 0 auto;
  transform: none;
  margin-bottom: 2rem;
}

.sheet {
  width: 210mm;
  padding: 10mm;
  box-sizing: border-box;
  font-family: 'Noto Sans Thai', ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
}

.font-handwriting {
  font-family: 'Dancing Script', 'Cursive', sans-serif;
  font-size: 16px;
  color: #1e40af;
}

input {
  background-color: transparent;
  transition: background-color 0.2s;
}

input:hover {
  background-color: rgba(59, 130, 246, 0.05);
}

input:focus {
  background-color: rgba(59, 130, 246, 0.1);
  outline: none;
}

/* Print Preview Modal Transitions */
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 0.2s ease;
}
.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
.preview-fade-enter-active .preview-paper-wrapper {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.preview-fade-enter-from .preview-paper-wrapper {
  transform: translateY(16px) scale(0.98);
  opacity: 0;
}

@media print {
  @page {
    size: A4;
    margin: 0 !important;
  }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 210mm !important;
    height: 297mm !important;
    background: white !important;
    overflow: hidden !important;
  }

  body * {
    visibility: hidden !important;
  }

  .printable-bill-container,
  .printable-bill-container * {
    visibility: visible !important;
  }

  .printable-bill-container {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 210mm !important;
    height: 297mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
    z-index: 999999 !important;
    display: block !important;
  }

  .printable-bill {
    width: 100% !important;
    height: 100% !important;
    background: white !important;
  }

  .printable-sheet {
    width: 100% !important;
    height: 100% !important;
    padding: 5mm !important;
    box-sizing: border-box !important;
    display: flex !important;
    flex-direction: column !important;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
</style>