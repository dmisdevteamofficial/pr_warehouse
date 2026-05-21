<script setup>
import UserAppToolbar from '@/components/layout/UserAppToolbar.vue'
import WithdrawFormView from './WithdrawFormView.vue'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { supabase } from '@/lib/supabase'

const loading = ref(true)
const items = ref([])
const categories = ref([])
const searchText = ref('')
const selectedCategoryId = ref('all')
const cart = ref([])
const showForm = ref(false)
const currentPage = ref(1)
const PAGE_SIZE = 6

// ─── Barcode Scanner ─────────────────────────────────────────────────────────
const barcodeBuffer = ref('')
const barcodeTimeout = ref(null)
const barcodeAlert = ref(null)
const barcodeAlertTimeout = ref(null)

function showBarcodeAlert(type, message) {
  if (barcodeAlertTimeout.value) clearTimeout(barcodeAlertTimeout.value)
  barcodeAlert.value = { type, message }
  barcodeAlertTimeout.value = setTimeout(() => { barcodeAlert.value = null }, 3000)
}

function handleBarcodeInput(e) {
  if (showForm.value) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  
  if (barcodeTimeout.value) clearTimeout(barcodeTimeout.value)
  
  if (e.key === 'Enter') {
    const code = barcodeBuffer.value.trim()
    barcodeBuffer.value = ''
    if (!code) return
    
    const found = items.value.find(i => i.item_code.toLowerCase() === code.toLowerCase())
    if (!found) { 
      showBarcodeAlert('error', `ไม่พบพัสดุรหัส "${code}"`); 
      return 
    }
    
    const inCart = cart.value.find(c => c.id === found.id)
    const currentAmount = inCart ? inCart.amount : 0
    
    if (found.current_stock <= currentAmount) { 
      showBarcodeAlert('error', `"${found.item_name}" ไม่สามารถเพิ่มได้ (สต็อกไม่พอ)`); 
      return 
    }
    
    addToCart(found)
    showBarcodeAlert('success', `สแกนพบ: "${found.item_name}"`)
  } else if (e.key.length === 1) {
    barcodeBuffer.value += e.key
    barcodeTimeout.value = setTimeout(() => { barcodeBuffer.value = '' }, 100)
  }
}

async function fetchData() {
  loading.value = true
  try {
    const [
      { data: itemsData, error: itemsError },
      { data: categoriesData, error: categoriesError }
    ] = await Promise.all([
      supabase.from('items').select('*, category(category_name)').order('item_name'),
      supabase.from('category').select('*').order('category_name')
    ])
    if (itemsError) throw itemsError
    if (categoriesError) throw categoriesError
    items.value = itemsData || []
    categories.value = categoriesData || []
  } catch (err) {
    console.error('Error fetching data:', err.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => { fetchData(); window.addEventListener('keydown', handleBarcodeInput) })
onUnmounted(() => window.removeEventListener('keydown', handleBarcodeInput))

const isSearching = computed(() => 
  searchText.value.trim() !== '' || selectedCategoryId.value !== 'all'
)

const filteredItems = computed(() => {
  // Reset to page 1 when filter changes (handled via watcher-like computed side-effect via separate watcher)
  return items.value.filter(item => {
    const q = searchText.value.toLowerCase()
    const usage = String(item.usage_type ?? '').toLowerCase()
    const matchSearch = !searchText.value ||
      item.item_name.toLowerCase().includes(q) ||
      item.item_code.toLowerCase().includes(q) ||
      usage.includes(q)
    const matchCategory = selectedCategoryId.value === 'all' || item.category_id === selectedCategoryId.value
    return matchSearch && matchCategory
  })
})

// Reset page when search/filter changes
watch([searchText, selectedCategoryId], () => { currentPage.value = 1 })

const totalPages = computed(() => {
  if (!isSearching.value) return 1
  return Math.ceil(filteredItems.value.length / PAGE_SIZE)
})

const displayedItems = computed(() => {
  if (!isSearching.value) {
    // No search: show first 6 only
    return filteredItems.value.slice(0, PAGE_SIZE)
  }
  // Searching: paginate
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredItems.value.slice(start, start + PAGE_SIZE)
})

function addToCart(item) {
  const existing = cart.value.find(c => c.id === item.id)
  if (existing) {
    if (existing.amount < item.current_stock) existing.amount++
  } else {
    cart.value.push({ ...item, amount: 1 })
  }
}
function removeFromCart(id) { cart.value = cart.value.filter(c => c.id !== id) }
function updateAmount(id, delta) {
  const item = cart.value.find(c => c.id === id)
  if (item) {
    const newAmount = item.amount + delta
    if (newAmount > 0 && newAmount <= item.current_stock) item.amount = newAmount
  }
}
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + item.amount, 0))

