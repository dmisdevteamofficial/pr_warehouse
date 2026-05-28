<script setup>
import { ref, watch } from "vue"
import AdminMenuItem from "../components/AdminMenuItem.vue"
import AdminMenuGroup from "../components/AdminMenuGroup.vue"
import { useAuthStore } from "@/stores/auth"

const emit = defineEmits(["select", "close"])

const props = defineProps({
  mobileOpen: { type: Boolean, default: false },
  activeItemId: { type: String, default: "/#/dashboard" },
})

const auth = useAuthStore()
const collapsed = ref(false)
const systemAdminsOpen = ref(false)
const prListOpen = ref(false)
const formExpOpen = ref(false)
const formApOpen = ref(false)

const menuItems = [
  { id: "/#/dashboard", icon: "fa-house", label: "แดชบอร์ด" },
  {
    id: "/#/pr_section",
    icon: "fa-file-lines",
    label: "ข้อมูลรายละเอียด",
    isTimeline: true,
    children: [
      { id: "/#/pr_list", icon: "fa-list-check", label: "รายการ [PR]" },
      { id: "/#/pr_po", icon: "fa-file-invoice-dollar", label: "รายการ [PO]" },
      { id: "/#/pr_po_items", icon: "fa-boxes-stacking", label: "รายการ [PO (สินค้า)]" },
      { id: "/#/pr_po_items_detail", icon: "fa-boxes-stacking", label: "รายการ [EXP (สินค้า)]" },
      { id: "/#/pr_ap", icon: "fa-file-invoice", label: "รายการ [AP]" },
      { id: "/#/pr_ap_items", icon: "fa-boxes-packing", label: "รายการ [AP (สินค้า)]" },
      { id: "/#/pr_trcloud", icon: "fa-layer-group", label: "เอกสาร TRCloud" },
      { id: "/#/pr_pv", icon: "fa-money-check-dollar", label: "รายการ [PV]" },
      { id: "/#/pr_history", icon: "fa-clipboard-check", label: "การเชื่อมโยง" },
    ],
  },
  // {
  //   id: "/#/system_admins",
  //   icon: "fa-user-shield",
  //   label: "สถานะรายการ",
  //   children: [
  //     { id: "/#/system_admins_purchase", icon: "fa-bolt", label: "รายการความเร่งด่วน" },
  //     { id: "/#/system_admins_receive", icon: "fa-people-group", label: "รายการทีมจัดซื้อ" },
  //     { id: "/#/system_admins_accept", icon: "fa-clipboard-check", label: "สถานะรับงาน" },
  //     { id: "/#/system_admins_store", icon: "fa-store", label: "ร้านค้า" },
  //     { id: "/#/system_admins_inspect", icon: "fa-magnifying-glass", label: "ตรวจสอบสินค้า" },
  //   ],
  // },
  {
    id: "/#/form_submit_exp",
    icon: "fa-paper-plane",
    label: "ฟอมร์ส่งรายการ Exp",
    selectable: true,
    children: [
      { id: "/#/form_tracking_exp", icon: "fa-list-check", label: "ตรางติดตาม Exp" },
      { id: "/#/form_slip_exp", icon: "fa-receipt", label: "จับคู่สลิบโอน Exp" },
      { id: "/#/form_line_exp", icon: "fa-message", label: "ส่งข้อความ LINE Exp" },
    ],
  },
  {
    id: "/#/form_submit_ap",
    icon: "fa-file-invoice-dollar",
    label: "ฟอมร์ส่งรายการ AP",
    selectable: true,
    children: [
      { id: "/#/form_tracking_ap", icon: "fa-table-columns", label: "ตรางติดตาม AP" },
      { id: "/#/form_slip_ap", icon: "fa-money-bill-transfer", label: "จับคู่สลิบโอน AP" },
      { id: "/#/form_line_ap", icon: "fa-comment-sms", label: "ส่งข้อความ LINE AP" },
    ],
  },
  
  { id: "/#/system_users", icon: "fa-users", label: "ผู้ใช้งานระบบ" },
  { id: "/#/usage_logs", icon: "fa-clipboard-list", label: "การบันทึกใช้งาน" },
  
]

watch(
  () => props.activeItemId,
  (id) => {
    const key = (id ?? "").toString()
    if (key.includes("system_admins")) systemAdminsOpen.value = true
    if (key.includes("pr_") || key.includes("pr_list")) prListOpen.value = true
    if (key.includes("_exp")) formExpOpen.value = true
    if (key.includes("_ap")) formApOpen.value = true
  },
  { immediate: true }
)

function selectItem(item) {
  emit("select", { itemId: item.id, itemLabel: item.label })
  if (props.mobileOpen) emit("close")
}

function getSectionKey(item) {
  const id = (item?.id ?? "").toString()
  if (id.includes("system_admins")) return "system_admins"
  if (id.includes("pr_") || id.includes("pr_list")) return "pr_list"
  if (id.includes("_exp")) return "form_exp"
  if (id.includes("_ap")) return "form_ap"
  return ""
}

function isSectionActive(item) {
  const activeId = (props.activeItemId ?? "").toString()
  const section = getSectionKey(item)
  if (section === "system_admins") return activeId.includes("system_admins")
  if (section === "pr_list") return activeId.includes("pr_") || activeId.includes("pr_list")
  if (section === "form_exp") return activeId.includes("_exp")
  if (section === "form_ap") return activeId.includes("_ap")
  return false
}

function isSectionOpen(item) {
  const section = getSectionKey(item)
  if (section === "system_admins") return systemAdminsOpen.value
  if (section === "pr_list") return prListOpen.value
  if (section === "form_exp") return formExpOpen.value
  if (section === "form_ap") return formApOpen.value
  return false
}

