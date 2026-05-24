<script setup>
import { computed, onMounted, ref, watch } from "vue"
import Swal from "sweetalert2"
import { useAuthStore } from "@/stores/auth"
import { useTrcloudStore } from "@/stores/trcloud"
import AdminSidebar from "./layout/AdminSidebar.vue"
import AdminHeader from "./layout/AdminHeader.vue"
import SystemadminLisView from "./Views/SystemadminLisView.vue"
import AdminLogsView from "./Views/adminLogsView.vue"
import JobStatusView from "./Views/jobstatusView.vue"
import StoreView from "./Views/storeView.vue"
import PurchaseView from "./Views/purchaseView.vue"
import UrgentsView from "./Views/urgentsView.vue"
import TeamView from "./Views/teamView.vue"
import DashboardView from "./Views/dashboardView.vue"
import AppoView from "./Views/appoView.vue"
import TrackingView from "./Views/trackingView.vue"
import SlipView from "./Views/slipView.vue"
import LineView from "./Views/lineView.vue"
import PrView from "./Views/prView.vue"
import PoView from "./Views/poView.vue"
import ApView from "./Views/apView.vue"
import TrcloudApItemsView from "./Views/trcloudApItemsView.vue"
import TrcloudPoItemsView from "./Views/trcloudPoItemsView.vue"
import PvView from "./Views/pvView.vue"
import TrcloudDocsView from "./Views/trcloudDocsView.vue"
import PrpoappvView from "./Views/prpoappvView.vue"

const auth = useAuthStore()
const trcloudStore = useTrcloudStore()
const sidebarOpen = ref(false)

const headerUser = computed(() => ({
  fullName: auth.user?.fullname ?? "-",
  employeeId: auth.user?.emp_code ?? "-",
  username: auth.user?.username ?? "-",
  role: auth.user?.role ?? "-",
  position: auth.user?.position ?? "-",
  department: auth.user?.department ?? "-",
}))

const SELECTION_STORAGE_KEY = "mwm_admin_selection"
const selectionOptions = [
  { itemId: "/#/dashboard", itemLabel: "แดชบอร์ด" },
  { itemId: "/#/pr_list", itemLabel: "รายการ PR" },
  { itemId: "/#/pr_po", itemLabel: "รายการ PO" },
  { itemId: "/#/pr_ap", itemLabel: "รายการ AP" },
  { itemId: "/#/pr_po_items", itemLabel: "รายการ PO (สินค้า)" },
  { itemId: "/#/pr_ap_items", itemLabel: "รายการ AP (สินค้า)" },
  { itemId: "/#/pr_trcloud", itemLabel: "เอกสาร TRCloud" },
  { itemId: "/#/pr_pv", itemLabel: "รายการ PV" },
  { itemId: "/#/pr_history", itemLabel: "ประวัติทั้งหมด" },
  { itemId: "/#/form_submit", itemLabel: "ฟอมร์ส่งรายการ" },
  { itemId: "/#/form_appo", itemLabel: "ฟอร์ม AP/PO" },
  { itemId: "/#/form_tracking", itemLabel: "ตรางติดตาม" },
  { itemId: "/#/form_slip_match", itemLabel: "จับคู่สลิบโอน" },
  { itemId: "/#/form_line_message", itemLabel: "ส่งข้อความ LINE" },
  { itemId: "/#/system_admins_purchase", itemLabel: "รายการความเร่งด่วน" },
  { itemId: "/#/system_admins_receive", itemLabel: "รายการทีมจัดซื้อ" },
  { itemId: "/#/system_admins_accept", itemLabel: "สถานะรับงาน" },
  { itemId: "/#/system_admins_store", itemLabel: "ร้านค้า" },
  { itemId: "/#/system_admins_inspect", itemLabel: "ตรวจสอบสินค้า" },
  { itemId: "/#/system_users", itemLabel: "ผู้ใช้งานระบบ" },
  { itemId: "/#/usage_logs", itemLabel: "การบันทึกใช้งาน" },
]

function normalizeSelection(next) {
  const id = (next?.itemId ?? "").toString()
  const found = selectionOptions.find((s) => s.itemId === id)
  if (!found) return selectionOptions[0]
  return {
    itemId: found.itemId,
    itemLabel: (next?.itemLabel ?? found.itemLabel ?? "").toString() || found.itemLabel,
  }
}

const selection = ref({
  itemId: "/#/dashboard",
  itemLabel: "แดชบอร์ด",
})

const pageTitle = computed(() => selection.value.itemLabel ?? "Dashboard")
const editApRequestId = ref(null)
const trackingRefreshKey = ref(0)

const activePage = computed(() => {
  const id = (selection.value.itemId ?? "").toString()
  if (id.includes("dashboard")) return "dashboard"
  if (id.includes("pr_list")) return "pr_list"
  if (id.includes("pr_po_items")) return "pr_po_items"
  if (id.includes("pr_po")) return "pr_po"
  if (id.includes("pr_ap_items")) return "pr_ap_items"
  if (id.includes("pr_ap")) return "pr_ap"
  if (id.includes("pr_trcloud")) return "pr_trcloud"
  if (id.includes("pr_pv")) return "pr_pv"
  if (id.includes("pr_history")) return "pr_history"
  if (id.includes("system_admins_purchase")) return "system_admins_purchase"
  if (id.includes("system_admins_receive")) return "system_admins_receive"
  if (id.includes("system_admins_accept")) return "system_admins_accept"
  if (id.includes("system_admins_store")) return "system_admins_store"
  if (id.includes("system_admins_inspect")) return "system_admins_inspect"
  if (id.includes("system_users")) return "system_users"
  if (id.includes("usage_logs")) return "usage_logs"
  if (id.includes("form_appo")) return "form_appo"
  if (id.includes("form_tracking")) return "form_tracking"
  if (id.includes("form_slip_match")) return "form_slip_match"
  if (id.includes("form_line_message")) return "form_line_message"
  return "default"
})

