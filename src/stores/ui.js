import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const toast = ref({ show: false, message: '', type: 'info' })
  const sidebarOpen = ref(false)
  const pendingOrderId = ref(null)

  function showToast(message, type = 'info', duration = 3000) {
    toast.value = { show: true, message, type }
    setTimeout(() => {
      toast.value.show = false
    }, duration)
  }

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function setPendingOrder(id) {
    pendingOrderId.value = id
  }

  return { toast, sidebarOpen, pendingOrderId, showToast, toggleSidebar, setPendingOrder }
})
