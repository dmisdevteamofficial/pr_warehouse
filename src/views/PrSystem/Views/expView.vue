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
const activeTab = ref('all') // 'all' or 'tracking'
const openMenuId = ref(null) // ID ของแถวที่เปิดเมนูค้างไว้
const selectedRows = ref([]) // รายการที่เลือกเพื่อส่งไปฟอร์ม
const showSelection = ref(false) // แสดง checkbox เพื่อเลือกหลายรายการ
const headerMenuOpen = ref(false) // เปิดเมนูที่หัวตาราง

const TRACK_STORAGE_KEY = 'trcloud_exp_tracked_rows'
const TRACK_TABLE = 'trcloud_tracking'
const TRACK_DOC_TYPE = 'expense'
const trackedRowIds = ref(loadTrackedRowIds())

// สถานะการจัดการ: กรอกมือแล้ว (อยู่ใน exp_requests) / ส่ง LINE แล้ว
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
    
    // ล้างข้อมูลที่ไม่มีอยู่ในตารางแล้ว (Cleanup)
    cleanupTrackedIds()
    
    persistTrackedRowIds()
  } catch (err) {
    console.warn('EXP item track cloud load failed:', err?.message || err)
  }
}

// ฟังก์ชันสำหรับล้าง ID ที่ไม่มีอยู่ในข้อมูลปัจจุบันแล้ว
function cleanupTrackedIds() {
  if (!trcloudStore.expenseItemRows || trcloudStore.expenseItemRows.length === 0) return
  
  const currentIds = new Set(trcloudStore.expenseItemRows.map(r => getRowIdentity(r)))
  const validTrackedIds = trackedRowIds.value.filter(id => currentIds.has(id))
  
  if (validTrackedIds.length !== trackedRowIds.value.length) {
    trackedRowIds.value = validTrackedIds
  }
}

