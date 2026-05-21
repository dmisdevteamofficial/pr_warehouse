<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import NotificationDropdown from '@/components/ui/NotificationDropdown.vue'
import ProfileDropdown from '@/components/ui/ProfileDropdown.vue'

const route = useRoute()
const ui = useUiStore()

const thaiDays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสอร์']
const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const dateTimeStr = ref('')

function updateTime() {
  const now = new Date()
  const day = thaiDays[now.getDay()]
  const date = now.getDate()
  const month = thaiMonths[now.getMonth()]
  const year = now.getFullYear() + 543
  const time = now.toTimeString().slice(0, 8)
  dateTimeStr.value = `วัน${day}ที่ ${date} ${month} ${year}  |  ${time}`
}

let timer
onMounted(() => { updateTime(); timer = setInterval(updateTime, 1000) })
onUnmounted(() => clearInterval(timer))

const isDark = ref(document.documentElement.classList.contains('dark'))
function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('mwm_theme', isDark.value ? 'dark' : 'light')
}

const breadcrumbMap = { '/dashboard': 'แดชบอร์ด' }
</script>

<template>
  <header class="h-14 flex items-center justify-between px-4 border-b shrink-0"
          style="background: var(--color-bg-toolbar); border-color: var(--color-border)">

    <div class="flex items-center gap-3">
      <button @click="ui.toggleSidebar()"
              class="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
              style="color: var(--color-text-secondary)">
        <i class="fa-solid fa-bars"></i>
      </button>
      <div class="flex items-center gap-1.5 text-[13px]">
        <i class="fa-solid fa-house" style="color: var(--color-text-muted)"></i>
        <span style="color: var(--color-text-muted)">หน้าหลัก</span>
        <span style="color: var(--color-text-muted)">›</span>
        <span class="font-medium text-primary-DEFAULT">
          {{ breadcrumbMap[route.path] || route.path }}
        </span>
      </div>
    </div>

    <div class="hidden md:block text-[13px]" style="color: var(--color-text-secondary)">
      {{ dateTimeStr }}
    </div>

    <div class="flex items-center gap-1">
      <button @click="toggleTheme"
              class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-[15px]"
              style="color: var(--color-text-secondary)">
        <i :class="isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'"></i>
      </button>

      <NotificationDropdown />
      <ProfileDropdown />
    </div>
  </header>
</template>
