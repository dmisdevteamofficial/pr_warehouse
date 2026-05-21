<script setup>
import { computed, onMounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const orders = ref([])
const transactions = ref([])
const items = ref([])
const categories = ref([])
const systemUsers = ref([])
const loading = ref(true)
const saving = ref(false)

const searchText = ref('')
const selectedCategoryId = ref('all')
const selectedStatus = ref('all')

const isSidebarOpen = ref(false)
const imageFile = ref(null)
const documentFile = ref(null)
const IMAGE_BUCKET = 'image'
const DOCUMENT_BUCKET = 'document_url'

const orderForm = ref({
  item_id: '',
  amount: 1,
  unit: '',
  category_id: '',
  image_url: '',
  document_url: '',
  status: 'pending',
  note: '',
  remark: ''
})

async function fetchData() {
  loading.value = true
  try {
    const [
      { data: itemsData, error: itemsError },
      { data: categoriesData, error: categoriesError },
      { data: ordersData, error: ordersError },
      { data: usersData, error: usersError },
      { data: txData, error: txError }
    ] = await Promise.all([
      supabase.from('items').select('id, item_code, item_name, unit, category_id').order('item_name'),
      supabase.from('category').select('*').order('category_name'),
      supabase
        .from('order_req')
        .select('*, items(item_code,item_name,unit), category(category_name), requester:system_users!created_by(fullname, emp_code)')
        .order('created_at', { ascending: false }),
      supabase.from('system_users').select('id, fullname, emp_code').order('fullname'),
      supabase
        .from('transactions')
        .select('order_id, amount, unit, return_date, created_at')
        .not('return_date', 'is', null)
    ])

    if (itemsError) throw itemsError
    if (categoriesError) throw categoriesError
    if (ordersError) throw ordersError
    if (usersError) throw usersError
    if (txError) throw txError

    items.value = itemsData || []
    categories.value = categoriesData || []
    orders.value = ordersData || []
    systemUsers.value = usersData || []
    transactions.value = txData || []
  } catch (err) {
    console.error('Error fetching order request data:', err.message)
    alert('ไม่สามารถโหลดข้อมูลคำขอเบิกสินค้าได้: ' + err.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

function formatDateOnly(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH')
}

function txByOrderId(orderId) {
  return transactions.value.find((row) => row.order_id === orderId) || null
}

const returnRows = computed(() => {
  return orders.value
    .map((row) => {
      const tx = txByOrderId(row.id)
      const returnDate = tx?.return_date || null
      const amount = Number(tx?.amount ?? row.amount ?? 0)
      const unit = tx?.unit || row.unit || row.items?.unit || ''
      return {
        ...row,
        requestId: row.request_id || row.id,
        returnDate,
        withdrawAt: row.updated_at || row.created_at,
        actualAmount: Number.isFinite(amount) ? amount : 0,
        actualUnit: unit,
        requesterInfo: row.requester || null
      }
    })
    .filter((row) => row.status === 'completed' && row.is_return === true && row.returnDate)
    .sort((a, b) => new Date(a.returnDate) - new Date(b.returnDate))
})

const filteredReturnRows = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  if (!keyword) return returnRows.value

  return returnRows.value.filter((row) => {
    const requestId = String(row.requestId || '').toLowerCase()
    const itemCode = row.items?.item_code?.toLowerCase() || ''
    const itemName = row.items?.item_name?.toLowerCase() || ''
    const mr = (row.mr_number || '').toLowerCase()
    const requesterName = (row.requesterInfo?.fullname || '').toLowerCase()
    const note = (row.note || '').toLowerCase()
    const remark = (row.remark || '').toLowerCase()
    return (
      requestId.includes(keyword) ||
      itemCode.includes(keyword) ||
      itemName.includes(keyword) ||
      mr.includes(keyword) ||
      requesterName.includes(keyword) ||
      note.includes(keyword) ||
      remark.includes(keyword)
    )
  })
})

const returnGroups = computed(() => {
  const groups = {}
  for (const row of filteredReturnRows.value) {
    const key = formatDateOnly(row.returnDate)
    if (!groups[key]) {
      groups[key] = {
        key,
        sortDate: row.returnDate,
        rows: []
      }
    }
    groups[key].rows.push(row)
  }
  return Object.values(groups).sort((a, b) => new Date(a.sortDate) - new Date(b.sortDate))
})

function openAddOrderSidebar() {
  const defaultItem = items.value[0]
  orderForm.value = {
    item_id: defaultItem?.id || '',
    amount: 1,
    unit: defaultItem?.unit || '',
    category_id: defaultItem?.category_id || '',
    image_url: '',
    document_url: '',
    status: 'pending',
    note: '',
    remark: ''
  }
  imageFile.value = null
  documentFile.value = null
  isSidebarOpen.value = true
}

function handleItemChange() {
  const selectedItem = items.value.find((it) => it.id === orderForm.value.item_id)
  if (!selectedItem) return
  orderForm.value.unit = selectedItem.unit || ''
  orderForm.value.category_id = selectedItem.category_id || ''
}

function onImageFileSelected(event) {
  imageFile.value = event.target.files?.[0] || null
}

function onDocumentFileSelected(event) {
  documentFile.value = event.target.files?.[0] || null
}

function makeStoragePath(file, type) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const timestamp = Date.now()
  const baseName = file.name.replace(/\.[^/.]+$/, '')
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${auth.user.id}/${type}/${timestamp}-${safeName}.${ext}`
}

async function uploadFileToStorage(file, type) {
  if (!file) return null
  const path = makeStoragePath(file, type)
  const targetBucket = type === 'images' ? IMAGE_BUCKET : DOCUMENT_BUCKET
  const { error: uploadError } = await supabase.storage.from(targetBucket).upload(path, file, {
    upsert: false
  })
  if (uploadError) throw uploadError
  const { data } = supabase.storage.from(targetBucket).getPublicUrl(path)
  return data.publicUrl
}

async function safeUpload(file, type, label, warnings) {
  if (!file) return null
  try {
    return await uploadFileToStorage(file, type)
  } catch (err) {
    console.error(`Upload ${label} failed:`, err.message)
    warnings.push(`${label}อัปโหลดไม่สำเร็จ (${err.message})`)
    return null
  }
}

async function saveOrderRequest() {
  if (!auth.user?.id) {
    alert('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง')
    return
  }

  if (!orderForm.value.item_id || !orderForm.value.amount || orderForm.value.amount <= 0 || !orderForm.value.unit) {
    alert('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (สินค้า, จำนวน, หน่วย)')
    return
  }

  saving.value = true
  try {
    const warnings = []
    const uploadedImageUrl = await safeUpload(imageFile.value, 'images', 'รูปภาพ', warnings)
    const uploadedDocumentUrl = await safeUpload(documentFile.value, 'documents', 'เอกสาร', warnings)

    const payload = {
      item_id: orderForm.value.item_id,
      amount: Number(orderForm.value.amount),
      unit: orderForm.value.unit,
      category_id: orderForm.value.category_id || null,
      image_url: uploadedImageUrl || orderForm.value.image_url || null,
      document_url: uploadedDocumentUrl || orderForm.value.document_url || null,
      status: orderForm.value.status || 'pending',
      note: orderForm.value.note || null,
      remark: orderForm.value.remark || null,
      created_by: auth.user.id,
      updated_by: auth.user.id
    }

    const { error: insertError } = await supabase.from('order_req').insert(payload)
    if (insertError) throw insertError

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'create_order_req',
      user_agent: navigator.userAgent,
      old_value: {
        item_id: payload.item_id,
        amount: payload.amount,
        status: payload.status
      }
    })

    isSidebarOpen.value = false
    await fetchData()
    if (warnings.length > 0) {
      alert(`บันทึกคำขอสำเร็จ แต่มีบางไฟล์อัปโหลดไม่สำเร็จ:\n- ${warnings.join('\n- ')}`)
    } else {
      alert('บันทึกคำขอเบิกสินค้าสำเร็จ')
    }
  } catch (err) {
    console.error('Error saving order request:', err.message)
    alert('เกิดข้อผิดพลาดในการบันทึกคำขอ: ' + err.message)
  } finally {
    saving.value = false
  }
}

function getStatusClass(status) {
  if (status === 'approved') return 'bg-green-50 text-green-600 border-green-100 dark:bg-green-800/20 dark:border-green-800/20 dark:text-green-400'
  if (status === 'rejected') return 'bg-red-50 text-red-600 border-red-100 dark:bg-red-800/20 dark:border-red-800/20 dark:text-red-400'
  if (status === 'completed') return 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-800/20 dark:border-blue-800/20 dark:text-blue-400'
  return 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-800/20 dark:border-amber-800/20 dark:text-amber-400'
}

function getStatusText(status) {
  if (status === 'approved') return 'อนุมัติ'
  if (status === 'rejected') return 'ไม่อนุมัติ'
  if (status === 'completed') return 'เสร็จสิ้น'
  return 'รออนุมัติ'
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function isDueDate(value) {
  if (!value) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return d.getTime() <= today.getTime()
}

function getCreatorLabel(createdBy) {
  if (!createdBy) return '-'
  const user = systemUsers.value.find((row) => row.id === createdBy)
  if (!user) return createdBy
  return user.emp_code ? `${user.fullname} (${user.emp_code})` : user.fullname
}

async function copyLink(url) {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    alert('คัดลอกลิงก์แล้ว')
  } catch {
    alert('คัดลอกลิงก์ไม่สำเร็จ')
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ข้อมูลการส่งคืน</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะรายการที่มีกำหนดส่งคืน</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          type="text"
          placeholder="ค้นหาเลขที่ใบบิน, MR, ชื่อสินค้า, ผู้เบิก..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">กำหนดส่งคืน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">เลขที่ใบบิน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
              <th class="text-right px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หน่วย</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้เบิก</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">วันที่เบิก</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="returnGroups.length === 0">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบรายการที่มีกำหนดส่งคืน</td>
            </tr>
            <template v-else v-for="group in returnGroups" :key="group.key">
              <tr class="bg-blue-50/60 border-b" style="border-color: var(--color-border)">
                <td colspan="7" class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">
                  กำหนดส่งคืน:
                  <span :class="isDueDate(group.sortDate) ? 'text-red-600' : ''">{{ group.key }}</span>
                  • {{ group.rows.length }} รายการ
                </td>
              </tr>
              <tr
                v-for="order in group.rows"
                :key="order.id"
                class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                style="border-color: var(--color-border)"
              >
                <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">{{ formatDateOnly(order.returnDate) }}</td>
                <td class="px-4 py-3">
                  <p class="font-medium" style="color: var(--color-text-primary)">#{{ order.requestId }}</p>
                  <p class="text-[11px]" style="color: var(--color-text-muted)">MR: {{ order.mr_number || '-' }}</p>
                </td>
                <td class="px-4 py-3">
                  <p class="font-medium" style="color: var(--color-text-primary)">{{ order.items?.item_name || '-' }}</p>
                  <p class="text-[11px]" style="color: var(--color-text-muted)">{{ order.items?.item_code || '-' }}</p>
                </td>
                <td class="px-4 py-3 text-right font-semibold" style="color: var(--color-text-primary)">{{ order.actualAmount }}</td>
                <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ order.actualUnit }}</td>
                <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                  <span v-if="order.requesterInfo?.fullname">
                    {{ order.requesterInfo.emp_code ? `${order.requesterInfo.fullname} (${order.requesterInfo.emp_code})` : order.requesterInfo.fullname }}
                  </span>
                  <span v-else>{{ getCreatorLabel(order.created_by) }}</span>
                </td>
                <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">{{ formatDateTime(order.withdrawAt) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isSidebarOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="isSidebarOpen = false"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">แบบฟอร์มขอเบิก / ขอซื้อสินค้า</h2>
            <button @click="isSidebarOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">สินค้า</label>
              <select
                v-model="orderForm.item_id"
                @change="handleItemChange"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              >
                <option value="" disabled style="background-color: var(--color-bg-card)">เลือกสินค้า</option>
                <option v-for="item in items" :key="item.id" :value="item.id" style="background-color: var(--color-bg-card)">{{ item.item_code }} - {{ item.item_name }}</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวน</label>
                <input
                  v-model.number="orderForm.amount"
                  type="number"
                  min="1"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body)"
                />
              </div>
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หน่วย</label>
                <input
                  v-model="orderForm.unit"
                  type="text"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body)"
                />
              </div>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ประเภทสินค้า</label>
              <select
                v-model="orderForm.category_id"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              >
                <option value="" style="background-color: var(--color-bg-card)">ไม่ระบุประเภท</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id" style="background-color: var(--color-bg-card)">{{ cat.category_name }}</option>
              </select>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">สถานะ</label>
              <select
                v-model="orderForm.status"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              >
                <option value="pending" style="background-color: var(--color-bg-card)">รออนุมัติ</option>
                <option value="approved" style="background-color: var(--color-bg-card)">อนุมัติ</option>
                <option value="rejected" style="background-color: var(--color-bg-card)">ไม่อนุมัติ</option>
                <option value="completed" style="background-color: var(--color-bg-card)">เสร็จสิ้น</option>
              </select>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">รูปภาพใบบิน</label>
              <input
                type="file"
                accept="image/*"
                @change="onImageFileSelected"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              />
              <p class="text-[11px]" style="color: var(--color-text-muted)">
                {{ imageFile ? imageFile.name : 'ยังไม่ได้เลือกรูปภาพ' }}
              </p>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">เอกสาร</label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                @change="onDocumentFileSelected"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              />
              <p class="text-[11px]" style="color: var(--color-text-muted)">
                {{ documentFile ? documentFile.name : 'ยังไม่ได้เลือกเอกสาร' }}
              </p>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">รายละเอียดคำขอ (note)</label>
              <textarea
                v-model="orderForm.note"
                rows="2"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              ></textarea>
            </div>

            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุเพิ่มเติม (remark)</label>
              <textarea
                v-model="orderForm.remark"
                rows="2"
                class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                style="border-color: var(--color-border); background: var(--color-bg-body)"
              ></textarea>
            </div>
          </div>

          <div class="p-6 border-t" style="border-color: var(--color-border); position: sticky; bottom: 0; background: var(--color-bg-card); z-index: 10;">
            <button
              @click="saveOrderRequest"
              :disabled="saving"
              class="w-full py-2.5 rounded-lg text-[14px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style="background: var(--color-primary)"
            >
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกคำขอ' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </AppLayout>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
