<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'
import { supabase } from '@/lib/supabase'

const trcloudStore = useTrcloudStore()
const loading = ref(true)
const trackedData = ref({
  pr: [],
  po: [],
  ap: [],
  pv: []
})

const activeTab = ref('pr') // 'pr', 'po', 'ap', 'pv'
const searchQuery = ref('')
const viewedTabs = ref([])
const currentTime = ref(new Date())

// อัปเดตเวลาทุกนาที
onMounted(() => {
  fetchTrackedData()
  const timer = setInterval(() => {
    currentTime.value = new Date()
  }, 60000)
})

function formatCurrentDate(date) {
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatCurrentTime(date) {
  return date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) + ' น.'
}

function handleTabClick(tab) {
  activeTab.value = tab
  if (!viewedTabs.value.includes(tab)) {
    viewedTabs.value.push(tab)
  }
}

// ฟังก์ชันดึงข้อมูลที่ถูก Track จาก Supabase
async function fetchTrackedData() {
  loading.value = true
  try {
    // 1. ดึงข้อมูลจาก TRCloud Store ทั้งหมดก่อน
    const fetchPromises = []
    if (!trcloudStore.prRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('pr'))
    if (!trcloudStore.poRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('po'))
    if (!trcloudStore.apRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('ap'))
    if (!trcloudStore.pvRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('pv'))
    if (fetchPromises.length) await Promise.all(fetchPromises)

    // 2. ดึงข้อมูล doc_key ที่ถูกติ๊ก Tracking จาก Supabase
    const { data: cloudTracking, error } = await supabase
      .from('trcloud_tracking')
      .select('doc_type, doc_key')
      .eq('checked', true)

    if (error) throw error

    // 3. กรองและจัดกลุ่มข้อมูล พร้อมล้างข้อมูลที่สำเร็จแล้ว
    const grouped = { pr: [], po: [], ap: [], pv: [] }
    const keysToUncheck = []
    
    cloudTracking.forEach(track => {
      const type = track.doc_type.toLowerCase()
      const key = String(track.doc_key)
      
      let found = null
      if (type === 'pr') found = trcloudStore.prRows.find(r => getRowIdentity(r) === key)
      else if (type === 'po') {
        // สำหรับ PO ใช้ข้อมูลจาก poItemRows เพื่อให้ได้รายละเอียดสินค้า
        const items = trcloudStore.poItemRows.filter(r => getRowIdentity(r) === key)
        if (items.length > 0) {
          items.forEach(item => {
            if (!isSuccessStatus(item.status)) grouped.po.push(item)
            else keysToUncheck.push({ type, key })
          })
        }
        return
      }
      else if (type === 'ap') {
        // สำหรับ AP กรองเอาเฉพาะ "ยังไม่ชำระ"
        const items = trcloudStore.apItemRows.filter(r => getRowIdentity(r) === key)
        if (items.length > 0) {
          items.forEach(item => {
            if (isUnpaidStatus(item.status)) grouped.ap.push(item)
            else keysToUncheck.push({ type, key }) // ถ้าสถานะเปลี่ยนเป็นชำระแล้ว ให้เตรียมปลดการติดตาม
          })
        }
        return
      }
      else if (type === 'pv') found = trcloudStore.pvRows.find(r => getRowIdentity(r) === key)

      if (found) {
        if (!isSuccessStatus(found.status)) {
          grouped[type].push(found)
        } else {
          // ถ้าสถานะกลายเป็นสำเร็จแล้ว ให้เก็บ key ไว้เพื่อปลดการติดตามใน Supabase
          keysToUncheck.push({ type, key })
        }
      }
    });

    // 4. ทำการ Auto-Cleanup ปลดการติดตามรายการที่สำเร็จแล้วใน Supabase อัตโนมัติ
    if (keysToUncheck.length > 0) {
      for (const item of keysToUncheck) {
        await supabase
          .from('trcloud_tracking')
          .update({ checked: false })
          .match({ doc_type: item.type.toUpperCase(), doc_key: item.key })
      }
    }

    trackedData.value = grouped
  } catch (err) {
    console.error('Failed to fetch tracking data:', err)
  } finally {
    loading.value = false
  }
}

