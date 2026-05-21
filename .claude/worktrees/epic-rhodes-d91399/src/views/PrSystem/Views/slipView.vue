<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(true)
const rows = ref([])
const searchText = ref('')

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

function moneyText(amount, currency) {
  const a = formatNumber(amount)
  const c = String(currency || '').trim()
  return c ? `${a} ${c}` : a
}

function createdByText() {
  const u = auth.user
  if (!u) return null
  return (u.fullname || u.username || u.emp_code || '').toString() || null
}

async function fetchRows() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('ap_requests')
      .select('id, ap_number, po_id, item_ref, total_price, currency_name, option_name, ap_status, updated_at')
      .in('ap_status', ['รอชำระ', 'จ่ายบางส่วน'])
      .order('updated_at', { ascending: false })

    if (error) throw error
    rows.value = data || []
  } catch (err) {
    alert('โหลดข้อมูลไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchRows)

const filteredRows = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const list = rows.value || []
  if (!key) return list
  return list.filter((r) => {
    const haystack = [
      r.ap_number,
      r.po_id,
      r.item_ref,
      r.option_name,
      r.ap_status,
      r.currency_name,
      r.total_price,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(key)
  })
})

const totalRows = computed(() => (filteredRows.value || []).length)

async function markPaidComplete(row) {
  const id = row?.id
  if (!id) return
  const ok = window.confirm('ยืนยันอัปเดตสถานะเป็น "จ่ายครบ" หรือไม่?')
  if (!ok) return

  try {
    const updatedBy = createdByText()
    const { error } = await supabase
      .from('ap_requests')
      .update({
        ap_status: 'จ่ายครบ',
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw error
    rows.value = (rows.value || []).filter((r) => r?.id !== id)
  } catch (err) {
    alert('อัปเดตไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  }
}
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการสลิป</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          แสดงเฉพาะสถานะ AP: รอชำระ, จ่ายบางส่วน • ทั้งหมด {{ totalRows }} รายการ
        </p>
      </div>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all self-start md:self-auto"
        style="border-color: var(--color-border); color: var(--color-text-secondary)"
        @click="fetchRows"
      >
        รีเฟรช
      </button>
    </div>

    <div class="flex flex-col md:flex-row gap-3 mb-4 p-3 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          type="text"
          placeholder="ค้นหา เลข AP, เลข PO, รายการ, สถานะ..."
          class="w-full pl-9 pr-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1200px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลข AP</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลข PO</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">รายการ</th>
              <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอด</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ความเร่งด่วน</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">AP Status</th>
              <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">อัปเดต</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="px-4 py-10 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="7" class="px-4 py-10 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูล</td>
            </tr>
            <tr
              v-for="r in filteredRows"
              :key="r.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 align-top whitespace-nowrap" style="color: var(--color-text-primary)">{{ r.ap_number || '-' }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap" style="color: var(--color-text-primary)">{{ r.po_id || '-' }}</td>
              <td class="px-4 py-3 align-top" style="color: var(--color-text-primary)">
                <div style="white-space: normal; word-break: break-word">{{ r.item_ref || '-' }}</div>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap text-right" style="color: var(--color-text-primary)">{{ moneyText(r.total_price, r.currency_name) }}</td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium border" style="border-color: rgba(239, 68, 68, 0.35); color: #ef4444">
                  {{ r.option_name || '-' }}
                </span>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium border" style="border-color: rgba(37, 99, 235, 0.25); color: #2563eb">
                  {{ r.ap_status || '-' }}
                </span>
              </td>
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
                  style="border-color: #16a34a; color: #16a34a"
                  @click="markPaidComplete(r)"
                >
                  จ่ายครบ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
