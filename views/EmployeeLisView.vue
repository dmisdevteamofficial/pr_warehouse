<script setup>
import { computed, onMounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabaseEmployee } from '@/lib/supabase'

const loading = ref(true)
const employees = ref([])
const searchText = ref('')
const selectedDepartment = ref('all')
const pageSize = 20
const page = ref(1)

async function fetchData() {
  if (!supabaseEmployee) {
    alert('ยังไม่ได้ตั้งค่า VITE_SUPABASE_EMPLOYEE_PROJECT2_DB / VITE_SUPABASE_DB_ANON_KEY_EMPLOYEE_PROJECT2 ใน .env')
    loading.value = false
    return
  }

  loading.value = true
  try {
    const { data: rows, error } = await supabaseEmployee
      .from('employees')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    employees.value = rows || []
  } catch (err) {
    alert('โหลดข้อมูลพนักงานไม่สำเร็จ: ' + err.message)
    employees.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

const departmentOptions = computed(() => {
  const set = new Set(employees.value.map((e) => e?.department).filter(Boolean))
  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'th'))
})

const filteredEmployees = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  return employees.value.filter((row) => {
    const haystack = [
      row.employee_code,
      row.fullname,
      row.position,
      row.department,
      row.project,
      row.company,
      row.tel,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    const matchSearch = !key || haystack.includes(key)
    const matchDepartment = selectedDepartment.value === 'all' || (row.department || '') === selectedDepartment.value
    return matchSearch && matchDepartment
  })
})

const totalRows = computed(() => filteredEmployees.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedEmployees = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredEmployees.value.slice(start, start + pageSize)
})

function goPrev() {
  page.value = Math.max(1, page.value - 1)
}

function goNext() {
  page.value = Math.min(totalPages.value, page.value + 1)
}

function onFilterChanged() {
  page.value = 1
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function getStatusClass(status) {
  // ตามที่ขอ: ให้ตัวหนังสือสถานะเป็นสีเขียวเสมอ
  // return status ? 'bg-green-50 text-green-700 border-green-100 dark:bg-green-700/30 dark:border-green-700/30 dark:text-green-500' : ''
  if (status === 'ลาออก') {
    return 'bg-red-50 text-red-700 border-red-100 dark:bg-red-700/30 dark:border-red-700/30 dark:text-red-500'
  }
  if (status === 'พนักงาน') {
    return 'bg-green-50 text-green-700 border-green-100 dark:bg-green-700/30 dark:border-green-700/30 dark:text-green-500'
  }
  return 'bg-am-50 text-am-700 border-am-100 dark:bg-am-700/30 dark:border-am-700/30 dark:text-am-500'
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายชื่อพนักงาน</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ข้อมูลจากตาราง employees (โปรเจกต์พนักงาน)</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          @input="onFilterChanged"
          type="text"
          placeholder="ค้นหารหัส, ชื่อ, แผนก, โครงการ, บริษัท, เบอร์โทร..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <div class="w-full md:w-56">
        <select
          v-model="selectedDepartment"
          @change="onFilterChanged"
          class="w-full px-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <option value="all" style="background-color: var(--color-bg-card)">ทุกแผนก</option>
          <option v-for="dep in departmentOptions" :key="dep" :value="dep" style="background-color: var(--color-bg-card)">{{ dep }}</option>
        </select>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedEmployees.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="goPrev"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg text-[12px] dark:bg-gray-800 dark:text-white transition-all dark:hover:bg-gray-700 font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ก่อนหน้า
          </button>
          <div class="text-[12px]" style="color: var(--color-text-muted)">หน้า {{ page }} / {{ totalPages }}</div>
          <button
            @click="goNext"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg text-[12px] dark:bg-gray-800 dark:text-white transition-all font-medium border bg-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ถัดไป
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1100px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">รหัสพนักงาน</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ชื่อ-นามสกุล</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ตำแหน่ง</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">แผนก</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">โครงการ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">บริษัท</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เบอร์โทร</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">บันทึกเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedEmployees"
              :key="row.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-primary)">{{ row.employee_code || '-' }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-primary)">{{ row.fullname || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.position || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.department || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.project || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ row.company || '-' }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ row.tel || '-' }}</td>
              <td class="px-4 py-3">
                <span v-if="row.status" class="px-2 py-0.5 rounded-full text-[11px] border" :class="getStatusClass(row.status)">{{ row.status }}</span>
                <span v-else style="color: var(--color-text-muted)">-</span>
              </td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatDateTime(row.created_at) }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลพนักงาน</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus,
select:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>