async function setTrackedCloud(docKeys, checked) {
  try {
    const keys = Array.isArray(docKeys) ? docKeys : [docKeys]
    if (checked) {
      // ลบของเก่าออกก่อนเพื่อป้องกัน Duplicate (ถ้ามี)
      await supabase.from(TRACK_TABLE).delete().eq('doc_type', TRACK_DOC_TYPE).in('doc_key', keys)
      
      const inserts = keys.map(k => ({
        doc_type: TRACK_DOC_TYPE,
        doc_key: k,
        checked: true,
        updated_by: auth.user?.id || null
      }))
      
      const { error: insertError } = await supabase.from(TRACK_TABLE).insert(inserts)
      if (insertError) throw insertError
      return
    }
    
    const { error } = await supabase
      .from(TRACK_TABLE)
      .delete()
      .eq('doc_type', TRACK_DOC_TYPE)
      .in('doc_key', keys)
    if (error) throw error
  } catch (err) {
    console.warn('EXP item track cloud sync failed:', err?.message || err)
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

function toggleTracked(row, checked) {
  const currentId = getRowIdentity(row)
  if (!currentId) return
  
  if (checked) {
    // Find all rows with the same doc_number
    const sameDocRows = trcloudStore.expenseItemRows.filter(r => r.doc_number === row.doc_number)
    const sameDocIds = sameDocRows.map(r => getRowIdentity(r)).filter(Boolean)
    
    // Add all same doc IDs to trackedRowIds, placing the current one first
    const newTracked = [...sameDocIds.filter(id => id !== currentId), currentId]
    const existingTracked = trackedRowIds.value.filter(id => !newTracked.includes(id))
    trackedRowIds.value = [...newTracked.reverse(), ...existingTracked]
    
    persistTrackedRowIds()
    setTrackedCloud(sameDocIds, true)
  } else {
    // Uncheck: only remove the current item
    trackedRowIds.value = trackedRowIds.value.filter((x) => x !== currentId)
    
    persistTrackedRowIds()
    setTrackedCloud(currentId, false)
  }
}

function mapStatus(status) {
  const s = String(status || '').trim()
  if (s === 'รอชำระ') return 'ยังไม่ชำระ'
  if (s === 'จ่ายครบ') return 'ชำระแล้ว'
  return s
}

const availableStatuses = computed(() => {
  if (!trcloudStore.expenseItemRows) return []
  const rawStatuses = trcloudStore.expenseItemRows.map((r) => r.status).filter(Boolean)
  const mapped = rawStatuses.map(s => mapStatus(s)).filter(s => s !== 'จ่ายบางส่วน')
  return [...new Set(mapped)].sort()
})

const filteredRows = computed(() => {
  let rows = Array.isArray(trcloudStore.expenseItemRows) ? [...trcloudStore.expenseItemRows] : []
  
  if (statusFilter.value) {
    rows = rows.filter((row) => String(row.status || '').includes(statusFilter.value))
  }
  
  // กรองตาม Tab: ติดตามงาน (แสดงข้อมูลทั้งหมดยกเว้นรายการที่สำเร็จแล้ว)
  if (activeTab.value === 'tracking') {
    rows = rows.filter((row) => {
      const s = String(row.status || '').toLowerCase()
      // Success includes 'ชำระแล้ว', 'paid', 'เรียบร้อย', 'เสร็จสิ้น', 'สำเร็จ'
      const isSuccess = s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('เรียบร้อย') || s.includes('เสร็จสิ้น') || s.includes('สำเร็จ')
      
      // แสดงข้อมูลทั้งหมดยกเว้น Success โดยไม่สนการติ๊กถูก
      return !isSuccess
    })
  }

  const q = searchQuery.value.toLowerCase().trim()
  if (q) {
    rows = rows.filter((row) =>
      [row.doc_number, row.ref_po, row.organization, row.item_name, row.status]
        .join(' | ')
        .toLowerCase()
        .includes(q)
    )
  }
  return rows.sort((a, b) => {
    // ในโหมดติดตามงาน: ให้รายการที่ติ๊กเลือกล่าสุดขึ้นบนสุด
    if (activeTab.value === 'tracking') {
      const idA = getRowIdentity(a)
      const idB = getRowIdentity(b)
      const trackedA = trackedRowIds.value.indexOf(idA)
      const trackedB = trackedRowIds.value.indexOf(idB)

      if (trackedA !== -1 && trackedB !== -1) return trackedA - trackedB
      if (trackedA !== -1) return -1
      if (trackedB !== -1) return 1
    }

    const dateA = a.issue_date || ''
    const dateB = b.issue_date || ''
    if (dateA === dateB) return String(a.doc_number || '').localeCompare(String(b.doc_number || ''))
    return dateB.localeCompare(dateA)
  })
})

const itemCount = computed(() => (trcloudStore.expenseItemRows || []).length)
const invoiceCount = computed(() => (trcloudStore.expenseRows || []).length)
const loading = computed(() => trcloudStore.loading)

async function refreshExpenseItemRows() {
  await trcloudStore.fetchTrcloudData('expense', { force: true })
  cleanupTrackedIds()
}

// ล้างข้อมูลทุกครั้งที่ข้อมูลใน Store เปลี่ยนแปลง
watch(() => trcloudStore.expenseItemRows, () => {
  cleanupTrackedIds()
  // ล้างรายการที่เลือกถ้าข้อมูลหลักเปลี่ยน
  selectedRows.value = []
}, { deep: true })

function getIdentityString(row) {
  const doc = row.doc_number || row.invoice_number || '-'
  const item = row.item_name || '-'
  return `${doc} | ${item} [EXP]`
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
    // ถ้าไม่มี doc_number ให้เลือกเฉพาะแถวนั้น (Fallback)
    const id = getRowIdentity(row)
    const index = selectedRows.value.findIndex(r => getRowIdentity(r) === id)
    if (index === -1) selectedRows.value.push(row)
    else selectedRows.value.splice(index, 1)
    return
  }

  // หาแถวทั้งหมดที่มี doc_number เดียวกันในรายการที่แสดงอยู่ (filteredRows)
  const sameDocRows = filteredRows.value.filter(r => r.doc_number === docNum)
  const isCurrentlySelected = isSelected(row)

  if (isCurrentlySelected) {
    // เอาออกเฉพาะรายการที่คลิก เพื่อให้สามารถยกเลิกบางรายการในกลุ่มได้
    const currentId = getRowIdentity(row)
    selectedRows.value = selectedRows.value.filter(r => getRowIdentity(r) !== currentId)
  } else {
    // ถ้ายังไม่ได้เลือก ให้เพิ่มทั้งหมดที่ยังไม่ได้อยู่ใน selectedRows
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

onMounted(() => {
  loadTrackedRowIdsFromCloud()
  loadTrackingStatus('exp')
  if (!trcloudStore.expenseRows.length) {
    refreshExpenseItemRows()
  }
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">TRCloud EXP รายการรายจ่าย</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงรายการ EXP แบบแยกแถวตามสินค้า/รายการในแต่ละบิล พร้อมเลขที่เอกสาร คู่ค้า คำอธิบายสินค้า และสถานะ</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">จำนวนแถวรายการสินค้า</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ itemCount }}</div>
      </div>
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">จำนวนใบ EXP</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ invoiceCount }}</div>
      </div>
    </div>

    <!-- Tabs Selection -->
    <div class="flex items-center gap-1 mb-4 p-1 rounded-xl w-fit" style="background: var(--color-bg-card); border: 1px solid var(--color-border)">
      <button 
        @click="activeTab = 'all'"
        :class="activeTab === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'"
        class="px-6 py-2 rounded-lg text-[13px] font-medium transition-all"
      >
        ข้อมูลทั้งหมด
      </button>
      <button 
        @click="activeTab = 'tracking'"
        :class="activeTab === 'tracking' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'"
        class="px-6 py-2 rounded-lg text-[13px] font-medium transition-all"
      >
        ติดตามงาน
      </button>
    </div>

    <div class="flex flex-col md:flex-row gap-3 mb-5 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
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
          placeholder="ค้นหา doc_number / คู่ค้า / รายการสินค้า / สถานะ"
          class="w-full pl-10 pr-4 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <button @click="refreshExpenseItemRows" :disabled="loading" class="px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
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
          ส่ง {{ selectedRows.length }} รายการไปฟอร์ม
        </button>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1340px] border-collapse table-fixed">
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
                      ส่งข้อมูลฟอร์ม EXP
                    </button>
                  </div>
                </div>
              </th>
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขexp</th>
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อ้างอิง PO</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อายุ (วัน)</th>
              <th class="px-4 py-3 font-medium w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">คู่ค้า</th>
              <th class="px-4 py-3 font-medium min-w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการสินค้า / คำอธิบาย</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดที่ชำระ</th>
              <th class="px-4 py-3 font-medium text-center w-[70px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ติดตาม</th>
              <th class="px-4 py-3 font-medium w-[120px]" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="px-4 py-12 text-center">
                <div class="flex flex-col items-center gap-2">
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                  <span style="color: var(--color-text-muted)">กำลังดึงข้อมูลจาก TRCLOUD...</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="!filteredRows.length">
              <td colspan="10" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบรายการ EXP รายการสินค้า</td>
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
                      ส่งไปฟอร์ม EXP
                    </button>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ row.doc_number || '-' }}</td>
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ row.ref_po || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ row.issue_date || '-' }}</td>
              <td class="px-4 py-3 font-mono" style="border-right: 1px solid var(--color-border)" :style="{ color: calculateAge(row.issue_date) > 30 ? '#ef4444' : calculateAge(row.issue_date) > 15 ? '#f59e0b' : 'var(--color-text-primary)' }">
                {{ calculateAge(row.issue_date) }} วัน
              </td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ row.organization || '-' }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                <div v-if="row.acc_code" class="text-[11px] font-mono text-blue-500 mb-0.5">{{ row.acc_code }}</div>
                <div>{{ row.invoice_note || row.item_name || '-' }}</div>
                <div class="flex flex-wrap gap-1 mt-1">
                  <span v-if="isAddedToTracking(row)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: rgba(16,185,129,0.15); color: #16a34a">
                    <i class="fa-solid fa-circle-check"></i> เข้าตารางแล้ว
                  </span>
                  <span v-if="isLineSent(row)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: rgba(6,182,212,0.15); color: #0891b2">
                    <i class="fa-brands fa-line"></i> ส่ง LINE แล้ว
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ Number(row.payment || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 text-center" style="border-right: 1px solid var(--color-border)">
                <input
                  type="checkbox"
                  class="w-4 h-4 accent-blue-600 cursor-pointer"
                  :checked="isTracked(row)"
                  @change="toggleTracked(row, $event.target.checked)"
                />
              </td>
              <td class="px-4 py-3">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border inline-block text-center w-full" :style="{
                  backgroundColor: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') || row.status === 'รอชำระ' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                  color: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') || row.status === 'รอชำระ' ? '#ef4444' : '#16a34a',
                  borderColor: row.status?.toString().toLowerCase().includes('ยังไม่') || row.status?.toString().toLowerCase().includes('unpaid') || row.status === 'รอชำระ' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'
                }">
                  {{ mapStatus(row.status) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