// ข้อมูลที่ผ่านการกรองค้นหา
const filteredTrackedData = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return trackedData.value

  const filterFn = (items) => items.filter(item => 
    JSON.stringify(item).toLowerCase().includes(q)
  )

  return {
    pr: filterFn(trackedData.value.pr),
    po: filterFn(trackedData.value.po),
    ap: filterFn(trackedData.value.ap),
    pv: filterFn(trackedData.value.pv)
  }
})

function getRowIdentity(row) {
  return String(row.unique_id || row.document_number || row.po_id || row.pr_id || row.ap_id || row.id || '')
}

function isSuccessStatus(status) {
  const s = (status || '').toString().toLowerCase()
  return s.includes('success') || s.includes('เสร็จสิ้น') || s.includes('เรียบร้อย')
}

function isUnpaidStatus(status) {
  const s = (status || '').toString().toLowerCase()
  return s.includes('ยังไม่') || s.includes('unpaid') || s.includes('ค้าง')
}

function calculateDocAge(dateStr) {
  if (!dateStr) return '-'
  const docDate = new Date(dateStr)
  if (isNaN(docDate)) return '-'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  docDate.setHours(0, 0, 0, 0)
  const diffTime = today - docDate
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? `${diffDays} วัน` : 'วันนี้'
}

