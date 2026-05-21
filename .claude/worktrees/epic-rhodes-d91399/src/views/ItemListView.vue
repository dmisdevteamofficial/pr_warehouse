<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const auth = useAuthStore()
const ui = useUiStore()

const DOCUMENT_BUCKET = 'document_url'

// State
const items = ref([])
const categories = ref([])
const loading = ref(true)
const searchText = ref('')
const selectedCategoryId = ref('all')
const selectedUsageType = ref('all')

// Barcode Download Mode
const isBarcodeMode = ref(false)
const selectedItemIds = ref(new Set())
const isDownloading = ref(false)

// Sidebar & Modal Visibility
const isSidebarOpen = ref(false)
const isCategoryModalOpen = ref(false)
const isRestockModalOpen = ref(false)
const isEditingCategory = ref(false)
const saving = ref(false)

const itemDocumentFile = ref(null)
const restockDocumentFile = ref(null)

// Watch for sidebar/modal open state to prevent body scrolling
watch([isSidebarOpen, isCategoryModalOpen, isRestockModalOpen], ([sidebar, category, restock]) => {
  if (sidebar || category || restock) {
    document.body.classList.add('no-scroll')
  } else {
    document.body.classList.remove('no-scroll')
  }
})

// Forms
const itemForm = ref({
  item_code: '',
  item_name: '',
  category_id: '',
  usage_type: '',
  amount: 1,
  unit: '',
  remark: ''
})

const restockForm = ref({
  item_id: '',
  item_name: '',
  amount: 1,
  unit: '',
  remark: ''
})

const categoryForm = ref({
  id: null,
  category_name: '',
  remark: ''
})

