<script setup>
import { useRouter, useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const route = useRoute()
const ui = useUiStore()

const menuGroups = [
  {
    label: 'ภาพรวม',
    items: [
      { label: 'แดชบอร์ด', icon: 'fa-gauge-high', path: '/dashboard' },
      { label: 'สรุปรายละเอียด', icon: 'fa-chart-line', path: '/reports' },
    ]
  },
  {
    label: 'คลังสินค้า',
    items: [
      { label: 'รายการสินค้า', icon: 'fa-boxes-stacked', path: '/item-list' },
      { label: 'ประวัติการเพี่มสินค้า', icon: 'fa-clock-rotate-left', path: '/inventory-imports' },
      { label: 'เพี่มสินค้า', icon: 'fa-file-import', path: '/imports' },
      { label: 'ประวัติการนำเข้าสินค้า', icon: 'fa-clock-rotate-left', path: '/inventory-history' },
    ]
  },
  {
    label: 'การเบิกจ่าย',
    items: [
      { label: 'เบิกสินค้า', icon: 'fa-arrow-up-from-bracket', path: '/withdraw' },
      { label: 'ประวัติการเบิก', icon: 'fa-clock-rotate-left', path: '/history' },
      { label: 'ข้อมูลการส่งคืน', icon: 'fa-arrow-rotate-left', path: '/order-list' },
    ]
  },
  {
    label: 'การกวดรับ',
    items: [
      { label: 'ใบกวดรับ', icon: 'fa-file-signature', path: '/return' },
      { label: 'ประวัติการกวดรับ', icon: 'fa-clipboard-list', path: '/return-history' },
    ]
  },
  {
    label: 'ระบบ',
    items: [
      { label: 'พนักงาน', icon: 'fa-users', path: '/employees' },
      { label: 'ผู้ใช้งานระบบ', icon: 'fa-shield-halved', path: '/system-users' },
      { label: 'บันทึกการใช้งาน', icon: 'fa-file-lines', path: '/logs' },
    ]
  },
]

function navigate(path) {
  router.push(path)
  if (ui.sidebarOpen) ui.toggleSidebar()
}
</script>

<template>
  <aside
    class="fixed md:static inset-y-0 left-0 z-30 w-60 flex flex-col border-r transition-transform duration-200"
    :class="ui.sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    style="background: var(--color-bg-sidebar); border-color: var(--color-border)"
  >
    <div class="px-4 py-4 border-b" style="border-color: var(--color-border)">
      <div class="flex items-center gap-3">
        <span class="rounded-md bg-blue-500/30 dark:bg-blue-500/40 w-12 h-10 flex items-center justify-center"><i class="fa-solid fa-warehouse text-[25px] text-blue-600 dark:text-blue-500"></i></span>
        <div>
          <div class="text-[15px] font-semibold" style="color: var(--color-text-primary)">MWM System</div>
          <div class="text-[10px]" style="color: var(--color-text-muted)">Mine Warehouse Management</div>
        </div>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      <div v-for="group in menuGroups" :key="group.label">
        <p class="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1"
           style="color: var(--color-text-muted)">{{ group.label }}</p>
        <ul class="space-y-0.5">
          <li v-for="item in group.items" :key="item.path">
            <button
              @click="navigate(item.path)"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-left transition-colors"
              :class="route.path === item.path
                ? 'bg-blue-50 dark:bg-blue-500/30 text-primary-DEFAULT border-l-[3px] border-blue-600 dark:border-blue-500 pl-[9px]'
                : 'hover:bg-gray-100 dark:hover:bg-slate-700'"
              :style="route.path !== item.path ? 'color: var(--color-text-secondary)' : ''"
            >
              <i :class="`fa-solid ${item.icon} w-4 text-center`"></i>
              {{ item.label }}
            </button>
          </li>
        </ul>
      </div>
    </nav>

    <div class="px-4 py-3 border-t text-center text-[11px]"
         style="border-color: var(--color-border); color: var(--color-text-muted)">
      Powered by DMIS
    </div>
  </aside>
</template>
