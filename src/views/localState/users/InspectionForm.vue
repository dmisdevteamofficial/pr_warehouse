<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

const props = defineProps({
  isModal: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

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
    if (barcodeBuffer.length > 2) processBarcodeInput(barcodeBuffer.trim())
    barcodeBuffer = ''; clearTimeout(barcodeTimer); return
  }
  if (e.key.length === 1) {
    barcodeBuffer += e.key; clearTimeout(barcodeTimer)
    barcodeTimer = setTimeout(() => { barcodeBuffer = '' }, BARCODE_TIMEOUT_MS)
  }
}

async function processBarcodeInput(code) {
  const cleanCode = code.replace(/^#/, '').trim()
  if (!cleanCode) return
  if (currentRequestId.value && String(currentRequestId.value) !== cleanCode) {
    ui.showToast(`มีข้อมูลใบเบิก #${currentRequestId.value} อยู่แล้ว กรุณาล้างข้อมูลก่อนสแกนใบใหม่`, 'warning')
    barcodeInput.value = ''; return
  }
  const group = historyGroups.value.find(g => String(g.requestId) === cleanCode)
  if (group) { addToInspection(group); barcodeInput.value = ''; return }
  try {
    const isNumeric = /^\d+$/.test(cleanCode)
    let query = supabase.from('order_req').select(`id, request_id, created_at, created_by, amount, unit, note, remark, status, updated_at, updated_by, mr_number, company, fixed_bill_number, items(item_code,item_name,unit), requester:system_users!created_by(fullname, position, department, emp_code)`).eq('status', 'completed')
    
    if (auth.user?.role !== 'admin_store' && auth.user?.role !== 'admin') {
      query = query.eq('created_by', auth.user?.id)
    }

    if (isNumeric) query = query.or(`request_id.eq.${cleanCode},id.eq.${cleanCode}`)
    else { ui.showToast('รหัสบาร์โค้ดไม่ถูกต้อง', 'warning'); return }
    const { data, error } = await query
    if (error) throw error
    if (data && data.length > 0) {
      const tempGroups = buildHistoryGroups(data)
      if (tempGroups.length > 0) { addToInspection(tempGroups[0]); barcodeInput.value = '' }
    } else ui.showToast(`ไม่พบข้อมูลใบเบิก #${cleanCode}`, 'error')
  } catch (err) { ui.showToast('ค้นหาไม่สำเร็จ', 'error') }
}

async function fetchData() {
  loading.value = true
  try {
    let ordersQuery = supabase.from('order_req').select(`id, request_id, created_at, created_by, amount, unit, note, remark, status, updated_at, updated_by, mr_number, company, fixed_bill_number, items(item_code,item_name,unit), requester:system_users!created_by(fullname, position, department, emp_code)`).eq('status', 'completed')
    
    if (auth.user?.role !== 'admin_store' && auth.user?.role !== 'admin') {
      ordersQuery = ordersQuery.eq('created_by', auth.user?.id)
    }

    const [{ data: ordersData }, { data: txData }] = await Promise.all([
      ordersQuery.order('updated_at', { ascending: false }),
      supabase.from('transactions').select('order_id, amount, unit, return_date, created_at, created_by').order('created_at', { ascending: false })
    ])
    orders.value = ordersData || []; transactions.value = txData || []
  } catch (err) { console.error(err) } finally { loading.value = false }
}

onMounted(() => {
  fetchData()
  if (barcodeField.value) barcodeField.value.focus()
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keydown', handleEscKey)
  if (ui.pendingOrderId) processPendingOrder(ui.pendingOrderId)
})

async function processPendingOrder(orderId) {
  if (loading.value) {
    const unwatch = watch(loading, (isL) => {
      if (!isL) {
        const group = historyGroups.value.find(g => String(g.requestId) === String(orderId))
        if (group) addToInspection(group)
        ui.setPendingOrder(null); unwatch()
      }
    })
  } else {
    const group = historyGroups.value.find(g => String(g.requestId) === String(orderId))
    if (group) addToInspection(group)
    ui.setPendingOrder(null)
  }
}

watch(() => ui.pendingOrderId, (newId) => { if (newId) processPendingOrder(newId) })

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keydown', handleEscKey)
  document.body.style.overflow = ''
})

