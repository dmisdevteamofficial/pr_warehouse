<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTrackingStatus } from '@/composables/useTrackingStatus'

const trcloudStore = useTrcloudStore()
const auth = useAuthStore()
const emit = defineEmits(['selectPage'])
const searchQuery = ref('')
const statusFilter = ref('')
const vendorFilter = ref('')
const viewMode = ref('all') // 'all' or 'tracked'
const openMenuId = ref(null) // ID ของแถวที่เปิดเมนูค้างไว้
const selectedRows = ref([]) // รายการที่เลือกเพื่อส่งไปฟอร์ม
const showSelection = ref(false) // แสดง checkbox เพื่อเลือกหลายรายการ
const headerMenuOpen = ref(false) // เปิดเมนูที่หัวตาราง

const TRACK_STORAGE_KEY = 'trcloud_po_tracked_rows'
const TRACK_TABLE = 'trcloud_tracking'
const TRACK_DOC_TYPE = 'po'
const trackedRowIds = ref(loadTrackedRowIds())
const sortingTrackedIds = ref([...trackedRowIds.value])

// สถานะการจัดการ: PO item ส่งเข้าได้ทั้งฝั่ง AP และ EXP → รวมทั้งสองแหล่ง
const { load: loadTrackingStatus, isAdded: isAddedToTracking, isLineSent } = useTrackingStatus()

function calculateAge(dateStr) {
  if (!dateStr) return 0
  try {
    const issueDate = new Date(dateStr)
    if (isNaN(issueDate.getTime())) return 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    issueDate.setHours(0, 0, 0, 0)
    const diffTime = today - issueDate
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays < 0 ? 0 : diffDays
  } catch {
    return 0
  }
}

