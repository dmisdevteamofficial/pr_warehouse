<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const rows = ref([])

const searchText = ref('')
const pageSize = 20
const page = ref(1)

const isModalOpen = ref(false)
const modalMode = ref('create')
const editingId = ref(null)

const form = ref({
  team_name: '',
})

function explainSupabasePolicyHint(err) {
  const msg = String(err?.message || '')
  const code = String(err?.code || '')
  const status = String(err?.status || '')

  if (
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('violates row-level security') ||
    code === '42501'
  ) {
    return (
      'ตาราง purchasing_team เปิด RLS อยู่ แต่ยังไม่มี Policy อนุญาตให้ role: anon บันทึก/แก้ไข/ลบได้\n' +
      'ให้ไปที่ Supabase > Table Editor > purchasing_team > RLS แล้วสร้าง Policy สำหรับ SELECT/INSERT/UPDATE/DELETE (หรือปิด RLS ถ้าต้องการให้บันทึกได้เลย)'
    )
  }

  if (status === '401' || msg.includes('401')) {
    return (
      'Supabase ตอบกลับ 401 (Unauthorized)\n' +
      'สาเหตุที่พบบ่อย: ยังไม่มี apikey/JWT ที่ใช้งานได้ หรือ RLS/Policy ไม่อนุญาตให้เข้าถึงตารางนี้'
    )
  }

  return null
}

function getErrorText(err) {
  return explainSupabasePolicyHint(err) || String(err?.message || err || 'เกิดข้อผิดพลาด')
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

function creatorText(row) {
  const c = row?._creator
  if (!c) return row?.created_by ? shortId(row.created_by) : '-'
  return c.emp_code ? `${c.fullname} (${c.emp_code})` : c.fullname || c.username || '-'
}

async function fetchTeams() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('purchasing_team')
      .select('id, team_name, created_by, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    const list = data || []

    const creatorIds = [...new Set(list.map((r) => r.created_by).filter(Boolean))]
    const creatorById = {}
    if (creatorIds.length) {
      const { data: creators, error: creatorsError } = await supabase
        .from('system_users')
        .select('id, fullname, emp_code, username')
        .in('id', creatorIds)

      if (!creatorsError) {
        for (const u of creators || []) creatorById[u.id] = u
      }
    }

    rows.value = list.map((r) => ({
      ...r,
      _creator: r.created_by ? creatorById[r.created_by] : null,
    }))
  } catch (err) {
    alert('โหลดข้อมูลทีมจัดซื้อไม่สำเร็จ: ' + getErrorText(err))
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchTeams)

const filteredRows = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const list = rows.value || []
  if (!key) return list
  return list.filter((r) => {
    const haystack = [r.team_name, creatorText(r)].filter(Boolean).join(' ').toLowerCase()
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

function openCreate() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  modalMode.value = 'create'
  editingId.value = null
  form.value = { team_name: '' }
  isModalOpen.value = true
}

function openEdit(row) {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  modalMode.value = 'edit'
  editingId.value = row?.id ?? null
  form.value = { team_name: row?.team_name ?? '' }
  isModalOpen.value = true
}

function closeModal() {
  isModalOpen.value = false
}

async function submit() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  const name = (form.value.team_name || '').trim()
  if (!name) return alert('กรุณากรอกชื่อทีมจัดซื้อ')

  saving.value = true
  try {
    if (modalMode.value === 'edit') {
      if (!editingId.value) throw new Error('ไม่พบรายการที่ต้องการแก้ไข')
      const { error } = await supabase
        .from('purchasing_team')
        .update({ team_name: name })
        .eq('id', editingId.value)
      if (error) throw error
      alert('แก้ไขข้อมูลสำเร็จ')
    } else {
      const payload = {
        team_name: name,
        created_by: auth.user.id,
      }
      const { error } = await supabase.from('purchasing_team').insert(payload)
      if (error) throw error
      alert('บันทึกข้อมูลสำเร็จ')
    }

    closeModal()
    await fetchTeams()
  } catch (err) {
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + getErrorText(err))
  } finally {
    saving.value = false
  }
}

async function removeRow(row) {
  const ok = window.confirm('ต้องการลบรายการนี้หรือไม่?')
  if (!ok) return
  try {
    const { error } = await supabase.from('purchasing_team').delete().eq('id', row.id)
    if (error) throw error
    await fetchTeams()
  } catch (err) {
    alert('ลบข้อมูลไม่สำเร็จ: ' + getErrorText(err))
  }
}
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการทีมจัดซื้อ</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">บันทึกข้อมูลจากตาราง purchasing_team</p>
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
          placeholder="ค้นหาทีมจัดซื้อ, ผู้บันทึก..."
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
        <table class="w-full text-[13px] min-w-[920px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ทีมจัดซื้อ</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้ที่เพิ่มเข้ามา</th>
              <th class="text-left px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เพิ่มเมื่อ</th>
              <th class="text-right px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedRows"
              :key="row.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ row.team_name }}</td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ creatorText(row) }}</td>
              <td class="px-4 py-3 text-[12px] whitespace-nowrap" style="color: var(--color-text-muted)">{{ formatDateTime(row.created_at) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    style="color: var(--color-text-secondary)"
                    title="แก้ไข"
                    @click="openEdit(row)"
                  >
                    <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button
                    type="button"
                    class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-red-600 dark:text-red-300"
                    title="ลบ"
                    @click="removeRow(row)"
                  >
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isModalOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeModal"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">
              {{ modalMode === 'edit' ? 'แก้ไขทีมจัดซื้อ' : 'เพิ่มทีมจัดซื้อ' }}
            </h2>
            <button @click="closeModal" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <form class="flex-1 overflow-y-auto p-6 space-y-4" @submit.prevent="submit">
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ทีมจัดซื้อ</label>
              <input
                v-model="form.team_name"
                type="text"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                placeholder="เช่น ทีม A / ทีม B ..."
              />
            </div>
          </form>

          <div class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
            <button
              type="button"
              @click="closeModal"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              @click="submit"
              :disabled="saving"
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

input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
