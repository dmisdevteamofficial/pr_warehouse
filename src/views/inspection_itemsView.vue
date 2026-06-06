<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Assets สำหรับใบบิน
import logoThaiDrill from '@/assets/thaidrill_company.png'
import logoSunnyFertilizer from '@/assets/sunny_fertilizer.png'
import logoPuiRakYa from '@/assets/puirakyar.png'
import logoTdFix from '@/assets/tdfix.png'
import logoTdContractor from '@/assets/tdcontractor.png'
import logoSunnyGreenFarm from '@/assets/sunny_green_farm.png'
import logoThaiDrillLao from '@/assets/thaidrillLao_company.png'
import logoSunny from '@/assets/sunnycompany.png'

const ui = useUiStore()
const auth = useAuthStore()

const loading = ref(false)
const inspections = ref([])
const searchText = ref('')
const barcodeInput = ref('')
const barcodeField = ref(null)

// --- สำหรับการแสดงใบบินขนาดเต็ม ---
const selectedInspection = ref(null)
const showBillModal = ref(false)

function openFullBill(ins) {
  selectedInspection.value = ins
  showBillModal.value = true
  document.body.style.overflow = 'hidden'
}

function closeFullBill() {
  showBillModal.value = false
  selectedInspection.value = null
  document.body.style.overflow = ''
}

// --- สำหรับการดูรูปภาพขนาดเต็ม ---
const showImageLightbox = ref(false)
const lightboxImageUrl = ref('')

function openLightbox(url) {
  lightboxImageUrl.value = url
  showImageLightbox.value = true
}

function closeLightbox() {
  showImageLightbox.value = false
  lightboxImageUrl.value = ''
}

const companyTopOptions = [
  'รถเจาะไทย',
  'ซันนี่ เฟอติไลเซอร์',
  'ปุ๋ยรากหญ้า',
  'ทีดี ฟิกซ์',
  'ทีดี คอนแทรคเตอร์',
  'ซันนี่ กรีน ฟาร์ม',
  'ไทยดิว ลาว',
  'ซันนี่ แมชีนเนอรี่'
]



// --- ดึงข้อมูลจาก Supabase ---
async function fetchInspections() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select(`
        *,
        inspection_items(*),
        creator:system_users!created_by(fullname, department)
      `)
      .order('created_at', { ascending: false })

    if (error) throw error
    inspections.value = (data || []).map(ins => ({
      ...ins,
      isDownloading: false
    }))
  } catch (err) {
    console.error('Fetch error:', err)
    ui.showToast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error')
  } finally {
    loading.value = false
  }
}

// --- การกรองข้อมูล ---
const filteredInspections = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  if (!query) return inspections.value
  return inspections.value.filter(ins => {
    const idMatch = ins.id.toLowerCase().includes(query)
    const poMatch = (ins.po_number || '').toLowerCase().includes(query)
    const vendorMatch = (ins.vendor_source || '').toLowerCase().includes(query)
    return idMatch || poMatch || vendorMatch
  })
})

// --- ระบบ Barcode ---
const barcodeBuffer = ref('')
let lastKeyTime = Date.now()

function handleGlobalKeydown(e) {
  // ตรวจสอบว่าไม่ได้กำลังพิมพ์ใน input อื่นๆ
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.target === barcodeField.value) {
      // ถ้าเป็น barcode field ให้ทำงานตามปกติ
    } else {
      return
    }
  }

  const currentTime = Date.now()
  if (currentTime - lastKeyTime > 100) {
    barcodeBuffer.value = ''
  }
  lastKeyTime = currentTime

  if (e.key === 'Enter') {
    if (barcodeBuffer.value.length > 2) {
      barcodeInput.value = barcodeBuffer.value
      handleBarcodeScan()
      barcodeBuffer.value = ''
    }
  } else if (e.key.length === 1) {
    barcodeBuffer.value += e.key
  }
}