// Fetch Data
async function fetchData() {
  loading.value = true
  try {
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select('*, category(category_name), creator:system_users!created_by(fullname)')
      .order('created_at', { ascending: false })
    
    if (itemsError) throw itemsError
    items.value = itemsData

    const { data: categoriesData, error: categoriesError } = await supabase
      .from('category')
      .select('*')
      .order('category_name')
    
    if (categoriesError) throw categoriesError
    categories.value = categoriesData
  } catch (err) {
    console.error('Error fetching data:', err.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

function makeStoragePath(file, type) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const timestamp = Date.now()
  const baseName = file.name.replace(/\.[^/.]+$/, '')
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${auth.user?.id || 'anonymous'}/${type}/${timestamp}-${safeName}.${ext}`
}

async function uploadDocumentToStorage(file, type) {
  if (!file) return null
  const path = makeStoragePath(file, type)
  const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { upsert: false })
  if (uploadError) throw uploadError
  const { data } = supabase.storage.from(DOCUMENT_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

function onItemDocumentSelected(event) {
  itemDocumentFile.value = event.target.files?.[0] || null
}

function onRestockDocumentSelected(event) {
  restockDocumentFile.value = event.target.files?.[0] || null
}

// Computed
/** ค่าประเภทที่ใช้ที่ไม่ซ้ำจากรายการสินค้า (สำหรับ dropdown กรอง) */
const usageTypeFilterMeta = computed(() => {
  const set = new Set()
  let hasEmpty = false
  for (const item of items.value) {
    const u = String(item.usage_type ?? '').trim()
    if (!u) hasEmpty = true
    else set.add(u)
  }
  return {
    values: [...set].sort((a, b) => a.localeCompare(b, 'th')),
    hasEmpty
  }
})

const filteredItems = computed(() => {
  return items.value.filter(item => {
    const matchSearch = item.item_name.toLowerCase().includes(searchText.value.toLowerCase()) || 
                        item.item_code.toLowerCase().includes(searchText.value.toLowerCase())
    const matchCategory = selectedCategoryId.value === 'all' || item.category_id === selectedCategoryId.value
    const usage = String(item.usage_type ?? '').trim()
    const matchUsage =
      selectedUsageType.value === 'all' ||
      (selectedUsageType.value === '__none__' && !usage) ||
      (selectedUsageType.value !== '__none__' && usage === selectedUsageType.value)
    return matchSearch && matchCategory && matchUsage
  })
})

const selectedCount = computed(() => selectedItemIds.value.size)

// ─── Barcode Mode ─────────────────────────────────────────────────────────────

function enterBarcodeMode() {
  isBarcodeMode.value = true
  selectedItemIds.value = new Set()
}

function exitBarcodeMode() {
  isBarcodeMode.value = false
  selectedItemIds.value = new Set()
}

function toggleItemSelection(itemId) {
  const next = new Set(selectedItemIds.value)
  if (next.has(itemId)) {
    next.delete(itemId)
  } else {
    next.add(itemId)
  }
  selectedItemIds.value = next
}

function isSelected(itemId) {
  return selectedItemIds.value.has(itemId)
}

// ─── Barcode Generation ───────────────────────────────────────────────────────

/**
 * Renders a CODE128 barcode onto an off-screen canvas and returns the canvas.
 * Uses a lightweight built-in encoder — no external library needed.
 */
function generateBarcodeCanvas(code, label) {
  // CODE128B encoding table
  const CODE128B_START = 104
  const CODE128_STOP  = 106
  const CODE128B_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'

  const PATTERNS = [
    '11011001100','11001101100','11001100110','10010011000','10010001100',
    '10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110',
    '10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11101101110','11101001100',
    '11100101100','11100100110','11101100100','11100110100','11100110010',
    '11011011000','11011000110','11000110110','10100011000','10001011000',
    '10001000110','10110001000','10001101000','10001100010','11010001000',
    '11000101000','11000100010','10110111000','10110001110','10001101110',
    '10111011000','10111000110','10001110110','11101110110','11010001110',
    '11000101110','11011101000','11011100010','11011101110','11101011000',
    '11101000110','11100010110','11101101000','11101100010','11100011010',
    '11101111010','11001000010','11110001010','10100110000','10100001100',
    '10010110000','10010000110','10000101100','10000100110','10110010000',
    '10110000100','10011010000','10011000010','10000110100','10000110010',
    '11000010010','11001010000','11110111010','11000010100','10001111010',
    '10100111100','10010111100','10010011110','10111100100','10011110100',
    '10011110010','11110100100','11110010100','11110010010','11011011110',
    '11011110110','11110110110','10101111000','10100011110','10001011110',
    '10111101000','10111100010','11110101000','11110100010','10111011110',
    '10111101110','11101011110','11110101110','11010000100','11010010000',
    '11010011100','11000111010','11010111000'
  ]

  // Encode string to CODE128B symbol indices
  const indices = []
  indices.push(CODE128B_START)
  let checksum = CODE128B_START
  for (let i = 0; i < code.length; i++) {
    const idx = CODE128B_CHARS.indexOf(code[i])
    if (idx === -1) continue // skip unsupported chars
    indices.push(idx)
    checksum += (i + 1) * idx
  }
  checksum = checksum % 103
  indices.push(checksum)
  indices.push(CODE128_STOP)

  // Build bar pattern string
  let bars = ''
  for (const idx of indices) {
    bars += PATTERNS[idx] || ''
  }
  bars += '11' // termination bar

  // Canvas dimensions
  const barWidth   = 2
  const barHeight  = 80
  const paddingX   = 20
  const paddingTop = 16
  const labelH     = 24
  const totalW     = bars.length * barWidth + paddingX * 2
  const totalH     = paddingTop + barHeight + labelH + 8

  const canvas  = document.createElement('canvas')
  canvas.width  = totalW
  canvas.height = totalH
  const ctx     = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, totalW, totalH)

  // Bars
  for (let i = 0; i < bars.length; i++) {
    ctx.fillStyle = bars[i] === '1' ? '#000000' : '#ffffff'
    ctx.fillRect(paddingX + i * barWidth, paddingTop, barWidth, barHeight)
  }

  // Label text
  ctx.fillStyle = '#000000'
  ctx.font      = 'bold 13px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(label, totalW / 2, paddingTop + barHeight + labelH - 4)

  return canvas
}

async function downloadBarcodes() {
  if (selectedCount.value === 0) return
  isDownloading.value = true

  try {
    const selected = filteredItems.value.filter(item => selectedItemIds.value.has(item.id))

    if (selected.length === 1) {
      // Single: download image directly
      const item   = selected[0]
      const canvas = generateBarcodeCanvas(item.item_code, item.item_code)
      const link   = document.createElement('a')
      link.download = `barcode-${item.item_code}.png`
      link.href     = canvas.toDataURL('image/png')
      link.click()
    } else {
      // Multiple: bundle into ZIP using JSZip (loaded from CDN)
      const JSZip = (await loadJSZip()).default || (await loadJSZip())
      const zip   = new JSZip()

      for (const item of selected) {
        const canvas  = generateBarcodeCanvas(item.item_code, item.item_code)
        const dataUrl = canvas.toDataURL('image/png')
        const base64  = dataUrl.replace(/^data:image\/png;base64,/, '')
        zip.file(`barcode-${item.item_code}.png`, base64, { base64: true })
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.download = 'barcodes.zip'
      link.href     = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
    }
  } catch (err) {
    console.error('Download error:', err)
    alert('เกิดข้อผิดพลาดในการดาวน์โหลด: ' + err.message)
  } finally {
    isDownloading.value = false
  }
}

function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return }
    const s  = document.createElement('script')
    s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = () => resolve(window.JSZip)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ─── Navigation / Unload Guards ──────────────────────────────────────────────

const LEAVE_MSG = 'คุณกำลังอยู่ในโหมดเลือกบาร์โค้ด\nต้องการออกจากหน้านี้หรือไม่?'

function handleBeforeUnload(e) {
  if (!isBarcodeMode.value) return
  e.preventDefault()
  e.returnValue = LEAVE_MSG // required for Chrome to show the dialog
  return LEAVE_MSG
}


onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

// Vue Router guard — fires when navigating to another route
onBeforeRouteLeave((to, from, next) => {
  if (!isBarcodeMode.value) { next(); return }
  const confirmed = window.confirm(LEAVE_MSG)
  confirmed ? next() : next(false)
})

// ─── Sidebar Handlers (Add/Import Item) ───────────────────────────────────────

function openAddItemSidebar() {
  itemForm.value = {
    item_code: '',
    item_name: '',
    category_id: categories.value[0]?.id || '',
    usage_type: '',
    amount: 1,
    unit: 'ชิ้น',
    remark: ''
  }
  itemDocumentFile.value = null
  isSidebarOpen.value = true
}

async function saveItem() {
  if (!itemForm.value.item_code || !itemForm.value.item_name || !itemForm.value.category_id) {
    alert('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (รหัสสินค้า, ชื่อสินค้า, ประเภท)')
    return
  }

  saving.value = true
  try {
    const warnings = []
    let uploadedDocumentUrl = null
    if (itemDocumentFile.value) {
      try {
        uploadedDocumentUrl = await uploadDocumentToStorage(itemDocumentFile.value, 'items')
      } catch (err) {
        console.error('Upload document failed:', err.message)
        warnings.push(`เอกสาร/รูปอัปโหลดไม่สำเร็จ (${err.message})`)
      }
    }

    let { data: existingItem, error: findError } = await supabase
      .from('items')
      .select('id, document_url')
      .eq('item_code', itemForm.value.item_code)
      .maybeSingle()

    if (findError) throw findError

    let itemId

    if (existingItem) {
      itemId = existingItem.id
      const { error: updateItemError } = await supabase
        .from('items')
        .update({
          item_name: itemForm.value.item_name,
          category_id: itemForm.value.category_id,
          usage_type: itemForm.value.usage_type,
          unit: itemForm.value.unit,
          remark: itemForm.value.remark,
          updated_by: auth.user.id,
          document_url: uploadedDocumentUrl || existingItem.document_url || null
        })
        .eq('id', itemId)
      if (updateItemError) throw updateItemError
    } else {
      const { data: newItem, error: insertItemError } = await supabase
        .from('items')
        .insert({
          item_code: itemForm.value.item_code,
          item_name: itemForm.value.item_name,
          category_id: itemForm.value.category_id,
          usage_type: itemForm.value.usage_type,
          unit: itemForm.value.unit,
          remark: itemForm.value.remark,
          document_url: uploadedDocumentUrl || null,
          current_stock: 0,
          created_by: auth.user.id,
          updated_by: auth.user.id
        })
        .select()
        .single()
      
      if (insertItemError) throw insertItemError
      itemId = newItem.id
    }

    const importPayloadBase = {
      item_id: itemId,
      amount: itemForm.value.amount,
      unit: itemForm.value.unit,
      remark: itemForm.value.remark,
      note: 'นำเข้าสินค้า',
      created_by: auth.user.id,
      updated_by: auth.user.id
    }

    let importError = null
    if (uploadedDocumentUrl) {
      const { error } = await supabase.from('inventory_imports').insert({ ...importPayloadBase, document_url: uploadedDocumentUrl })
      importError = error
      if (importError && String(importError.message || '').includes('document_url')) {
        warnings.push('ตาราง inventory_imports ไม่มีคอลัมน์ document_url จึงบันทึกลิงก์ไว้ที่รายการสินค้าแทน')
        importError = null
        const { error: retryErr } = await supabase.from('inventory_imports').insert(importPayloadBase)
        if (retryErr) throw retryErr
      } else if (importError) {
        throw importError
      }
    } else {
      const { error } = await supabase.from('inventory_imports').insert(importPayloadBase)
      if (error) throw error
    }

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'import_item',
      user_agent: navigator.userAgent,
      old_value: { 
        item_code: itemForm.value.item_code, 
        amount: itemForm.value.amount 
      }
    })

    isSidebarOpen.value = false
    await fetchData()
    if (warnings.length) alert('บันทึกข้อมูลสำเร็จ\n\n' + warnings.join('\n'))
    else alert('บันทึกข้อมูลสำเร็จ')
  } catch (err) {
    console.error(err)
    alert('Error saving item: ' + err.message)
  } finally {
    saving.value = false
  }
}

// Category Handlers
function openCategoryModal() {
  isCategoryModalOpen.value = true
  isEditingCategory.value = false
  categoryForm.value = { id: null, category_name: '', remark: '' }
}

function editCategory(cat) {
  isEditingCategory.value = true
  categoryForm.value = { ...cat }
}

function cancelEditCategory() {
  isEditingCategory.value = false
  categoryForm.value = { id: null, category_name: '', remark: '' }
}

// Restock Handlers
function openRestockModal(item) {
  restockForm.value = {
    item_id: item.id,
    item_name: item.item_name,
    amount: 1,
    unit: item.unit,
    remark: ''
  }
  restockDocumentFile.value = null
  isRestockModalOpen.value = true
}

async function handleRestock() {
  if (restockForm.value.amount <= 0) {
    ui.showToast('กรุณากรอกจำนวนที่ต้องการเติมให้ถูกต้อง', 'warning')
    return
  }

  if (!restockDocumentFile.value) {
    ui.showToast('กรุณาแนบไฟล์รูปภาพหรือเอกสารเพื่อยืนยันการเติมสินค้า', 'error')
    return
  }

  saving.value = true
  try {
    const warnings = []
    let uploadedDocumentUrl = null
    if (restockDocumentFile.value) {
      try {
        uploadedDocumentUrl = await uploadDocumentToStorage(restockDocumentFile.value, 'restock')
      } catch (err) {
        console.error('Upload document failed:', err.message)
        warnings.push(`เอกสาร/รูปอัปโหลดไม่สำเร็จ (${err.message})`)
      }
    }

    const restockPayloadBase = {
      item_id: restockForm.value.item_id,
      amount: restockForm.value.amount,
      unit: restockForm.value.unit,
      remark: restockForm.value.remark,
      note: 'เติมสินค้า (Restock)',
      created_by: auth.user.id,
      updated_by: auth.user.id
    }

    if (uploadedDocumentUrl) {
      const { error } = await supabase.from('inventory_imports').insert({ ...restockPayloadBase, document_url: uploadedDocumentUrl })
      if (error && String(error.message || '').includes('document_url')) {
        warnings.push('ตาราง inventory_imports ไม่มีคอลัมน์ document_url จึงบันทึกลิงก์ไว้ที่หมายเหตุไม่ได้')
        const { error: retryErr } = await supabase.from('inventory_imports').insert(restockPayloadBase)
        if (retryErr) throw retryErr
      } else if (error) {
        throw error
      }
    } else {
      const { error } = await supabase.from('inventory_imports').insert(restockPayloadBase)
      if (error) throw error
    }

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'restock_item',
      user_agent: navigator.userAgent,
      old_value: { 
        item_name: restockForm.value.item_name, 
        amount: restockForm.value.amount 
      }
    })

    isRestockModalOpen.value = false
    await fetchData()
    if (warnings.length) ui.showToast('เติมสินค้าสำเร็จ (มีคำเตือน)', 'warning')
    else ui.showToast('เติมสินค้าสำเร็จเรียบร้อยแล้ว', 'success')
  } catch (err) {
    console.error(err)
    ui.showToast('เกิดข้อผิดพลาด: ' + err.message, 'error')
  } finally {
    saving.value = false
  }
}

async function saveCategory() {
  if (!categoryForm.value.category_name) {
    alert('กรุณากรอกชื่อประเภทสินค้า')
    return
  }

  saving.value = true
  try {
    if (isEditingCategory.value) {
      const { error } = await supabase
        .from('category')
        .update({
          category_name: categoryForm.value.category_name,
          remark: categoryForm.value.remark,
          updated_by: auth.user.id
        })
        .eq('id', categoryForm.value.id)
      
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('category')
        .insert({
          category_name: categoryForm.value.category_name,
          remark: categoryForm.value.remark,
          created_by: auth.user.id,
          updated_by: auth.user.id
        })
      
      if (error) throw error
    }

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: isEditingCategory.value ? 'edit_category' : 'add_category',
      user_agent: navigator.userAgent,
      old_value: { category_name: categoryForm.value.category_name }
    })

    await fetchData()
    isEditingCategory.value = false
    categoryForm.value = { id: null, category_name: '', remark: '' }
    alert('บันทึกหมวดหมู่สำเร็จ')
  } catch (err) {
    alert('Error saving category: ' + err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppLayout>
    <!-- Header Section -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการสินค้า</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">จัดการข้อมูลสินค้าและสต็อกในระบบ</p>
      </div>
      <div class="flex flex-wrap gap-3">
        <!-- Barcode mode: show exit banner instead of normal buttons -->
        <template v-if="isBarcodeMode">
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[13px] font-medium">
            <i class="fa-solid fa-barcode"></i>
            <span>โหมดเลือกบาร์โค้ด</span>
            <span class="mx-1 text-blue-400 dark:text-blue-600">|</span>
            <span>เลือกแล้ว <strong>{{ selectedCount }}</strong> รายการ</span>
          </div>
          <button
            @click="exitBarcodeMode"
            class="flex items-center gap-2 py-1.5 px-3 rounded-lg border text-[13px] font-medium transition-all hover:bg-red-50 dark:hover:bg-red-900/30 active:scale-95 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700"
          >
            <i class="fa-solid fa-xmark"></i>
            ออกจากโหมดนี้
          </button>
        </template>

        <template v-else>
          <button
            @click="enterBarcodeMode"
            class="flex items-center gap-3 py-1.5 px-3 rounded-lg border text-[13px] font-medium transition-all hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 text-slate-600 dark:text-slate-300 border-slate-500 dark:border-slate-700"
          >
            <i class="fa-solid fa-download"></i>
            ดาวน์โหลดบาร์โค้ด
          </button>
          <button
            @click="openCategoryModal"
            class="flex items-center gap-3 px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-all hover:bg-gray-50 active:scale-95"
            style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
          >
            <i class="fa-solid fa-tags"></i>
            จัดการประเภทสินค้า
          </button>
          <button
            @click="openAddItemSidebar"
            class="flex items-center gap-3 px-4 py-1.5 rounded-lg border text-[13px] font-medium transition-all hover:bg-gray-100 active:scale-95"
            style="background: var(--color-card); color: var(--color-text-primary); border-color: var(--color-border)"
          >
            <i class="fa-solid fa-plus"></i>
            เพิ่มสินค้า / นำเข้า
          </button>
        </template>
      </div>
    </div>

    <!-- Filters Section -->
    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input 
          v-model="searchText"
          type="text" 
          placeholder="ค้นหาด้วยรหัส หรือ ชื่อสินค้า..." 
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <div class="w-full md:w-48">
        <select 
          v-model="selectedCategoryId"
          class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="background-color: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <option value="all" style="background-color: var(--color-bg-card)">ทุกประเภทสินค้า</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id" style="background-color: var(--color-bg-card)">{{ cat.category_name }}</option>
        </select>
      </div>
      <div class="w-full md:w-48">
        <select
          v-model="selectedUsageType"
          class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="background-color: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <option value="all" style="background-color: var(--color-bg-card)">ทุกประเภทที่ใช้</option>
          <option v-if="usageTypeFilterMeta.hasEmpty" value="__none__" style="background-color: var(--color-bg-card)">ไม่ระบุ</option>
          <option
            v-for="ut in usageTypeFilterMeta.values"
            :key="ut"
            :value="ut"
            style="background-color: var(--color-bg-card)"
          >
            {{ ut }}
          </option>
        </select>
      </div>
    </div>

    <!-- Table Section -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <!-- Checkbox column header: X button in barcode mode -->
              <th class="px-4 py-3 w-10 text-center">
                <template v-if="isBarcodeMode">
                  <button
                    @click="exitBarcodeMode"
                    class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
                    title="ออกจากโหมดเลือก"
                  >
                    <i class="fa-solid fa-xmark text-[11px]"></i>
                  </button>
                </template>
              </th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รหัสสินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภท</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
              <th class="text-right px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวนคงเหลือ</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้เพิ่ม</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
              <!-- Hide restock column header in barcode mode -->
              <th v-if="!isBarcodeMode" class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">เติมสินค้า</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredItems"
              :key="item.id"
              class="border-b last:border-b-0 transition-colors"
              :class="[
                isBarcodeMode
                  ? isSelected(item.id)
                    ? 'bg-blue-50 dark:bg-blue-900/20 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-300/30'
                    : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-blue-400/10'
                  : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'
              ]"
              style="border-color: var(--color-border)"
              @click="isBarcodeMode ? toggleItemSelection(item.id) : null"
            >
              <!-- Checkbox cell -->
              <td class="px-4 py-3 text-center" @click.stop="isBarcodeMode ? toggleItemSelection(item.id) : null">
                <template v-if="isBarcodeMode">
                  <div
                    class="inline-flex items-center justify-center w-5 h-5 rounded border-2 transition-all"
                    :class="isSelected(item.id)
                      ? 'bg-blue-500 border-blue-500 dark:bg-blue-400 dark:border-blue-400'
                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800'"
                  >
                    <i v-if="isSelected(item.id)" class="fa-solid fa-check text-white text-[9px]"></i>
                  </div>
                </template>
              </td>

              <td class="px-4 py-3 font-mono" style="color: var(--color-text-muted)">{{ item.item_code }}</td>
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ item.item_name }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                <span class="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 dark:bg-blue-800/30 text-blue-700 hover:bg-blue-100 dark:text-blue-300 border border-blue-600 dark:border-blue-800/30 transition-colors cursor-w-resize">
                  {{ item.category?.category_name || 'ไม่มีประเภท' }}
                </span>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                {{ item.usage_type || '-' }}
              </td>
              <td class="px-4 py-3 font-bold text-right">
                <span
                  class="rounded-lg px-1 py-0.5 text-center"
                  :class="item.current_stock <= 5
                    ? 'bg-red-100 dark:bg-red-600/30 text-red-600 dark:text-red-500'
                    : 'bg-green-100 dark:bg-green-600/30 text-emerald-600 dark:text-green-500'"
                >{{ item.current_stock }} {{ item.unit }}</span>
              </td>
              <td class="px-4 py-3 text-center" style="color: var(--color-text-secondary)">{{ item.creator?.fullname || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ item.remark || '-' }}</td>

              <!-- Restock button: hidden in barcode mode -->
              <td v-if="!isBarcodeMode" class="px-4 py-3 text-center" @click.stop>
                <button
                  @click="openRestockModal(item)"
                  class="px-3 py-1 rounded bg-emerald-50 hover:scale-105 hover:bg-emerald-100 dark:hover:bg-emerald-400/30 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-600/20 text-[11px] font-medium hover:bg-emerald-100 transition-colors"
                >
                  <i class="fa-solid fa-plus-circle mr-1"></i>
                  Restock
                </button>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="8" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="filteredItems.length === 0">
              <td colspan="8" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลสินค้า</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ─── Floating Download Bar (Barcode Mode) ─────────────────────────── -->
    <Transition name="float-up">
      <div
        v-if="isBarcodeMode && selectedCount > 0"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-800"
      >
        <div class="flex items-center gap-2 text-[13px] font-medium text-blue-700 dark:text-blue-300">
          <i class="fa-solid fa-barcode text-blue-500"></i>
          <span>เลือกแล้ว <strong>{{ selectedCount }}</strong> รายการ</span>
        </div>
        <div class="w-px h-5 bg-gray-200 dark:bg-slate-600"></div>
        <button
          @click="downloadBarcodes"
          :disabled="isDownloading"
          class="flex items-center gap-2 px-4 py-1.5 rounded-xl text-[13px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed bg-blue-500 hover:bg-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          <i :class="isDownloading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-download'"></i>
          {{ isDownloading ? 'กำลังสร้าง...' : (selectedCount === 1 ? 'ดาวน์โหลดรูปภาพ' : 'ดาวน์โหลด ZIP') }}
        </button>
        <button
          @click="selectedItemIds = new Set()"
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400"
        >
          <i class="fa-solid fa-rotate-left text-[11px]"></i>
          ล้าง
        </button>
      </div>
    </Transition>

    <!-- Sidebar: Add Item / Import -->
    <Transition name="slide-right">
      <div v-if="isSidebarOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="isSidebarOpen = false"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เพิ่มสินค้า / นำเข้า</h2>
            <button @click="isSidebarOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">รหัสสินค้า</label>
              <input v-model="itemForm.item_code" placeholder="กรอกรหัสสินค้า" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ชื่อสินค้า</label>
              <input v-model="itemForm.item_name" placeholder="กรอกชื่อสินค้า" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ประเภทที่ใช้</label>
              <input v-model="itemForm.usage_type" placeholder="กรอกประเภทที่ใช้ (เช่น งานซ่อม, งานก่อสร้าง)" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ประเภทสินค้า</label>
                <select v-model="itemForm.category_id" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)">
                  <option v-for="cat in categories" :key="cat.id" :value="cat.id" style="background-color: var(--color-bg-card)">{{ cat.category_name }}</option>
                </select>
              </div>
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หน่วย</label>
                <input v-model="itemForm.unit" type="text" placeholder="เช่น ชิ้น, กล่อง" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนที่จะนำเข้า</label>
              <input v-model.number="itemForm.amount" type="number" min="1" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุ</label>
              <textarea v-model="itemForm.remark" placeholder="คำอธิบาย(ถ้ามี)" rows="3" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)"></textarea>
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">แนบไฟล์ (เอกสาร/รูป)</label>
              <input
                type="file"
                @change="onItemDocumentSelected"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
              />
              <p class="text-[11px]" style="color: var(--color-text-muted)">อัปโหลดไปที่ Storage bucket `document_url`</p>
            </div>
          </div>
          <div class="p-6 border-t" style="border-color: var(--color-border)">
            <button 
              @click="saveItem" 
              :disabled="saving"
              class="w-full py-2.5 rounded-lg bg-slate-200 active:scale-95 transition-all duration-300 dark:bg-slate-500/40 text-[14px] font-medium text-slate-800 dark:text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Modal: Category Management -->
    <div v-if="isCategoryModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isCategoryModalOpen = false"></div>
      <div class="relative w-full max-w-2xl max-h-[90vh] shadow-2xl rounded-2xl flex flex-col" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">จัดการประเภทสินค้า</h2>
          <button @click="isCategoryModalOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6">
          <!-- Add/Edit Category Form -->
          <div class="mb-8 p-4 rounded-xl border" style="background: var(--color-bg-body); border-color: var(--color-border)">
            <h3 class="text-[14px] font-medium mb-4" style="color: var(--color-text-primary)">
              {{ isEditingCategory ? 'แก้ไขประเภทสินค้า' : 'เพิ่มประเภทสินค้าใหม่' }}
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">ชื่อประเภทสินค้า</label>
                <input v-model="categoryForm.category_name" placeholder="กรอกชื่อประเภทสินค้า" type="text" class="w-full px-3 py-1.5 border rounded-lg text-[13px] focus:outline-none dark:bg-slate-800/50" style="border-color: var(--color-border)" />
              </div>
              <div class="space-y-1">
                <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">หมายเหตุ</label>
                <input v-model="categoryForm.remark" placeholder="(ถ้ามี)" type="text" class="w-full px-3 py-1.5 border rounded-lg text-[13px] focus:outline-none dark:bg-slate-800/50" style="border-color: var(--color-border)" />
              </div>
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button v-if="isEditingCategory" @click="cancelEditCategory" :disabled="saving" class="px-3 py-1.5 rounded-lg text-[12px] border disabled:opacity-50" style="border-color: var(--color-border); color: var(--color-text-muted)">ยกเลิก</button>
              <button @click="saveCategory" :disabled="saving" class="px-4 py-1.5 rounded-lg text-[12px] border border-slate-500 dark:border-slate-300 hover:bg-slate-300/50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-100 font-medium disabled:opacity-50 transition-all duration-300 delay-100">
                {{ saving ? 'กำลังบันทึก...' : (isEditingCategory ? 'บันทึกการแก้ไข' : 'บันทึก') }}
              </button>
            </div>
          </div>

          <!-- Category Table -->
          <div class="rounded-xl border overflow-hidden" style="border-color: var(--color-border)">
            <table class="w-full text-[13px]">
              <thead>
                <tr class="bg-gray-50 dark:bg-slate-800/50" style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-4 py-2 font-medium" style="color: var(--color-text-muted)">ชื่อประเภท</th>
                  <th class="text-left px-4 py-2 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
                  <th class="text-right px-4 py-2 font-medium" style="color: var(--color-text-muted)">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cat in categories" :key="cat.id" class="border-b last:border-b-0" style="border-color: var(--color-border)">
                  <td class="px-4 py-2" style="color: var(--color-text-primary)">{{ cat.category_name }}</td>
                  <td class="px-4 py-2" style="color: var(--color-text-muted)">{{ cat.remark || '-' }}</td>
                  <td class="px-4 py-2 text-right">
                    <button @click="editCategory(cat)" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                      <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Restock Item -->
    <div v-if="isRestockModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isRestockModalOpen = false"></div>
      <div class="relative w-full max-w-md shadow-2xl rounded-2xl flex flex-col overflow-hidden" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เติมสินค้า (Restock)</h2>
          <button @click="isRestockModalOpen = false" class="p-2 hover:bg-gray-100 dark:hover:bg-slate-600/40 rounded-lg transition-colors">
            <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div class="p-3 rounded-lg bg-amber-100 dark:bg-amber-400/20 mb-2">
            <p class="text-[12px] text-amber-700 dark:text-amber-300 font-medium">กำลังเติมสินค้า:</p>
            <p class="text-[15px] text-amber-900 dark:text-amber-200 font-bold">{{ restockForm.item_name }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนที่ต้องการเติม</label>
            <div class="flex gap-2">
              <input v-model.number="restockForm.amount" type="number" min="1" class="flex-1 px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              <div class="px-4 py-2 border rounded-lg text-[13px] bg-gray-50 dark:bg-slate-800/50 flex items-center justify-center min-w-[60px]" style="border-color: var(--color-border)">
                {{ restockForm.unit }}
              </div>
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุ</label>
            <textarea v-model="restockForm.remark" rows="2" placeholder="ระบุรายละเอียดการเติมสินค้า (ถ้ามี)" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)"></textarea>
          </div>
          <div class="space-y-1">
            <label class="text-[13px] font-medium flex items-center gap-1" style="color: var(--color-text-primary)">
              แนบไฟล์ (เอกสาร/รูป)
              <span class="text-red-500 font-bold">*</span>
            </label>
            <input
              type="file"
              @change="onRestockDocumentSelected"
              class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
              :class="!restockDocumentFile ? 'border-red-300 bg-red-50/30' : 'border-gray-200'"
              style="background: var(--color-bg-body); color: var(--color-text-primary)"
            />
            <p v-if="!restockDocumentFile" class="text-[11px] text-red-500">กรุณาแนบไฟล์เพื่อยืนยันการเติมสินค้า</p>
          </div>
        </div>
        <div class="p-6 border-t flex gap-2" style="border-color: var(--color-border)">
          <button @click="isRestockModalOpen = false" class="flex-1 py-2 gap-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
            ยกเลิก
          </button>
          <button 
            @click="handleRestock" 
            :disabled="saving"
            class="flex-2 gap-2 py-2 px-6 rounded-lg text-[14px] bg-emerald-100 dark:bg-emerald-400/50 font-medium text-slate-700 dark:text-white transition-all hover:bg-emerald-200 dark:hover:opacity-90 disabled:opacity-50"
          >
            {{ saving ? 'กำลังบันทึก...' : 'ยืนยันการเติมสินค้า' }}
          </button>
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

.float-up-enter-active,
.float-up-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.float-up-enter-from,
.float-up-leave-to {
  transform: translateX(-50%) translateY(24px);
  opacity: 0;
}

body.no-scroll {
  overflow: hidden;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
