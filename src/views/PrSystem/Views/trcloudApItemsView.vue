<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const trcloudStore = useTrcloudStore()
const auth = useAuthStore()
const emit = defineEmits(['selectPage'])
const searchQuery = ref('')
const statusFilter = ref('')
const activeTab = ref('all') // 'all' or 'tracking'
const openMenuId = ref(null) // ID ของแถวที่เปิดเมนูค้างไว้

const TRACK_STORAGE_KEY = 'trcloud_ap_tracked_rows'
const TRACK_TABLE = 'trcloud_tracking'
const TRACK_DOC_TYPE = 'ap'
const trackedRowIds = ref(loadTrackedRowIds())

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
    persistTrackedRowIds()
  } catch (err) {
    console.warn('AP item track cloud load failed:', err?.message || err)
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
    console.warn('AP item track cloud sync failed:', err?.message || err)
  }
}

function getRowIdentity(row) {
  // สร้าง Identity ที่ไม่ซ้ำกันรายบรรทัดสินค้า โดยใช้ เลขที่เอกสาร + ชื่อสินค้า + จำนวน + ราคา
  const doc = row.doc_number || row.invoice_number || row.ap_id || row.id || ''
  const item = row.item_name || ''
  const qty = row.quantity || ''
  const price = row.price || ''
  return String(`${doc}|${item}|${qty}|${price}`)
}

function isTracked(row) {
  const id = getRowIdentity(row)
  return id ? trackedRowIds.value.includes(id) : false
}

function toggleTracked(row, checked) {
  const currentId = getRowIdentity(row)
  const docNo = row.doc_number || row.invoice_number || ''
  
  if (checked) {
    // กรณีติ๊กถูก: ให้เลือกทุกรายการที่มีเลขที่เอกสารเดียวกัน
    const relatedRows = trcloudStore.apItemRows.filter(r => 
      (r.doc_number || r.invoice_number) === docNo
    )
    
    const newIds = relatedRows.map(getRowIdentity).filter(Boolean)
    trackedRowIds.value = [...new Set([...trackedRowIds.value, ...newIds])]
    
    persistTrackedRowIds()
    setTrackedCloud(newIds, true)
  } else {
    // กรณีติ๊กออก: ให้ยกเลิกเฉพาะรายการที่กดเท่านั้น
    if (!currentId) return
    trackedRowIds.value = trackedRowIds.value.filter((x) => x !== currentId)
    
    persistTrackedRowIds()
    setTrackedCloud(currentId, false)
  }
}

const availableStatuses = computed(() => {
  if (!trcloudStore.apItemRows) return []
  return [...new Set(trcloudStore.apItemRows.map((r) => r.status).filter(Boolean))].sort()
})

const filteredRows = computed(() => {
  let rows = Array.isArray(trcloudStore.apItemRows) ? [...trcloudStore.apItemRows] : []
  
  if (statusFilter.value) {
    rows = rows.filter((row) => String(row.status || '').includes(statusFilter.value))
  }
  
  // กรองตาม Tab: ติดตามงาน (แสดงเฉพาะยังไม่ชำระ)
  if (activeTab.value === 'tracking') {
    rows = rows.filter((row) => {
      const s = String(row.status || '').toLowerCase()
      return s.includes('ยังไม่') || s.includes('unpaid') || s.includes('pending') || s.includes('ค้าง')
    })
  }

  const q = searchQuery.value.toLowerCase().trim()
  if (q) {
    rows = rows.filter((row) =>
      [row.doc_number, row.organization, row.item_name, row.status]
        .join(' | ')
        .toLowerCase()
        .includes(q)
    )
  }
  return rows.sort((a, b) => {
    const dateA = a.issue_date || ''
    const dateB = b.issue_date || ''
    if (dateA === dateB) return String(a.doc_number || '').localeCompare(String(b.doc_number || ''))
    return dateB.localeCompare(dateA)
  })
})

const itemCount = computed(() => (trcloudStore.apItemRows || []).length)
const invoiceCount = computed(() => (trcloudStore.apRows || []).length)
const loading = computed(() => trcloudStore.loading)

async function refreshApItemRows() {
  trcloudStore.fetchTrcloudData('ap', { force: true })
}

function sendToAppo(row) {
  const doc = row.doc_number || row.invoice_number || '-'
  const item = row.item_name || '-'
  const identity = `${doc} | ${item} [AP]`
  
  trcloudStore.pendingAutofill = identity
  emit('selectPage', { itemId: "/#/form_appo", itemLabel: "ฟอร์ม AP/PO" })
  openMenuId.value = null
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
  if (!trcloudStore.apRows.length) {
    refreshApItemRows()
  }
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">TRCloud AP รายการสินค้า</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงรายการ AP แบบแยกแถวตามสินค้า/รายการในแต่ละบิล พร้อมเลขที่เอกสาร คู่ค้า คำอธิบายสินค้า และสถานะ</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">จำนวนแถวรายการสินค้า</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ itemCount }}</div>
      </div>
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">จำนวนใบ AP</div>
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
          placeholder="ค้นหา เลขที่เอกสาร / คู่ค้า / รายการสินค้า / สถานะ"
          class="w-full pl-10 pr-4 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <button @click="refreshApItemRows" :disabled="loading" class="px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
        <i class="fa-solid fa-rotate mr-2" :class="loading ? 'fa-spin' : ''"></i>
        รีเฟรชข้อมูล
      </button>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1000px] border-collapse table-fixed">
          <thead>
            <tr class="text-left" style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 font-medium w-[50px] text-center" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">#</th>
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 font-medium w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">คู่ค้า</th>
              <th class="px-4 py-3 font-medium min-w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการสินค้า / คำอธิบาย</th>
              <th class="px-4 py-3 font-medium w-[80px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">จำนวน</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ราคา/หน่วย</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดรวม</th>
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
              <td colspan="10" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบรายการ AP รายการสินค้า</td>
            </tr>
            <tr v-for="(row, index) in filteredRows" :key="`${row.doc_number || ''}_${row.item_name || ''}_${row.price || ''}_${index}`" class="hover:bg-gray-50/50 transition-colors" style="border-bottom: 1px solid var(--color-border)">
              <td class="px-4 py-3 text-center relative" style="border-right: 1px solid var(--color-border)">
                <button 
                  @click="toggleMenu(`${row.doc_number}_${index}`)"
                  class="p-1 hover:bg-gray-100 rounded-md transition-colors"
                >
                  <i class="fa-solid fa-ellipsis-vertical text-gray-500"></i>
                </button>
                
                <!-- Dropdown Menu -->
                <div 
                  v-if="openMenuId === `${row.doc_number}_${index}`"
                  class="absolute left-full top-0 ml-1 w-48 rounded-lg shadow-xl border z-50 py-1"
                  style="background: var(--color-bg-card); border-color: var(--color-border)"
                >
                  <button 
                    @click="sendToAppo(row)"
                    class="w-full text-left px-4 py-2 text-[12px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                    style="color: var(--color-text-primary)"
                  >
                    <i class="fa-solid fa-paper-plane text-blue-500"></i>
                    ส่งไปฟอร์ม AP/PO
                  </button>
                </div>
              </td>
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary)">{{ row.doc_number || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.issue_date || '-' }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.organization || '-' }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.item_name || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.quantity || '-' }}</td>
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