async function handleBarcodeScan() {
  const code = barcodeInput.value.trim()
  if (!code) return
  
  loading.value = true
  try {
    // 1. ค้นหาและกรองในหน้าจอทันที (ใช้ตัวพิมพ์เล็กเพื่อการเปรียบเทียบ)
    searchText.value = code
    
    // 2. ตรวจสอบว่ามีข้อมูลใน memory (inspections) หรือไม่
    const exists = inspections.value.some(ins => {
      const idMatch = ins.id.toLowerCase().includes(code.toLowerCase())
      const poMatch = (ins.po_number || '').toLowerCase().includes(code.toLowerCase())
      const invMatch = (ins.vendor_invoice_no || '').toLowerCase().includes(code.toLowerCase())
      return idMatch || poMatch || invMatch
    })

    // 3. ถ้าไม่พบใน memory ให้ดึงจากฐานข้อมูล
    if (!exists) {
      let query = supabase
        .from('inspections')
        .select('*, inspection_items(*), creator:system_users!created_by(fullname, department)')

      // ตรวจสอบว่าเป็น UUID หรือไม่ (ถ้าใช่ค้นหาที่ ID, ถ้าไม่ใช่ค้นหาที่ PO/Invoice)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
      
      if (isUUID) {
        query = query.eq('id', code)
      } else {
        // ค้นหาแบบกว้าง (Partial match) ใน PO, Invoice และชื่อผู้ขาย
        query = query.or(`po_number.ilike.%${code}%,vendor_invoice_no.ilike.%${code}%,vendor_source.ilike.%${code}%`)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) throw error
      
      if (data && data.length > 0) {
        const newItems = data.map(ins => ({ ...ins, isDownloading: false }))
        // เพิ่มรายการใหม่เข้าไปใน list
        newItems.forEach(newItem => {
          if (!inspections.value.find(existing => existing.id === newItem.id)) {
            inspections.value.unshift(newItem)
          }
        })
        ui.showToast(`พบข้อมูลใหม่ ${data.length} รายการ`, 'success')
        
        // ถ้าสแกนเจอใบเดียว ให้เปิดขึ้นมาแสดงทันที
        if (data.length === 1) {
          openFullBill(data[0])
        }
      } else {
        ui.showToast('ไม่พบข้อมูลใบตรวจรับในระบบ', 'warning')
      }
    } else {
      // ถ้ามีอยู่ใน list แล้ว และกรองออกมาเจอใบเดียว ให้เปิดขึ้นมาเลย
      const filtered = filteredInspections.value
      if (filtered.length === 1) {
        openFullBill(filtered[0])
      }
    }
    
    barcodeInput.value = ''
  } catch (err) {
    console.error('Barcode Scan Error:', err)
    ui.showToast('เกิดข้อผิดพลาดในการค้นหา: ' + err.message, 'error')
  } finally {
    loading.value = false
  }
}



// --- ฟังก์ชันดาวน์โหลด PDF (High Quality Scale 4) ---
async function downloadPDF(ins, element) {
  if (!element) return
  ins.isDownloading = true
  try {
    await nextTick()
    const canvas = await html2canvas(element, {
      scale: 4,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: 794,
      windowWidth: 794,
      onclone: (clonedDoc) => {
        const clonedEl = clonedDoc.querySelector('.bill-to-print')
        if (clonedEl) {
          clonedEl.style.boxShadow = 'none'
          clonedEl.style.width = '794px'
          clonedEl.style.transform = 'none'
          
          const tables = clonedEl.querySelectorAll('table')
          tables.forEach(t => {
            t.style.borderCollapse = 'collapse'
            t.style.width = '100%'
            t.style.tableLayout = 'fixed'
            t.style.border = '1.5px solid black'
          })
          
          const allCells = clonedEl.querySelectorAll('th, td')
          allCells.forEach(cell => {
            cell.style.border = '1px solid black'
            cell.style.backgroundColor = 'white'
            cell.style.color = 'black'
            cell.style.padding = '4px'
          })
        }
      }
    })

    const imgData = canvas.toDataURL('image/jpeg', 1.0)
    const pdf = new jsPDF({ 
      orientation: 'portrait', 
      unit: 'mm', 
      format: 'a4', 
      compress: true 
    })
    
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    const fileName = `Inspection-${ins.po_number || ins.id.slice(0,8)}.pdf`
    pdf.save(fileName)
    ui.showToast('ดาวน์โหลด PDF สำเร็จ', 'success')
  } catch (err) {
    console.error('PDF Error:', err)
    ui.showToast('สร้าง PDF ไม่สำเร็จ: ' + err.message, 'error')
  } finally {
    ins.isDownloading = false
  }
}

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

