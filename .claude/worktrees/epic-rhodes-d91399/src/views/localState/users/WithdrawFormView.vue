<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'

// Company Logos
import logoThaiDrill from '@/assets/thaidrill_company.png'
import logoThaiDrillLao from '@/assets/thaidrillLao_company.png'
import logoTDL_MVDC from '@/assets/tdl&mvdc_company.jpg'
import logoSunny from '@/assets/sunnycompany.png'

const props = defineProps({
  cartItems: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['back', 'submit'])
const auth = useAuthStore()

// ─── Form State ──────────────────────────────────────────────────────────────
const mrNumber = ref('')
const formDate = ref(new Date().toISOString().split('T')[0])
const withdrawType = ref({ forSale: false, newWithdraw: false })
const replaceReason = ref('')

const repairCode = ref('')
const referenceNumber = ref('')
const meterFrom = ref('')
const meterTo = ref('')
const selectedCompany = ref('')

const withdrawReasons = ref({
  broken: false,
  pm: false,
  pmDetail: '',
  rust: false,
  colorFade: false,
  colorMismatch: false,
  cracked: false,
  reserve: false,
  damageLoss: false,
  fromAccident: false,
  changeOther: false,
  preventAccident: false,
  clean: false,
  officeTool: false,
  other1: false,
  other1Detail: '',
  other2: false,
  other2Detail: ''
})

const constCenter = ref(['', '', '', ''])

const signatories = ref({
  requester: { name: auth.user?.fullname || '', date: new Date().toISOString().split('T')[0] },
  approver: { name: '', date: '' },
  payer1: { name: '', date: '' },
  payer2: { name: '', date: '' },
  checker: { name: '', date: '' }
})

// ─── Modal & Saving State ───────────────────────────────────────────────────
const saving = ref(false)
const showSuccessModal = ref(false)
const generatedRequestId = ref(null)
const isBillView = ref(false)

// ─── Items from cart (editable) ─────────────────────────────────────────────
const formItems = ref([])

onMounted(() => {
  if (props.cartItems.length > 0) {
    formItems.value = props.cartItems.map(item => ({
      id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      amount: item.amount,
      unit: item.unit,
      category_id: item.category_id,
      unit_price: '',
      total: '',
      is_return: false,
      remark: ''
    }))
  }
})

const totalAmount = computed(() =>
  props.cartItems.reduce((sum, i) => sum + i.amount, 0)
)

// ─── Helper: Load Barcode Library ───────────────────────────────────────────
function loadJsBarcode() {
  return new Promise((resolve, reject) => {
    if (window.JsBarcode) { resolve(window.JsBarcode); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js'
    s.onload  = () => resolve(window.JsBarcode)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ─── Logic ──────────────────────────────────────────────────────────────────
async function handleSubmit() {
  if (props.cartItems.length === 0) return
  
  saving.value = true
  try {
    // 1. Generate Request ID (Timestamp based for uniqueness in this context)
    const reqId = Math.floor(Date.now() / 1000)
    generatedRequestId.value = reqId

    // 2. Prepare Purpose String
    const purposes = []
    if (withdrawReasons.value.broken) purposes.push('ขาดไม่ได้ระดับ')
    if (withdrawReasons.value.pm) purposes.push(`ทำ PM วาระ ${withdrawReasons.value.pmDetail}`)
    if (withdrawReasons.value.rust) purposes.push('มีอาการรั่วซึม')
    if (withdrawReasons.value.colorFade) purposes.push('สึกหรอตามอายุการใช้งาน')
    if (withdrawReasons.value.colorMismatch) purposes.push('เชื่อมพอกกันสึกหรอ')
    if (withdrawReasons.value.cracked) purposes.push('มีการแตกร้าว')
    if (withdrawReasons.value.reserve) purposes.push('เป็นอะไหล่สำรอง')
    if (withdrawReasons.value.damageLoss) purposes.push('อาไหล่สูญหาย')
    if (withdrawReasons.value.fromAccident) purposes.push('จากอุบัติเหตุ')
    if (withdrawReasons.value.changeOther) purposes.push('แก้ไข/ดัดแปลง')
    if (withdrawReasons.value.preventAccident) purposes.push('ป้องกันเกิดอุบัติเหตุ')
    if (withdrawReasons.value.clean) purposes.push('ทำความสะอาด')
    if (withdrawReasons.value.officeTool) purposes.push('อุปกรณ์สำนักงาน')
    if (withdrawReasons.value.other1) purposes.push(withdrawReasons.value.other1Detail)
    if (withdrawReasons.value.other2) purposes.push(withdrawReasons.value.other2Detail)
    
    const withdrawPurpose = purposes.join(', ')

    // 3. Prepare orders to insert
    const orders = formItems.value.map(item => ({
      request_id: reqId,
      item_id: item.id,
      amount: item.amount,
      unit: item.unit,
      category_id: item.category_id,
      status: 'pending',
      mr_number: mrNumber.value,
      company: selectedCompany.value,
      fixed_bill_number: repairCode.value,
      metter_hour: meterFrom.value,
      metter_kilometter: meterTo.value,
      withdraw_purpose: withdrawPurpose,
      remark: item.remark,
      is_return: item.is_return,
      note: `หมายเลขเครื่องจักร: ${referenceNumber.value}\nสาเหตุทดแทน: ${replaceReason.value}`,
      receive_by: null,
      inspector_by: null,
      created_by: auth.user.id,
      expire_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }))

    const { error } = await supabase.from('order_req').insert(orders)
    if (error) throw error

    showSuccessModal.value = true
  } catch (err) {
    console.error('Error submitting order:', err.message)
    alert('เกิดข้อผิดพลาด: ' + err.message)
  } finally {
    saving.value = false
  }
}

async function generateBill() {
  showSuccessModal.value = false
  isBillView.value = true
  
  await nextTick()
  if (generatedRequestId.value) {
    try {
      const barcodeLib = await loadJsBarcode()
      barcodeLib("#barcode", generatedRequestId.value.toString(), {
        format: "CODE128",
        width: 1.5,
        height: 40,
        displayValue: true,
        fontSize: 12,
        margin: 0
      })
    } catch (err) {
      console.error('Failed to load JsBarcode:', err)
    }
  }
}

function exportToPdf() {
  window.print()
}

function finishAndBack() {
  emit('back')
}

</script>

<template>
  <div class="min-h-screen bg-gray-100 dark:bg-slate-950 py-6 px-4">

    <!-- ── Action Bar ── -->
    <div class="max-w-[960px] mx-auto flex items-center justify-between mb-4 print:hidden">
      <button
        @click="$emit('back')"
        class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 text-[14px] font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all shadow-sm"
      >
        <i class="fa-solid fa-chevron-left text-[12px]"></i>
        ย้อนกลับ
      </button>
      <button
        @click="handleSubmit"
        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-bold shadow-md shadow-blue-500/25 transition-all active:scale-[0.98]"
      >
        <i class="fa-solid fa-file-circle-check text-[14px]"></i>
        สร้างใบเบิกพัสดุ
      </button>
    </div>

    <!-- ── Paper Form ── -->
    <div class="paper-scroll-wrap scrollbar-overlay-x">
      <div class="paper-sheet bg-white dark:bg-white text-gray-900 shadow-xl rounded-lg overflow-hidden font-['Niramit',sans-serif] text-[9px]" style="color: #111;">

        <div class="p-6 pb-1 pt-2.7">

        <!-- ── Header ── -->
        <div class="relative flex items-stretch gap-3 mb-0">
        
          <!-- Left: Logos + MR/วันที่ + Withdraw Type -->
          <div class="flex-1 min-w-0 flex flex-col z-10">
            <!-- Logos row -->
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

            <!-- เลขที่ MR / วันที่ -->
            <div class="mt-0.3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold whitespace-nowrap text-[9px]">เลขที่ MR</span>
                <input v-model="mrNumber" class="flex-1 max-w-[189px] border-b border-gray-400 outline-none text-[9px] px-1" style="background:transparent;"/>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-semibold whitespace-nowrap text-[9px]">วันที่</span>
                <input v-model="formDate" type="date" class="border-b border-gray-400 outline-none text-[9px] px-1 w-52" style="background:transparent;" />
              </div>
            </div>

            <!-- Withdraw Type -->
            <div class="flex items-center gap-5 mt-auto pt-0.3 text-[9px]">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawType.forSale" class="w-3 h-3 accent-gray-700" />
                เบิกเพื่อขาย
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawType.newWithdraw" class="w-3 h-3 accent-gray-700" />
                เบิกใหม่
              </label>
              <div class="flex items-center gap-1.5">
                <span class="whitespace-nowrap">ทดแทนของเก่า : สาเหตุ</span>
                <input v-model="replaceReason" class="border-b border-gray-400 outline-none text-[9px] px-1 flex-1 min-w-[276px]" style="background:transparent;" />
              </div>
            </div>
          </div>

          <!-- ใบเบิกพัสดุ — absolute กลางหน้าจริงๆ -->
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h1 class="text-[18px] font-bold tracking-wide" style="color: #111;">ใบเบิกพัสดุ</h1>
          </div>

          <!-- Right: FM code + checkbox บริษัท + CONST CENTER -->
          <div class="shrink-0 z-10">
            <div class="text-[9px] text-gray-500 mb-0.2 text-right">FM-MT-ST01-02 REV 03 - 09/04/2669</div>
            <div class="border border-gray-400 p-0.5 text-[9px] min-w-[150px]">
              <div v-for="(label, idx) in ['รถเจาะไทย','ซั่นนี่ เฟอติไลเซอร์','ปู่รากหญ้า','ที่ดี พึกษ์','ที่ดี คอนแทรคเตอร์','ไทดริว ลาว','อื่นๆ แมชชีน']" :key="idx"
                class="flex items-center gap-1.5 leading-[1.2]">
                <input type="radio" name="company" :value="label" v-model="selectedCompany" class="w-2 h-2 accent-gray-700" />
                <span>{{ label }}</span>
              </div>
              <div class="flex items-center gap-1 mt-0.2 pt-0.3 border-t border-gray-300">
                <span class="text-[10px]">CONST CENTER</span>
                <div class="flex gap-1 ml-1">
                  <input v-for="i in 5" :key="i" v-model="constCenter[i-1]" maxlength="2"
                    class="w-3 h-3 border border-gray-400 text-center text-[9px] outline-none" style="background:transparent;" />
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ── Withdraw Type ── -->
        <!-- <div class="flex items-center gap-6 mb-3 text-[13px]">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="withdrawType.forSale" class="w-3.5 h-3.5 accent-gray-700" />
            เบิกเพื่อขาย
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="withdrawType.newWithdraw" class="w-3.5 h-3.5 accent-gray-700" />
            เบิกใหม่
          </label>
          <div class="flex items-center gap-1.5">
            <span>กดแทนของเก่า : สาเหตุ</span>
            <input v-model="replaceReason" class="border-b border-gray-400 outline-none text-[13px] px-1 flex-1 min-w-[180px]" style="background:transparent;" />
          </div>
        </div> -->

        <!-- ── Repair Code / Reference ── -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 text-[9px]">
          <div class="flex items-center gap-1">
            <span class="font-semibold">รหัสใบสั่งช่อม</span>
            <input v-model="repairCode" class="border-b border-gray-400 outline-none w-28" style="background:transparent;" />
          </div>
          <div class="flex items-center gap-1">
            <span>หมายเลขเครื่องจักร</span>
            <input v-model="referenceNumber" class="border-b border-gray-400 outline-none w-28" style="background:transparent;" />
          </div>
          <div class="flex items-center gap-1">
            <span>มิเตอร์ (ชม.)</span>
            <input v-model="meterFrom" class="border-b border-gray-400 outline-none px-1 w-20" style="background:transparent;" />
          </div>
          <div class="flex items-center gap-1">
            <span>มิเตอร์ (กม.)</span>
            <input v-model="meterTo" class="border-b border-gray-400 outline-none px-1 w-20" style="background:transparent;" />
          </div>
        </div>

        <!-- ── Withdraw Reasons ── -->
        <div class="border border-gray-300 rounded p-0.5 mb-0.8">
          <div class="font-semibold mb-1 text-[9px]">จุดประสงค์การเบิก</div>
          <div class="grid grid-cols-5 gap-x-4 gap-y-1 text-[9px]">

            <!-- Col 1 -->
            <div class="space-y-1">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.broken" class="w-3 h-3 accent-gray-700" />
                ขาดไม่ได้ระดับ
              </label>
              <div class="flex items-center gap-1.5">
                <input type="checkbox" v-model="withdrawReasons.pm" class="w-3 h-3 accent-gray-700 shrink-0" />
                <span>ทำ PM วาระ</span>
                <input v-model="withdrawReasons.pmDetail" class="border-b border-gray-300 outline-none px-0.5 flex-1 min-w-0 text-[11px]" style="background:transparent;" />
              </div>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.rust" class="w-3 h-3 accent-gray-700" />
                มีอาการรั่วซึม
              </label>
            </div>

            <!-- Col 2 -->
            <div class="space-y-1">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.colorFade" class="w-3 h-3 accent-gray-700" />
                สึกหรอตามอายุการใช้งาน
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.colorMismatch" class="w-3 h-3 accent-gray-700" />
                เชื่อมพอกกันสึกหรอ
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.cracked" class="w-3 h-3 accent-gray-700" />
                มีการแตกร้าว
              </label>
            </div>

            <!-- Col 3 -->
            <div class="space-y-1">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.reserve" class="w-3 h-3 accent-gray-700" />
                เป็นอะไหล่สำรอง
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.damageLoss" class="w-3 h-3 accent-gray-700" />
                อาไหล่สูญหาย
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.fromAccident" class="w-3 h-3 accent-gray-700" />
                จากอุบัติเหตุ
              </label>
            </div>

            <!-- Col 4 -->
            <div class="space-y-1">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.changeOther" class="w-3 h-3 accent-gray-700" />
                แก้ไข/ดัดแปลง
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.preventAccident" class="w-3 h-3 accent-gray-700" />
                ป้องกันเกิดอุบัติเหตุ
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.clean" class="w-3 h-3 accent-gray-700" />
                ทำความสะอาด
              </label>
            </div>

            <!-- Col 5 -->
            <div class="space-y-1">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="withdrawReasons.officeTool" class="w-3 h-3 accent-gray-700" />
                อุปกรณ์สำนักงาน
              </label>
              <div class="flex items-center gap-1">
                <input type="checkbox" v-model="withdrawReasons.other1" class="w-3 h-3 accent-gray-700 shrink-0" />
                <span>อื่นๆ</span>
                <input v-model="withdrawReasons.other1Detail" class="border-b border-gray-300 outline-none px-0.5 flex-1 min-w-0 text-[9px]" style="background:transparent;" />
              </div>
              <div class="flex items-center gap-1">
                <input type="checkbox" v-model="withdrawReasons.other2" class="w-3 h-3 accent-gray-700 shrink-0" />
                <span>อื่นๆ</span>
                <input v-model="withdrawReasons.other2Detail" class="border-b border-gray-300 outline-none px-0.5 flex-1 min-w-0 text-[9px]" style="background:transparent;" />
              </div>
            </div>

          </div>
        </div>

        <!-- ── Items Table ── -->
        <table class="w-full border-collapse text-[9px] mb-0.5">
          <thead>
            <tr>
              <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-5 bg-gray-300">ลำดับ</th>
              <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-21 bg-gray-300">รหัสสินค้า</th>
              <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-29 bg-gray-300">รายการ</th>
              <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-26 bg-gray-300">จำนวน (เบิก)</th>
              <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-28 bg-gray-300">จำนวนเงิน</th>
              <!-- <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-20 bg-gray-300">รวม</th> -->
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
            <!-- Cart items — read only -->
            <tr v-for="(item, idx) in formItems" :key="idx" class="bg-blue-50/40">
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ idx + 1 }}</td>
              <td class="border border-gray-400 px-1 py-1 text-center font-mono text-[9px]">{{ item.item_code }}</td>
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.item_name }}</td>
              <td class="border border-gray-400 px-1 py-1 text-center font-bold text-blue-700 text-[9px]">{{ item.amount }}</td>
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ item.unit }}</td>
              <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
              <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                <input 
                  type="checkbox" 
                  :checked="item.is_return === true" 
                  @change="item.is_return = true"
                  class="w-3 h-3 accent-blue-600" 
                />
              </td>
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                <input 
                  type="checkbox" 
                  :checked="item.is_return === false" 
                  @change="item.is_return = false"
                  class="w-3 h-3 accent-blue-600" 
                />
              </td>
              <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                <input v-model="item.remark" class="w-full outline-none text-[9px]" style="background:transparent;" />
              </td>
            </tr>

            <!-- Empty rows to fill up to at least 4 rows total -->
            <tr v-for="n in Math.max(0, 4 - formItems.length)" :key="'empty-' + n">
              <td class="border border-gray-400 px-1 py-1 text-center text-gray-400">{{ formItems.length + n }}</td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
              <td class="border border-gray-400 px-1 py-1"></td>
            </tr>

            <!-- Total row -->
            <tr class="bg-gray-50 font-semibold">
              <td colspan="3" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-200">รวม</td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center text-blue-700">{{ totalAmount }}</td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
              <td class="border border-gray-400 px-0.5 py-0.5"></td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
              <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
            </tr>
          </tbody>
        </table>

        <!-- ── Signatories ── -->
        <table class="w-full border-collapse text-[9px] mb-1">
          <thead>
            <tr>
              <th class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">ผู้เบิก</th>
              <th class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">ผู้อนุมัต</th>
              <th class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">ผู้จ่าย</th>
              <th class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">ผู้รับ</th>
              <th class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">ผู้ตรวจสอบ/หน.พัสดุ</th>
            </tr>
          </thead>
          <tbody>
            <!-- Signature space -->
            <tr>
              <td v-for="key in ['requester','approver','payer1','payer2','checker']" :key="key"
                class="border border-gray-400 px-0.5 py-0" style="height:40px; vertical-align:top;">
                <textarea
                  v-model="signatories[key].name"
                  rows="2"
                  placeholder=""
                  :readonly="key === 'requester'"
                  :disabled="key !== 'requester'"
                  class="w-full h-full resize-none outline-none text-[9px] pt-0.5 disabled:bg-gray-100/50"
                  style="background:transparent;"
                ></textarea>
              </td>
            </tr>
            <!-- Name row -->
            <tr>
              <td v-for="key in ['requester','approver','payer1','payer2','checker']" :key="'n-'+key"
                class="border border-gray-400 px-0.5 py-0.2">
                <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                <input
                  v-model="signatories[key].name"
                  :readonly="key === 'requester'"
                  :disabled="key !== 'requester'"
                  class="w-full border-b border-gray-300 outline-none text-[9px] pb-0.2 disabled:bg-gray-100/50"
                  style="background:transparent;"
                />
              </td>
            </tr>
            <!-- Date row -->
            <tr>
              <td v-for="key in ['requester','approver','payer1','payer2','checker']" :key="'d-'+key"
                class="border border-gray-400 px-0.2 py-0.1">
                <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                <input
                  v-model="signatories[key].date"
                  type="date"
                  :readonly="key === 'requester'"
                  :disabled="key !== 'requester'"
                  class="w-full outline-none text-[9px] pb-0.1 disabled:bg-gray-100/50"
                  style="background:transparent;"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <!-- ── Note ── -->
        <div class="flex items-end justify-between">
          <div class="text-[10px]">
            <span class="font-bold underline">หมายเหตุ : กรณีเบิกใช้งานช่อมต้องแนบใบแจ้งช่อมทุกครั้ง</span>
          </div>
          
          <!-- Barcode Area (Only show when bill is generated) -->
          <div v-show="isBillView" class="flex flex-col items-center">
            <svg id="barcode"></svg>
          </div>
        </div>

        </div>
      </div>
    </div>

    <!-- ── Success Modal ── -->
    <Transition name="modal-fade">
      <div v-if="showSuccessModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
        <div class="relative bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border border-gray-100 dark:border-slate-800">
          <div class="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600 dark:text-green-400">
            <i class="fa-solid fa-check text-[40px]"></i>
          </div>
          <h3 class="text-[20px] font-bold text-gray-800 dark:text-gray-100 mb-2">บันทึกสำเร็จ!</h3>
          <p class="text-gray-500 dark:text-gray-400 mb-8 text-[14px]">ระบบได้บันทึกใบเบิกพัสดุของคุณเรียบร้อยแล้ว (Request ID: {{ generatedRequestId }})</p>
          
          <div class="flex flex-col gap-3">
            <button @click="generateBill" class="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-500/25">
              <i class="fa-solid fa-file-invoice mr-2"></i>
              สร้างใบบิล
            </button>
            <button @click="finishAndBack" class="w-full py-3.5 rounded-2xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-200 transition-all">
              กลับ
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Bill Action Bar (Only show in Bill View) ── -->
    <div v-if="isBillView" class="max-w-[960px] mx-auto flex justify-center gap-4 mt-6 print:hidden">
      <button @click="exportToPdf" class="px-8 py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-lg shadow-teal-500/25 transition-all">
        <i class="fa-solid fa-file-pdf mr-2"></i>
        ส่งออกเป็น PDF / พิมพ์
      </button>
      <button @click="finishAndBack" class="px-8 py-3.5 rounded-2xl bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-gray-300 font-bold hover:bg-gray-300 transition-all">
        เสร็จสิ้น
      </button>
    </div>

    <!-- ── Bottom action (mobile) ── -->
    <div v-if="!isBillView && !showSuccessModal" class="max-w-[960px] mx-auto flex justify-end mt-4 print:hidden">
      <button
        @click="handleSubmit"
        class="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-bold shadow-lg shadow-blue-500/25 transition-all active:scale-[0.98]"
      >
        <i class="fa-solid fa-file-circle-check"></i>
        สร้างใบเบิกพัสดุ
      </button>
    </div>

  </div>
</template>

<style scoped>
input[type="date"]::-webkit-calendar-picker-indicator {
  opacity: 0.4;
  cursor: pointer;
}
input::placeholder,
textarea::placeholder {
  color: #bbb;
}
table input, table textarea {
  display: block;
}
.modal-fade-enter-active, .modal-fade-leave-active { transition: all 0.3s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: scale(0.95); }

.paper-scroll-wrap {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  overflow-x: auto;
  overflow-x: overlay;
  overflow-y: visible;
  padding-bottom: 0;
  scrollbar-gutter: auto;
  -webkit-overflow-scrolling: touch;
}

.paper-sheet {
  width: 960px;
  min-width: 960px;
  margin: 0 auto;
}

@media (max-width: 960px) {
  .paper-scroll-wrap {
    border-radius: 12px;
  }

  .paper-sheet {
    margin: 0;
  }
}

@media print {
  .print\:hidden { display: none !important; }
  body { background: white !important; }
  .min-h-screen { padding: 0 !important; background: white !important; }
  .paper-scroll-wrap { overflow: visible !important; max-width: none !important; padding-bottom: 0 !important; }
  .paper-sheet { width: auto !important; min-width: 0 !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
}
</style>