function getBadgeInfo(status) {
  if (!status) return { text: '—', bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' }
  const s = status.toString().toLowerCase()
  if (s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('complete') || s.includes('อนุมัติ')) {
    return { text: status, bg: 'rgba(0,0,0,0.05)', color: '#000000' }
  }
  if (s.includes('ยังไม่') || s.includes('ค้าง') || s.includes('unpaid') || s.includes('cancel')) {
    return { text: status, bg: 'rgba(239,68,68,0.1)', color: '#ef4444' }
  }
  return { text: status, bg: 'rgba(0,0,0,0.05)', color: '#666666' }
}

const totalTrackedCount = computed(() => {
  return trackedData.value.pr.length + trackedData.value.po.length + trackedData.value.ap.length + trackedData.value.pv.length
})

onMounted(() => {
  // fetchTrackedData() // ลบออกเพราะย้ายไปไว้ใน onMounted ด้านบนแล้ว
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header Section -->
    <div class="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h1 class="text-[20px] font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
          <i class="fa-solid fa-bell text-gray-800 dark:text-white"></i>
          สรุปข้อมูลแจ้งเตือน รายวัน
        </h1>
        <div class="flex items-center gap-3 mt-1">
          <p class="text-[13px]" style="color: var(--color-text-muted)">
            <i class="fa-regular fa-calendar-check mr-1"></i>
            ประจำวันที่: {{ formatCurrentDate(currentTime) }}
          </p>
          <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
          <p class="text-[13px]" style="color: var(--color-text-muted)">
            <i class="fa-regular fa-clock mr-1"></i>
            เวลาแจ้งเตือนล่าสุด: {{ formatCurrentTime(currentTime) }}
          </p>
        </div>
      </div>
      
      <div class="flex items-center gap-3">
        <div class="relative min-w-[300px]">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
          <input 
            v-model="searchQuery" 
            type="text" 
            placeholder="ค้นหาเลขที่เอกสาร, คู่ค้า, Staff..." 
            class="w-full pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-gray-400 transition-all" 
            style="border-color: var(--color-border); color: var(--color-text-primary)" 
          />
        </div>
        <button @click="fetchTrackedData" :disabled="loading" class="px-4 py-2 rounded-lg text-[13px] font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 disabled:opacity-50 transition-colors flex items-center gap-2">
          <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
          อัปเดต
        </button>
      </div>
    </div>

    <!-- Summary Navigation (Unified Bar) -->
    <div class="flex items-center gap-2 p-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl mb-8 w-fit border border-gray-200 dark:border-gray-700">
      <button 
        v-for="type in ['pr', 'po', 'ap', 'pv']" 
        :key="type"
        @click="handleTabClick(type)"
        :class="['px-5 py-2 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 uppercase', activeTab === type ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300']"
      >
        <i 
          :class="[
            'fa-solid', 
            type === 'pr' ? 'fa-file-lines' : type === 'po' ? 'fa-file-invoice-dollar' : type === 'ap' ? 'fa-file-invoice' : 'fa-money-check-dollar',
            (trackedData[type].length > 0 && !viewedTabs.includes(type)) ? 'text-red-500 animate-shake-infinite' : ''
          ]"
        ></i>
        <span>{{ type }}</span>
        <span :class="['px-2 py-0.5 rounded-full text-[11px]', trackedData[type].length > 0 ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-400']">
          {{ trackedData[type].length }}
        </span>
      </button>
    </div>

    <!-- Tables Section -->
    <div class="flex-1 overflow-auto space-y-8 pr-2">
      <div v-if="loading" class="py-20 text-center">
        <i class="fa-solid fa-circle-notch fa-spin text-3xl text-gray-400 mb-4"></i>
        <p style="color: var(--color-text-muted)">กำลังประมวลผลข้อมูลแจ้งเตือน...</p>
      </div>

      <template v-else>
        <!-- PR Section -->
        <div v-if="activeTab === 'pr'" class="space-y-3 h-full">
          <template v-if="filteredTrackedData.pr.length">
            <div class="flex items-center gap-2 px-1">
              <span class="w-1.5 h-5 bg-gray-900 dark:bg-white rounded-full"></span>
              <h2 class="font-bold text-gray-800 dark:text-gray-100">รายการ PR ({{ filteredTrackedData.pr.length }})</h2>
            </div>
            <div class="rounded-xl border overflow-hidden bg-white dark:bg-gray-950 shadow-sm" style="border-color: var(--color-border)">
              <table class="w-full text-[13px] border-collapse">
                <thead class="bg-gray-50 dark:bg-gray-900/50" style="border-bottom: 1px solid var(--color-border)">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">เลขที่เอกสาร</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">วันที่</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">อายุเอกสาร</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">Staff</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">โครงการ</th>
                    <th class="px-4 py-3 text-right font-medium text-gray-500">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in filteredTrackedData.pr" :key="getRowIdentity(r)" class="border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" style="border-color: var(--color-border)">
                    <td class="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">{{ r.document_number || r.pr_id }}</td>
                    <td class="px-4 py-3">{{ r.issue_date || r.date }}</td>
                    <td class="px-4 py-3 font-medium text-red-500">{{ calculateDocAge(r.issue_date || r.date) }}</td>
                    <td class="px-4 py-3">{{ r.staff || '-' }}</td>
                    <td class="px-4 py-3">{{ r.project || '-' }}</td>
                    <td class="px-4 py-3 text-right">
                      <span class="px-2 py-1 rounded-lg text-[11px] font-medium" :style="{ backgroundColor: getBadgeInfo(r.status).bg, color: getBadgeInfo(r.status).color }">
                        {{ getBadgeInfo(r.status).text }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <div v-else class="h-full flex flex-col items-center justify-center py-20 text-center">
            <i class="fa-solid fa-bell-slash text-4xl mb-4 opacity-10"></i>
            <p class="text-[15px] font-medium" style="color: var(--color-text-muted)">ไม่มีข้อความแจ้งเตือน</p>
          </div>
        </div>

        <!-- PO Section -->
        <div v-if="activeTab === 'po'" class="space-y-3 h-full">
          <template v-if="filteredTrackedData.po.length">
            <div class="flex items-center gap-2 px-1">
              <span class="w-1.5 h-5 bg-gray-900 dark:bg-white rounded-full"></span>
              <h2 class="font-bold text-gray-800 dark:text-gray-100">รายการ PO ({{ filteredTrackedData.po.length }})</h2>
            </div>
            <div class="rounded-xl border overflow-hidden bg-white dark:bg-gray-950 shadow-sm" style="border-color: var(--color-border)">
              <div class="overflow-x-auto">
                <table class="w-full text-[12px] border-collapse min-w-[1200px]">
                  <thead class="bg-gray-50 dark:bg-gray-900/50 text-gray-500 font-medium" style="border-bottom: 1px solid var(--color-border)">
                    <tr>
                      <th class="px-3 py-3 text-left">เลขที่เอกสาร</th>
                      <th class="px-3 py-3 text-left">วันที่</th>
                      <th class="px-3 py-3 text-left">อายุ (วัน)</th>
                      <th class="px-3 py-3 text-left">คู่ค้า</th>
                      <th class="px-3 py-3 text-left">รายการสินค้า / คำอธิบาย</th>
                      <th class="px-3 py-3 text-center">จำนวน</th>
                      <th class="px-3 py-3 text-right">ราคา/หน่วย</th>
                      <th class="px-3 py-3 text-right">ยอดรวม</th>
                      <th class="px-3 py-3 text-right">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in filteredTrackedData.po" :key="getRowIdentity(r)" class="border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" style="border-color: var(--color-border)">
                      <td class="px-3 py-3 font-mono font-medium text-purple-600">{{ r.doc_number || r.po_id }}</td>
                      <td class="px-3 py-3 whitespace-nowrap">{{ r.issue_date || r.date }}</td>
                      <td class="px-3 py-3 font-medium text-red-500">{{ calculateDocAge(r.issue_date || r.date) }}</td>
                      <td class="px-3 py-3 max-w-[150px] truncate" :title="r.organization">{{ r.organization || '-' }}</td>
                      <td class="px-3 py-3 max-w-[200px] truncate" :title="r.item_name">{{ r.item_name || '-' }}</td>
                      <td class="px-3 py-3 text-center">{{ r.quantity }} {{ r.unit }}</td>
                      <td class="px-3 py-3 text-right font-mono">{{ Number(r.price || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}</td>
                      <td class="px-3 py-3 text-right font-mono font-bold">{{ Number(r.item_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}</td>
                      <td class="px-3 py-3 text-right">
                        <span class="px-2 py-1 rounded-lg text-[10px] font-medium" :style="{ backgroundColor: getBadgeInfo(r.status).bg, color: getBadgeInfo(r.status).color }">
                          {{ getBadgeInfo(r.status).text }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
          <div v-else class="h-full flex flex-col items-center justify-center py-20 text-center">
            <i class="fa-solid fa-bell-slash text-4xl mb-4 opacity-10"></i>
            <p class="text-[15px] font-medium" style="color: var(--color-text-muted)">ไม่มีข้อความแจ้งเตือน</p>
          </div>
        </div>

        <!-- AP Section -->
        <div v-if="activeTab === 'ap'" class="space-y-3 h-full">
          <template v-if="filteredTrackedData.ap.length">
            <div class="flex items-center gap-2 px-1">
              <span class="w-1.5 h-5 bg-gray-900 dark:bg-white rounded-full"></span>
              <h2 class="font-bold text-gray-800 dark:text-gray-100">รายการ AP เฉพาะ "ยังไม่ชำระ" ({{ filteredTrackedData.ap.length }})</h2>
            </div>
            <div class="rounded-xl border overflow-hidden bg-white dark:bg-gray-950 shadow-sm" style="border-color: var(--color-border)">
              <div class="overflow-x-auto">
                <table class="w-full text-[12px] border-collapse min-w-[1200px]">
                  <thead class="bg-gray-50 dark:bg-gray-900/50 text-gray-500 font-medium" style="border-bottom: 1px solid var(--color-border)">
                    <tr>
                      <th class="px-3 py-3 text-left">เลขที่เอกสาร</th>
                      <th class="px-3 py-3 text-left">อ้างอิง PO</th>
                      <th class="px-3 py-3 text-left">วันที่</th>
                      <th class="px-3 py-3 text-left">อายุ (วัน)</th>
                      <th class="px-3 py-3 text-left">คู่ค้า</th>
                      <th class="px-3 py-3 text-left">รายการสินค้า / คำอธิบาย</th>
                      <th class="px-3 py-3 text-center">จำนวน</th>
                      <th class="px-3 py-3 text-right">ราคา/หน่วย</th>
                      <th class="px-3 py-3 text-right">ยอดรวม</th>
                      <th class="px-3 py-3 text-right">ยอดที่ชำระ</th>
                      <th class="px-3 py-3 text-right">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in filteredTrackedData.ap" :key="getRowIdentity(r)" class="border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" style="border-color: var(--color-border)">
                      <td class="px-3 py-3 font-mono font-medium text-gray-900 dark:text-white">{{ r.doc_number || r.invoice_number }}</td>
                      <td class="px-3 py-3 font-mono text-gray-500">{{ r.ref_po || '-' }}</td>
                      <td class="px-3 py-3 whitespace-nowrap">{{ r.issue_date }}</td>
                      <td class="px-3 py-3 font-medium text-red-500">{{ calculateDocAge(r.issue_date) }}</td>
                      <td class="px-3 py-3 max-w-[150px] truncate" :title="r.organization">{{ r.organization || '-' }}</td>
                      <td class="px-3 py-3 max-w-[200px] truncate" :title="r.item_name">{{ r.item_name || '-' }}</td>
                      <td class="px-3 py-3 text-center">{{ r.quantity }} {{ r.unit }}</td>
                      <td class="px-3 py-3 text-right font-mono">{{ Number(r.price || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}</td>
                      <td class="px-3 py-3 text-right font-mono font-bold">{{ Number(r.item_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}</td>
                      <td class="px-3 py-3 text-right font-mono text-emerald-600">{{ Number(r.payment || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}</td>
                      <td class="px-3 py-3 text-right">
                        <span class="px-2 py-1 rounded-lg text-[10px] font-medium" :style="{ backgroundColor: getBadgeInfo(r.status).bg, color: getBadgeInfo(r.status).color }">
                          {{ getBadgeInfo(r.status).text }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
          <div v-else class="h-full flex flex-col items-center justify-center py-20 text-center">
            <i class="fa-solid fa-bell-slash text-4xl mb-4 opacity-10"></i>
            <p class="text-[15px] font-medium" style="color: var(--color-text-muted)">ไม่มีข้อความแจ้งเตือน</p>
          </div>
        </div>

        <!-- PV Section -->
        <div v-if="activeTab === 'pv'" class="space-y-3 h-full">
          <template v-if="filteredTrackedData.pv.length">
            <div class="flex items-center gap-2 px-1">
              <span class="w-1.5 h-5 bg-gray-900 dark:bg-white rounded-full"></span>
              <h2 class="font-bold text-gray-800 dark:text-gray-100">รายการ PV ({{ filteredTrackedData.pv.length }})</h2>
            </div>
            <div class="rounded-xl border overflow-hidden bg-white dark:bg-gray-950 shadow-sm" style="border-color: var(--color-border)">
              <table class="w-full text-[13px] border-collapse">
                <thead class="bg-gray-50 dark:bg-gray-900/50" style="border-bottom: 1px solid var(--color-border)">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">เลขที่เอกสาร</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">วันที่</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">อายุเอกสาร</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">Staff</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-500">โครงการ</th>
                    <th class="px-4 py-3 text-right font-medium text-gray-500">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in filteredTrackedData.pv" :key="getRowIdentity(r)" class="border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" style="border-color: var(--color-border)">
                    <td class="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">{{ r.document_number || r.pv_id }}</td>
                    <td class="px-4 py-3">{{ r.issue_date || r.date }}</td>
                    <td class="px-4 py-3 font-medium text-red-500">{{ calculateDocAge(r.issue_date || r.date) }}</td>
                    <td class="px-4 py-3">{{ r.staff || '-' }}</td>
                    <td class="px-4 py-3">{{ r.project || '-' }}</td>
                    <td class="px-4 py-3 text-right">
                      <span class="px-2 py-1 rounded-lg text-[11px] font-medium" :style="{ backgroundColor: getBadgeInfo(r.status).bg, color: getBadgeInfo(r.status).color }">
                        {{ getBadgeInfo(r.status).text }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <div v-else class="h-full flex flex-col items-center justify-center py-20 text-center">
            <i class="fa-solid fa-bell-slash text-4xl mb-4 opacity-10"></i>
            <p class="text-[15px] font-medium" style="color: var(--color-text-muted)">ไม่มีข้อความแจ้งเตือน</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes shake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-1px); }
  50% { transform: translateX(1px); }
  75% { transform: translateX(-1px); }
  100% { transform: translateX(0); }
}

.animate-shake-infinite {
  animation: shake 0.5s infinite;
}

.overflow-auto::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.overflow-auto::-webkit-scrollbar-track {
  background: transparent;
}
.overflow-auto::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.3);
  border-radius: 10px;
}
</style>