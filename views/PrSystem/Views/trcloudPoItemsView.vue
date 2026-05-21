<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const trcloudStore = useTrcloudStore()
const auth = useAuthStore()
const searchQuery = ref('')
const statusFilter = ref('')
const viewMode = ref('all') // 'all' or 'tracked'

const TRACK_STORAGE_KEY = 'trcloud_po_tracked_rows'
const TRACK_TABLE = 'trcloud_tracking'
const TRACK_DOC_TYPE = 'po'
const trackedRowIds = ref(loadTrackedRowIds())
const sortingTrackedIds = ref([...trackedRowIds.value])

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
    trackedRowIds.value = [...new Set([...trackedRowIds.value, ...cloudIds])]
    sortingTrackedIds.value = [...trackedRowIds.value]
    persistTrackedRowIds()
  } catch (err) {
    console.warn('PO item track cloud load failed:', err?.message || err)
  }
}

async function setTrackedCloud(docKeys, checked) {
  try {
    const keys = Array.isArray(docKeys) ? docKeys : [docKeys]
    if (checked) {
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
    console.warn('PO item track cloud sync failed:', err?.message || err)
  }
}

function getRowIdentity(row) {
  if (!row) return ''
  // Use a combination of fields to make it unique per item row
  return `${row.doc_number || ''}|${row.item_name || ''}|${row.quantity || ''}|${row.price || ''}`
}

function isTracked(row) {
  const id = getRowIdentity(row)
  return id ? trackedRowIds.value.includes(id) : false
}

async function toggleTracked(row, checked) {
  const currentId = getRowIdentity(row)
  const docNumber = row.doc_number || ''
  
  if (checked) {
    // Select ALL items with the same doc_number
    const itemsInSamePo = trcloudStore.poItemRows.filter((r) => (r.doc_number || r.invoice_number) === docNumber)
    const newIds = itemsInSamePo.map(getRowIdentity).filter(Boolean)
    
    trackedRowIds.value = [...new Set([...newIds, ...trackedRowIds.value])]
    persistTrackedRowIds()
    await setTrackedCloud(newIds, true)
  } else {
    // Unselect ONLY this specific item
    if (!currentId) return
    trackedRowIds.value = trackedRowIds.value.filter((x) => x !== currentId)
    persistTrackedRowIds()
    await setTrackedCloud(currentId, false)
  }
}

const availableStatuses = computed(() => {
  return [...new Set(trcloudStore.poItemRows.map((r) => r.status).filter(Boolean))].sort()
})

const filteredRows = computed(() => {
  let rows = trcloudStore.poItemRows
  
  if (statusFilter.value) {
    rows = rows.filter((row) => String(row.status || '').includes(statusFilter.value))
  }
  
  if (viewMode.value === 'tracked') {
    rows = rows.filter((row) => {
      const status = String(row.status || '').toLowerCase()
      const isNew = status === 'new'
      const isSuccess = status === 'success' || status === 'สำเร็จ' || status.includes('สำเร็จ')
      
      // ในโหมดติดตามงาน: ไม่แสดง Success และแสดงเฉพาะ New หรือรายการที่เลือกติดตามไว้
      return !isSuccess && (isNew || isTracked(row))
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
  sortingTrackedIds.value = [...trackedRowIds.value]
}

// Update sorting order when switching view mode
watch(viewMode, () => {
  sortingTrackedIds.value = [...trackedRowIds.value]
})

onMounted(() => {
  loadTrackedRowIdsFromCloud()
  if (!trcloudStore.poRows.length) {
    refreshPoItemRows()
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
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1100px] border-collapse">
          <thead>
            <tr class="text-left" style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อ้างอิงEXP</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">อายุ (วัน)</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">คู่ค้า</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการสินค้า / คำอธิบาย</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">จำนวน</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">หน่วย</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ราคา/หน่วย</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดรวม</th>
              <th class="px-4 py-3 font-medium text-center" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ติดตาม</th>
              <th class="px-4 py-3 font-medium" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="12" class="px-4 py-12 text-center">
                <div class="flex flex-col items-center gap-2">
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                  <span style="color: var(--color-text-muted)">กำลังดึงข้อมูลจาก TRCLOUD...</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="!filteredRows.length">
              <td colspan="12" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบรายการ PO รายการสินค้า</td>
            </tr>
            <tr v-for="row in filteredRows" :key="`${row.doc_number || ''}_${row.item_name || ''}_${row.price || ''}`" class="hover:bg-gray-50/50 transition-colors" style="border-bottom: 1px solid var(--color-border)">
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ row.doc_number || '-' }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ row.expense || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.issue_date || '-' }}</td>
              <td class="px-4 py-3 font-mono" :style="{ color: calculateAge(row.issue_date) > 30 ? '#ef4444' : calculateAge(row.issue_date) > 15 ? '#f59e0b' : 'var(--color-text-primary)' }">
                {{ calculateAge(row.issue_date) }} วัน
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.organization || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.item_name || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.quantity || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.unit || '-' }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ Number(row.price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ Number(row.item_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  class="w-4 h-4 accent-blue-600 cursor-pointer"
                  :checked="isTracked(row)"
                  @change="toggleTracked(row, $event.target.checked)"
                />
              </td>
              <td class="px-4 py-3">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border" :style="{
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
