<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const trcloudStore = useTrcloudStore()

const props = defineProps({
  docNumber: {
    type: [String, null],
    default: null
  }
})

const emit = defineEmits(['selectPage'])

const copied = ref(false)

// Type-specific keys for documents, to match the items
const documentTypeKeys = {
  ap: ['document_number', 'ap_number', 'invoice_number', 'doc_number', 'reference', 'id'],
  expense: ['document_number', 'expense_number', 'expense', 'expense_no', 'expense_doc', 'expense_id', 'doc_number', 'reference', 'id'],
  po: ['document_number', 'po_number', 'po', 'doc_number', 'reference', 'id']
}

// Use store's pre-built indexes
const documentData = computed(() => {
  if (!props.docNumber) return null
  const target = String(props.docNumber).trim()
  return trcloudStore.documentByDocNumber.get(target) || null
})

const documentItems = computed(() => {
  if (!documentData.value || !props.docNumber) return []
  
  const type = documentData.value.__type
  const targetDocNumber = String(props.docNumber).trim()
  
  let items = []
  let itemIndex = null
  const typeKeys = documentTypeKeys[type]
  
  if (type === 'ap') {
    itemIndex = trcloudStore.apItemsByDocNumber
  } else if (type === 'expense') {
    itemIndex = trcloudStore.expenseItemsByDocNumber
  } else if (type === 'po') {
    itemIndex = trcloudStore.poItemsByDocNumber
  }
  
  if (itemIndex && typeKeys) {
    // Check the target first
    if (itemIndex.has(targetDocNumber)) {
      items = itemIndex.get(targetDocNumber)
    } else {
      // Check all type-specific document number keys from the documentData
      for (const key of typeKeys) {
        const val = String(documentData.value[key] || '').trim()
        if (val && itemIndex.has(val)) {
          items = itemIndex.get(val)
          break
        }
      }
    }
  }
  
  return items
})

const documentUrl = computed(() => {
  if (!documentData.value) return '-'
  return getDisplayValue(documentData.value, ['url', 'link'])
})

const getDisplayValue = (obj, possibleKeys) => {
  for (const key of possibleKeys) {
    if (obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      return obj[key]
    }
  }
  return '-'
}

const isUrl = (value) => {
  if (!value) return false
  const str = String(value)
  // Fast check length first to avoid processing very long strings
  if (str.length > 2048) return false
  // Simple and safe URL pattern without catastrophic backtracking
  try {
    new URL(str)
    return true
  } catch (_) {
    try {
      new URL('https://' + str)
      return true
    } catch (_) {
      return false
    }
  }
}