const onSelect = (payload) => {
  if (!payload || typeof payload !== "object") return
  selection.value = normalizeSelection({
    itemId: payload.itemId ?? selection.value.itemId,
    itemLabel: payload.itemLabel ?? selection.value.itemLabel,
  })
  sidebarOpen.value = false
}

function onEditApRequest(row) {
  editApRequestId.value = row?.id ?? null
  selection.value = normalizeSelection({ itemId: "/#/form_appo", itemLabel: "ฟอร์ม AP/PO" })
}

function onEditedApRequest() {
  editApRequestId.value = null
  trackingRefreshKey.value += 1
  selection.value = normalizeSelection({ itemId: "/#/form_tracking", itemLabel: "ตรางติดตาม" })
}

function onCancelEditApRequest() {
  editApRequestId.value = null
  selection.value = normalizeSelection({ itemId: "/#/form_tracking", itemLabel: "ตรางติดตาม" })
}

onMounted(() => {
  // Pre-load TRCLOUD data
  if (!trcloudStore.isLoaded) {
    trcloudStore.fetchAll()
  }
  
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    selection.value = normalizeSelection(parsed)
  } catch {
    localStorage.removeItem(SELECTION_STORAGE_KEY)
  }
})

watch(
  () => selection.value,
  (val) => {
    try {
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(val))
    } catch {
    }
  },
  { deep: true }
)

const onLogout = async () => {
  const result = await Swal.fire({
    title: 'ออกจากระบบ',
    text: 'คุณต้องการออกจากระบบใช่หรือไม่?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#3085d6',
    cancelButtonColor: '#d33',
    confirmButtonText: 'ใช่, ออกจากระบบ',
    cancelButtonText: 'ยกเลิก',
    background: document.documentElement.classList.contains('dark') ? '#1e293b' : '#fff',
    color: document.documentElement.classList.contains('dark') ? '#fff' : '#000'
  })

  if (result.isConfirmed) {
    auth.logout()
  }
}
</script>

<template>
  <div
    class="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400"
  >
    <AdminSidebar
      :mobileOpen="sidebarOpen"
      :activeItemId="selection.itemId"
      @close="sidebarOpen = false"
      @select="onSelect"
    />
    <div class="flex flex-col flex-1 overflow-hidden">
      <AdminHeader
        :title="pageTitle"
        :user="headerUser"
        @toggle-sidebar="sidebarOpen = true"
        @logout="onLogout"
      />
      <main class="flex-1 overflow-auto p-4 sm:p-6">
        <DashboardView v-if="activePage === 'dashboard'" />
        <SystemadminLisView v-else-if="activePage === 'system_users'" />
        <AdminLogsView v-else-if="activePage === 'usage_logs'" />
        <UrgentsView v-else-if="activePage === 'system_admins_purchase'" />
        <TeamView v-else-if="activePage === 'system_admins_receive'" />
        <JobStatusView v-else-if="activePage === 'system_admins_accept'" />
        <StoreView v-else-if="activePage === 'system_admins_store'" />
        <PurchaseView v-else-if="activePage === 'system_admins_inspect'" />
        <AppoView 
  v-else-if="activePage === 'form_appo'" 
  :editId="editApRequestId" 
  @edited="onEditedApRequest" 
  @cancelEdit="onCancelEditApRequest"
  @selectPage="onSelect" 
/>
        <TrackingView v-else-if="activePage === 'form_tracking'" :refreshKey="trackingRefreshKey" @editRow="onEditApRequest" />
        <SlipView v-else-if="activePage === 'form_slip_match'" />
        <LineView v-else-if="activePage === 'form_line_message'" />
        <PrView v-else-if="activePage === 'pr_list'" />
        <PoView v-else-if="activePage === 'pr_po'" />
        <ApView v-else-if="activePage === 'pr_ap'" />
        <TrcloudPoItemsView v-else-if="activePage === 'pr_po_items'" />
        <TrcloudApItemsView 
          v-else-if="activePage === 'pr_ap_items'" 
          @selectPage="onSelect" 
        />
        <TrcloudDocsView v-else-if="activePage === 'pr_trcloud'" />
        <PvView v-else-if="activePage === 'pr_pv'" />
        <PrpoappvView v-else-if="activePage === 'pr_history'" />
        <div
          v-else-if="activePage !== 'default'"
          class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6"
        >
          <p class="text-gray-900 dark:text-white font-semibold">
            {{ pageTitle }}
          </p>
        </div>
        <div
          v-else
          class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6"
        >
          <p class="text-gray-900 dark:text-white font-semibold">
            {{ pageTitle }}
          </p>
        </div>
      </main>
    </div>
  </div>
</template>
