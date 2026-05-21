<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'

const loading = ref(true)
const logs = ref([])
const systemUsersById = ref({})
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
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s
}

function userLabel(userId) {
  const u = systemUsersById.value[userId]
  if (!u) return userId ? shortId(userId) : '-'
  const code = u.emp_code || ''
  const name = u.fullname || u.username || '-'
  return code ? `${name} (${code})` : name
}

function formatOldValue(value) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function fetchData() {
  loading.value = true
  try {
    const { data: rows, error } = await supabase
      .from('user_logs')
      .select('id, system_user_id, action, old_value, user_agent, ip_address, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    const list = rows || []
    logs.value = list

    const userIds = [...new Set(list.map((r) => r.system_user_id).filter(Boolean))]
    const byId = {}
    if (userIds.length) {
      const { data: users, error: usersError } = await supabase
        .from('system_users')
        .select('id, emp_code, fullname, username')
        .in('id', userIds)
      if (!usersError) {
        for (const u of users || []) byId[u.id] = u
      }
    }
    systemUsersById.value = byId
  } catch (err) {
    alert('โหลดข้อมูลล็อกอินไม่สำเร็จ: ' + err.message)
    logs.value = []
    systemUsersById.value = {}
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

const filteredLogs = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return logs.value
  return logs.value.filter((row) => {
    const user = systemUsersById.value[row.system_user_id]
    const oldValueText = formatOldValue(row.old_value)
    const haystack = [
      user?.fullname,
      user?.emp_code,
      user?.username,
      row.ip_address,
      row.user_agent,
      row.action,
      oldValueText,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(key)
  })
})

const totalRows = computed(() => filteredLogs.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedLogs = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredLogs.value.slice(start, start + pageSize)
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
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">บันทึกการใช้งานระบบ</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงรายการจาก user_logs (การกระทำ และรายละเอียด old_value)</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          @input="onFilterChanged"
          type="text"
          placeholder="ค้นหาชื่อ, รหัสพนักงาน, การกระทำ, รายละเอียด, ip..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedLogs.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
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
        <table class="w-full text-[13px] min-w-[1180px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้ใช้งาน</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">การกระทำ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รายละเอียด</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">IP Address</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">User Agent</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เวลา</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedLogs"
              :key="row.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-primary)">
                {{ userLabel(row.system_user_id) }}
              </td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ row.action || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                <span :title="formatOldValue(row.old_value)">{{ formatOldValue(row.old_value) }}</span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text-secondary)">{{ row.ip_address || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                <span :title="row.user_agent || '-'">{{ row.user_agent || '-' }}</span>
              </td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatDateTime(row.created_at) }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>