function loadTrackedRowIds() {
  try {
    const raw = localStorage.getItem(TRACK_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistTrackedRowIds() {
  localStorage.setItem(TRACK_STORAGE_KEY, JSON.stringify(trackedRowIds.value))
}

async function loadTrackedRowIdsFromCloud() {
  try {
    const { data, error } = await supabase
      .from(TRACK_TABLE)
      .select('doc_key')
      .eq('doc_type', TRACK_DOC_TYPE)
    if (error) throw error
    const cloudIds = (data || []).map((r) => String(r.doc_key || '')).filter(Boolean)
    
    // ใช้ข้อมูลจาก Cloud เป็นหลัก
    trackedRowIds.value = cloudIds
    sortingTrackedIds.value = [...cloudIds]
    
    // ล้างข้อมูลที่ไม่มีอยู่ในตารางแล้ว (Cleanup)
    cleanupTrackedIds()
    
    persistTrackedRowIds()
  } catch (err) {
    console.warn('PO item track cloud load failed:', err?.message || err)
  }
}

// ฟังก์ชันสำหรับล้าง ID ที่ไม่มีอยู่ในข้อมูลปัจจุบันแล้ว
function cleanupTrackedIds() {
  if (!trcloudStore.poItemRows || trcloudStore.poItemRows.length === 0) return
  
  const currentIds = new Set(trcloudStore.poItemRows.map(r => getRowIdentity(r)))
  const validTrackedIds = trackedRowIds.value.filter(id => currentIds.has(id))
  
  if (validTrackedIds.length !== trackedRowIds.value.length) {
    trackedRowIds.value = validTrackedIds
    sortingTrackedIds.value = sortingTrackedIds.value.filter(id => currentIds.has(id))
  }
}

async function setTrackedCloud(docKeys, checked, rows = []) {
  try {
    const keys = Array.isArray(docKeys) ? docKeys : [docKeys]
    const rowList = Array.isArray(rows) ? rows : [rows]

    if (checked) {
      await supabase.from(TRACK_TABLE).delete().eq('doc_type', TRACK_DOC_TYPE).in('doc_key', keys)
      const inserts = rowList.map(r => {
        // จัดการวันที่ให้เป็นรูปแบบที่ Supabase ยอมรับ (YYYY-MM-DD) หรือ null
        let formattedDate = r.issue_date || r.date || null
        if (formattedDate && formattedDate.includes('/')) {
          const [d, m, y] = formattedDate.split('/')
          formattedDate = `${y}-${m}-${d}`
        }

        return {
          doc_type: TRACK_DOC_TYPE,
          doc_key: getRowIdentity(r),
          checked: true,
          updated_by: auth.user?.email || auth.user?.id || 'unknown',
          doc_date: formattedDate || null,
          partner_name: r.organization || r.partner_name || null,
          item_description: r.item_name || r.item_description || null,
          quantity: isNaN(parseFloat(r.quantity)) ? 0 : parseFloat(r.quantity),
          unit_price: isNaN(parseFloat(r.price)) ? 0 : parseFloat(r.price),
          total_amount: isNaN(parseFloat(r.item_total)) ? 0 : parseFloat(r.item_total)
        }
      })
      const { error: insertError } = await supabase.from(TRACK_TABLE).insert(inserts)
      if (insertError) {
        console.error('PO Track Insert Error:', insertError)
        throw insertError
      }
      return
    }
    const { error } = await supabase
      .from(TRACK_TABLE)
      .delete()
      .eq('doc_type', TRACK_DOC_TYPE)
      .in('doc_key', keys)
    if (error) throw error
  } catch (err) {
    console.warn('PO item track cloud sync failed:', err?.message || err)
  }
}

function getRowIdentity(row) {
  // ใช้ unique_id จาก Store เพื่อความแม่นยำสูงสุด ป้องกันการติ๊กซ้ำซ้อน
  return String(row.unique_id || '')
}

function isTracked(row) {
  const id = getRowIdentity(row)
  return id ? trackedRowIds.value.includes(id) : false
}

async function toggleTracked(row, checked) {
  const currentId = getRowIdentity(row)
  const docNum = row.doc_number || row.invoice_number || ''
  if (!currentId) return
  
  if (checked) {
    // 1. ติ๊กถูก: เลือกทุกรายการที่มีเลขที่เอกสารเดียวกัน (Siblings)
    const siblings = trcloudStore.poItemRows.filter(r => (r.doc_number || r.invoice_number) === docNum)
    const siblingIds = siblings.map(r => getRowIdentity(r)).filter(Boolean)
    
    // เพิ่มเข้าลำดับแรกสุด (Newest First) สำหรับการจัดลำดับครั้งถัดไป
    trackedRowIds.value = [...new Set([...siblingIds, ...trackedRowIds.value])]
    
    // หมายเหตุ: ไม่ทำการอัปเดต sortingTrackedIds ที่นี่ เพื่อให้ตำแหน่งแถวคงที่ (Frozen) ขณะใช้งาน
    
    persistTrackedRowIds()
    await setTrackedCloud(siblingIds, true, siblings)
  } else {
    // 2. ติ๊กออก: ให้ยกเลิกเฉพาะรายการที่กดเท่านั้น
    trackedRowIds.value = trackedRowIds.value.filter((x) => x !== currentId)
    
    // หมายเหตุ: ไม่ทำการอัปเดต sortingTrackedIds ที่นี่
    
    persistTrackedRowIds()
    await setTrackedCloud(currentId, false)
  }
}

const availableStatuses = computed(() => {
  return [...new Set(trcloudStore.poItemRows.map((r) => r.status).filter(Boolean))].sort()
})

const availableVendors = computed(() => {
  return [...new Set(trcloudStore.poItemRows.map((r) => r.organization).filter(Boolean))].sort()
})

const filteredRows = computed(() => {
  let rows = trcloudStore.poItemRows
  
  if (statusFilter.value) {
    rows = rows.filter((row) => String(row.status || '').includes(statusFilter.value))
  }

  if (vendorFilter.value) {
    rows = rows.filter((row) => String(row.organization || '') === vendorFilter.value)
  }
  
  if (viewMode.value === 'tracked') {
    rows = rows.filter((row) => {
      const status = String(row.status || '').toLowerCase()
      // Success includes 'success', 'สำเร็จ', 'เสร็จสิ้น', 'เรียบร้อย'
      const isSuccess = status.includes('success') || status.includes('สำเร็จ') || status.includes('เสร็จสิ้น') || status.includes('เรียบร้อย')
      
      // ในโหมดติดตามงาน: แสดงข้อมูลทั้งหมด (เช่น New, Partial) ยกเว้นรายการที่สำเร็จแล้ว (Success)
      // โดยไม่ต้องสนใจว่ามีการติ๊กถูก (Tracked) หรือไม่
      return !isSuccess
    })
  }

  const q = searchQuery.value.toLowerCase().trim()
  if (q) {
    rows = rows.filter((row) =>
      [row.doc_number, row.expense, row.organization, row.item_name, row.status]
        .join(' | ')
        .toLowerCase()
        .includes(q)
    )
  }
  
  // Sort by Tracking status first (if in tracked mode, sort by tracking order), then by Date Descending
      return [...rows].sort((a, b) => {
        const idA = getRowIdentity(a)
        const idB = getRowIdentity(b)
        const trackedA = sortingTrackedIds.value.indexOf(idA)
        const trackedB = sortingTrackedIds.value.indexOf(idB)
        const isNewA = String(a.status || '').toLowerCase() === 'new'
        const isNewB = String(b.status || '').toLowerCase() === 'new'
   
        // If in tracked mode, show most recently tracked at top, then New items
        if (viewMode.value === 'tracked') {
          // Both are manually tracked: sort by their order in sortingTrackedIds (most recent first)
          if (trackedA !== -1 && trackedB !== -1) {
            return trackedA - trackedB
          }
          
          // Only A is manually tracked: A comes first
          if (trackedA !== -1) return -1
          
          // Only B is manually tracked: B comes first
          if (trackedB !== -1) return 1
  
          // If neither is manually tracked, prioritize 'New' status
          if (isNewA && !isNewB) return -1
          if (!isNewA && isNewB) return 1
        }
     
        // Default: sort by Date Descending (Used for 'all' mode or as fallback for 'tracked' mode)
        const dateA = a.issue_date || ''
        const dateB = b.issue_date || ''
        if (dateA === dateB) return String(a.doc_number || '').localeCompare(String(b.doc_number || ''))
        return dateB.localeCompare(dateA)
      })
})

const itemCount = computed(() => trcloudStore.poItemRows.length)
const invoiceCount = computed(() => trcloudStore.poRows.length)
const loading = computed(() => trcloudStore.loading)

async function refreshPoItemRows() {
  await trcloudStore.fetchTrcloudData('po', { force: true })
  cleanupTrackedIds()
  sortingTrackedIds.value = [...trackedRowIds.value]
  await autoSyncTodayData()
}

async function autoSyncTodayData() {
  try {
    const today = new Date().toISOString().split('T')[0] // รูปแบบ YYYY-MM-DD
    const todayRows = trcloudStore.poItemRows.filter(row => {
      let docDate = row.issue_date || ''
      return docDate === today
    })

    if (todayRows.length === 0) return

    const inserts = todayRows.map(r => ({
      unique_id: getRowIdentity(r),
      doc_number: r.doc_number || r.invoice_number || '',
      issue_date: r.issue_date || null,
      organization: r.organization || '',
      item_name: r.item_name || '',
      quantity: isNaN(parseFloat(r.quantity)) ? 0 : parseFloat(r.quantity),
      unit: r.unit || '',
      price: isNaN(parseFloat(r.price)) ? 0 : parseFloat(r.price),
      item_total: isNaN(parseFloat(r.item_total)) ? 0 : parseFloat(r.item_total),
      staff: r.staff || '',
      currency: r.currency || 'LAK'
    }))

    // ใช้ upsert โดยอิงจาก unique_id เพื่อป้องกันข้อมูลซ้ำ
    const { error } = await supabase
      .from('po_items_sync')
      .upsert(inserts, { onConflict: 'unique_id' })

    if (error) throw error
    console.log(`Auto-synced ${todayRows.length} rows for today (${today})`)
  } catch (err) {
    console.warn('Auto-sync today data failed:', err?.message || err)
  }
}

function getIdentityString(row) {
  const doc = row.doc_number || row.invoice_number || '-'
  const item = row.item_name || '-'
  return `${doc} | ${item} [PO]`
}

function sendToExp(rows) {
  const items = Array.isArray(rows) ? rows : [rows]
  if (items.length === 0) return

  const identities = items.map(r => getIdentityString(r))
  
  trcloudStore.pendingAutofill = identities
  emit('selectPage', { itemId: "/#/form_submit_exp", itemLabel: "ฟอมร์ส่งรายการ Exp" })
  openMenuId.value = null
  selectedRows.value = []
}

function isSelected(row) {
  return selectedRows.value.some(r => getRowIdentity(r) === getRowIdentity(row))
}

function toggleSelectRow(row) {
  const docNum = row.doc_number
  if (!docNum) {
    const id = getRowIdentity(row)
    const index = selectedRows.value.findIndex(r => getRowIdentity(r) === id)
    if (index === -1) selectedRows.value.push(row)
    else selectedRows.value.splice(index, 1)
    return
  }

  const sameDocRows = filteredRows.value.filter(r => r.doc_number === docNum)
  const isCurrentlySelected = isSelected(row)

  if (isCurrentlySelected) {
    const currentId = getRowIdentity(row)
    selectedRows.value = selectedRows.value.filter(r => getRowIdentity(r) !== currentId)
  } else {
    const currentSelectedIds = new Set(selectedRows.value.map(r => getRowIdentity(r)))
    const toAdd = sameDocRows.filter(r => !currentSelectedIds.has(getRowIdentity(r)))
    selectedRows.value.push(...toAdd)
  }
}

const isAllSelected = computed(() => {
  if (filteredRows.value.length === 0) return false
  return filteredRows.value.every(row => isSelected(row))
})

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedRows.value = []
  } else {
    selectedRows.value = [...filteredRows.value]
  }
}

function enableSelectionMode() {
  showSelection.value = true
  headerMenuOpen.value = false
}

function cancelSelectionMode() {
  showSelection.value = false
  selectedRows.value = []
}

function toggleMenu(id) {
  if (openMenuId.value === id) {
    openMenuId.value = null
  } else {
    openMenuId.value = id
  }
}

// ล้างข้อมูลทุกครั้งที่ข้อมูลใน Store เปลี่ยนแปลง
watch(() => trcloudStore.poItemRows, () => {
  cleanupTrackedIds()
  selectedRows.value = []
}, { deep: true })

// Update sorting order when switching view mode
watch(viewMode, () => {
  sortingTrackedIds.value = [...trackedRowIds.value]
})

onMounted(async () => {
  loadTrackedRowIdsFromCloud()
  loadTrackingStatus(['ap', 'exp'])
  if (!trcloudStore.poRows.length) {
    await refreshPoItemRows()
  } else {
    // ถ้ามีข้อมูลอยู่แล้ว ให้ลอง Sync ข้อมูลของวันนี้ด้วย
    await autoSyncTodayData()
  }
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">TRCloud PO รายการสินค้า</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงรายการ PO แยกตามสินค้า พร้อมระบบติดตามงาน (Tracked) และคำนวณอายุเอกสารอัตโนมัติ</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="p-4 rounded-xl border relative overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
        <div class="text-[12px] font-medium uppercase tracking-wider mb-2" style="color: var(--color-text-muted)">
          จำนวนใบ PO
        </div>
        <div class="text-2xl font-bold font-mono" style="color: var(--color-text-primary)">{{ invoiceCount }}</div>
      </div>
      <div class="p-4 rounded-xl border relative overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
        <div class="text-[12px] font-medium uppercase tracking-wider mb-2" style="color: var(--color-text-muted)">
          จำนวนรายการสินค้า
        </div>
        <div class="text-2xl font-bold font-mono" style="color: var(--color-text-primary)">{{ itemCount }}</div>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-3 mb-5 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center gap-1 bg-gray-100/50 p-1 rounded-lg border" style="border-color: var(--color-border)">
        <button 
          @click="viewMode = 'all'" 
          :class="viewMode === 'all' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'"
          class="px-4 py-1.5 rounded-md text-[13px] font-medium transition-all"
        >
          ข้อมูลทั้งหมด
        </button>
        <button 
          @click="viewMode = 'tracked'" 
          :class="viewMode === 'tracked' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'"
          class="px-4 py-1.5 rounded-md text-[13px] font-medium transition-all"
        >
          ติดตามงาน
        </button>
      </div>
      
      <div class="flex items-center gap-2 ml-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">คู่ค้า</label>
        <select v-model="vendorFilter" class="px-3 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none max-w-[200px]" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option value="">ทั้งหมด</option>
          <option v-for="vendor in availableVendors" :key="vendor" :value="vendor">{{ vendor }}</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สถานะ</label>
        <select v-model="statusFilter" class="px-3 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option value="">ทั้งหมด</option>
          <option v-for="status in availableStatuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </div>
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="ค้นหา เลขที่เอกสาร / คู่ค้า / รายการสินค้า / สถานะ"
          class="w-full pl-10 pr-4 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <button @click="refreshPoItemRows" :disabled="loading" class="px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
        <i class="fa-solid fa-rotate mr-2" :class="loading ? 'fa-spin' : ''"></i>
        รีเฟรชข้อมูล
      </button>

      <!-- ปุ่มส่งหลายรายการ -->
      <div v-if="showSelection" class="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
        <button 
          @click="cancelSelectionMode"
          class="px-4 py-2 rounded-lg text-[13px] font-medium border hover:bg-gray-50 transition-colors"
          style="border-color: var(--color-border); color: var(--color-text-secondary); background: var(--color-bg-card)"
        >
          ยกเลิก
        </button>
        <button 
          :disabled="selectedRows.length === 0"
          @click="sendToExp(selectedRows)" 
          class="px-4 py-2 rounded-lg text-[13px] font-medium bg-green-600 text-white hover:bg-green-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i class="fa-solid fa-paper-plane mr-2"></i>
          ส่ง {{ selectedRows.length }} รายการไป Exp
        </button>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1460px] border-collapse table-fixed">
          <thead>
            <tr class="text-left" style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 font-medium w-[50px] text-center relative" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">
                <div v-if="showSelection">
                  <input 
                    type="checkbox" 
                    :checked="isAllSelected" 
                    @change="toggleSelectAll"
                    class="w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                </div>
                <div v-else>
                  <button 
                    @click="headerMenuOpen = !headerMenuOpen"
                    class="p-1 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <i class="fa-solid fa-ellipsis-vertical text-gray-500"></i>
                  </button>
                  
                  <!-- Header Dropdown Menu -->
                  <div 
                    v-if="headerMenuOpen"
                    class="absolute left-0 mt-2 w-48 rounded-lg shadow-xl border z-50 py-1 text-left"
                    style="background: var(--color-bg-card); border-color: var(--color-border)"
                  >
                    <button 
                      @click="enableSelectionMode"
                      class="w-full text-left px-4 py-2 text-[12px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                      style="color: var(--color-text-primary)"
                    >
                      <i class="fa-solid fa-list-check text-blue-500"></i>
                      ส่งข้อมูลฟอร์ม Exp
                    </button>
                  </div>
                </div>
              </th>
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อ้างอิงEXP</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อายุ (วัน)</th>
              <th class="px-4 py-3 font-medium w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">คู่ค้า</th>
              <th class="px-4 py-3 font-medium w-[150px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">Staff</th>
              <th class="px-4 py-3 font-medium min-w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการสินค้า / คำอธิบาย</th>
              <th class="px-4 py-3 font-medium w-[80px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">จำนวน</th>
              <th class="px-4 py-3 font-medium w-[80px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">หน่วย</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ราคา/หน่วย</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดรวม</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดที่ชำระ</th>
              <th class="px-4 py-3 font-medium text-center w-[70px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ติดตาม</th>
              <th class="px-4 py-3 font-medium w-[120px]" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="14" class="px-4 py-12 text-center">
                <div class="flex flex-col items-center gap-2">
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                  <span style="color: var(--color-text-muted)">กำลังดึงข้อมูลจาก TRCLOUD...</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="!filteredRows.length">
              <td colspan="15" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบรายการ PO รายการสินค้า</td>
            </tr>
            <tr v-for="(row, index) in filteredRows" :key="getRowIdentity(row)" class="dark:hover:bg-gray-200/50 hover:bg-blue-100/50 transition-colors" :style="{ borderBottom: '1px solid var(--color-border)', ...(isAddedToTracking(row) ? { boxShadow: 'inset 3px 0 0 #16a34a', background: 'rgba(16,185,129,0.06)' } : {}) }">
              <td class="px-4 py-3 text-center relative" style="border-right: 1px solid var(--color-border)">
                <div v-if="showSelection">
                  <input 
                    type="checkbox" 
                    :checked="isSelected(row)" 
                    @change="toggleSelectRow(row)"
                    class="w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                </div>
                <div v-else>
                  <button 
                    @click="toggleMenu(`${row.doc_number}_${index}`)"
                    class="p-1 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <i class="fa-solid fa-ellipsis-vertical text-gray-500"></i>
                  </button>
                  
                  <!-- Row Dropdown Menu -->
                  <div 
                    v-if="openMenuId === `${row.doc_number}_${index}`"
                    class="absolute left-full top-0 ml-1 w-48 rounded-lg shadow-xl border z-50 py-1 text-left"
                    style="background: var(--color-bg-card); border-color: var(--color-border)"
                  >
                    <button 
                      @click="sendToExp(row)"
                      class="w-full text-left px-4 py-2 text-[12px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                      style="color: var(--color-text-primary)"
                    >
                      <i class="fa-solid fa-paper-plane text-blue-500"></i>
                      ส่งไปฟอร์ม Exp
                    </button>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary)">{{ row.doc_number || '-' }}</td>
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary)">{{ row.expense || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.issue_date || '-' }}</td>
              <td class="px-4 py-3 font-mono" :style="{ color: calculateAge(row.issue_date) > 30 ? '#ef4444' : calculateAge(row.issue_date) > 15 ? '#f59e0b' : 'var(--color-text-primary)' }">
                {{ calculateAge(row.issue_date) }} วัน
              </td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.organization || '-' }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.staff || '-' }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">
                {{ row.item_name || '-' }}
                <span v-if="isAddedToTracking(row)" class="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold align-middle" style="background: rgba(16,185,129,0.15); color: #16a34a">
                  <i class="fa-solid fa-circle-check"></i> เข้าตารางแล้ว
                </span>
                <span v-if="isLineSent(row)" class="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold align-middle" style="background: rgba(6,182,212,0.15); color: #0891b2">
                  <i class="fa-brands fa-line"></i> ส่ง LINE แล้ว
                </span>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.quantity || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.unit || '-' }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ Number(row.price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ Number(row.item_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ Number(row.payment || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  class="w-4 h-4 accent-blue-600 cursor-pointer"
                  :checked="isTracked(row)"
                  @change="toggleTracked(row, $event.target.checked)"
                />
              </td>
              <td class="px-4 py-3">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border inline-block text-center w-full" :style="{
                  backgroundColor: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                  color: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') ? '#b91c1c' : '#047857',
                  borderColor: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'
                }">
                  {{ row.status || '-' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
