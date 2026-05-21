<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(true)
const rows = ref([])

const prFilter = ref('')
const pageSize = 20
const page = ref(1)

const expandedPrKey = ref(null)
const expandedOrderReqIds = ref([])

function formatReqDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  return `${day}/${month}/${year}`
}

function formatReqDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hh}:${mm}`
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
  const base = c.emp_code ? `${c.fullname} (${c.emp_code})` : c.fullname || c.username || '-'
  const dep = String(c.department ?? '').trim()
  if (!dep) return base
  return `${base}\nหน่วยงาน: ${dep}`
}

function userText(user, fallbackId) {
  if (!user) return fallbackId ? shortId(fallbackId) : '-'
  return user.emp_code ? `${user.fullname} (${user.emp_code})` : user.fullname || user.username || (fallbackId ? shortId(fallbackId) : '-')
}

function prKey(value) {
  const raw = String(value ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits || raw
}

function itemLineText(r) {
  const name = String(r?.details || '-')
  const amount = r?.amount_req ?? '-'
  const unit = r?.unit ? ` ${r.unit}` : ''
  return `${name} — ${amount}${unit}`.trim()
}

function isOrderExpanded(reqId) {
  return expandedOrderReqIds.value.includes(reqId)
}

function toggleOrderExpanded(reqId) {
  if (!reqId) return
  const next = new Set(expandedOrderReqIds.value)
  if (next.has(reqId)) next.delete(reqId)
  else next.add(reqId)
  expandedOrderReqIds.value = Array.from(next)
}

async function fetchHistoryClosedPr() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('purchasing_req')
      .select('id, pr_number, urgent_id, purchase_team_id, details, amount_req, unit, air_code, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    const list = data || []

    const urgentIds = [...new Set(list.map((r) => r.urgent_id).filter(Boolean))]
    const urgentNameById = {}
    if (urgentIds.length) {
      const { data: urgents, error: urgentsError } = await supabase
        .from('urgents')
        .select('id, option_name')
        .in('id', urgentIds)
      if (!urgentsError) {
        for (const u of urgents || []) {
          const id = u?.id
          const name = String(u?.option_name ?? '').trim()
          if (id && name) urgentNameById[id] = name
        }
      }
    }

    const teamIds = [...new Set(list.map((r) => r.purchase_team_id).filter(Boolean))]
    const teamNameById = {}
    if (teamIds.length) {
      const { data: teams, error: teamsError } = await supabase
        .from('purchasing_team')
        .select('id, team_name')
        .in('id', teamIds)
      if (!teamsError) {
        for (const t of teams || []) {
          const id = t?.id
          const name = String(t?.team_name ?? '').trim()
          if (id && name) teamNameById[id] = name
        }
      }
    }

    const reqIds = list.map((r) => r.id).filter(Boolean)
    const orderByPrId = {}
    if (reqIds.length) {
      const { data: orders, error: ordersError } = await supabase
        .from('purchasing_order')
        .select(
          'id, pr_id, status_receive, date_recieve, receive_by, store_by, lao_po_number, ap_number, pr_thai, status_purchase, is_finish, created_by, updated_by, created_at, updated_at'
        )
        .in('pr_id', reqIds)

      if (!ordersError) {
        for (const o of orders || []) {
          const current = orderByPrId[o.pr_id]
          if (!current) {
            orderByPrId[o.pr_id] = o
            continue
          }
          const a = +new Date(current.updated_at || current.created_at || 0)
          const b = +new Date(o.updated_at || o.created_at || 0)
          if (b >= a) orderByPrId[o.pr_id] = o
        }
      }
    }

    const orderList = Object.values(orderByPrId)
    const receiverIds = [...new Set(orderList.map((o) => o?.created_by).filter(Boolean))]
    const closerIds = [...new Set(orderList.map((o) => o?.updated_by).filter(Boolean))]
    const relatedUserIds = [...new Set([...receiverIds, ...closerIds])]
    const userById = {}
    if (relatedUserIds.length) {
      const { data: users, error: usersError } = await supabase
        .from('system_users')
        .select('id, fullname, emp_code, username')
        .in('id', relatedUserIds)
      if (!usersError) {
        for (const u of users || []) userById[u.id] = u
      }
    }

    const creatorIds = [...new Set(list.map((r) => r.created_by).filter(Boolean))]
    const creatorById = {}
    if (creatorIds.length) {
      const { data: creators, error: creatorsError } = await supabase
        .from('system_users')
        .select('id, fullname, emp_code, username, department')
        .in('id', creatorIds)

      if (!creatorsError) {
        for (const u of creators || []) creatorById[u.id] = u
      }
    }

    const mapped = list.map((r) => ({
      ...r,
      _creator: r.created_by ? creatorById[r.created_by] : null,
      _order: orderByPrId[r.id]
        ? {
            ...orderByPrId[r.id],
            _receiver_user: orderByPrId[r.id]?.created_by ? userById[orderByPrId[r.id].created_by] || null : null,
            _closer_user: orderByPrId[r.id]?.updated_by ? userById[orderByPrId[r.id].updated_by] || null : null,
          }
        : null,
      _urgent_name: r.urgent_id ? urgentNameById[r.urgent_id] || null : null,
      _purchase_team_name: r.purchase_team_id ? teamNameById[r.purchase_team_id] || null : null,
    }))

    const grouped = new Map()
    for (const r of mapped) {
      const key = prKey(r?.pr_number)
      if (!key) continue
      const k = String(key)
      const existing = grouped.get(k)
      if (!existing) {
        grouped.set(k, { key: k, pr_number: r?.pr_number || k, items: [r] })
      } else {
        existing.items.push(r)
        if (!existing.pr_number && r?.pr_number) existing.pr_number = r.pr_number
      }
    }

    const closedGroups = []
    for (const g of grouped.values()) {
      const allFinished = (g.items || []).length && (g.items || []).every((x) => !!x?._order?.is_finish)
      if (!allFinished) continue
      closedGroups.push(g)
    }

    rows.value = closedGroups
      .sort((a, b) => {
        const aTime = Math.max(
          ...a.items.map((x) =>
            +new Date(x?._order?.updated_at || x?._order?.date_recieve || x?._order?.created_at || x?.created_at || 0)
          )
        )
        const bTime = Math.max(
          ...b.items.map((x) =>
            +new Date(x?._order?.updated_at || x?._order?.date_recieve || x?._order?.created_at || x?.created_at || 0)
          )
        )
        return bTime - aTime
      })
      .map((g) => {
        const seen = new Set()
        const uniqueLines = []
        for (const item of g.items || []) {
          const text = itemLineText(item)
          const norm = text.replace(/\s+/g, ' ').trim().toLowerCase()
          if (!norm || seen.has(norm)) continue
          seen.add(norm)
          uniqueLines.push(text)
        }
        const closedAt = Math.max(
          ...g.items.map((x) =>
            +new Date(x?._order?.updated_at || x?._order?.date_recieve || x?._order?.created_at || x?.created_at || 0)
          )
        )
        return {
          ...g,
          detailsText: uniqueLines.join(', '),
          closedAtIso: closedAt ? new Date(closedAt).toISOString() : null,
        }
      })
  } catch (err) {
    alert('โหลดประวัติ PR ไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!auth.user?.id) return
  fetchHistoryClosedPr()
})

const filteredGroups = computed(() => {
  const raw = String(prFilter.value || '').trim()
  const key = raw ? prKey(raw) : ''
  if (!key) return rows.value || []
  return (rows.value || []).filter((g) => String(g?.key || '').includes(String(key)))
})

const totalRows = computed(() => filteredGroups.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedGroups = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredGroups.value.slice(start, start + pageSize)
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

function toggleExpanded(group) {
  const key = group?.key
  if (!key) return
  expandedPrKey.value = expandedPrKey.value === key ? null : key
}
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ประวัติทั้งหมด</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะ PR ที่ปิดงานแล้ว (is_finish = true)</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="prFilter"
          @input="onFilterChanged"
          type="text"
          placeholder="กรอง PR No."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedGroups.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
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
        <table class="w-full text-[13px] min-w-[980px] border-collapse" style="border: 1px solid var(--color-border)">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="w-[56px] px-3 py-3 font-medium text-center whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"></th>
              <th class="w-[180px] text-center px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PR</th>
              <th class="text-center px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายละเอียด</th>
              <th class="text-center px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่ปิดงาน</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in pagedGroups" :key="group.key">
              <tr
                class="border-b last:border-b-0 cursor-pointer"
                style="border-color: var(--color-border)"
                @click="toggleExpanded(group)"
              >
                <td class="px-3 py-3 text-center align-top" style="border-right: 1px solid var(--color-border)">
                  <button
                    type="button"
                    class="w-10 h-10 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors"
                    :class="expandedPrKey === group.key ? 'text-red-600 border-red-300' : 'text-gray-800 border-gray-300'"
                    style="background: var(--color-bg-body)"
                    title="แสดงรายการ"
                    @click.stop="toggleExpanded(group)"
                  >
                    <i class="fa-solid" :class="expandedPrKey === group.key ? 'fa-minus text-[22px]' : 'fa-plus text-[22px]'"></i>
                  </button>
                </td>

                <td class="w-[180px] px-4 py-3 align-middle text-center whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <div class="font-medium truncate w-full" :title="group.pr_number || '-'" style="color: #ef4444">
                    {{ group.pr_number || '-' }}
                  </div>
                </td>

                <td class="px-4 py-3 align-top" style="border-right: 1px solid var(--color-border)">
                  <div class="p-0 text-[12px] leading-5" style="color: var(--color-text-primary)">
                    {{ group.detailsText || '-' }}
                  </div>
                </td>

                <td class="px-4 py-3 align-middle text-center whitespace-nowrap" style="color: #2563eb">
                  {{ formatReqDate(group.closedAtIso) }}
                </td>
              </tr>

              <tr v-if="expandedPrKey === group.key" class="border-b" style="border-color: var(--color-border)">
                <td colspan="4" class="px-0 py-0">
                  <div class="overflow-x-auto">
                    <table class="w-full text-[12px] min-w-[1200px] border-collapse" style="border: 1px solid var(--color-border)">
                      <thead>
                        <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการสินค้า</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">จำนวน/หน่วย</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้ขอ PR</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ด่วน</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ทีมจัดซื้อ</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">AIR</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่ขอ</th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted)"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="item in group.items" :key="item.id">
                        <tr style="border-bottom: 1px solid var(--color-border)">
                          <td class="px-4 py-2" style="color: var(--color-text-primary); white-space: pre-line; border-right: 1px solid var(--color-border)">
                            {{ item.details || '-' }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                            {{ item.amount_req ?? '-' }} {{ item.unit || '' }}
                          </td>
                          <td class="px-4 py-2" style="color: var(--color-text-primary); white-space: pre-line; border-right: 1px solid var(--color-border)">
                            {{ creatorText(item) }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                            {{ item._urgent_name || item.urgent_id || '-' }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                            {{ item._purchase_team_name || item.purchase_team_id || '-' }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                            {{ item.air_code || '-' }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                            {{ formatReqDateTime(item.created_at) }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: #2563eb">
                            <div class="flex items-center justify-between gap-2">
                              <span></span>
                              <button
                                type="button"
                                class="w-7 h-7 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors"
                                style="border-color: var(--color-border); color: var(--color-text-secondary)"
                                :title="isOrderExpanded(item.id) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'"
                                @click.stop="toggleOrderExpanded(item.id)"
                              >
                                <i class="fa-solid fa-chevron-down" :class="isOrderExpanded(item.id) ? 'rotate-180' : ''"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                        <tr v-if="isOrderExpanded(item.id)" style="border-bottom: 1px solid var(--color-border)">
                          <td colspan="8" class="px-4 py-3" style="background: var(--color-bg-card)">
                            <div class="text-[12px] font-medium mb-2" style="color: var(--color-text-muted)">
                              รายละเอียดการสั่งซื้อ (purchasing_order)
                            </div>
                            <div
                              class="rounded-lg border p-3 overflow-x-auto"
                              style="border-color: var(--color-border); background: var(--color-bg-card)"
                            >
                              <table class="w-full text-[12px] min-w-[1100px] border-collapse" style="border: 1px solid var(--color-border)">
                                <thead>
                                  <tr style="background: #FDBA74; border-bottom: 1px solid var(--color-border)">
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สถานะการซื้อ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สถานะรับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่รับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้รับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ร้านค้า</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลข PO (ลาว)</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลข AP</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PR (ไทย)</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ปิดงาน</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้ปิดงาน</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">อัปเดตเมื่อ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr v-if="!item._order">
                                    <td colspan="11" class="px-3 py-3 text-center" style="color: var(--color-text-muted)">ยังไม่มีข้อมูลใน purchasing_order</td>
                                  </tr>
                                  <tr v-else>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.status_purchase || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.status_receive || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ formatReqDate(item._order.date_recieve) }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.receive_by || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.store_by || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.lao_po_number || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.ap_number || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.pr_thai || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.is_finish ? 'ปิดงาน' : '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ userText(item?._order?._closer_user, item?._order?.updated_by) }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-muted)">{{ formatDateTime(item._order.updated_at) }}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                        </template>
                        <tr v-if="loading">
                          <td colspan="8" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
                        </tr>
                        <tr v-else-if="!loading && (!group.items || !group.items.length)">
                          <td colspan="8" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบรายการ</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>

            <tr v-if="loading">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบประวัติ PR ที่ปิดงานแล้ว</td>
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
