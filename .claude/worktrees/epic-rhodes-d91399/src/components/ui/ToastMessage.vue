<script setup>
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>

<template>
  <Transition enter-active-class="transition ease-out duration-300"
              enter-from-class="opacity-0 -translate-y-4 sm:translate-y-0 sm:translate-x-4"
              enter-to-class="opacity-100 translate-y-0 sm:translate-x-0"
              leave-active-class="transition ease-in duration-200"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0">
    <div v-if="ui.toast.show"
         class="fixed top-5 right-5 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-2xl border shadow-2xl text-[14px] min-w-[280px]"
         style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)">
      
      <!-- Status Icon -->
      <div :class="[
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
        ui.toast.type === 'success' ? 'bg-green-100 text-green-600 dark:bg-green-900/30' : 
        ui.toast.type === 'error' ? 'bg-red-100 text-red-600 dark:bg-red-900/30' :
        ui.toast.type === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' :
        'bg-blue-100 text-blue-600 dark:bg-blue-900/30'
      ]">
        <i :class="[
          'text-[16px]',
          ui.toast.type === 'success' ? 'fa-solid fa-circle-check' : 
          ui.toast.type === 'error' ? 'fa-solid fa-circle-exclamation' :
          ui.toast.type === 'warning' ? 'fa-solid fa-triangle-exclamation' :
          'fa-solid fa-circle-info'
        ]"></i>
      </div>

      <!-- Message Text -->
      <div class="flex-1 font-medium">{{ ui.toast.message }}</div>

      <!-- Close Button -->
      <button @click="ui.toast.show = false" class="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
        <i class="fa-solid fa-xmark text-[14px]" style="color: var(--color-text-muted)"></i>
      </button>
    </div>
  </Transition>
</template>
