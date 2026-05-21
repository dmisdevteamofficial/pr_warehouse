<script setup>
import { computed, onMounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'

const loading = ref(true)
const rows = ref([])
const searchText = ref('')
const pageSize = 20
const page = ref(1)

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function shortId(value) {
  if (!value) return '-'
  const s = String(value)
  return s.length > 12 ? `${s.slice(0, 8)}...${s.slice(-4)}` : s
}

function creatorLabel(row) {
  const c = row.creator
  if (!c) return row.created_by ? shortId(row.created_by) : '-'
  return c.emp_code ? `${c.fullname} (${c.emp_code})` : c.fullname || '-'
}

async function fetchData() {
  loading.value = true
  try {
    const [{ data: items, error: itemsError }, { data: imports, error: importsError }] = await Promise.all([
      supabase
        .from('items')
        .select('id, item_code, item_name, usage_type, document_url, current_stock, unit, remark, created_by, created_at, creator:system_users!created_by(fullname, emp_code)')
        .order('created_at', { ascending: false }),
      supabase.from('inventory_imports').select('item_id, amount, unit, document_url, created_at').order('created_at', { ascending: true }),
    ])

    if (itemsError) throw itemsError
    if (importsError) throw importsError

    const firstImportByItemId = {}
    for (const row of imports || []) {
      if (firstImportByItemId[row.item_id] === undefined) {
        firstImportByItemId[row.item_id] = {
          amount: row.amount,
          unit: row.unit,
          document_url: row.document_url,
          created_at: row.created_at,
        }
      }
    }

    rows.value = (items || []).map((it) => ({
      ...it,
      first_import_amount: firstImportByItemId[it.id]?.amount ?? null,
      first_import_unit: firstImportByItemId[it.id]?.unit ?? null,
      first_import_document_url: firstImportByItemId[it.id]?.document_url ?? null,
    }))
  } catch (err) {
    alert('โหลดประวัติการเพิ่มสินค้าไม่สำเร็จ: ' + err.message)
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

const filteredRows = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return rows.value
  return rows.value.filter((row) => {
    const haystack = [row.item_code, row.item_name, row.usage_type, row.unit, row.remark]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(key)
  })
})

const totalRows = computed(() => filteredRows.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedRows = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredRows.value.slice(start, start + pageSize)
})

function onFilterChanged() {
  page.value = 1
}
function goPrev() {
  page.value = Math.max(1, page.value - 1)
}
function goNext() {
  page.value = Math.min(totalPages.value, page.value + 1)
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ประวัติการนำเข้าสินค้า</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          คอลัมน์จำนวนแสดงจำนวนตามบันทึกนำเข้า<strong>ครั้งแรก</strong> (ไม่เปลี่ยนตามการเบิก/เติมสต็อก)
        </p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          @input="onFilterChanged"
          type="text"
          placeholder="ค้นหาด้วยรหัสสินค้า, ชื่อสินค้า, ประเภทที่ใช้, หมายเหตุ..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedRows.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="goPrev"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ก่อนหน้า
          </button>
          <div class="text-[12px]" style="color: var(--color-text-muted)">หน้า {{ page }} / {{ totalPages }}</div>
          <button
            @click="goNext"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ถัดไป
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1080px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่-เวลา</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สินค้า</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ประเภทที่ใช้</th>
              <th class="text-right px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จำนวน</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">หน่วย</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้ดำเนินการ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ประเภทรายการ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ไฟล์แนบ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedRows"
              :key="row.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">
                {{ formatDateTime(row.created_at) }}
              </td>
              <td class="px-4 py-3">
                <p class="font-medium" style="color: var(--color-text-primary)">{{ row.item_name || '-' }}</p>
                <p class="text-[11px]" style="color: var(--color-text-muted)">{{ row.item_code || '-' }}</p>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                {{ String(row.usage_type ?? '').trim() || '-' }}
              </td>
              <td class="px-4 py-3 text-right font-semibold text-emerald-600">
                {{ row.first_import_amount != null ? row.first_import_amount : '—' }}
              </td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">
                {{ row.first_import_unit || row.unit || '-' }}
              </td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">
                {{ creatorLabel(row) }}
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">นำสินค้าเข้า</span>
              </td>
              <td class="px-4 py-3">
                <div v-if="row.first_import_document_url || row.document_url" class="flex items-center gap-2">
                  <a :href="row.first_import_document_url || row.document_url" target="_blank" class="text-blue-600 hover:underline">เปิดไฟล์</a>
                </div>
                <span v-else style="color: var(--color-text-muted)">-</span>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                {{ row.remark || '-' }}
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลประวัติการนำเข้า</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