function goToForm() { showForm.value = true }
function backToCart() { showForm.value = false }
function handleFormSubmit(data) { console.log('Submit form:', data) }
</script>

<template>
  <WithdrawFormView
    v-if="showForm"
    :cart-items="cart"
    @back="backToCart"
    @submit="handleFormSubmit"
  />

  <UserAppToolbar v-else>
    <div class="max-w-screen-2xl mx-auto px-4 md:px-6 mt-6 pb-20">

      <Transition name="toast">
        <div
          v-if="barcodeAlert"
          :class="[
            'fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-white text-[14px] font-semibold backdrop-blur-md transition-all',
            barcodeAlert.type === 'success' ? 'bg-green-500/90' : 'bg-red-500/90'
          ]"
        >
          <i :class="barcodeAlert.type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'" class="text-[18px]"></i>
          {{ barcodeAlert.message }}
        </div>
      </Transition>

      <div class="flex flex-col lg:flex-row gap-6">

        <div class="flex-1">
          <div class="section-title text-[22px] font-bold mb-5 flex items-center gap-2">
            <i class="fa-solid fa-box-open text-blue-600"></i>
            เลือกพัสดุที่ต้องจะการเบิก
          </div>

          <div class="flex items-center gap-3 px-4 py-3 mb-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 text-blue-600 dark:text-blue-400 text-[13px]">
            <i class="fa-solid fa-barcode text-[20px] shrink-0"></i>
            <span>กดยิงบาร์โค้ด — ระบบจะค้นหาและเพิ่มพัสดุลงตะกร้าอัตโนมัติ</span>
          </div>

          <div class="flex flex-col md:flex-row gap-3 mb-6 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm">
            <div class="flex-1 relative">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]"></i>
              <input v-model="searchText" type="text" placeholder="ค้นหาชื่อ, รหัส หรือประเภทที่ใช้..."
                class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[14px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" />
            </div>
            <select v-model="selectedCategoryId"
              class="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[14px] outline-none min-w-[160px]">
              <option value="all">ทุกหมวดหมู่</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.category_name }}</option>
            </select>
          </div>

          <!-- Item count hint -->
          <div v-if="!loading" class="mb-3 flex items-center justify-between">
            <p class="text-[12px] text-gray-400">
              <template v-if="!isSearching">
                แสดง 6 รายการล่าสุด — <span class="text-blue-500 font-medium">ค้นหาเพื่อดูทั้งหมด {{ items.length }} รายการ</span>
              </template>
              <template v-else>
                พบ <span class="font-semibold text-gray-600 dark:text-gray-300">{{ filteredItems.length }}</span> รายการ
              </template>
            </p>
          </div>

          <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div v-for="i in 6" :key="i" class="h-32 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse"></div>
          </div>
          <div v-else-if="filteredItems.length === 0" class="py-20 text-center text-gray-400">
            <i class="fa-solid fa-inbox text-[48px] mb-4 opacity-20"></i>
            <p>ไม่พบพัสดุที่ต้องการ</p>
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div v-for="item in displayedItems" :key="item.id"
              class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group">
              <div class="flex justify-between items-start mb-2">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-500 uppercase tracking-wider">{{ item.item_code }}</span>
                <span :class="item.current_stock > 0 ? 'text-green-500' : 'text-red-500'" class="text-[11px] font-bold">
                  {{ item.current_stock > 0 ? 'ยังเหลือ' : 'หมดแล้ว' }}
                </span>
              </div>
              <h3 class="text-[15px] font-bold text-gray-800 dark:text-gray-100 mb-1 line-clamp-1">{{ item.item_name }}</h3>
              <p class="text-[12px] text-gray-400 mb-1.5">{{ item.category?.category_name || '-' }}</p>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mb-4 line-clamp-2 leading-snug">
                <span class="text-gray-400 dark:text-gray-500 shrink-0">ประเภทที่ใช้</span>
                <span class="font-medium text-gray-700 dark:text-gray-200 ml-1">{{ String(item.usage_type ?? '').trim() || '—' }}</span>
              </p>
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-[16px] font-black text-blue-600">{{ item.current_stock }}</span>
                  <span class="text-[12px] text-gray-400 ml-1">{{ item.unit }}</span>
                </div>
                <button @click="addToCart(item)" :disabled="item.current_stock <= 0"
                  class="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-blue-50">
                  <i class="fa-solid fa-plus"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Pagination (show only when searching and more than 1 page) -->
          <div v-if="isSearching && totalPages > 1" class="mt-6 flex items-center justify-center gap-2">
            <button
              @click="currentPage--"
              :disabled="currentPage === 1"
              class="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-500 hover:border-blue-400 hover:text-blue-500 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <i class="fa-solid fa-chevron-left text-[11px]"></i>
            </button>

            <template v-for="page in totalPages" :key="page">
              <!-- Show first, last, current, and neighbours; others as "..." -->
              <template v-if="page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1">
                <button
                  @click="currentPage = page"
                  :class="[
                    'w-9 h-9 rounded-xl text-[13px] font-bold border transition-all',
                    currentPage === page
                      ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-500'
                  ]"
                >
                  {{ page }}
                </button>
              </template>
              <span
                v-else-if="page === currentPage - 2 || page === currentPage + 2"
                class="w-9 h-9 flex items-center justify-center text-gray-400 text-[13px]"
              >…</span>
            </template>

            <button
              @click="currentPage++"
              :disabled="currentPage === totalPages"
              class="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-500 hover:border-blue-400 hover:text-blue-500 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <i class="fa-solid fa-chevron-right text-[11px]"></i>
            </button>
          </div>

        </div>

        <!-- Cart panel (unchanged) -->
        <div class="w-full lg:w-[380px] shrink-0">
          <div class="sticky top-20">
            <div class="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-120px)]">
              <div class="p-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
                <div class="flex items-center justify-between">
                  <h2 class="text-[17px] font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    <i class="fa-solid fa-cart-shopping text-blue-500"></i>รายการที่จะเบิก
                  </h2>
                  <span class="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[12px] font-bold">{{ cart.length }} รายการ</span>
                </div>
              </div>

              <div class="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
                <div v-if="cart.length === 0" class="h-full flex flex-col items-center justify-center py-10 text-gray-400 text-center">
                  <div class="w-16 h-16 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-basket-shopping text-[24px] opacity-20"></i>
                  </div>
                  <p class="text-[13px]">ยังไม่มีพัสดุที่เลือก</p>
                  <p class="text-[11px] mt-1 opacity-60">ยิงบาร์โค้ดหรือกดปุ่ม + เพื่อเพิ่มพัสดุ</p>
                </div>
                <div v-for="c in cart" :key="c.id"
                  class="p-3 rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-box text-blue-500 text-[14px]"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-bold text-gray-800 dark:text-gray-100 truncate">{{ c.item_name }}</div>
                    <div class="text-[11px] text-gray-400">สต็อกคงเหลือ: {{ c.current_stock }} {{ c.unit }}</div>
                  </div>
                  <div class="flex flex-col items-end gap-2">
                    <button @click="removeFromCart(c.id)" class="text-gray-300 hover:text-red-500 transition-colors">
                      <i class="fa-solid fa-xmark text-[12px]"></i>
                    </button>
                    <div class="flex items-center bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
                      <button @click="updateAmount(c.id, -1)" class="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 transition-all text-[10px]"><i class="fa-solid fa-minus"></i></button>
                      <span class="w-8 text-center text-[12px] font-bold">{{ c.amount }}</span>
                      <button @click="updateAmount(c.id, 1)" class="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 transition-all text-[10px]"><i class="fa-solid fa-plus"></i></button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="p-5 bg-gray-50/80 dark:bg-slate-800/80 backdrop-blur-md border-t border-gray-100 dark:border-slate-800">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-[13px] text-gray-500 dark:text-gray-400 font-medium">รวมจำนวนที่เบิก</span>
                  <span class="text-[16px] font-black text-gray-800 dark:text-gray-100">{{ cartTotal }} หน่วย</span>
                </div>
                <button
                  @click="goToForm"
                  :disabled="cart.length === 0"
                  class="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-[15px] shadow-lg shadow-blue-500/25 transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                >
                  ถัดไป
                  <i class="fa-solid fa-chevron-right ml-2 text-[12px]"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </UserAppToolbar>
</template>

<style scoped>
.section-title { color: var(--color-text-primary); }
.overflow-y-auto::-webkit-scrollbar { width: 4px; }
.overflow-y-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-y-auto::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
.dark .overflow-y-auto::-webkit-scrollbar-thumb { background: #334155; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-16px); }
</style>