const copyDocNumber = async () => {
  if (!props.docNumber) return
  try {
    await navigator.clipboard.writeText(String(props.docNumber))
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const getStatusStyles = (statusValue) => {
  const status = String(statusValue || '').trim().toLowerCase()
  const styles = {
    success: { bg: '#c7ffdc', color: '#139141' },
    new: { bg: '#ffd1d1', color: '#c2273e' },
    partial: { bg: '#ffe9d1', color: '#bf7d0b' },
    cancel: { bg: '#ffd1ef', color: '#c72848' }
  }
  return styles[status] || { bg: '#add5ff', color: '#0e549e' }
}

const goBack = () => {
  emit('selectPage', { itemId: '/#/pr_po_items', itemLabel: 'TRCloud PO รายการสินค้า' })
}

onMounted(() => {
  if (!trcloudStore.isLoaded) {
    trcloudStore.fetchAll()
  }
})
</script>

<template>
  <div>
    <div class="mb-6 flex items-center gap-3">
      <button 
        @click="goBack"
        class="px-4 py-2 rounded-lg border bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <i class="fa-solid fa-arrow-left mr-2"></i>
        ย้อนกลับ
      </button>
    </div>

    <div v-if="!documentData" class="rounded-xl border p-12 text-center" style="background: var(--color-bg-card); border-color: var(--color-border);">
      <i class="fa-solid fa-file-circle-question text-3xl text-gray-400 mb-4"></i>
      <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary)">ไม่พบเอกสาร</h2>
      <p style="color: var(--color-text-muted)">ไม่พบเอกสารหมายเลข {{ docNumber }} ในระบบ</p>
    </div>

    <template v-else>
      <div class="mb-6">
        <h1 class="text-[20px] font-semibold mb-2" style="color: var(--color-text-primary)">
          <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-semibold" style="background: rgba(59, 130, 246, 0.1); color: rgb(59, 130, 246);">
            {{ documentData.__type?.toUpperCase() }}
          </span>
          <button 
            @click="copyDocNumber" 
            class="inline-flex items-center gap-2 hover:text-blue-500 dark:hover:text-blue-400 rounded px-2 py-1 transition-colors cursor-pointer"
            :title="copied ? 'คัดลอกแล้ว!' : 'คลิกเพื่อคัดลอกเลขเอกสาร'"
          >
            {{ docNumber }}
            <i v-if="copied" class="fa-solid fa-check text-green-500"></i>
            <i v-else class="fa-regular fa-copy text-gray-400"></i>
          </button>
        </h1>
        <p class="text-[13px]" style="color: var(--color-text-muted)">รายละเอียดเอกสารจาก TRCloud</p>
      </div>

      <!-- Main Details -->
      <div class="rounded-xl border p-6 mb-6" style="background: var(--color-bg-card); border-color: var(--color-border);">
        <h3 class="text-sm font-semibold mb-4 uppercase tracking-wider" style="color: var(--color-text-muted)">ข้อมูลทั่วไป</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">NAME:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['name', 'organization']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">ORGANIZATION:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['organization', 'name']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">ADDRESS:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['address']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">TELEPHONE:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              <a 
                v-if="getDisplayValue(documentData, ['telephone', 'phone', 'tel']) !== '-'"
                :href="'tel:' + getDisplayValue(documentData, ['telephone', 'phone', 'tel'])"
                class="text-blue-500 hover:text-blue-600 underline"
              >
                <i class="fa-solid fa-phone mr-1 text-xs"></i>
                {{ getDisplayValue(documentData, ['telephone', 'phone', 'tel']) }}
              </a>
              <span v-else>-</span>
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">ISSUE DATE:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['issue_date', 'date', 'issueDate']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">REFERENCE:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['reference', 'ref']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">STAFF:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['staff', 'created_by']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">PROJECT:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['project', 'project_name']) }}
            </p>
          </div>
          <div>
            <label class="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider hover:text-[14px] hover:text-rose-500 dark:hover:text-rose-400 transition-colors animate-pulse">ลิงค์เอกสาร:</label>
            <div class="mt-1">
              <a 
                v-if="isUrl(documentUrl)" 
                :href="documentUrl" 
                target="_blank" 
                rel="noopener noreferrer"
                class="font-medium text-blue-500 hover:text-blue-600 underline inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                :title="documentUrl"
              >
                <i class="fa-solid fa-external-link-alt mr-1 text-xs"></i>
                {{ documentUrl }}
              </a>
              <p v-else class="font-medium" style="color: var(--color-text-primary)">
                {{ documentUrl }}
              </p>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">APPROVE DATE:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['approve_date', 'approved_date']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">CREATE DT:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['create_dt', 'created_at', 'created_date']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">PAYMENT:</label>
            <p class="font-mono text-lg font-semibold mt-1" style="color: #10b981;">
              {{ Number(getDisplayValue(documentData, ['payment', 'payment_amount'])).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">TOTAL:</label>
            <p class="font-mono text-lg font-semibold mt-1" style="color: #f59e0b;">
              {{ Number(getDisplayValue(documentData, ['total', 'amount'])).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">GRAND TOTAL:</label>
            <p class="font-mono text-lg font-semibold mt-1" style="color: #ef4444;">
              {{ Number(getDisplayValue(documentData, ['grand_total', 'grandTotal'])).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">CURRENCY:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['currency', 'currency_name', 'currency_code', 'fx', 'fx_code']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">DEPARTMENT:</label>
            <p class="font-medium mt-1" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['department', 'department_name']) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-gray-500 uppercase tracking-wider">STATUS:</label>
            <p class="font-medium mt-1">
              <span 
                class="inline-block px-3 py-1 rounded-full text-xs font-semibold"
                :style="{ 
                  'background-color': getStatusStyles(getDisplayValue(documentData, ['status', 'payment_status', 'status_payment', 'status_text', 'invoice_status'])).bg,
                  'color': getStatusStyles(getDisplayValue(documentData, ['status', 'payment_status', 'status_payment', 'status_text', 'invoice_status'])).color
                }"
              >
                {{ getDisplayValue(documentData, ['status', 'payment_status', 'status_payment', 'status_text', 'invoice_status']) }}
              </span>
            </p>
          </div>
          <div class="md:col-span-2 lg:col-span-3">
            <label class="text-xs text-gray-500 uppercase tracking-wider">INVOICE NOTE:</label>
            <p class="font-medium mt-1 whitespace-pre-wrap" style="color: var(--color-text-primary)">
              {{ getDisplayValue(documentData, ['invoice_note', 'remark', 'note', 'description']) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div v-if="documentItems.length > 0" class="rounded-xl border overflow-hidden mb-6" style="background: var(--color-bg-card); border-color: var(--color-border);">
        <div class="px-6 py-4 border-b" style="border-color: var(--color-border);">
          <h3 class="text-sm font-semibold uppercase tracking-wider" style="color: var(--color-text-muted)">
            รายการสินค้า ({{ documentItems.length }} รายการ)
          </h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-[13px]">
            <thead>
              <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border);">
                <th class="px-6 py-3 text-left font-medium" style="color: var(--color-text-muted);">เลขเอกสาร</th>
                <th class="px-6 py-3 text-left font-medium" style="color: var(--color-text-muted);">คำอธิบาย</th>
                <th class="px-6 py-3 text-left font-medium" style="color: var(--color-text-muted);">จำนวน</th>
                <th class="px-6 py-3 text-left font-medium" style="color: var(--color-text-muted);">หน่วย</th>
                <th class="px-6 py-3 text-right font-medium" style="color: var(--color-text-muted);">ราคา</th>
                <th class="px-6 py-3 text-right font-medium" style="color: var(--color-text-muted);">รวมทั้งหมด</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in documentItems" :key="index" class="hover:bg-blue-50 dark:hover:bg-gray-800/50 transition-colors" style="border-bottom: 1px solid var(--color-border);">
                <td class="px-6 py-4 font-mono" style="color: var(--color-text-primary);">
                  {{ getDisplayValue(item, ['product_id', 'item_id', 'id']) }}
                </td>
                <td class="px-6 py-4" style="color: var(--color-text-primary);">
                  {{ getDisplayValue(item, ['description', 'item_name', 'product_name', 'name', 'title']) }}
                  <div v-if="item.acc_code" class="text-xs text-blue-500 mt-1">
                    <i class="fa-solid fa-book-open"></i> {{ item.acc_code }}
                  </div>
                </td>
                <td class="px-6 py-4" style="color: var(--color-text-primary);">{{ getDisplayValue(item, ['quantity', 'qty', 'amount']) }}
                </td>
                <td class="px-6 py-4" style="color: var(--color-text-primary);">{{ getDisplayValue(item, ['unit', 'unit_name', 'uom']) }}
                </td>
                <td class="px-6 py-4 text-right font-mono" style="color: var(--color-text-primary);">
                  {{ Number(item.price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                </td>
                <td class="px-6 py-4 text-right font-mono font-semibold" style="color: #f59e0b;">
                  {{ Number(item.item_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
