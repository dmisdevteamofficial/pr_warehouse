<script setup>
import AppSidebar from './AppSidebar.vue'
import AppToolbar from './AppToolbar.vue'
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>

<template>
  <div class="flex h-screen overflow-hidden" style="background: var(--color-bg-base)">

    <div v-if="ui.sidebarOpen"
      class="fixed inset-0 bg-black/40 z-20 md:hidden"
      @click="ui.toggleSidebar()" />

    <AppSidebar />

    <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
      <AppToolbar />
      <main class="flex-1 overflow-y-auto p-4 md:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
