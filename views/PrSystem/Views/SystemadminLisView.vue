<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase, supabaseEmployee } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import bcrypt from 'bcryptjs'

const auth = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const systemUsers = ref([])

const searchText = ref('')
const pageSize = 20
const page = ref(1)

const isCreateOpen = ref(false)
const employeeSearchText = ref('')
const employeeSearching = ref(false)
const selectedEmployee = ref(null)
const employeeHint = ref('')
const employeeResults = ref([])
const isEmployeeDropdownOpen = ref(false)
const employeeActiveIndex = ref(-1)
let employeeSearchTimer = null

const form = ref({
  username: '',
  password: '',
  role: 'staff',
})

const showPassword = ref(false)

const existingEmpCodes = computed(() => new Set((systemUsers.value || []).map((u) => u.emp_code).filter(Boolean)))
const existingUsernames = computed(() => new Set((systemUsers.value || []).map((u) => u.username).filter(Boolean)))
const selectedEmpAlreadyHasUser = computed(() => {
  const code = selectedEmployee.value?.employee_code
  if (!code) return false
  return existingEmpCodes.value.has(code)
})

function roleToDb(uiRole) {
  const r = (uiRole || '').toString()
  if (r === 'admin') return 'admin_store'
  if (['staff', 'admin_store', 'super_admin'].includes(r)) return r
  if (r === 'user') return 'staff'
  return 'staff'
}

function roleLabel(dbRole) {
  if (dbRole === 'staff') return 'staff'
  if (dbRole === 'admin') return 'admin_store'
  if (dbRole === 'admin_store') return 'admin_store'
  if (dbRole === 'super_admin') return 'super_admin'
  return dbRole || '-'
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function shortId(value) {
  if (!value) return '-'
  const s = String(value)
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s
}

async function fetchSystemUsers() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('system_users')
      .select('id, username, emp_code, fullname, role, created_at, created_by')
      .order('created_at', { ascending: false })

    if (error) throw error

    const list = data || []
    const creatorIds = [...new Set(list.map((r) => r.created_by).filter(Boolean))]
    const creatorById = {}

    if (creatorIds.length) {
      const { data: creators, error: creatorsError } = await supabase
        .from('system_users')
        .select('id, fullname, emp_code')
        .in('id', creatorIds)

      if (!creatorsError) {
        for (const u of creators || []) {
          creatorById[u.id] = u
        }
      }
    }

    systemUsers.value = list.map((row) => ({
      ...row,
      _creator: row.created_by ? creatorById[row.created_by] : null,
    }))
  } catch (err) {
    alert('โหลดข้อมูลผู้ใช้งานระบบไม่สำเร็จ: ' + err.message)
    systemUsers.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchSystemUsers)

const filteredUsers = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const list = systemUsers.value || []
  if (!key) return list
  return list.filter((u) => {
    const haystack = [u.username, u.emp_code, u.fullname, u.role].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(key)
  })
})

const totalRows = computed(() => filteredUsers.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedUsers = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredUsers.value.slice(start, start + pageSize)
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

function openCreate() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  isCreateOpen.value = true
  employeeSearchText.value = ''
  selectedEmployee.value = null
  employeeHint.value = ''
  employeeResults.value = []
  isEmployeeDropdownOpen.value = false
  employeeActiveIndex.value = -1
  showPassword.value = false
  form.value = { username: '', password: '', role: 'staff' }
}

function closeCreate() {
  isCreateOpen.value = false
}

function closeEmployeeDropdown() {
  isEmployeeDropdownOpen.value = false
  employeeActiveIndex.value = -1
}

function handleEmployeeBlur() {
  setTimeout(closeEmployeeDropdown, 120)
}

function openEmployeeDropdown() {
  if (employeeResults.value.length) isEmployeeDropdownOpen.value = true
}

function onEmployeeInput() {
  // ถ้าผู้ใช้พิมพ์ใหม่ ให้ถือว่ายังไม่เลือกพนักงาน (แต่ยังแก้ไขช่องอื่นได้)
  if (selectedEmployee.value) selectedEmployee.value = null
  if (employeeSearchTimer) clearTimeout(employeeSearchTimer)
  employeeSearchTimer = setTimeout(() => {
    searchEmployees()
  }, 250)
}