function handleEscKey(e) {
  if (e.key === 'Escape') {
    if (showPrintPreview.value) handleClosePreview()
    else if (props.isModal) emit('close')
  }
}

function txByOrderId(orderId) { return transactions.value.find((row) => row.order_id === orderId) || null }
async function handleBarcodeScan() { if (barcodeInput.value.trim()) await processBarcodeInput(barcodeInput.value.trim()) }

function buildHistoryGroups(rows) {
  const groups = {}
  rows.forEach((row) => {
    const key = row.request_id ? `request-${row.request_id}` : `single-${row.id}`
    const tx = txByOrderId(row.id)
    if (!groups[key]) {
      groups[key] = { key, requestId: row.request_id || row.id, updatedAt: row.updated_at, items: [] }
    }
    groups[key].items.push({ id: row.id, itemCode: row.items?.item_code || '-', itemName: row.items?.item_name || '-', amount: Number(tx?.amount ?? row.amount ?? 0), unit: tx?.unit || row.unit || row.items?.unit || '' })
  })
  return Object.values(groups).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

const historyGroups = computed(() => buildHistoryGroups(orders.value))
const filteredHistoryGroups = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return historyGroups.value
  return historyGroups.value.filter(g => String(g.requestId).toLowerCase().includes(key) || g.items.some(it => it.itemName.toLowerCase().includes(key)))
})

const docType = reactive({ goods: false, hire: false, rent: false, service: false })
const companyTopOptions = ['รถเจาะไทย', 'ซันนี่ เฟอติไลเซอร์', 'ปุ๋ยรากหญ้า', 'ทีดี ฟิกซ์', 'ทีดี คอนแทรคเตอร์', 'ซันนี่ กรีน ฟาร์ม', 'ไทยดิว ลาว', 'ซันนี่ แมชีนเนอรี่']
const companyTop = reactive(Object.fromEntries(companyTopOptions.map((t) => [t, false])))
const imageFiles = ref([])

function handleImageChange(event) {
  const files = Array.from(event.target.files || [])
  imageFiles.value = [...imageFiles.value, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))]
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
  valuation: { beforeVat: '0.00', vat: '0.00', total: '0.00', vatPercent: 0, currency: 'บาท' },
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

const receiverRoleLabel = computed(() => `ผู้ตรวจรับของ (แผนก${auth.user?.department || 'คลังสินค้า/พัสดุ'})`)

function addToInspection(group) {
  if (currentRequestId.value && currentRequestId.value !== group.requestId) { ui.showToast(`มีข้อมูลใบเบิก #${currentRequestId.value} อยู่แล้ว`, 'warning'); return }
  group.items.forEach(item => {
    const idx = form.items.findIndex(it => !it.itemName && !it.itemCode)
    const newItem = { itemCode: item.itemCode, itemName: item.itemName, unit: item.unit, receivedQty: item.amount, unitPrice: '', orderedQty: item.amount, remainingQty: '0', totalPrice: '', note: `จากใบเบิก #${group.requestId}` }
    if (idx !== -1) form.items[idx] = newItem; else form.items.push(newItem)
  })
  currentRequestId.value = group.requestId; ui.showToast(`เพิ่มรายการเรียบร้อย`, 'success')
}

function clearForm() {
  if (!confirm('ล้างข้อมูล?')) return
  Object.assign(form, { inspectionDate: todayISO, repairBillNo: '', vendorSource: '', poNumber: '', vendorInvoiceNo: '', goodsReceiptNo: '', deliveryPlace: '', receivingDept: '', items: Array.from({ length: 10 }, () => ({ itemCode: '', itemName: '', unit: '', receivedQty: '', unitPrice: '', orderedQty: '', remainingQty: '', totalPrice: '', note: '' })), valuation: { beforeVat: '0.00', vat: '0.00', total: '0.00', vatPercent: 0, currency: 'บาท' }, sign: { receiver: { name: '', printedName: auth.user?.fullname || '', date: todayISO }, inspector: { name: '', printedName: '', date: todayISO }, documentReceiver: { name: '', printedName: '', date: todayISO } } })
  Object.keys(docType).forEach(k => docType[k] = false); Object.keys(companyTop).forEach(k => companyTop[k] = false); currentRequestId.value = null; imageFiles.value = []
}

