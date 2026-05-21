<script setup>
import { ref, onMounted, computed } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

// State
const imports = ref([])
const loading = ref(true)
const searchText = ref('')
const dateFilter = ref('all') // all, today, week, month

// Fetch Data
async function fetchImports() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('inventory_imports')
      .select(`
        *,
        item:items(item_code, item_name, usage_type),
        creator:system_users!created_by(fullname)
      `)
      .eq('note', 'เติมสินค้า (Restock)')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    imports.value = data
  } catch (err) {
    console.error('Error fetching imports:', err.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchImports()
})

// Computed Filtered Data
const filteredImports = computed(() => {
  return imports.value.filter(imp => {
    const itemMatch = imp.item?.item_name?.toLowerCase().includes(searchText.value.toLowerCase()) || 
                      imp.item?.item_code?.toLowerCase().includes(searchText.value.toLowerCase()) ||
                      imp.note?.toLowerCase().includes(searchText.value.toLowerCase())
    
    if (!itemMatch) return false

    if (dateFilter.value === 'all') return true
    
    const impDate = new Date(imp.created_at)
    const now = new Date()
    
    if (dateFilter.value === 'today') {
      return impDate.toDateString() === now.toDateString()
    } else if (dateFilter.value === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return impDate >= weekAgo
    } else if (dateFilter.value === 'month') {
      return impDate.getMonth() === now.getMonth() && impDate.getFullYear() === now.getFullYear()
    }
    
    return true
  })
})

// Export to Excel
function exportToExcel() {
  const dataToExport = filteredImports.value.map(imp => ({
    'วันที่-เวลา': new Date(imp.created_at).toLocaleString('th-TH'),
    'รหัสสินค้า': imp.item?.item_code || '-',
    'ชื่อสินค้า': imp.item?.item_name || '-',
    'ประเภทที่ใช้': String(imp.item?.usage_type ?? '').trim() || '-',
    'จำนวน': imp.amount,
    'หน่วย': imp.unit,
    'ผู้ดำเนินการ': imp.creator?.fullname || '-',
    'ประเภทรายการ': 'เติมสินค้า (Restock)',
    'หมายเหตุ': imp.remark || '-'
  }))

  const worksheet = XLSX.utils.json_to_sheet(dataToExport)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Restock History')
  
  // Set column widths
  const wscols = [
    {wch: 20}, {wch: 15}, {wch: 25}, {wch: 18},
    {wch: 10}, {wch: 10}, {wch: 20}, {wch: 20}, {wch: 30}
  ]
  worksheet['!cols'] = wscols

  XLSX.writeFile(workbook, `Inventory_Imports_${new Date().toISOString().slice(0,10)}.xlsx`)
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <AppLayout>
    <!-- Header Section -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ประวัติการเพิ่มสินค้า</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะรายการ <strong>เติมสินค้า (Restock)</strong> — ไม่รวมการนำเข้าครั้งแรก</p>
      </div>
      <div>
        <button @click="exportToExcel" 
                class="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 shadow-sm">
          <i class="fa-solid fa-file-excel"></i>
          ส่งออกไฟล์ Excel
        </button>
      </div>
    </div>

    <!-- Filters Section -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="md:col-span-2 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input 
          v-model="searchText"
          type="text" 
          placeholder="ค้นหาด้วยรหัสสินค้า, ชื่อสินค้า หรือหมายเหตุ..." 
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <div>
        <select 
          v-model="dateFilter"
          class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="background-color: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <option value="all" style="background-color: var(--color-bg-card)">ทั้งหมด</option>
          <option value="today" style="background-color: var(--color-bg-card)">วันนี้</option>
          <option value="week" style="background-color: var(--color-bg-card)">ใน 7 วันนี้</option>
          <option value="month" style="background-color: var(--color-bg-card)">ในเดือนนี้</option>
        </select>
      </div>
    </div>

    <!-- Table Section -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">วันที่-เวลา</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
              <th class="text-right px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หน่วย</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้ดำเนินการ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภทรายการ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ไฟล์แนบ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="px-4 py-12 text-center">
                <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-500"></i>
                <p style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</p>
              </td>
            </tr>
            <tr v-else-if="filteredImports.length === 0">
              <td colspan="9" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">
                <i class="fa-solid fa-folder-open text-2xl mb-2 opacity-20"></i>
                <p>ไม่พบประวัติการเติมสินค้า (Restock)</p>
              </td>
            </tr>
            <tr v-for="imp in filteredImports" :key="imp.id"
                class="border-b last:border-b-0 hover:bg-gray-50/50 dark:hover:bg-slate-700/30 transition-colors"
                style="border-color: var(--color-border)">
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                {{ formatDate(imp.created_at) }}
              </td>
              <td class="px-4 py-3">
                <div class="font-medium" style="color: var(--color-text-primary)">{{ imp.item?.item_name }}</div>
                <div class="text-[11px] font-mono mt-0.5" style="color: var(--color-text-muted)">{{ imp.item?.item_code }}</div>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                {{ String(imp.item?.usage_type ?? '').trim() || '-' }}
              </td>
              <td class="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-500">
                +{{ imp.amount }}
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ imp.unit }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-bold text-blue-600">
                    {{ imp.creator?.fullname?.charAt(0) }}
                  </div>
                  <span style="color: var(--color-text-secondary)">{{ imp.creator?.fullname || '-' }}</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  เติมสินค้า (Restock)
                </span>
              </td>
              <td class="px-4 py-3">
                <div v-if="imp.document_url" class="flex items-center gap-2">
                  <a :href="imp.document_url" target="_blank" class="text-blue-600 hover:underline">เปิดไฟล์</a>
                </div>
                <span v-else style="color: var(--color-text-muted)">-</span>
              </td>
              <td class="px-4 py-3 italic" style="color: var(--color-text-muted)">
                {{ imp.remark || '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus, select:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