async function searchEmployees() {
  if (!supabaseEmployee) {
    alert('ยังไม่ได้ตั้งค่า .env ของฐานข้อมูลพนักงาน (VITE_SUPABASE_EMPLOYEE_PROJECT2_DB / VITE_SUPABASE_DB_ANON_KEY_EMPLOYEE_PROJECT2)')
    return
  }

  const raw = employeeSearchText.value.trim()
  // รองรับกรณีช่องค้นหาแสดงเป็น "CODE - FULLNAME"
  const key = raw.includes(' - ') ? raw.split(' - ')[0].trim() : raw
  if (!key) {
    employeeHint.value = ''
    selectedEmployee.value = null
    employeeResults.value = []
    closeEmployeeDropdown()
    return
  }

  employeeSearching.value = true
  try {
    const { data, error } = await supabaseEmployee
      .from('employees')
      .select('id, employee_code, fullname, department, position, company, project, tel, status')
      .or(`employee_code.ilike.%${key}%,fullname.ilike.%${key}%`)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) throw error
    const list = data || []
    employeeResults.value = list
    if (!list.length) {
      employeeHint.value = 'ไม่พบข้อมูลพนักงาน (ยังสามารถกรอกเองได้)'
      closeEmployeeDropdown()
    } else {
      employeeHint.value = ''
      isEmployeeDropdownOpen.value = true
      employeeActiveIndex.value = -1
    }
  } catch (err) {
    alert('ค้นหาพนักงานไม่สำเร็จ: ' + err.message)
    selectedEmployee.value = null
    employeeHint.value = ''
    employeeResults.value = []
    closeEmployeeDropdown()
  } finally {
    employeeSearching.value = false
  }
}

function pickEmployee(emp) {
  selectedEmployee.value = emp
  const code = emp?.employee_code || ''
  const name = emp?.fullname || ''
  employeeSearchText.value = code && name ? `${code} - ${name}` : (code || name || '')
  closeEmployeeDropdown()
}

function onEmployeeKeydown(e) {
  if (!isEmployeeDropdownOpen.value) return
  if (!employeeResults.value.length) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    employeeActiveIndex.value = Math.min(employeeResults.value.length - 1, employeeActiveIndex.value + 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    employeeActiveIndex.value = Math.max(0, employeeActiveIndex.value - 1)
    return
  }
  if (e.key === 'Enter') {
    if (employeeActiveIndex.value >= 0 && employeeResults.value[employeeActiveIndex.value]) {
      e.preventDefault()
      pickEmployee(employeeResults.value[employeeActiveIndex.value])
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    closeEmployeeDropdown()
  }
}

function creatorText(row) {
  const c = row._creator
  if (!c) return row.created_by ? shortId(row.created_by) : '-'
  return c.emp_code ? `${c.fullname} (${c.emp_code})` : c.fullname || '-'
}

async function submitCreate() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  if (!selectedEmployee.value?.employee_code || !selectedEmployee.value?.fullname) return alert('กรุณาเลือกพนักงานจากช่องค้นหา')
  if (!form.value.username) return alert('กรุณากรอก Username')
  if (!form.value.password) return alert('กรุณากรอก Password')
  if (selectedEmpAlreadyHasUser.value) return alert('พนักงานรหัสนี้มีผู้ใช้งานระบบอยู่แล้ว (emp_code ซ้ำ)')
  if (existingUsernames.value.has(form.value.username)) return alert('Username นี้ถูกใช้งานแล้ว กรุณาเปลี่ยน Username')

  saving.value = true
  try {
    const password_hash = await bcrypt.hash(form.value.password, 10)
    const payload = {
      emp_code: selectedEmployee.value.employee_code,
      fullname: selectedEmployee.value.fullname || null,
      position: selectedEmployee.value.position || null,
      department: selectedEmployee.value.department || null,
      username: form.value.username,
      password_hash,
      role: roleToDb(form.value.role),
      created_by: auth.user.id,
    }

    const { error } = await supabase.from('system_users').insert(payload)
    if (error) {
      if (error.code === '23505' && String(error.message || '').includes('system_users_emp_code_key')) {
        throw new Error('พนักงานรหัสนี้มีผู้ใช้งานระบบอยู่แล้ว (emp_code ซ้ำ)')
      }
      if (error.code === '23505' && String(error.message || '').includes('system_users_username_key')) {
        throw new Error('Username นี้ถูกใช้งานแล้ว กรุณาเปลี่ยน Username')
      }
      if (
        String(error.message || '').includes('system_users_role_check') ||
        String(error.details || '').includes('system_users_role_check')
      ) {
        throw new Error(
          `ฐานข้อมูลยังไม่อนุญาต role "${payload.role}" (ติด constraint: system_users_role_check)\nกรุณาปรับ constraint ในฐานข้อมูลให้รองรับ role นี้ก่อน`
        )
      }
      throw error
    }

    closeCreate()
    await fetchSystemUsers()
    alert('บันทึกผู้ใช้งานระบบสำเร็จ')
  } catch (err) {
    alert('บันทึกผู้ใช้งานระบบไม่สำเร็จ: ' + err.message)
  } finally {
    saving.value = false
  }
}

// function statusColor(status) {
//   return status ? 'bg-green-50 text-green-700 border-green-100 dark:bg-green-700/30 dark:border-green-700/30 dark:text-green-500' : 'bg-red-50 text-red-700 border-red-100 dark:bg-red-700/30 dark:border-red-700/30 dark:text-red-500'
// }