function formatInputNumber(obj, key) {
  let val = String(obj[key]).replace(/,/g, ''); const n = parseFloat(val)
  if (!isNaN(n)) obj[key] = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

watch(() => [form.items, form.valuation.vatPercent], () => {
  let subtotal = 0
  form.items.forEach(it => {
    const q = parseFloat(String(it.receivedQty).replace(/,/g, '')); const p = parseFloat(String(it.unitPrice).replace(/,/g, ''))
    if (!isNaN(q) && !isNaN(p)) it.totalPrice = (q * p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const line = parseFloat(String(it.totalPrice).replace(/,/g, '')); if (!isNaN(line)) subtotal += line
  })
  form.valuation.beforeVat = subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const vat = subtotal * ((parseFloat(form.valuation.vatPercent) || 0) / 100)
  form.valuation.vat = vat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  form.valuation.total = (subtotal + vat).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}, { deep: true })

const showPrintPreview = ref(false)
function handleOpenPreview() { showPrintPreview.value = true; document.body.style.overflow = 'hidden' }
function handleClosePreview() { showPrintPreview.value = false; document.body.style.overflow = '' }
function handlePrint() { handleClosePreview(); nextTick(() => window.print()) }

const isSaving = ref(false)
async function handleSave() {
  const valid = form.items.filter(it => it.itemName || it.itemCode)
  if (!valid.length) { ui.showToast('เพิ่มสินค้าก่อน', 'warning'); return }
  if (!confirm('บันทึกข้อมูล?')) return
  isSaving.value = true
  try {
    const urls = []
    for (const img of imageFiles.value) {
      const path = `uploads/${Date.now()}_${Math.random().toString(36).substr(7)}`
      const { error } = await supabase.storage.from('inspections').upload(path, img.file)
      if (error) throw error
      urls.push(supabase.storage.from('inspections').getPublicUrl(path).data.publicUrl)
    }
    const { data, error } = await supabase.from('inspections').insert({ inspection_date: form.inspectionDate, doc_type: docType, company_selections: companyTop, repair_bill_no: form.repairBillNo, vendor_source: form.vendorSource, po_number: form.poNumber, vendor_invoice_no: form.vendorInvoiceNo, goods_receipt_no: form.goodsReceiptNo, delivery_place: form.deliveryPlace, receiving_dept: form.receivingDept, valuation: form.valuation, evaluation_data: form.evaluationRows, signatures: form.sign, image_urls: urls, created_by: auth.user?.id }).select().single()
    if (error) throw error
    await supabase.from('inspection_items').insert(valid.map(it => ({ inspection_id: data.id, item_code: it.itemCode, item_name: it.itemName, unit: it.unit, received_qty: parseFloat(String(it.receivedQty).replace(/,/g, '')) || 0, unit_price: parseFloat(String(it.unitPrice).replace(/,/g, '')) || 0, ordered_qty: parseFloat(String(it.orderedQty).replace(/,/g, '')) || 0, remaining_qty: parseFloat(String(it.remainingQty).replace(/,/g, '')) || 0, total_price: parseFloat(String(it.totalPrice).replace(/,/g, '')) || 0, note: it.note })))
    ui.showToast('บันทึกสำเร็จ', 'success'); if (confirm('ล้างฟอร์ม?')) clearForm()
  } catch (err) { ui.showToast(err.message, 'error') } finally { isSaving.value = false }
}

function formatDateOnly(v) {
  if (!v) return '-'
  return new Date(v).toLocaleDateString('th-TH')
}

async function handleDownloadPDF() {
  if (!previewPaperRef.value) return
  isGeneratingPDF.value = true
  try {
    await nextTick()
    const canvas = await html2canvas(previewPaperRef.value, { scale: 4, useCORS: true, allowTaint: true, onclone: (doc) => {
      const el = doc.querySelector('.preview-paper-wrapper')
      if (el) {
        Object.assign(el.style, { boxShadow: 'none', transform: 'none', margin: '0', borderRadius: '0', width: '794px' })
        el.querySelectorAll('table').forEach(t => Object.assign(t.style, { borderCollapse: 'collapse', width: '100%', border: '1px solid black' }))
        el.querySelectorAll('th, td').forEach(c => Object.assign(c.style, { border: '1px solid black', backgroundColor: 'white' }))
      }
    }})
    const pdf = new jsPDF('p', 'mm', 'a4', true)
    pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, 210, 297, '', 'FAST')
    pdf.save(`inspection-${currentRequestId.value || form.inspectionDate}.pdf`)
    ui.showToast('สำเร็จ', 'success')
  } catch (err) { ui.showToast(err.message, 'error') } finally { isGeneratingPDF.value = false }
}
</script>

<template>
  <div class="flex flex-col xl:flex-row gap-6 h-full overflow-hidden" :class="isModal ? 'bg-white rounded-2xl' : ''">
    <!-- Form Side -->
    <div class="xl:w-[75%] h-full overflow-y-auto bg-gray-100 p-4 rounded-xl border border-gray-200 relative">
      <div class="flex justify-between items-center mb-4 px-2 print:hidden">
        <h2 class="text-lg font-bold text-gray-800"></h2>
        <div class="flex gap-2">
          <button @click="clearForm" class="px-4 py-1.5 bg-white border border-red-300 rounded-lg shadow-sm hover:bg-red-50 text-sm font-bold text-red-600 flex items-center gap-2"><i class="fa-solid fa-trash-can"></i> ล้างข้อมูล</button>
          <button @click="handleSave" :disabled="isSaving" class="px-4 py-1.5 bg-blue-600 border border-blue-700 rounded-lg shadow-sm hover:bg-blue-700 text-sm font-bold text-white flex items-center gap-2 disabled:opacity-50"><i v-if="isSaving" class="fa-solid fa-spinner fa-spin"></i><i v-else class="fa-solid fa-floppy-disk"></i>{{ isSaving ? 'บันทึก...' : 'บันทึก' }}</button>
          <button @click="handleOpenPreview" class="px-4 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-bold flex items-center gap-2"><i class="fa-solid fa-print"></i> พิมพ์ / PDF</button>
        </div>
      </div>

      <div class="paper mx-auto"><div class="sheet"><div class="border border-gray-300 overflow-hidden bg-white">
        <!-- Header -->
        <div class="pb-1 bg-white">
          <div class="flex items-start justify-between px-2 py-1">
            <div class="flex items-center gap-2 flex-nowrap overflow-hidden">
              <img v-for="l in [logoThaiDrill, logoSunnyFertilizer, logoPuiRakYa, logoTdFix, logoTdContractor, logoSunnyGreenFarm, logoThaiDrillLao, logoSunny]" :key="l" :src="l" class="h-8 w-auto object-contain" />
            </div>
            <div class="text-[7px] text-gray-500 text-right">FM-HO-PC01-07<br/>REV.01 - 17/10/2567</div>
          </div>
          <div class="text-center mt-1">
            <div class="text-[13px] font-bold text-gray-800 uppercase leading-none">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
            <div class="text-[10px] font-bold text-gray-800">(Inspection Memo)</div>
          </div>
          <div class="flex items-center justify-between mt-2 px-2 text-[8px] text-gray-600 border-t pt-1">
            <label v-for="t in companyTopOptions" :key="t" class="flex items-center gap-1">
              <div class="w-2.5 h-2.5 border flex items-center justify-center bg-white"><input type="checkbox" v-model="companyTop[t]" class="opacity-0 absolute w-2.5 h-2.5 cursor-pointer" /><i v-if="companyTop[t]" class="fa-solid fa-check text-[7px] text-blue-600"></i></div><span>{{ t }}</span>
            </label>
          </div>
        </div>
        <!-- Doc Type -->
        <div class="flex p-2 border-t">
          <div class="w-[55%] grid grid-cols-2 gap-y-1">
            <label v-for="(v, k) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="k" class="flex items-center text-[10px]">
              <div class="w-3 h-3 border flex items-center justify-center mr-2 bg-white"><input type="checkbox" v-model="docType[k]" class="opacity-0 absolute w-3 h-3 cursor-pointer" /><i v-if="docType[k]" class="fa-solid fa-check text-[10px]"></i></div><span>{{ v }}</span>
            </label>
          </div>
          <div class="w-[45%] text-[10px] pl-4">
            <div class="flex items-end justify-between mb-1"><span>วันที่ตรวจรับ</span><input v-model="form.inspectionDate" class="border-b w-full mx-2 text-center outline-none h-4" /></div>
            <div class="flex items-end justify-between"><span>เลขที่ใบแจ้งซ่อม</span><input v-model="form.repairBillNo" class="border-b w-full mx-2 text-center outline-none h-4" /></div>
          </div>
        </div>
        <!-- Seller Info -->
        <div class="text-[10px] p-1 grid grid-cols-2 gap-4">
          <div v-for="f in [{l:'สินค้ามาจากผู้ขาย',v:'vendorSource'},{l:'หมายเลขใบสั่งซื้อ',v:'poNumber'},{l:'ใบแจ้งหนี้ผู้ขาย',v:'vendorInvoiceNo'},{l:'หมายเลขใบรับสินค้า',v:'goodsReceiptNo'},{l:'สถานที่จัดส่ง',v:'deliveryPlace'},{l:'แผนกที่ตรวจรับ',v:'receivingDept'}]" :key="f.v" class="flex items-end">
            <span class="mr-2 whitespace-nowrap">{{ f.l }}</span><input v-model="form[f.v]" class="border-b flex-1 outline-none h-4 px-1" />
          </div>
        </div>
        <!-- Table -->
        <div class="overflow-x-auto"><table class="w-full text-[9px] border-collapse border">
          <thead><tr class="bg-gray-50 font-bold">
            <th class="border p-0.5 w-[25px]">ลาดับ</th><th class="border p-0.5 w-[100px]">รหัสสินค้า</th><th class="border p-0.5">รายการ</th><th class="border p-0.5 w-[40px]">รับจริง</th><th class="border p-0.5 w-[40px]">หน่วย</th><th class="border p-0.5 w-[50px]">ราคา/หน่วย</th><th class="border p-0.5 w-[60px]">ราคารวม</th><th class="border p-0.5 w-[40px]">สั่งซื้อ</th><th class="border p-0.5 w-[40px]">คงเหลือ</th><th class="border p-0.5 w-[80px]">หมายเหตุ</th>
          </tr></thead>
          <tbody>
            <tr v-for="(it, idx) in form.items" :key="idx" class="h-6">
              <td class="border text-center">{{ idx + 1 }}</td><td class="border"><input v-model="it.itemCode" class="w-full text-center outline-none" /></td><td class="border"><input v-model="it.itemName" class="w-full px-1 outline-none" /></td><td class="border"><input v-model="it.receivedQty" class="w-full text-center outline-none" /></td><td class="border"><input v-model="it.unit" class="w-full text-center outline-none" /></td><td class="border"><input v-model="it.unitPrice" @blur="formatInputNumber(it,'unitPrice')" class="w-full text-right px-1 outline-none" /></td><td class="border text-right px-1">{{ it.totalPrice }}</td><td class="border"><input v-model="it.orderedQty" class="w-full text-center outline-none" /></td><td class="border"><input v-model="it.remainingQty" class="w-full text-center outline-none" /></td><td class="border"><input v-model="it.note" class="w-full px-1 outline-none" /></td>
            </tr>
            <tr class="font-bold"><td colspan="6" class="text-right p-0.5">มูลค่าสินค้าก่อน VAT</td><td class="border text-right p-0.5">{{ form.valuation.beforeVat }}</td><td colspan="3" class="border p-1">{{ form.valuation.currency }}</td></tr>
            <tr class="font-bold"><td colspan="6" class="text-right p-0.5">VAT <input v-model="form.valuation.vatPercent" class="w-8 border-b text-center outline-none" />%</td><td class="border text-right p-0.5">{{ form.valuation.vat }}</td><td colspan="3" class="border p-1">{{ form.valuation.currency }}</td></tr>
            <tr class="bg-gray-50 font-bold"><td colspan="6" class="text-right p-0.5">รวมทั้งสิ้น</td><td class="border text-right p-0.5">{{ form.valuation.total }}</td><td colspan="3" class="border p-1">{{ form.valuation.currency }}</td></tr>
          </tbody>
        </table></div>
        <!-- Evaluation -->
        <div class="border-t">
          <div class="bg-gray-100 text-center py-1 font-bold text-[10px]">แบบประเมินผู้ขาย / ผู้ให้บริการ</div>
          <table class="w-full text-[9px] border-collapse">
            <thead><tr class="bg-gray-50">
              <th rowspan="2" class="border p-1 w-[40px]">ลำดับ</th><th rowspan="2" class="border p-1 text-left pl-2">รายการ</th><th colspan="3" class="border p-1">ประเมินผล</th><th rowspan="2" class="border p-1 w-[150px]">หมายเหตุ</th>
            </tr><tr class="bg-gray-50"><th class="border p-1 w-[50px]">ดี</th><th class="border p-1 w-[50px]">พอใช้</th><th class="border p-1 w-[80px]">ควรปรับปรุง</th></tr></thead>
            <tbody><tr v-for="(r, idx) in form.evaluationRows" :key="idx" class="h-8">
              <td class="border text-center">{{ idx + 1 }}</td><td class="border px-2">{{ r.text }}</td>
              <td class="border text-center"><div @click="r.good=!r.good;if(r.good){r.fair=r.improve=false}" class="w-4 h-4 border mx-auto flex items-center justify-center cursor-pointer bg-white"><i v-if="r.good" class="fa-solid fa-check"></i></div></td>
              <td class="border text-center"><div @click="r.fair=!r.fair;if(r.fair){r.good=r.improve=false}" class="w-4 h-4 border mx-auto flex items-center justify-center cursor-pointer bg-white"><i v-if="r.fair" class="fa-solid fa-check"></i></div></td>
              <td class="border text-center"><div @click="r.improve=!r.improve;if(r.improve){r.good=r.fair=false}" class="w-4 h-4 border mx-auto flex items-center justify-center cursor-pointer bg-white"><i v-if="r.improve" class="fa-solid fa-check"></i></div></td>
              <td class="border"><input v-model="r.note" class="w-full px-1 outline-none" /></td>
            </tr></tbody>
          </table>
        </div>
        <!-- Images -->
        <div class="border-t min-h-[150px] flex flex-col">
          <div class="bg-gray-100 text-center py-1 font-bold text-[10px]">แนบรูปภาพการตรวจรับ</div>
          <div class="p-3 flex flex-wrap gap-3 justify-center">
            <div v-for="(img, idx) in imageFiles" :key="idx" class="relative group">
              <img :src="img.url" class="h-28 w-40 object-cover border rounded" /><button @click="imageFiles.splice(idx,1)" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <label class="h-28 w-40 border-2 border-dashed rounded flex flex-col items-center justify-center text-gray-400 hover:text-blue-400 hover:border-blue-400 cursor-pointer"><i class="fa-solid fa-plus text-xl"></i><span class="text-[8px] font-bold">เพิ่มรูปภาพ</span><input type="file" multiple accept="image/*" class="hidden" @change="handleImageChange" /></label>
          </div>
        </div>
        <!-- Signs -->
        <div class="p-4 grid grid-cols-3 gap-4 text-[9px]">
          <div v-for="(r, k) in {receiver:receiverRoleLabel, inspector:'ผู้ตรวจสอบ (หัวหน้าหน่วย)', documentReceiver:'ผู้รับเอกสาร (จัดซื้อ/การเงิน)'}" :key="k" class="flex flex-col items-center">
            <div class="w-full flex items-end gap-1 mb-1 font-bold">ลงชื่อ <input v-model="form.sign[k].name" class="border-b border-dotted flex-1 text-center font-handwriting text-blue-800 outline-none h-4" /></div>
            <div class="text-[8px] italic flex items-center gap-1">ชื่อตัวบรรจง <input v-model="form.sign[k].printedName" class="border-b border-dotted flex-1 text-center outline-none h-4" /></div>
            <div class="font-bold text-center mt-1">{{ r }}</div>
            <div class="w-full flex justify-center gap-1 mt-1">วันที่ <input v-model="form.sign[k].date" class="border-b border-dotted w-20 text-center outline-none h-4" /></div>
          </div>
        </div>
      </div></div></div></div>

    <!-- History Side -->
    <div class="xl:w-[25%] h-full flex flex-col gap-4 overflow-hidden print:hidden">
      <div class="p-4 rounded-xl border bg-white shadow-sm">
        <div class="flex items-center gap-2 text-gray-700 mb-2 font-bold"><i class="fa-solid fa-barcode text-lg"></i>สแกนบาร์โค้ดใบเบิก</div>
        <div class="relative"><input v-model="barcodeInput" placeholder="สแกนที่นี่..." class="w-full pl-4 pr-10 py-2 bg-gray-50 border rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500" @keyup.enter="handleBarcodeScan" ref="barcodeField" /><button @click="handleBarcodeScan" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600"><i class="fa-solid fa-arrow-right-to-bracket"></i></button></div>
      </div>
      <div class="p-4 rounded-xl border bg-white shadow-sm flex flex-col gap-3">
        <h2 class="text-lg font-bold text-gray-800">ประวัติการเบิก</h2>
        <div class="relative"><i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i><input v-model="searchText" placeholder="ค้นหา..." class="w-full pl-9 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500" /></div>
      </div>
      <div class="flex-1 overflow-y-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-xs text-left">
          <thead class="sticky top-0 bg-gray-50 border-b"><tr><th class="px-3 py-3 font-semibold text-gray-600">รายการเบิก (OR)</th><th class="px-3 py-3 text-center">เพิ่ม</th></tr></thead>
          <tbody><tr v-for="g in filteredHistoryGroups" :key="g.key" class="border-b last:border-0 hover:bg-blue-50/30">
            <td class="px-3 py-3">
              <div class="text-[10px] text-gray-500">{{ formatDateOnly(g.updatedAt) }}</div><div class="font-bold text-blue-600">#{{ g.requestId }}</div>
              <div class="text-[10px] text-gray-400 mt-1"><div v-for="it in g.items" :key="it.id" class="truncate max-w-[150px]">• {{ it.itemName }}</div></div>
            </td>
            <td class="px-3 py-3 text-center"><button @click="addToInspection(g)" :disabled="currentRequestId && currentRequestId !== g.requestId" class="p-2 rounded-lg" :class="[currentRequestId && currentRequestId !== g.requestId ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-600 hover:text-white']"><i class="fa-solid fa-plus-circle"></i></button></td>
          </tr></tbody>
        </table>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="showPrintPreview" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm print:hidden">
      <div class="bg-gray-800 w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 class="text-white font-bold flex items-center gap-2"><i class="fa-solid fa-magnifying-glass"></i>ตัวอย่างก่อนพิมพ์</h3>
          <div class="flex gap-3">
            <button @click="handleDownloadPDF" :disabled="isGeneratingPDF" class="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"><i v-if="isGeneratingPDF" class="fa-solid fa-spinner fa-spin"></i><i v-else class="fa-solid fa-file-pdf"></i>{{ isGeneratingPDF ? 'สร้าง...' : 'ดาวน์โหลด PDF' }}</button>
            <button @click="handlePrint" class="px-4 py-2 bg-white text-gray-800 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-100"><i class="fa-solid fa-print"></i>พิมพ์</button>
            <button @click="handleClosePreview" class="px-4 py-2 bg-gray-700 text-white rounded-lg font-bold hover:bg-gray-600">ปิด</button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-8 bg-gray-900 flex justify-center">
          <div ref="previewPaperRef" class="preview-paper-wrapper bg-white shadow-2xl origin-top" style="width: 210mm; min-height: 297mm;">
            <!-- Simple content for preview - should ideally be same as form above -->
            <div class="p-8 text-black text-center pt-20">--- กำลังประมวลผลข้อมูลใบบิน ---</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paper { width: 210mm; min-height: 297mm; background: white; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
.sheet { padding: 5mm; height: 100%; display: flex; flex-direction: column; }
.font-handwriting { font-family: 'Dancing Script', cursive; font-size: 16px; }
@media print { .print\:hidden { display: none !important; } .paper { width: 100%; margin: 0; box-shadow: none; } }
</style>