function toggleSection(item) {
  const section = getSectionKey(item)
  if (section === "system_admins") systemAdminsOpen.value = !systemAdminsOpen.value
  if (section === "pr_list") prListOpen.value = !prListOpen.value
  if (section === "form_exp") formExpOpen.value = !formExpOpen.value
  if (section === "form_ap") formApOpen.value = !formApOpen.value
}

function onParentClick(item) {
  if (item?.selectable) selectItem(item)
  toggleSection(item)
}

const closeMobile = () => {
  emit("close")
}
</script>

<template>
  <div>
    <div
      v-if="props.mobileOpen"
      class="fixed inset-0 bg-black/40 z-40 sm:hidden"
      @click="closeMobile"
    />
    <aside
      :class="[
        'flex flex-col justify-between bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 h-screen py-4 px-2 transition-all duration-300 transform-gpu',
        collapsed ? 'w-16' : 'w-56',
        'fixed left-0 top-0 z-50 shadow-xl sm:static sm:z-auto sm:shadow-none',
        props.mobileOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0',
      ]"
    >
    <!-- Logo + Toggle -->
    <div>
      <div class="flex items-center justify-between px-2 mb-6">
        <div class="flex items-center gap-2">
          <div
            class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0"
            aria-label="ระบบติดตามงาน"
          >
            <i class="fa-solid fa-file-invoice text-white text-[16px]"></i>
          </div>
          <span
            v-if="!collapsed"
            class="text-gray-900 dark:text-white font-semibold text-sm tracking-wide flex flex-col leading-4"
          >
            <span>ระบบติดตามงาน</span>
            <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <i class="fa-solid fa-receipt text-[10px]"></i>
              ใบสั่งซื้อ
            </span>
          </span>
        </div>
        <button
          class="hidden sm:inline-flex text-gray-500 hover:text-gray-900 dark:hover:text-white transition p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="collapsed = !collapsed"
        >
          <i v-if="!collapsed" class="fa-solid fa-chevron-left text-[14px]"></i>
          <i v-else class="fa-solid fa-chevron-right text-[14px]"></i>
        </button>
        <button
          class="sm:hidden text-gray-500 hover:text-gray-900 dark:hover:text-white transition p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          type="button"
          aria-label="ปิดเมนู"
          @click="closeMobile"
        >
          <i class="fa-solid fa-xmark text-[18px]"></i>
        </button>
      </div>

      <!-- Menu Items -->
      <AdminMenuGroup label="ระบบ" :collapsed="collapsed">
        <div v-for="item in menuItems" :key="item.id">
          <div v-if="item.children">
            <div @click="onParentClick(item)">
              <li
                :class="[
                  'relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                  isSectionActive(item)
                    ? 'bg-blue-50 dark:bg-blue-500/30 text-primary-DEFAULT border-l-[3px] border-blue-600 dark:border-blue-500 pl-[9px]'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white',
                ]"
              >
                <i class="fa-solid w-5 text-center" :class="item.icon"></i>
                <span v-if="!collapsed" class="text-sm font-medium whitespace-nowrap transition-all duration-300">
                  {{ item.label }}
                </span>
                <i
                  v-if="!collapsed"
                  class="fa-solid fa-chevron-down text-[12px] ml-auto transition-transform duration-200"
                  :class="{ 'rotate-180': isSectionOpen(item) }"
                  :style="{ color: isSectionActive(item) ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }"
                ></i>
              </li>
            </div>

            <div 
              v-if="isSectionOpen(item)" 
              :class="[
                collapsed ? 'mt-1' : 'mt-1 ml-3 pl-2',
                !item.isTimeline && !collapsed ? 'border-l border-gray-200 dark:border-gray-800' : ''
              ]"
            >
              <div
                v-for="(child, index) in item.children"
                :key="child.id"
                @click="selectItem(child)"
              >
                <AdminMenuItem
                  :icon="child.icon"
                  :label="child.label"
                  :active="props.activeItemId === child.id"
                  :collapsed="collapsed"
                  :isStep="item.isTimeline"
                  :isFirstStep="index === 0"
                  :isLastStep="index === item.children.length - 1"
                />
              </div>
            </div>
          </div>
          <div v-else @click="selectItem(item)">
            <AdminMenuItem
              :icon="item.icon"
              :label="item.label"
              :active="props.activeItemId === item.id"
              :collapsed="collapsed"
              :badge="item.badge"
            />
          </div>
        </div>
      </AdminMenuGroup>
    </div>

    <!-- User Profile Footer -->
    <div class="mt-auto px-2 pb-2">
      <div 
        class="flex items-center gap-3 p-2 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 transition-all duration-300"
        :class="collapsed ? 'justify-center' : ''"
      >
        <div class="w-8 h-8 rounded-full bg-blue-600 flex-shrink-0 overflow-hidden flex items-center justify-center">
          <img v-if="auth.profileImage" :src="auth.profileImage" class="w-full h-full object-cover" />
          <span v-else class="text-[12px] font-bold text-white">
            {{ (auth.user?.fullname || 'U').charAt(0) }}
          </span>
        </div>
        <div v-if="!collapsed" class="flex flex-col min-w-0">
          <span class="text-[12px] font-semibold text-gray-900 dark:text-white truncate">
            {{ auth.user?.fullname || 'ผู้ใช้งาน' }}
          </span>
          <span class="text-[10px] text-gray-500 dark:text-gray-400 truncate">
            {{ auth.user?.position || auth.user?.role || '-' }}
          </span>
        </div>
      </div>
    </div>

    <div
      class="border-t border-gray-200 dark:border-gray-800 pt-3 px-3 text-[10px] text-center text-gray-500 dark:text-gray-400"
    >
      <span v-if="!collapsed">พัฒนาโดย DMIS</span>
    </div>
    </aside>
  </div>
</template>