function statusColor(role){
  if (role === 'super_admin') return 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-700/30 dark:border-purple-700/30 dark:text-purple-300'
  if (role === 'admin') return 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-700/30 dark:border-blue-700/30 dark:text-blue-300'
  if (role === 'admin_store') return 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-700/30 dark:border-blue-700/30 dark:text-blue-300'
  if (role === 'staff') return 'bg-green-50 text-green-700 border-green-100 dark:bg-green-700/30 dark:border-green-700/30 dark:text-green-500'
  return 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-700/30 dark:border-amber-700/30 dark:text-amber-500'
}
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ผู้ใช้งานระบบ</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">บันทึกผู้ใช้งานเข้าสู่ระบบจากตาราง system_users</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="openCreate"
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border bg-white dark:bg-gray-800 dark:text-white hover:bg-gray-50 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <i class="fa-solid fa-plus mr-2"></i>
          เพิ่มข้อมูล
        </button>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          @input="onFilterChanged"
          type="text"
          placeholder="ค้นหา Username, รหัสพนักงาน, ชื่อ-นามสกุล..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedUsers.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
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
        <table class="w-full text-[13px] min-w-[980px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">Username</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">รหัสพนักงาน</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ชื่อ-นามสกุล</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้ที่เพิ่มเข้ามา</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เพิ่มเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedUsers"
              :key="row.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-primary)">{{ row.username }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ row.emp_code || '-' }}</td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-primary)">{{ row.fullname || '-' }}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded-full text-[11px] border" :class="statusColor(row.role)">{{ roleLabel(row.role) }}</span>
              </td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ creatorText(row) }}</td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatDateTime(row.created_at) }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลผู้ใช้งานระบบ</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isCreateOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeCreate"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เพิ่มผู้ใช้งานระบบ</h2>
            <div class="flex items-center gap-2">
              <button @click="closeCreate" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
              </button>
            </div>
          </div>

          <form class="flex-1 overflow-y-auto p-6 space-y-4" @submit.prevent="submitCreate">
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ค้นหารหัสพนักงาน / ชื่อพนักงาน</label>
              <div class="relative">
                <input
                  v-model="employeeSearchText"
                  @focus="openEmployeeDropdown"
                  @blur="handleEmployeeBlur"
                  @input="onEmployeeInput"
                  @keydown="onEmployeeKeydown"
                  type="text"
                  placeholder="พิมพ์รหัสพนักงานหรือชื่อ..."
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />

                <div
                  v-if="isEmployeeDropdownOpen && employeeResults.length"
                  class="absolute z-10 mt-1 w-full border rounded-lg overflow-hidden max-h-56 overflow-y-auto"
                  style="border-color: var(--color-border); background: var(--color-bg-card)"
                >
                  <button
                    v-for="(emp, idx) in employeeResults"
                    :key="emp.id"
                    type="button"
                    class="w-full text-left px-3 py-2 transition-colors border-b last:border-b-0"
                    :class="idx === employeeActiveIndex ? 'bg-gray-50 dark:bg-slate-700/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'"
                    style="border-color: var(--color-border)"
                    @mousedown.prevent="pickEmployee(emp)"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[13px] font-medium truncate" style="color: var(--color-text-primary)">
                          {{ emp.employee_code }} - {{ emp.fullname || '-' }}
                        </div>
                        <div class="text-[11px] truncate" style="color: var(--color-text-muted)">
                          {{ emp.department || '-' }}<span v-if="emp.position"> • {{ emp.position }}</span>
                        </div>
                      </div>
                      <span class="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 dark:bg-blue-800/30 text-slate-700 dark:text-blue-300 whitespace-nowrap" style="border-color: var(--color-border)">
                        {{ emp.status || '—' }}
                      </span>
                    </div>
                    <div v-if="existingEmpCodes.has(emp.employee_code)" class="text-[11px] mt-1" style="color: var(--color-danger)">
                      มีผู้ใช้งานระบบแล้ว
                    </div>
                  </button>
                </div>
              </div>
              <div class="text-[12px] mt-1" style="color: var(--color-text-muted)">
                <span v-if="employeeSearching">กำลังค้นหา...</span>
                <span v-else>{{ employeeHint }}</span>
              </div>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">Username</label>
              <input
                v-model="form.username"
                type="text"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
              />
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">Password</label>
              <div class="relative">
                <input
                  v-model="form.password"
                  :type="showPassword ? 'text' : 'password'"
                  class="w-full px-3 py-2 pr-10 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />
                <button
                  type="button"
                  @click="showPassword = !showPassword"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-[13px]"
                  style="color: var(--color-text-muted)"
                  :title="showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'"
                >
                  <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
                </button>
              </div>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ผู้ใช้งาน</label>
              <select
                v-model="form.role"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
              >
                <option value="staff">staff</option>
                <option value="admin_store">admin_store</option>
                <option value="super_admin">super_admin</option>
              </select>
            </div>
          </form>

          <div class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
            <button
              @click="closeCreate"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              @click="submitCreate"
              :disabled="saving || selectedEmpAlreadyHasUser"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            >
              {{ saving ? 'กำลังบันทึก...' : 'บันทึก' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
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

input:focus,
select:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