onMounted(() => {
  fetchInspections()
  window.addEventListener('keydown', handleGlobalKeydown)
  if (barcodeField.value) barcodeField.value.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <AppLayout title="ประวัติการตรวจรับพัสดุ">
    <div class="p-6 bg-gray-200 min-h-screen">
      <!-- Header & Tools -->
      <div class="max-w-[1600px] mx-auto mb-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 class="text-2xl font-bold text-gray-800">ประวัติการตรวจรับพัสดุ</h1>
            <p class="text-sm text-gray-500">แสดงข้อมูลรายการใบตรวจรับทั้งหมดในรูปแบบใบบิน</p>
          </div>
          
          <div class="flex flex-wrap gap-3 w-full md:w-auto">
            <!-- Barcode Search -->
            <div class="relative flex-1 md:flex-none md:w-64">
              <i class="fa-solid fa-barcode absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input 
                v-model="barcodeInput"
                @keyup.enter="handleBarcodeScan"
                ref="barcodeField"
                type="text" 
                placeholder="สแกน Barcode / เลข PO..."
                class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm"
              />
            </div>

            <!-- Text Search -->
            <div class="relative flex-1 md:flex-none md:w-64">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input 
                v-model="searchText"
                type="text" 
                placeholder="ค้นหาผู้ขาย / เลขที่..."
                class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm"
              />
            </div>

            <button @click="fetchInspections" class="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
              <i class="fa-solid fa-arrows-rotate" :class="{'fa-spin': loading}"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Main Content: Bills Grid -->
      <div class="max-w-[1600px] mx-auto">
        <div v-if="loading" class="flex flex-col items-center py-20 text-gray-500">
          <i class="fa-solid fa-spinner fa-spin text-4xl mb-4"></i>
          <p class="italic">กำลังโหลดข้อมูลใบบิน...</p>
        </div>

        <div v-else-if="filteredInspections.length === 0" class="flex flex-col items-center py-20 text-gray-400 bg-white rounded-2xl w-full shadow-sm border">
          <i class="fa-solid fa-file-circle-xmark text-5xl mb-4"></i>
          <p class="italic">ไม่พบประวัติการตรวจรับ</p>
        </div>

        <!-- Grid Layout (Modern Cards) -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
          <div 
            v-for="ins in filteredInspections" 
            :key="ins.id"
            class="group bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 hover:shadow-xl hover:border-blue-500/50 transition-all cursor-pointer relative overflow-hidden"
            @click="openFullBill(ins)"
          >
            <!-- Top Section: Bill Preview (Half height) -->
            <div class="relative h-48 bg-gray-50 overflow-hidden border-b border-gray-100 flex justify-center">
              <!-- Date Badge on Image -->
              <div class="absolute top-3 right-3 z-10 bg-white/90 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-bold text-gray-700 shadow-sm border border-gray-100">
                {{ formatDate(ins.inspection_date) }}
              </div>

              <!-- True Miniature Preview (Centered and Scaled to show Top Part) -->
              <div class="origin-top scale-[0.45] mt-2 shadow-sm" style="width: 210mm; pointer-events: none;">
                <div class="bg-white" style="width: 210mm; height: 140mm; padding: 5mm; overflow: hidden;">
                  <div style="border: 2px solid black; height: 100%; display: flex; flex-direction: column; background: white;">
                    <!-- Header with ALL Logos (Exactly like the image) -->
                    <div style="border-bottom: 1px solid black; padding: 6px; background-color: white;">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="display: flex; gap: 4px; align-items: center;">
                          <img :src="logoThaiDrill" style="height: 24px; width: auto;" />
                          <img :src="logoSunnyFertilizer" style="height: 24px; width: auto;" />
                          <img :src="logoPuiRakYa" style="height: 24px; width: auto;" />
                          <img :src="logoTdFix" style="height: 24px; width: auto;" />
                          <img :src="logoTdContractor" style="height: 24px; width: auto;" />
                          <img :src="logoSunnyGreenFarm" style="height: 24px; width: auto;" />
                          <img :src="logoThaiDrillLao" style="height: 24px; width: auto;" />
                          <img :src="logoSunny" style="height: 24px; width: auto;" />
                        </div>
                        <div style="text-align: right; font-size: 7px; line-height: 1.2;">FM-HO-PC01-07<br/>REV.01 - 17/10/2567</div>
                      </div>
                      <div style="text-align: center; margin-top: 4px;">
                        <div style="font-size: 14px; font-weight: bold;">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
                        <div style="font-size: 11px; font-weight: bold;">(Inspection Memo)</div>
                      </div>
                      <!-- Company Checkboxes -->
                      <div style="display: flex; justify-content: space-around; font-size: 7px; margin-top: 8px; border-top: 1px solid black; padding-top: 5px;">
                        <div v-for="t in companyTopOptions" :key="t" style="display: flex; align-items: center; gap: 2px;">
                          <div style="width: 9px; height: 9px; border: 1px solid black; background: white; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                            <i v-if="ins.company_selections?.[t]" class="fa-solid fa-check" style="font-size: 7px;"></i>
                          </div>
                          <span>{{ t }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Doc Type & Info Section -->
                    <div style="display: flex; border-bottom: 1px solid black; background-color: white;">
                      <div style="width: 50%; padding: 8px; border-right: 1px solid black; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <div v-for="(val, key) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="key" style="display: flex; align-items: center; gap: 8px;">
                          <div style="width: 12px; height: 12px; border: 1px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                            <i v-if="ins.doc_type?.[key]" class="fa-solid fa-check" style="font-size: 9px;"></i>
                          </div>
                          <span style="font-size: 11px;">{{ val }}</span>
                        </div>
                      </div>
                      <div style="width: 50%; padding: 8px; font-size: 11px;">
                        <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                          <span style="width: 90px;">วันที่ตรวจรับ</span>
                          <div style="flex: 1; border-bottom: 1px solid black; text-align: center; font-weight: bold;">{{ formatDate(ins.inspection_date) }}</div>
                        </div>
                        <div style="display: flex; align-items: flex-end;">
                          <span style="width: 90px;">เลขที่ใบแจ้งซ่อม</span>
                          <div style="flex: 1; border-bottom: 1px solid black; text-align: center; font-weight: bold;">{{ ins.repair_bill_no }}</div>
                        </div>
                      </div>
                    </div>

                    <!-- Seller & Order Info -->
                    <div style="display: flex; border-bottom: 1px solid black; font-size: 11px; background-color: white;">
                      <div style="width: 50%; padding: 8px; border-right: 1px solid black;">
                        <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                          <span style="width: 120px;">สินค้ามาจากผู้ขาย</span>
                          <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; padding-left: 6px;">{{ ins.vendor_source }}</div>
                        </div>
                        <div style="display: flex; align-items: flex-end;">
                          <span style="width: 120px;">สถานที่จัดส่ง</span>
                          <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; padding-left: 6px;">{{ ins.delivery_place }}</div>
                        </div>
                      </div>
                      <div style="width: 50%; padding: 8px;">
                        <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                          <span style="width: 120px;">หมายเลขใบสั่งซื้อ</span>
                          <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; text-align: center;">{{ ins.po_number }}</div>
                        </div>
                        <div style="display: flex; align-items: flex-end;">
                          <span style="width: 120px;">แผนกที่ตรวจรับ</span>
                          <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; text-align: center;">{{ ins.receiving_dept }}</div>
                        </div>
                      </div>
                    </div>

                    <!-- Table Header Preview -->
                    <div style="flex: 1; background: white;">
                      <table style="width: 100%; border-collapse: collapse; table-layout: fixed; border-bottom: 1px solid black;">
                        <thead>
                            <tr style="background: #f3f4f6; font-weight: bold; text-align: center; font-size: 9px; height: 25px;">
                            <td style="border: 1px solid black; width: 35px;">ลำดับ</td>
                            <td style="border: 1px solid black; width: 95px;">รหัสสินค้า</td>
                            <td style="border: 1px solid black;">รายการ</td>
                            <td style="border: 1px solid black; width: 40px;">รับจริง</td>
                            <td style="border: 1px solid black; width: 40px;">หน่วย</td>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="i in 5" :key="i" style="height: 20px; border-bottom: 1px solid #eee;">
                            <td style="border-right: 1px solid black;"></td>
                            <td style="border-right: 1px solid black;"></td>
                            <td style="border-right: 1px solid black;"></td>
                            <td style="border-right: 1px solid black;"></td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Hover Overlay -->
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
            </div>

            <!-- Bottom Section: Info -->
            <div class="p-4 flex flex-col flex-1 gap-1">
              <div class="flex justify-between items-start mb-1">
                <h3 class="font-bold text-gray-800 text-[13px] line-clamp-1 flex-1">
                  {{ ins.inspection_items?.[0]?.item_name || 'ใบตรวจรับพัสดุ' }}
                  <span v-if="(ins.inspection_items?.length || 0) > 1" class="text-gray-400 font-normal">
                    ({{ ins.inspection_items.length }} รายการ)
                  </span>
                </h3>
                <span class="bg-amber-50 text-amber-600 text-[9px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ml-2 uppercase">
                  ตรวจรับแล้ว
                </span>
              </div>

              <!-- Item Names Subtitle (Blue link style) -->
              <p class="text-[10px] text-blue-600 line-clamp-1 mb-2 font-medium">
                {{ ins.inspection_items?.map(it => it.item_name).join(', ') }}
              </p>

              <div class="mt-auto pt-2 border-t border-gray-50 flex justify-between items-center">
                <div class="text-[10px] text-gray-400 flex items-center gap-1">
                  <span>วันที่ตรวจ:</span>
                  <span class="text-gray-500 font-medium">{{ formatDate(ins.inspection_date) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Full Bill Modal -->
    <div v-if="showBillModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <!-- Modal Header -->
        <div class="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <i class="fa-solid fa-file-invoice text-xl"></i>
            </div>
            <div>
              <h3 class="font-bold text-gray-800">รายละเอียดใบตรวจรับพัสดุ</h3>
              <p class="text-xs text-gray-500">เลขที่ PO: {{ selectedInspection?.po_number }} | ID: {{ selectedInspection?.id.slice(0,8) }}</p>
            </div>
          </div>
          <div class="flex gap-2">
            <button 
              @click="downloadPDF(selectedInspection, $refs['full_bill_' + selectedInspection.id][0])"
              :disabled="selectedInspection?.isDownloading"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <i v-if="selectedInspection?.isDownloading" class="fa-solid fa-spinner fa-spin"></i>
              <i v-else class="fa-solid fa-download"></i>
              ดาวน์โหลด PDF
            </button>
            <button @click="closeFullBill" class="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
        </div>

        <!-- Modal Body (Full Bill) -->
        <div class="flex-1 overflow-y-auto p-8 bg-gray-200 flex justify-center">
          <div 
            :ref="'full_bill_' + selectedInspection.id"
            class="bill-to-print shadow-2xl bg-white overflow-hidden mb-10"
            style="width: 210mm; min-height: 297mm; padding: 5mm; box-sizing: border-box; font-family: 'Noto Sans Thai', sans-serif; font-size: 10px; color: black; display: flex; flex-direction: column;"
          >
            <!-- (ใช้ Content ใบบินเดิมที่สมบูรณ์) -->
            <div style="border: 2px solid black; width: 100%; display: flex; flex-direction: column; flex: 1; background-color: white;">
              
              <!-- Header -->
              <div style="border-bottom: 1px solid black; padding: 6px; background-color: white;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <img :src="logoThaiDrill" style="height: 24px; width: auto;" />
                    <img :src="logoSunnyFertilizer" style="height: 24px; width: auto;" />
                    <img :src="logoPuiRakYa" style="height: 24px; width: auto;" />
                    <img :src="logoTdFix" style="height: 24px; width: auto;" />
                    <img :src="logoTdContractor" style="height: 24px; width: auto;" />
                    <img :src="logoSunnyGreenFarm" style="height: 24px; width: auto;" />
                    <img :src="logoThaiDrillLao" style="height: 24px; width: auto;" />
                    <img :src="logoSunny" style="height: 24px; width: auto;" />
                  </div>
                  <div style="text-align: right; font-size: 7px; line-height: 1.2;">FM-HO-PC01-07<br/>REV.01 - 17/10/2567</div>
                </div>
                <div style="text-align: center; margin-top: 4px;">
                  <div style="font-size: 14px; font-weight: bold;">ใบตรวจรับพัสดุ / การจ้าง / การเช่า / การบริการ</div>
                  <div style="font-size: 11px; font-weight: bold;">(Inspection Memo)</div>
                </div>
                <!-- Company Checkboxes -->
                <div style="display: flex; justify-content: space-around; font-size: 7px; margin-top: 8px; border-top: 1px solid black; padding-top: 5px; flex-wrap: nowrap;">
                  <div v-for="t in companyTopOptions" :key="t" style="display: flex; align-items: center; gap: 2px; white-space: nowrap;">
                    <div style="width: 9px; height: 9px; border: 1px solid black; display: flex; align-items: center; justify-content: center; background: white; flex-shrink: 0;">
                      <i v-if="selectedInspection.company_selections?.[t]" class="fa-solid fa-check" style="font-size: 7px;"></i>
                    </div>
                    <span style="font-size: 7px;">{{ t }}</span>
                  </div>
                </div>
              </div>

              <!-- Doc Type & Info Section -->
              <div style="display: flex; border-bottom: 1px solid black; background-color: white;">
                <div style="width: 50%; padding: 8px; border-right: 1px solid black; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  <div v-for="(val, key) in {goods:'พัสดุ', hire:'การจ้าง', rent:'การเช่า', service:'การบริการ'}" :key="key" style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 12px; height: 12px; border: 1px solid black; display: flex; align-items: center; justify-content: center; background: white;">
                      <i v-if="selectedInspection.doc_type?.[key]" class="fa-solid fa-check" style="font-size: 9px;"></i>
                    </div>
                    <span style="font-size: 11px;">{{ val }}</span>
                  </div>
                </div>
                <div style="width: 50%; padding: 8px; font-size: 11px;">
                  <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                    <span style="width: 90px;">วันที่ตรวจรับ</span>
                    <div style="flex: 1; border-bottom: 1px solid black; text-align: center; font-weight: bold;">{{ formatDate(selectedInspection.inspection_date) }}</div>
                  </div>
                  <div style="display: flex; align-items: flex-end;">
                    <span style="width: 90px;">เลขที่ใบแจ้งซ่อม</span>
                    <div style="flex: 1; border-bottom: 1px solid black; text-align: center; font-weight: bold;">{{ selectedInspection.repair_bill_no }}</div>
                  </div>
                </div>
              </div>

              <!-- Seller & Order Info -->
              <div style="display: flex; border-bottom: 1px solid black; font-size: 11px; background-color: white;">
                <div style="width: 50%; padding: 8px; border-right: 1px solid black;">
                  <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                    <span style="width: 120px;">สินค้ามาจากผู้ขาย</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; padding-left: 6px;">{{ selectedInspection.vendor_source }}</div>
                  </div>
                  <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                    <span style="width: 120px;">ใบแจ้งหนี้ผู้ขาย</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; padding-left: 6px;">{{ selectedInspection.vendor_invoice_no }}</div>
                  </div>
                  <div style="display: flex; align-items: flex-end;">
                    <span style="width: 120px;">สถานที่จัดส่ง/ให้บริการ</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; padding-left: 6px;">{{ selectedInspection.delivery_place }}</div>
                  </div>
                </div>
                <div style="width: 50%; padding: 8px;">
                  <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                    <span style="width: 120px;">หมายเลขใบสั่งซื้อ</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; text-align: center;">{{ selectedInspection.po_number }}</div>
                  </div>
                  <div style="display: flex; margin-bottom: 6px; align-items: flex-end;">
                    <span style="width: 120px;">หมายเลขใบรับสินค้า</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; text-align: center;">{{ selectedInspection.goods_receipt_no }}</div>
                  </div>
                  <div style="display: flex; align-items: flex-end;">
                    <span style="width: 120px;">แผนกที่ตรวจรับ</span>
                    <div style="flex: 1; border-bottom: 1px solid black; font-weight: bold; text-align: center;">{{ selectedInspection.receiving_dept }}</div>
                  </div>
                </div>
              </div>

              <!-- Items Table -->
              <table style="width: 100%; border-collapse: collapse; background-color: white; table-layout: fixed; border: 1px solid black; border-bottom: none;">
                <thead>
                  <tr style="background: #f3f4f6; font-weight: bold; text-align: center; font-size: 9px;">
                    <th style="border: 1px solid black; width: 35px; padding: 4px 1px;">ลำดับ</th>
                    <th style="border: 1px solid black; width: 95px; padding: 4px 1px;">รหัสสินค้า</th>
                    <th style="border: 1px solid black; width: 216px; padding: 4px 2px;">รายการ</th>
                    <th style="border: 1px solid black; width: 40px; padding: 4px 1px;">รับจริง</th>
                    <th style="border: 1px solid black; width: 40px; padding: 4px 1px;">หน่วย</th>
                    <th style="border: 1px solid black; width: 60px; padding: 4px 1px;">ราคา/หน่วย</th>
                    <th style="border: 1px solid black; width: 70px; padding: 4px 1px;">ราคารวม</th>
                    <th style="border: 1px solid black; width: 40px; padding: 4px 1px;">สั่งซื้อ</th>
                    <th style="border: 1px solid black; width: 40px; padding: 4px 1px;">คงเหลือ</th>
                    <th style="border: 1px solid black; width: 80px; padding: 4px 1px;">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, idx) in selectedInspection.inspection_items" :key="it.id" style="font-size: 9px; height: 30px;">
                    <td style="border: 1px solid black; text-align: center;">{{ idx + 1 }}</td>
                    <td style="border: 1px solid black; text-align: center; font-weight: bold;">{{ it.item_code }}</td>
                    <td style="border: 1px solid black; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ it.item_name }}</td>
                    <td style="border: 1px solid black; text-align: center;">{{ it.received_qty }}</td>
                    <td style="border: 1px solid black; text-align: center;">{{ it.unit }}</td>
                    <td style="border: 1px solid black; text-align: right; padding-right: 4px;">{{ it.unit_price?.toLocaleString() }}</td>
                    <td style="border: 1px solid black; text-align: right; padding-right: 4px; font-weight: bold;">{{ it.total_price?.toLocaleString() }}</td>
                    <td style="border: 1px solid black; text-align: center;">{{ it.ordered_qty }}</td>
                    <td style="border: 1px solid black; text-align: center;">{{ it.remaining_qty }}</td>
                    <td style="border: 1px solid black; padding: 0 4px; font-size: 8px;">{{ it.note }}</td>
                  </tr>
                  <!-- Totals Rows -->
                  <tr style="font-weight: bold; font-size: 10px;">
                    <td colspan="6" style="border: 1px solid black; text-align: right; padding-right: 10px; height: 30px;">มูลค่าสินค้าก่อน VAT</td>
                    <td style="border: 1px solid black; text-align: right; padding-right: 6px;">{{ selectedInspection.valuation?.beforeVat }}</td>
                    <td colspan="3" style="border: 1px solid black; padding-left: 8px;">{{ selectedInspection.valuation?.currency }}</td>
                  </tr>
                  <tr style="font-weight: bold; font-size: 10px;">
                    <td colspan="6" style="border: 1px solid black; text-align: right; padding-right: 10px; height: 30px;">ภาษีมูลค่าเพิ่ม {{ selectedInspection.valuation?.vatPercent }}%(VAT)</td>
                    <td style="border: 1px solid black; text-align: right; padding-right: 6px;">{{ selectedInspection.valuation?.vat }}</td>
                    <td colspan="3" style="border: 1px solid black; padding-left: 8px;">{{ selectedInspection.valuation?.currency }}</td>
                  </tr>
                  <tr style="font-weight: bold; font-size: 10px;">
                    <td colspan="6" style="border: 1px solid black; text-align: right; padding-right: 10px; height: 30px;">รวมเป็นเงินทั้งสิ้น</td>
                    <td style="border: 1px solid black; text-align: right; padding-right: 6px;">{{ selectedInspection.valuation?.total }}</td>
                    <td colspan="3" style="border: 1px solid black; padding-left: 8px;">{{ selectedInspection.valuation?.currency }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- Evaluation Section -->
              <div style="width: 100%; border-top: 1px solid black; background: #f3f4f6; text-align: center; padding: 6px; font-weight: bold; font-size: 11px;">แบบประเมินผู้ขาย / ผู้ให้บริการ</div>
              <table style="width: 100%; border-collapse: collapse; background-color: white; table-layout: fixed; border: 1px solid black; border-top: none;">
                <thead>
                  <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 10px;">
                    <th rowspan="2" style="border: 1px solid black; width: 45px; padding: 6px 2px;">ลำดับ</th>
                    <th rowspan="2" style="border: 1px solid black; text-align: left; padding-left: 10px;">รายการ</th>
                    <th colspan="3" style="border: 1px solid black; width: 195px; padding: 6px 2px;">ประเมินผล</th>
                    <th rowspan="2" style="border: 1px solid black; width: 180px; padding: 6px 2px;">หมายเหตุ</th>
                  </tr>
                  <tr style="background: #f9fafb; font-weight: bold; text-align: center; font-size: 10px;">
                    <th style="border: 1px solid black; width: 55px; padding: 6px 2px;">ดี</th>
                    <th style="border: 1px solid black; width: 55px; padding: 6px 2px;">พอใช้</th>
                    <th style="border: 1px solid black; width: 85px; padding: 6px 2px;">ควรปรับปรุง</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, idx) in selectedInspection.evaluation_data" :key="idx" style="height: 34px; font-size: 10px;">
                    <td style="border: 1px solid black; text-align: center;">{{ idx + 1 }}</td>
                    <td style="border: 1px solid black; padding-left: 10px;">{{ r.text }}</td>
                    <td style="border: 1px solid black; text-align: center;"><div style="width: 14px; height: 14px; border: 1px solid black; margin: auto; display: flex; align-items: center; justify-content: center; background: white;"><span v-if="r.good" style="font-weight: bold; font-size: 12px;">✓</span></div></td>
                    <td style="border: 1px solid black; text-align: center;"><div style="width: 14px; height: 14px; border: 1px solid black; margin: auto; display: flex; align-items: center; justify-content: center; background: white;"><span v-if="r.fair" style="font-weight: bold; font-size: 12px;">✓</span></div></td>
                    <td style="border: 1px solid black; text-align: center;"><div style="width: 14px; height: 14px; border: 1px solid black; margin: auto; display: flex; align-items: center; justify-content: center; background: white;"><span v-if="r.improve" style="font-weight: bold; font-size: 12px;">✓</span></div></td>
                    <td style="border: 1px solid black; padding-left: 6px;">{{ r.note }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- Images Section -->
              <div style="background: #f3f4f6; text-align: center; padding: 4px; border-bottom: 1px solid black; font-weight: bold; font-size: 11px;">แนบรูปภาพการตรวจรับ</div>
              <div style="padding: 15px; display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; flex: 1; min-height: 250px; border-bottom: 1px solid black; align-content: flex-start; background-color: white;">
                <div 
                  v-for="(url, idx) in selectedInspection.image_urls" 
                  :key="idx" 
                  @click="openLightbox(url)"
                  style="border: 1px solid #ccc; padding: 4px; background: white; box-shadow: 0 1px 4px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;"
                  class="hover:scale-105"
                >
                  <img :src="url" style="height: 200px; width: 280px; object-fit: cover;" />
                </div>
                <div v-if="!selectedInspection.image_urls?.length" style="color: #9ca3af; font-size: 14px; display: flex; align-items: center; flex: 1; justify-content: center;">- ไม่มีรูปภาพแนบ -</div>
              </div>

              <!-- Signatures -->
              <div style="padding: 20px 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; background-color: white;">
                <div v-for="(role, key) in {
                  receiver: 'ผู้ตรวจรับของ',
                  inspector: 'ผู้ตรวจสอบ (หัวหน้างาน)',
                  documentReceiver: 'ผู้รับเอกสาร (จัดซื้อ/การเงิน)'
                }" :key="key" style="text-align: left; display: flex; flex-direction: column; font-size: 9.5px; line-height: 1.8;">
                  <div style="display: flex; align-items: flex-end; width: 100%; margin-bottom: 4px;">
                    <span style="white-space: nowrap; padding-bottom: 2px;">ลงชื่อ</span>
                    <div style="flex: 1; border-bottom: 1px solid black; margin-left: 4px; height: 18px; position: relative;">
                      <div v-if="selectedInspection.signatures?.[key]?.name" style="position: absolute; bottom: 3px; left: 0; right: 0; text-align: center; font-weight: bold; color: #1e40af; font-size: 12px;">{{ selectedInspection.signatures[key].name }}</div>
                      <span v-else style="color: transparent;">.</span>
                    </div>
                  </div>
                  <div style="display: flex; align-items: flex-end; margin-top: 4px; width: 100%;">
                    <span style="white-space: nowrap; padding-bottom: 2px;">ชื่อตัวบรรจง</span>
                    <div style="margin-left: 6px; border-bottom: 1px solid black; font-weight: bold; min-width: 100px; padding: 0 6px 2px 6px; flex: 1; text-align: center;">{{ selectedInspection.signatures?.[key]?.printedName }}</div>
                  </div>
                  <div style="margin-top: 6px; font-weight: bold; text-align: center; width: 100%;">{{ role }}</div>
                  <div style="display: flex; align-items: flex-end; margin-top: 4px; width: 100%;">
                    <span style="white-space: nowrap; padding-bottom: 2px;">วันที่</span>
                    <div style="margin-left: 10px; border-bottom: 1px solid black; font-weight: bold; flex: 1; text-align: center; padding-bottom: 2px;">{{ formatDate(selectedInspection.signatures?.[key]?.date) }}</div>
                  </div>
                </div>
              </div>

              <!-- Footer -->
              <div style="text-align: center; font-size: 7px; padding: 4px; border-top: 1px solid black; color: #666;">
                FM-HO-PC01-07 REV.01 - 17/10/2567 | สร้างโดย: {{ selectedInspection.creator?.fullname }} ({{ selectedInspection.creator?.department }})
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Image Lightbox Modal -->
    <div v-if="showImageLightbox" @click="closeLightbox" class="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out">
      <div class="relative max-w-7xl max-h-screen">
        <img :src="lightboxImageUrl" class="max-w-full max-h-[90vh] object-contain shadow-2xl rounded-lg" @click.stop />
        <button @click="closeLightbox" class="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors">
          <i class="fa-solid fa-xmark text-3xl"></i>
        </button>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.preview-paper-wrapper {
  background: white;
  transform-origin: top center;
}

@media (max-width: 640px) {
  .preview-paper-wrapper {
    scale: 0.45;
  }
}

.font-thai {
  font-family: 'Noto Sans Thai', sans-serif;
}
</style>
