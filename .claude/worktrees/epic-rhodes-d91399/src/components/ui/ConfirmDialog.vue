<script setup>
import { ref } from 'vue'

const props = defineProps({
  show: Boolean,
  title: { type: String, default: 'ยืนยันการดำเนินการ' },
  message: { type: String, default: 'คุณแน่ใจหรือไม่ว่าต้องการดำเนินการนี้?' },
  confirmText: { type: String, default: 'ตกลง' },
  cancelText: { type: String, default: 'ยกเลิก' },
  type: { type: String, default: 'primary' } // primary, danger, warning
})

const emit = defineEmits(['confirm', 'cancel'])

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="onCancel"></div>
      
      <!-- Dialog Content -->
      <div class="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
           style="background: var(--color-bg-card)">
        <div class="p-6">
          <div class="flex items-center gap-4 mb-4">
            <div :class="[
              'w-12 h-12 rounded-full flex items-center justify-center shrink-0',
              type === 'danger' ? 'bg-red-100 text-red-600 dark:bg-red-900/30' : 
              type === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' :
              'bg-blue-100 text-blue-600 dark:bg-blue-900/30'
            ]">
              <i :class="[
                'text-xl',
                type === 'danger' ? 'fa-solid fa-triangle-exclamation' :
                type === 'warning' ? 'fa-solid fa-circle-exclamation' :
                'fa-solid fa-circle-info'
              ]"></i>
            </div>
            <div>
              <h3 class="text-[16px] font-bold" style="color: var(--color-text-primary)">{{ title }}</h3>
              <p class="text-[14px] mt-1" style="color: var(--color-text-secondary)">{{ message }}</p>
            </div>
          </div>
          
          <div class="flex items-center justify-end gap-3 mt-6">
            <button @click="onCancel"
                    class="px-4 py-2 rounded-xl text-[14px] font-medium transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                    style="color: var(--color-text-secondary)">
              {{ cancelText }}
            </button>
            <button @click="onConfirm"
                    :class="[
                      'px-6 py-2 rounded-xl text-[14px] font-medium text-white transition-opacity hover:opacity-90 shadow-sm',
                      type === 'danger' ? 'bg-red-600' : 
                      type === 'warning' ? 'bg-amber-500' :
                      'bg-blue-600'
                    ]">
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@keyframes zoom-in {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.animate-in { animation: zoom-in 0.2s ease-out; }
</style>
