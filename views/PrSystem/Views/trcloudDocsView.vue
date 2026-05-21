<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const trcloudStore = useTrcloudStore()
const searchQuery = ref('')
const docTypeFilter = ref('')
const statusFilter = ref('')

const typeOptions = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'PO', label: 'PO' },
  { value: 'AP', label: 'AP' },
]

const combinedRows = computed(() => {
  const poItems = (trcloudStore.poItemRows || []).map((item, idx) => ({
    id: `PO_${item.doc_number}_${idx}`,
    type: 'PO',
    docNumber: item.doc_number,
    date: item.issue_date || '-',
    organization: item.organization || '-',
    productName: item.item_name || '-',
    status: item.status || '-',
    amount: parseFloat(item.item_total || 0),
    raw: item,
  }))

  const apItems = (trcloudStore.apItemRows || []).map((item, idx) => ({
    id: `AP_${item.doc_number}_${idx}`,
    type: 'AP',
    docNumber: item.doc_number,
    date: item.issue_date || '-',
    organization: item.organization || '-',
    productName: item.item_name || '-',
    status: item.status || '-',
    amount: parseFloat(item.item_total || 0),
    raw: item,
  }))

  return [...poItems, ...apItems]
})

const filteredRows = computed(() => {
  let rows = combinedRows.value
  if (docTypeFilter.value) {
    rows = rows.filter((row) => row.type === docTypeFilter.value)
  }
  if (statusFilter.value) {
    const lowerStatus = statusFilter.value.toLowerCase()
    rows = rows.filter((row) => String(row.status || '').toLowerCase().includes(lowerStatus))
  }
  const q = searchQuery.value.toLowerCase().trim()
  if (q) {
    rows = rows.filter((row) =>
      [row.docNumber, row.organization, row.description, row.status, row.type]
        .join(' | ')
        .toLowerCase()
        .includes(q)
    )
  }
  return rows.sort((a, b) => a.docNumber.localeCompare(b.docNumber))
})

const availableStatuses = computed(() => {
  const statuses = combinedRows.value.map((row) => row.status).filter(Boolean)
  return [...new Set(statuses)].sort()
})

function getStatusStyle(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('complete') || s.includes('อนุมัติ')) {
    return { bg: 'rgba(16,185,129,0.12)', color: '#047857', border: 'rgba(16,185,129,0.25)' }
  }
  if (s.includes('ยังไม่') || s.includes('unpaid') || s.includes('ค้าง')) {
    return { bg: 'rgba(239,68,68,0.12)', color: '#b91c1c', border: 'rgba(239,68,68,0.25)' }
  }
  if (s.includes('partial') || s.includes('บางส่วน')) {
    return { bg: 'rgba(59,130,246,0.12)', color: '#1d4ed8', border: 'rgba(59,130,246,0.25)' }
  }
  return { bg: 'rgba(148,163,184,0.12)', color: '#475569', border: 'rgba(148,163,184,0.25)' }
}

async function fetchData() {
  await Promise.all([
    trcloudStore.fetchTrcloudData('po'),
    trcloudStore.fetchTrcloudData('ap'),
  ])
}

onMounted(() => {
  if (trcloudStore.poRows.length === 0 || trcloudStore.apRows.length === 0) {
    fetchData()
  }
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">TRCloud Documents</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงรายการ PO และ AP จาก TRCloud พร้อมเลขที่เอกสาร คู่ค้า คำอธิบาย และสถานะ</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">รวมเอกสาร</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ combinedRows.length }}</div>
      </div>
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">PO</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ trcloudStore.poRows.length }}</div>
      </div>
      <div class="p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="text-[12px] text-gray-500">AP</div>
        <div class="text-2xl font-bold mt-2" style="color: var(--color-text-primary)">{{ trcloudStore.apRows.length }}</div>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-3 mb-5 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ประเภท</label>
        <select v-model="docTypeFilter" class="px-3 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สถานะ</label>
        <select v-model="statusFilter" class="px-3 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none min-w-[160px]" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option value="">ทั้งหมด</option>
          <option v-for="status in availableStatuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </div>
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="ค้นหา เลขที่เอกสาร / คู่ค้า / คำอธิบาย / สถานะ"
          class="w-full pl-10 pr-4 py-2 rounded-lg border bg-transparent text-[13px] focus:outline-none"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1000px] border-collapse table-fixed">
          <thead>
            <tr class="text-left" style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 font-medium w-[130px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลขที่เอกสาร</th>
              <th class="px-4 py-3 font-medium w-[100px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่</th>
              <th class="px-4 py-3 font-medium w-[70px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ประเภท</th>
              <th class="px-4 py-3 font-medium w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">คู่ค้า</th>
              <th class="px-4 py-3 font-medium min-w-[200px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สินค้า</th>
              <th class="px-4 py-3 font-medium w-[110px]" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดรวม</th>
              <th class="px-4 py-3 font-medium w-[120px]" style="color: var(--color-text-muted)">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredRows.length === 0">
              <td colspan="7" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบรายการเอกสาร</td>
            </tr>
            <tr v-for="row in filteredRows" :key="row.id" class="hover:bg-gray-50/50 transition-colors" style="border-bottom: 1px solid var(--color-border)">
              <td class="px-4 py-3 font-mono break-all" style="color: var(--color-text-primary)">{{ row.docNumber }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.date }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-primary)">{{ row.type }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.organization }}</td>
              <td class="px-4 py-3 whitespace-normal break-words" style="color: var(--color-text-primary)">{{ row.productName }}</td>
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-primary)">{{ row.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="px-4 py-3">
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold border inline-block text-center w-full" :style="{ backgroundColor: getStatusStyle(row.status).bg, color: getStatusStyle(row.status).color, borderColor: getStatusStyle(row.status).border }">
                  {{ row.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
