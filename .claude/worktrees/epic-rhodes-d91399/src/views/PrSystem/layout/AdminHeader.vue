<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import ProfileEditSidebar from "@/components/layout/ProfileEditSidebar.vue"
import { useTrcloudStore } from "@/stores/trcloud"
import {
  getTrcloudProxyCookie,
  setTrcloudProxyCookie,
  clearTrcloudProxyCookie,
} from "@/utils/trcloudSession"

const emit = defineEmits(["logout", "edit-profile", "toggle-sidebar"])

const props = defineProps({
  title: { type: String, default: "Dashboard" },
  user: {
    type: Object,
    default: () => ({
      fullName: "ผู้ใช้งานตัวอย่าง",
      employeeId: "EMP-0001",
      role: "Admin",
      position: "Manager",
    }),
  },
})

const router = useRouter()
const trcloudStore = useTrcloudStore()

const menuOpen = ref(false)
const profileRef = ref(null)
const notificationsOpen = ref(false)
const notificationsRef = ref(null)
const isDark = ref(document.documentElement.classList.contains("dark"))
const now = ref(new Date())
const isCompact = ref(window.matchMedia("(max-width: 640px)").matches)
const switchOpen = ref(false)
const showEditProfile = ref(false)
const showTrcloudCookieModal = ref(false)
const trcloudCookieDraft = ref("")
const hasTrcloudProxyCookie = ref(false)
const notificationReadMap = ref({})
const NOTIFICATION_READ_STORAGE_KEY = "mw-prsystem-notification-read-map-v1"
const weeklyExpandState = ref({ PR: false, PO: false, AP: false })
const expandedNotificationIds = ref({})
const expandedWeeklySummaryIds = ref({})

function refreshTrcloudCookieFlag() {
  hasTrcloudProxyCookie.value = !!getTrcloudProxyCookie()
}

function openTrcloudCookieModal() {
  menuOpen.value = false
  notificationsOpen.value = false
  switchOpen.value = false
  trcloudCookieDraft.value = getTrcloudProxyCookie()
  showTrcloudCookieModal.value = true
}

function closeTrcloudCookieModal() {
  showTrcloudCookieModal.value = false
}

async function saveTrcloudCookie() {
  setTrcloudProxyCookie(trcloudCookieDraft.value)
  refreshTrcloudCookieFlag()
  closeTrcloudCookieModal()
  try {
    await trcloudStore.fetchAll({ force: true })
  } catch (_) {
    /* fetchAll handles errors internally */
  }
}

async function clearTrcloudCookieAndRefetch() {
  clearTrcloudProxyCookie()
  refreshTrcloudCookieFlag()
  trcloudCookieDraft.value = ""
  closeTrcloudCookieModal()
  try {
    await trcloudStore.fetchAll({ force: true })
  } catch (_) {}
}

