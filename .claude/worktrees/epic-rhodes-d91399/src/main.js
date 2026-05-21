const savedTheme = localStorage.getItem('mwm_theme')
if (savedTheme === 'dark') document.documentElement.classList.add('dark')

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { OverlayScrollbars } from 'overlayscrollbars'
import 'overlayscrollbars/styles/overlayscrollbars.css'
import App from './App.vue'
import router from './router'
import './assets/main.css'

const app = createApp(App)
const paperScrollbarInstances = new Map()

function createOverlayScrollbarOptions(overflow = undefined) {
  return {
    ...(overflow ? { overflow } : {}),
    scrollbars: {
      theme: 'os-theme-mwm',
      visibility: 'auto',
      autoHide: 'leave',
      autoHideDelay: 500,
      autoHideSuspend: false,
      dragScroll: true,
      clickScroll: false,
      pointers: ['mouse', 'touch', 'pen']
    }
  }
}

function syncPaperScrollbars() {
  const elements = Array.from(document.querySelectorAll('.paper-scroll-wrap'))
  const activeElements = new Set(elements)

  paperScrollbarInstances.forEach((instance, element) => {
    if (!activeElements.has(element)) {
      instance.destroy()
      paperScrollbarInstances.delete(element)
    }
  })

  elements.forEach((element) => {
    if (!paperScrollbarInstances.has(element)) {
      const instance = OverlayScrollbars(
        element,
        createOverlayScrollbarOptions({
          x: 'scroll',
          y: 'hidden'
        })
      )

      paperScrollbarInstances.set(element, instance)
    }
  })
}

function initOverlayScrollbars() {
  OverlayScrollbars(document.body, createOverlayScrollbarOptions())
  syncPaperScrollbars()

  const observer = new MutationObserver(() => {
    syncPaperScrollbars()
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })
}

app.directive('click-outside', {
  mounted(el, binding) {
    el._clickOutside = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value()
      }
    }
    document.addEventListener('click', el._clickOutside)
  },
  unmounted(el) {
    document.removeEventListener('click', el._clickOutside)
  }
})

app.use(createPinia()).use(router).mount('#app')

requestAnimationFrame(() => {
  initOverlayScrollbars()
})