const dateTimeText = computed(() => {
  const formatter = new Intl.DateTimeFormat(
    "th-TH",
    isCompact.value
      ? {
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
      : {
          year: "numeric",
          month: "long",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
  )
  return formatter.format(now.value)
})

const todayKey = computed(() => {
  const d = now.value
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
})

const currentWeekKey = computed(() => {
  const d = new Date(now.value)
  const dayNum = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dayNum + 3)
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const firstDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000))
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`
})

function parseDateValue(v) {
  const d = new Date(v)
  if (Number.isNaN(+d)) return ""
  return d.toLocaleDateString("th-TH")
}

function isPrPoPendingStatus(status) {
  const s = String(status || "").toLowerCase()
  if (!s.trim()) return true
  return !s.includes("success")
}

function isApPendingStatus(status) {
  const s = String(status || "").toLowerCase()
  return s.includes("ยังไม่") || s.includes("unpaid") || s.includes("ค้าง") || s.includes("partial")
}

function getDocNo(row, ...keys) {
  for (const k of keys) {
    const v = String(row?.[k] || "").trim()
    if (v) return v
  }
  return "-"
}

function getIssueDateText(row) {
  return parseDateValue(row?.issue_date || row?.date) || "-"
}

function getUnreadById(id) {
  return !notificationReadMap.value[id]
}

function getPendingEntries(type, rows, statusGetter) {
  return (rows || []).map((r) => {
    const docNo =
      type === "PR"
        ? getDocNo(r, "document_number", "pr_id", "id")
        : type === "PO"
          ? getDocNo(r, "document_number", "po_id", "id")
          : getDocNo(r, "invoice_number", "document_number", "expense_id", "id")
    return {
      docNo,
      issueDate: getIssueDateText(r),
      status: String(statusGetter(r) || "-"),
    }
  })
}

const notifications = computed(() => {
  const out = []

  const prPending = (trcloudStore.prRows || []).filter((r) => isPrPoPendingStatus(r.status)).slice(0, 20)
  const poPending = (trcloudStore.poRows || []).filter((r) => isPrPoPendingStatus(r.status)).slice(0, 20)
  const apPending = (trcloudStore.apRows || []).filter((r) => isApPendingStatus(r.payment_status || r.status)).slice(0, 20)

  const weeklyId = `weekly-${currentWeekKey.value}`
  const weeklyDetails = {
    PR: getPendingEntries("PR", prPending, (r) => r.status),
    PO: getPendingEntries("PO", poPending, (r) => r.status),
    AP: getPendingEntries("AP", apPending, (r) => r.payment_status || r.status),
  }
  const weeklyTotal = weeklyDetails.PR.length + weeklyDetails.PO.length + weeklyDetails.AP.length
  if (weeklyTotal > 0) {
    out.push({
      id: weeklyId,
      type: "weekly-summary",
      title: "แจ้งเตือนประจำสัปดาห์",
      description: `PR ${weeklyDetails.PR.length} | PO ${weeklyDetails.PO.length} | AP ${weeklyDetails.AP.length}`,
      time: "ทุกสัปดาห์",
      unread: getUnreadById(weeklyId),
      details: weeklyDetails,
    })
  }

  const pushDaily = (type, rows, statusGetter) => {
    for (const r of rows) {
      const docNo =
        type === "PR"
          ? getDocNo(r, "document_number", "pr_id", "id")
          : type === "PO"
            ? getDocNo(r, "document_number", "po_id", "id")
            : getDocNo(r, "invoice_number", "document_number", "expense_id", "id")
      const issueDate = getIssueDateText(r)
      const status = String(statusGetter(r) || "-")
      const id = `daily-${todayKey.value}-${type}-${docNo}`
      out.push({
        id,
        type: "daily",
        title: `${type} ยังไม่เสร็จ`,
        description: `หมายเลข: ${docNo} | วันที่: ${issueDate} | สถานะ: ${status}`,
        time: "วันนี้",
        unread: getUnreadById(id),
      })
    }
  }

  pushDaily("PR", prPending, (r) => r.status)
  pushDaily("PO", poPending, (r) => r.status)
  pushDaily("AP", apPending, (r) => r.payment_status || r.status)

  return out
})

const dailyNotifications = computed(() => {
  return notifications.value.filter((n) => n.type !== "weekly-summary")
})

const weeklyNotifications = computed(() => {
  return notifications.value.filter((n) => n.type === "weekly-summary")
})

function toggleWeeklySection(section) {
  weeklyExpandState.value[section] = !weeklyExpandState.value[section]
}

function toggleNotificationExpand(id) {
  expandedNotificationIds.value[id] = !expandedNotificationIds.value[id]
}

function toggleWeeklySummaryExpand(id) {
  const current = !!expandedWeeklySummaryIds.value[id]
  expandedWeeklySummaryIds.value[id] = !current
}

function toggleNotifications() {
  menuOpen.value = false
  switchOpen.value = false
  notificationsOpen.value = !notificationsOpen.value
}

function closeNotifications() {
  notificationsOpen.value = false
}

function goToStoreSystem() {
  switchOpen.value = false
  menuOpen.value = false
  router.push("/dashboard")
}

function markAllNotificationsRead() {
  const nextMap = { ...notificationReadMap.value }
  for (const n of notifications.value) {
    nextMap[n.id] = true
  }
  notificationReadMap.value = nextMap
  localStorage.setItem(NOTIFICATION_READ_STORAGE_KEY, JSON.stringify(nextMap))
}

function markNotificationRead(id) {
  const nextMap = { ...notificationReadMap.value, [id]: true }
  notificationReadMap.value = nextMap
  localStorage.setItem(NOTIFICATION_READ_STORAGE_KEY, JSON.stringify(nextMap))
}

function toggleMenu() {
  notificationsOpen.value = false
  switchOpen.value = false
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
  switchOpen.value = false
}

function toggleSwitch() {
  switchOpen.value = !switchOpen.value
}

function openEditProfile() {
  notificationsOpen.value = false
  switchOpen.value = false
  menuOpen.value = false
  showEditProfile.value = true
}

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle("dark", isDark.value)
  localStorage.setItem("theme", isDark.value ? "dark" : "light")
  if (typeof CustomEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("themechange", { detail: { isDark: isDark.value } })
    )
  }
}

function onThemeChange(event) {
  if (!(event instanceof CustomEvent)) return
  if (!event.detail || typeof event.detail.isDark !== "boolean") return
  isDark.value = event.detail.isDark
  document.documentElement.classList.toggle("dark", isDark.value)
}

function onPointerDown(event) {
  const profileEl = profileRef.value
  if (
    menuOpen.value &&
    profileEl instanceof HTMLElement &&
    !profileEl.contains(event.target)
  ) {
    closeMenu()
  }

  const notiEl = notificationsRef.value
  if (
    notificationsOpen.value &&
    notiEl instanceof HTMLElement &&
    !notiEl.contains(event.target)
  ) {
    closeNotifications()
  }
}

let timerId
const onResize = () => {
  isCompact.value = window.matchMedia("(max-width: 640px)").matches
}

onMounted(() => {
  try {
    const raw = localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === "object") {
      notificationReadMap.value = parsed
    }
  } catch (_) {}

  refreshTrcloudCookieFlag()
  window.addEventListener("mw-trcloud-proxy-cookie-changed", refreshTrcloudCookieFlag)
  timerId = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
  if (!trcloudStore.isLoaded) {
    trcloudStore.fetchAll()
  }
  window.addEventListener("resize", onResize)
  window.addEventListener("pointerdown", onPointerDown)
  window.addEventListener("themechange", onThemeChange)
})

onBeforeUnmount(() => {
  window.removeEventListener("mw-trcloud-proxy-cookie-changed", refreshTrcloudCookieFlag)
  window.clearInterval(timerId)
  window.removeEventListener("resize", onResize)
  window.removeEventListener("pointerdown", onPointerDown)
  window.removeEventListener("themechange", onThemeChange)
})
</script>

<template>
  <header
    class="flex items-center justify-between bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-2.5 sm:py-3"
  >
    <div class="flex items-center gap-2 min-w-0">
      <button
        type="button"
        class="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 transition"
        @click="emit('toggle-sidebar')"
        aria-label="เมนู"
      >
        <i class="fa-solid fa-bars text-[18px]"></i>
      </button>
      <h1
        class="text-gray-900 dark:text-white font-semibold text-base sm:text-lg truncate"
      >
        {{ props.title }}
      </h1>
    </div>
    <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
      <div
        class="rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 whitespace-nowrap"
      >
        {{ dateTimeText }}
      </div>

      <button
        type="button"
        class="text-gray-600 hover:text-gray-900 bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:bg-gray-800 rounded-lg p-1.5 transition"
        @click="toggleTheme"
        :aria-label="isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'"
      >
        <i v-if="isDark" class="fa-solid fa-sun text-[18px]"></i>
        <i v-else class="fa-solid fa-moon text-[18px]"></i>
      </button>

      <button
        type="button"
        class="relative text-gray-600 hover:text-gray-900 bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:bg-gray-800 rounded-lg p-1.5 transition"
        title="ตั้งค่า Cookie TRCloud (หลังล็อกอินเว็บไซต์ TRCloud)"
        aria-label="ตั้งค่า Cookie TRCloud"
        @click="openTrcloudCookieModal"
      >
        <i class="fa-solid fa-cloud text-[18px]"></i>
        <span
          v-if="!hasTrcloudProxyCookie"
          class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-gray-950"
          aria-hidden="true"
        />
      </button>

      <div ref="notificationsRef" class="relative">
        <button
          type="button"
          class="relative text-gray-600 hover:text-gray-900 bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:bg-gray-800 rounded-lg p-1.5 transition"
          @click="toggleNotifications"
          aria-haspopup="menu"
          :aria-expanded="notificationsOpen"
        >
          <i class="fa-solid fa-bell text-[18px]"></i>
          <span
            v-if="notifications.some((n) => n.unread)"
            class="absolute top-0.5 right-0.5 w-2 h-2 bg-blue-500 rounded-full"
          />
        </button>

        <div
          v-if="notificationsOpen"
          class="absolute right-0 mt-2 w-[32rem] max-w-[92vw] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg z-50 overflow-hidden"
          role="menu"
        >
          <div
            class="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between"
          >
            <p class="text-sm font-semibold text-gray-900 dark:text-white">
              แจ้งเตือน
            </p>
            <button
              type="button"
              class="text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              @click="markAllNotificationsRead"
            >
              อ่านทั้งหมด
            </button>
          </div>

          <div class="max-h-80 overflow-auto">
            <button
              v-for="n in dailyNotifications"
              :key="n.id"
              type="button"
              class="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900 transition flex gap-3"
              @click="markNotificationRead(n.id); toggleNotificationExpand(n.id)"
            >
              <span
                class="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                :class="n.unread ? 'bg-blue-500' : 'bg-transparent'"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center justify-between gap-3">
                  <span
                    class="text-sm font-medium truncate"
                    :class="
                      n.unread
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-700 dark:text-gray-300'
                    "
                  >
                    {{ n.title }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {{ n.time }}
                  </span>
                </span>
                <span
                  class="block text-xs text-gray-500 dark:text-gray-400 break-words"
                  :class="expandedNotificationIds[n.id] ? 'whitespace-normal' : 'truncate'"
                >
                  {{ n.description }}
                </span>
                <span class="block mt-1 text-[11px] text-blue-600 dark:text-blue-300">
                  {{ expandedNotificationIds[n.id] ? 'ซ่อนรายละเอียด' : 'คลิกเพื่อดูรายละเอียด' }}
                </span>
              </span>
            </button>

            <div
              v-for="n in weeklyNotifications"
              :key="`${n.id}-weekly`"
              class="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800"
            >
              <button
                type="button"
                class="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg px-1 py-1 transition flex gap-3"
                @click="markNotificationRead(n.id); toggleWeeklySummaryExpand(n.id)"
              >
                <span
                  class="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                  :class="n.unread ? 'bg-blue-500' : 'bg-transparent'"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-3">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">
                      {{ n.title }}
                    </span>
                    <span class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {{ n.time }}
                    </span>
                  </span>
                  <span class="block text-xs text-gray-500 dark:text-gray-400">
                    {{ n.description }}
                  </span>
                  <span class="block mt-1 text-[11px] text-blue-600 dark:text-blue-300">
                    {{ expandedWeeklySummaryIds[n.id] ? 'ซ่อนรายการย่อย' : 'คลิกเพื่อดูรายการย่อย' }}
                  </span>
                </span>
              </button>

              <div v-if="expandedWeeklySummaryIds[n.id]" class="mt-2 space-y-1">
                <div v-for="section in ['PR', 'PO', 'AP']" :key="`${n.id}-${section}`" class="rounded-lg border border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    class="w-full px-3 py-2 text-left text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-900 transition"
                    @click="toggleWeeklySection(section)"
                  >
                    <span>{{ section }} ค้าง {{ n.details[section].length }} รายการ</span>
                    <i class="fa-solid fa-chevron-down text-[10px] transition-transform" :class="{ 'rotate-180': weeklyExpandState[section] }"></i>
                  </button>
                  <div v-if="weeklyExpandState[section]" class="px-3 pb-2">
                    <div
                      v-for="item in n.details[section]"
                      :key="`${section}-${item.docNo}-${item.issueDate}`"
                      class="text-xs text-gray-600 dark:text-gray-400 py-1 border-t border-gray-100 dark:border-gray-800 break-words"
                    >
                      หมายเลข: {{ item.docNo }} | วันที่: {{ item.issueDate }} | สถานะ: {{ item.status }}
                    </div>
                    <div
                      v-if="!n.details[section].length"
                      class="text-xs text-gray-500 dark:text-gray-400 py-1 border-t border-gray-100 dark:border-gray-800"
                    >
                      ไม่มีรายการค้าง
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="px-3 py-2 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              class="w-full rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm py-2 transition"
              @click="closeNotifications"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
      <div ref="profileRef" class="relative">
        <button
          type="button"
          class="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 transition"
          @click="toggleMenu"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
        >
          <i class="fa-solid fa-circle-user text-[24px]"></i>
        </button>

        <div
          v-if="menuOpen"
          class="absolute right-0 mt-2 w-80 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl z-50 overflow-hidden"
          role="menu"
        >
          <div class="px-5 py-6 text-center">
            <div class="mx-auto w-20 h-20 rounded-full bg-blue-600/10 p-1 mb-3">
              <div class="w-full h-full rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
                <span class="text-2xl font-bold text-blue-600">
                  {{ (props.user.fullName || '-').charAt(0) }}
                </span>
              </div>
            </div>

            <p class="text-[15px] font-bold text-gray-900 dark:text-white">
              {{ props.user.fullName }}
            </p>
            <p class="text-[12px] text-gray-500 dark:text-gray-400">
              {{ props.user.employeeId }} <span v-if="props.user.username">({{ props.user.username }})</span>
            </p>

            <div class="mt-2 flex items-center justify-center gap-2 flex-wrap">
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-[10px] font-semibold"
              >
                <i class="fa-solid fa-briefcase"></i>
                {{ props.user.position }}
              </span>
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[10px] font-semibold"
              >
                <i class="fa-solid fa-user-shield"></i>
                {{ props.user.role }}
              </span>
            </div>

            <p v-if="props.user.department" class="text-[10px] mt-2 text-gray-500 dark:text-gray-400">
              ( {{ props.user.department }} )
            </p>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-800" />

          <div class="p-2">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
              style="color: var(--color-text-secondary)"
              @click="openEditProfile"
            >
              <div class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <i class="fa-solid fa-user-pen text-blue-600 dark:text-blue-300"></i>
              </div>
              แก้ไขข้อมูลโปรไฟล์
            </button>

            <div v-if="props.user.role === 'super_admin'">
              <button
                type="button"
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
                style="color: var(--color-text-secondary)"
                @click="toggleSwitch"
              >
                <div class="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <i class="fa-solid fa-right-left text-purple-700 dark:text-purple-300"></i>
                </div>
                สลับระบบ
                <i
                  class="fa-solid fa-chevron-down text-[10px] ml-auto transition-transform duration-200"
                  :class="{ 'rotate-180': switchOpen }"
                  style="color: var(--color-text-muted)"
                ></i>
              </button>

              <div v-if="switchOpen" class="px-4 pb-2">
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
                  style="color: var(--color-text-secondary)"
                  @click="goToStoreSystem(); closeMenu()"
                >
                  <div class="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <i class="fa-solid fa-warehouse text-blue-700 dark:text-blue-300"></i>
                  </div>
                  ไป ระบบคลัง
                </button>
              </div>
            </div>

            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/10 text-left text-red-600 dark:text-red-300"
              @click="emit('logout'); closeMenu()"
            >
              <div class="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <i class="fa-solid fa-right-from-bracket"></i>
              </div>
              ออกจากระบบ
            </button>
          </div>

          <div
            class="px-5 py-3 border-t border-gray-200 dark:border-gray-800 text-center text-[10px] text-gray-500 dark:text-gray-400"
          >
            เข้าสู่ระบบเมื่อ: {{ new Date().toLocaleDateString('th-TH') }}
          </div>
        </div>
      </div>
    </div>

    <ProfileEditSidebar
      :show="showEditProfile"
      @close="showEditProfile = false"
    />

    <Teleport to="body">
      <div
        v-if="showTrcloudCookieModal"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trcloud-cookie-title"
        @click.self="closeTrcloudCookieModal"
      >
        <div
          class="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl overflow-hidden"
          @click.stop
        >
          <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2
              id="trcloud-cookie-title"
              class="text-base font-semibold text-gray-900 dark:text-white"
            >
              เชื่อมต่อข้อมูล TRCloud
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              วางค่า Cookie จากเบราว์เซอร์หลังล็อกอิน
              <span class="font-mono text-[11px]">thaidrill.trcloud.co</span>
              (ส่วน <span class="font-mono">PHPSESSID</span> และ
              <span class="font-mono">trcloud</span> จำเป็นบ่อยที่สุด) จากนั้นกดตกลง ระบบจะดึง PR/PO/AP/PV ใหม่
              — ไม่ต้องแก้ไฟล์โค้ดหรือ .env
            </p>
            <p class="text-[11px] text-amber-700 dark:text-amber-400 mt-2">
              ใช้งานกับ <span class="font-semibold">npm run dev</span> (Vite proxy) เท่านั้น;
              โหมด build/static ต้องมีเซิร์ฟเวอร์ proxy แยก
            </p>
          </div>
          <div class="px-5 py-4 space-y-3">
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Cookie string
            </label>
            <textarea
              v-model="trcloudCookieDraft"
              rows="5"
              class="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs font-mono p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-y min-h-[120px]"
              placeholder="PHPSESSID=...; trcloud=...; ..."
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div
            class="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex flex-col-reverse sm:flex-row sm:justify-end gap-2"
          >
            <button
              type="button"
              class="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition"
              @click="closeTrcloudCookieModal"
            >
              ปิด
            </button>
            <button
              type="button"
              class="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/30 transition"
              @click="clearTrcloudCookieAndRefetch"
            >
              ล้างค่าในระบบนี้
            </button>
            <button
              type="button"
              class="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition"
              @click="saveTrcloudCookie"
            >
              ตกลง และโหลดข้อมูลใหม่
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </header>
</template>
