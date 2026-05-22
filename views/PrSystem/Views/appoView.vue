<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { supabase, supabaseEmployee } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTrcloudStore } from '@/stores/trcloud'

const auth = useAuthStore()
const trcloudStore = useTrcloudStore()
const emit = defineEmits(['edited', 'cancelEdit', 'selectPage'])
const props = defineProps({
  editId: { type: [Number, String], default: null },
})

const saving = ref(false)
const editMode = ref(false)
const editRowId = ref(null)
const editLoading = ref(false)
const urgentOptions = ref([])
const departmentOptions = ref([])
const apSearchText = ref('')
const apSearching = ref(false)
const apDropdownOpen = ref(false)
const apNumberOptions = ref([])
const apActiveIndex = ref(-1)
let apSearchTimer = null
const apInfoLoading = ref(false)
const apInfoError = ref('')
const apInfo = ref(null)
const expandedRowIds = ref([])
const showAddedTable = ref(false)
const addedTableRef = ref(null)

async function fetchUrgentOptions() {
  try {
    const { data, error } = await supabase
      .from('urgents')
      .select('option_name')
      .order('created_at', { ascending: true })
    if (error) throw error
    urgentOptions.value = (data || [])
      .map((r) => String(r?.option_name || '').trim())
      .filter(Boolean)
  } catch {
    urgentOptions.value = []
  }
}

async function fetchDepartmentOptions() {
  if (!supabaseEmployee) {
    departmentOptions.value = []
    return
  }
  try {
    const { data, error } = await supabaseEmployee
      .from('employees')
      .select('department')
      .order('department', { ascending: true })
    if (error) throw error

    const set = new Set()
    for (const r of data || []) {
      const name = String(r?.department || '').trim()
      if (name) set.add(name)
    }
    departmentOptions.value = Array.from(set)
  } catch {
    departmentOptions.value = []
  }
}

async function fetchApNumberOptions() {
  apSearching.value = true
  try {
    // Ensure stores are ready
    const fetchPromises = []
    if (!trcloudStore.apRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('ap'))
    if (!trcloudStore.poRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('po'))
    if (!trcloudStore.prRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('pr'))
    
    if (fetchPromises.length) await Promise.all(fetchPromises)

    // Combine items from AP, PO, and PR
    const allItems = [
      ...(trcloudStore.apItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'AP' })),
      ...(trcloudStore.poItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'PO' })),
      ...(trcloudStore.prItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'PR' }))
    ]

    const out = allItems.map(r => {
      const doc = r.doc || '-'
      const item = r.item || '-'
      return `${doc} | ${item} [${r.type}]`
    }).filter(Boolean)
    
    // Unique and Sort
    apNumberOptions.value = [...new Set(out)].sort()
  } catch (err) {
    console.error('Fetch TRCloud options failed:', err)
    apNumberOptions.value = []
  } finally {
    apSearching.value = false
  }
}

const filteredApNumberOptions = computed(() => {
  const key = apSearchText.value.trim().toLowerCase()
  const list = apNumberOptions.value || []
  if (!key) return list.slice(0, 200)
  return list.filter((x) => String(x || '').toLowerCase().includes(key)).slice(0, 200)
})

function isoDateFromAny(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(+d)) return ''
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatThaiDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(+d)) return '-'
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  return `${day}/${month}/${year}`
}

function isRowExpanded(id) {
  return expandedRowIds.value.includes(id)
}

function toggleRowExpanded(id) {
  if (!id) return
  const next = new Set(expandedRowIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedRowIds.value = Array.from(next)
}

function scrollToAddedTable() {
  const el = addedTableRef.value
  if (!el) return
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch {
  }
}

function userNameText(u) {
  if (!u) return '-'
  return u.emp_code ? `${u.fullname} (${u.emp_code})` : u.fullname || u.username || '-'
}

async function fetchApAutofill(apIdentity) {
  const identity = String(apIdentity || '').trim()
  apInfoError.value = ''
  apInfo.value = null
  if (!identity) return

  apInfoLoading.value = true
  try {
    // Parse "Doc Number | Item Name [TYPE]"
    // Example: "AP20260517-001 | Some Product [AP]"
    const typeMatch = identity.match(/\[(AP|PO|PR)\]$/)
    const type = typeMatch ? typeMatch[1] : null
    
    let cleanIdentity = identity
    if (type) {
      cleanIdentity = identity.replace(` [${type}]`, '')
    }

    const [docNum, ...itemParts] = cleanIdentity.split(' | ')
    const itemName = itemParts.join(' | ')

    // 1. Search in the corresponding TRCloud store based on type (or all if type unknown)
    let trcloudItem = null
    
    const searchInAp = () => trcloudStore.apItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)
    const searchInPo = () => trcloudStore.poItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)
    const searchInPr = () => trcloudStore.prItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)

    if (type === 'AP') trcloudItem = searchInAp()
    else if (type === 'PO') trcloudItem = searchInPo()
    else if (type === 'PR') trcloudItem = searchInPr()
    else {
      // Fallback: search all
      trcloudItem = searchInAp() || searchInPo() || searchInPr()
    }

    if (trcloudItem) {
      console.log('Found TRCloud Item:', trcloudItem)
      const poDateIso = isoDateFromAny(trcloudItem.issue_date)
      
      // 1. เลขที่ AP (จากหน้า trcloudApItemsView.vue ตาราง เลขที่เอกสาร)
      form.value.ap_number = type === 'AP' ? (trcloudItem.doc_number || trcloudItem.invoice_number || '') : ''
      
      // 2. เลขที่ PO และคนเปิด PO (Staff จากหน้า poView.vue)
      let poId = type === 'PO' ? (trcloudItem.doc_number || trcloudItem.invoice_number || '') : (trcloudItem.ref_po || '')
      let staff = trcloudItem.staff || ''
      
      // ค้นหาข้อมูลจากรายการ PO เพื่อให้ได้ Staff ที่ถูกต้อง (ถ้าเลือก AP มา)
      if (type === 'AP' || !staff) {
        const relatedPo = trcloudStore.poItemRows.find(p => {
          const isSameDoc = poId && (p.doc_number === poId || p.invoice_number === poId)
          const isSameItem = p.item_name === trcloudItem.item_name
          return isSameDoc || (isSameItem && p.organization === trcloudItem.organization)
        })
        
        if (relatedPo) {
          if (!poId) poId = relatedPo.doc_number || relatedPo.invoice_number || ''
          staff = relatedPo.staff || ''
        }
      }
      form.value.po_id = poId
      form.value.po_created_by = staff

      // 3. จำนวนสั่ง
      const rawQty = trcloudItem.quantity || trcloudItem.qty || 0
      form.value.qty_order = !isNaN(parseFloat(rawQty)) ? parseFloat(rawQty) : null
      
      // 4. แผนกที่ขอ (ดึงมาจากรายการ PR ที่เกี่ยวข้อง)
      let dept = trcloudItem.department || trcloudItem.department_name || ''
      
      // ถ้าไม่มีแผนกในตัวรายการเอง ให้พยายามค้นหาข้ามไปที่ PR
      if (!dept) {
        const targetItemName = String(trcloudItem.item_name || '').trim().toLowerCase()
        
        // ค้นหาจากรายการ PR ที่มีชื่อสินค้าตรงกัน (แบบไม่สนช่องว่างและตัวพิมพ์เล็กใหญ่)
        const relatedPr = trcloudStore.prItemRows.find(p => {
          const prItemName = String(p.item_name || '').trim().toLowerCase()
          return prItemName === targetItemName && targetItemName !== ''
        })
        
        if (relatedPr) {
          dept = relatedPr.department || relatedPr.department_name || relatedPr.project || ''
        }
      }
      
      // เพิ่มแผนกใหม่เข้าไปในตัวเลือกถ้ายังไม่มี เพื่อให้ <select> แสดงผลได้
      if (dept && !departmentOptions.value.includes(dept)) {
        departmentOptions.value = [...departmentOptions.value, dept].sort()
      }
      
      form.value.department = dept
      
      form.value.supplier_name = trcloudItem.organization || ''
      form.value.item_ref = trcloudItem.item_name || ''
      
      const rawPrice = trcloudItem.item_total || trcloudItem.total || 0
      form.value.total_price = !isNaN(parseFloat(rawPrice)) ? parseFloat(rawPrice) : null
      
      form.value.po_date = poDateIso
      form.value.ap_status = trcloudItem.status || ''
      form.value.currency_name = trcloudItem.currency || 'THB' 

      apInfo.value = {
        po_id: form.value.po_id || '-',
        po_date: poDateIso ? formatThaiDate(poDateIso) : '-',
        supplier_name: trcloudItem.organization || '-',
        item_ref: trcloudItem.item_name || '-',
        qty_order: form.value.qty_order || '-',
        option_name: '-',
        department: form.value.department || '-',
        po_created_by: form.value.po_created_by || `TRCloud ${type || 'Data'}`,
      }
      console.log('Form Autofilled with Cross-ref:', form.value)
      return
    }

    apInfoError.value = 'ไม่พบข้อมูลรายการนี้ใน TRCloud'
  } catch (err) {
    apInfoError.value = String(err?.message || err || 'เกิดข้อผิดพลาด')
  } finally {
    apInfoLoading.value = false
  }
}

function scheduleApSearch() {
  apActiveIndex.value = -1
  if (apSearchTimer) clearTimeout(apSearchTimer)
  apSearchTimer = setTimeout(() => {
    fetchApNumberOptions()
  }, 250)
}

function openApDropdown() {
  apDropdownOpen.value = true
  if (!(apNumberOptions.value || []).length) scheduleApSearch()
}

function closeApDropdown() {
  setTimeout(() => {
    apDropdownOpen.value = false
    apActiveIndex.value = -1
  }, 150)
}

async function selectApOption(value) {
  const v = String(value || '').trim()
  apSearchText.value = v
  // ดึงเฉพาะเลขที่เอกสารออกมา (ก่อนเครื่องหมาย |)
  const docPart = v.split(' | ')[0].trim()
  form.value.ap_number = docPart
  apDropdownOpen.value = false
  apActiveIndex.value = -1
  await fetchApAutofill(v)
}

function goBack() {
  emit('selectPage', { itemId: "/#/pr_ap_items", itemLabel: "รายการ AP (สินค้า)" })
}

function onApInput() {
  form.value.ap_number = apSearchText.value
  openApDropdown()
}

function onApKeydown(e) {
  if (!apDropdownOpen.value && (e.key === 'ArrowDown' || e.key === 'Enter')) {
    openApDropdown()
    return
  }
  const max = (filteredApNumberOptions.value || []).length - 1
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    apActiveIndex.value = Math.min(max, apActiveIndex.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    apActiveIndex.value = Math.max(0, apActiveIndex.value - 1)
  } else if (e.key === 'Enter') {
    if (apActiveIndex.value >= 0 && apActiveIndex.value <= max) {
      e.preventDefault()
      selectApOption(filteredApNumberOptions.value[apActiveIndex.value])
    }
  } else if (e.key === 'Escape') {
    apDropdownOpen.value = false
    apActiveIndex.value = -1
  }
}

const form = ref({
  ap_number: '',
  po_id: '',
  po_date: '',
  supplier_name: '',
  item_ref: '',
  qty_order: null,
  department: '',
  po_created_by: '',
  date_transfer: '',
  option_name: '',
  total_price: null,
  currency_name: '',
  ap_status: '',
  qty_received: null,
  desired_date: '',
  remark: '',
})

const rows = ref([])

const qtyAutoPreview = computed(() => {
  const order = Number(form.value.qty_order ?? 0)
  const received = Number(form.value.qty_received ?? 0)
  const v = order - received
  return Number.isFinite(v) ? v : 0
})

function todayIsoDate() {
  const d = new Date()
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function resetForm(keepHeader = true) {
  const header = keepHeader
    ? {
        ap_number: form.value.ap_number,
        po_id: form.value.po_id,
        po_date: form.value.po_date,
        supplier_name: form.value.supplier_name,
      }
    : {}

  form.value = {
    ap_number: '',
    po_id: '',
    po_date: todayIsoDate(),
    supplier_name: '',
    item_ref: '',
    qty_order: null,
    department: '',
    po_created_by: '',
    date_transfer: '',
    option_name: '',
    total_price: null,
    currency_name: '',
    ap_status: '',
    qty_received: null,
    desired_date: '',
    remark: '',
    ...header,
  }
  apSearchText.value = form.value.ap_number || ''
  apDropdownOpen.value = false
  apNumberOptions.value = []
  apActiveIndex.value = -1
  apInfoLoading.value = false
  apInfoError.value = ''
  apInfo.value = null
}

resetForm(false)

onMounted(() => {
  fetchUrgentOptions()
  fetchDepartmentOptions()
  // Fetch all TRCloud sources early for the dropdown
  trcloudStore.fetchTrcloudData('ap')
  trcloudStore.fetchTrcloudData('po')
  trcloudStore.fetchTrcloudData('pr')
  apSearchText.value = form.value.ap_number || ''
  showAddedTable.value = (rows.value || []).length > 0

  // ตรวจสอบว่ามีการส่งข้อมูลมาจากหน้าอื่นหรือไม่
  if (trcloudStore.pendingAutofill) {
    selectApOption(trcloudStore.pendingAutofill)
    trcloudStore.pendingAutofill = null
  }
})

// เพิ่ม watch สำหรับกรณีที่อยู่ในหน้านี้อยู่แล้วและมีการส่งข้อมูลมาใหม่
watch(() => trcloudStore.pendingAutofill, (val) => {
  if (val) {
    selectApOption(val)
    trcloudStore.pendingAutofill = null
  }
})

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

async function addRow() {
  const base = {
    ap_number: (form.value.ap_number || '').trim() || null,
    po_id: (form.value.po_id || '').trim() || null,
    po_date: form.value.po_date || null,
    supplier_name: (form.value.supplier_name || '').trim() || null,
  }
  if (!base.ap_number && !base.po_id) return alert('กรุณากรอก เลขที่ AP หรือ เลขที่ PO ก่อน')

  const payload = {
    ...base,
    item_ref: (form.value.item_ref || '').trim() || null,
    qty_order: form.value.qty_order === null || form.value.qty_order === '' ? null : Number(form.value.qty_order),
    department: (form.value.department || '').trim() || null,
    po_created_by: (form.value.po_created_by || '').trim() || null,
    date_transfer: form.value.date_transfer || null,
    option_name: (form.value.option_name || '').trim() || null,
    total_price: form.value.total_price === null || form.value.total_price === '' ? null : Number(form.value.total_price),
    currency_name: (form.value.currency_name || '').trim() || null,
    ap_status: (form.value.ap_status || '').trim() || null,
    qty_received: form.value.qty_received === null || form.value.qty_received === '' ? null : Number(form.value.qty_received),
    desired_date: form.value.desired_date || null,
    remark: (form.value.remark || '').trim() || null,
    _qty_auto_preview: qtyAutoPreview.value,
  }

  rows.value = [{ _tmp_id: crypto.randomUUID(), ...payload }, ...(rows.value || [])]
  resetForm(false)
  showAddedTable.value = true
  await nextTick()
  scrollToAddedTable()
}

function clearRows() {
  const ok = window.confirm('ต้องการล้างรายการทั้งหมดหรือไม่?')
  if (!ok) return
  rows.value = []
}

function removeRow(tmpId) {
  rows.value = (rows.value || []).filter((r) => r?._tmp_id !== tmpId)
}

function createdByText() {
  const u = auth.user
  if (!u) return null
  return (u.fullname || u.username || u.emp_code || '').toString() || null
}

async function startEdit(id) {
  const raw = id === null || id === undefined ? '' : String(id).trim()
  const editIdNum = raw ? Number(raw) : NaN
  if (!Number.isFinite(editIdNum)) return

  editMode.value = true
  editRowId.value = editIdNum
  editLoading.value = true
  try {
    const { data, error } = await supabase
      .from('ap_requests')
      .select(
        'id, ap_number, po_id, po_date, supplier_name, item_ref, qty_order, department, po_created_by, date_transfer, option_name, total_price, currency_name, ap_status, qty_received, desired_date, remark'
      )
      .eq('id', editIdNum)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('ไม่พบข้อมูลที่ต้องการแก้ไข')

    form.value.ap_number = data.ap_number || ''
    apSearchText.value = data.ap_number || ''
    form.value.po_id = data.po_id || ''
    form.value.po_date = data.po_date ? isoDateFromAny(data.po_date) : todayIsoDate()
    form.value.supplier_name = data.supplier_name || ''
    form.value.item_ref = data.item_ref || ''
    form.value.qty_order = data.qty_order ?? null
    form.value.department = data.department || ''
    form.value.po_created_by = data.po_created_by || ''
    form.value.date_transfer = data.date_transfer ? isoDateFromAny(data.date_transfer) : ''
    form.value.option_name = data.option_name || ''
    form.value.total_price = data.total_price ?? null
    form.value.currency_name = data.currency_name || ''
    form.value.ap_status = data.ap_status || ''
    form.value.qty_received = data.qty_received ?? null
    form.value.desired_date = data.desired_date ? isoDateFromAny(data.desired_date) : ''
    form.value.remark = data.remark || ''

    showAddedTable.value = false
  } catch (err) {
    editMode.value = false
    editRowId.value = null
    alert('โหลดข้อมูลสำหรับแก้ไขไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  } finally {
    editLoading.value = false
  }
}

async function submitEdit() {
  if (!editRowId.value) return
  saving.value = true
  try {
    const updatedBy = createdByText()
    const payload = {
      ap_number: (form.value.ap_number || '').trim() || null,
      po_id: (form.value.po_id || '').trim() || null,
      po_date: form.value.po_date || null,
      supplier_name: (form.value.supplier_name || '').trim() || null,
      item_ref: (form.value.item_ref || '').trim() || null,
      qty_order: form.value.qty_order === null || form.value.qty_order === '' ? null : Number(form.value.qty_order),
      department: (form.value.department || '').trim() || null,
      po_created_by: (form.value.po_created_by || '').trim() || null,
      date_transfer: form.value.date_transfer || null,
      option_name: (form.value.option_name || '').trim() || null,
      total_price: form.value.total_price === null || form.value.total_price === '' ? null : Number(form.value.total_price),
      currency_name: (form.value.currency_name || '').trim() || null,
      ap_status: (form.value.ap_status || '').trim() || null,
      qty_received: form.value.qty_received === null || form.value.qty_received === '' ? null : Number(form.value.qty_received),
      desired_date: form.value.desired_date || null,
      remark: (form.value.remark || '').trim() || null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('ap_requests').update(payload).eq('id', editRowId.value)
    if (error) throw error

    editMode.value = false
    editRowId.value = null
    resetForm(false)
    alert('บันทึกการแก้ไขสำเร็จ')
    emit('edited')
  } catch (err) {
    alert('บันทึกการแก้ไขไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  editMode.value = false
  editRowId.value = null
  resetForm(false)
  emit('cancelEdit')
}

async function submitAll() {
  if (!(rows.value || []).length) return alert('ยังไม่มีรายการในตาราง กรุณากด "เพิ่มรายการ" ก่อน')
  saving.value = true
  try {
    const createdBy = createdByText()
    const payload = (rows.value || []).map((r) => ({
      ap_number: r.ap_number ?? null,
      po_id: r.po_id ?? null,
      po_date: r.po_date ?? null,
      supplier_name: r.supplier_name ?? null,
      item_ref: r.item_ref ?? null,
      qty_order: r.qty_order ?? null,
      department: r.department ?? null,
      po_created_by: r.po_created_by ?? null,
      date_transfer: r.date_transfer ?? null,
      option_name: r.option_name ?? null,
      total_price: r.total_price ?? null,
      currency_name: r.currency_name ?? null,
      ap_status: r.ap_status ?? null,
      qty_received: r.qty_received ?? null,
      desired_date: r.desired_date ?? null,
      remark: r.remark ?? null,
      amount_received: r.amount_received ?? null,
      amount_balance: r.amount_balance ?? null,
      created_by: createdBy,
      updated_by: createdBy,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase.from('ap_requests').insert(payload)
    if (error) throw error

    rows.value = []
    resetForm(false)
    alert('บันทึกข้อมูลสำเร็จ')
  } catch (err) {
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'))
  } finally {
    saving.value = false
  }
}

watch(
  () => props.editId,
  (id) => {
    if (id === null || id === undefined || String(id).trim() === '') return
    startEdit(id)
  },
  { immediate: true }
)
</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-4">
        <button 
          @click="goBack"
          class="p-2 rounded-full hover:bg-gray-100 transition-colors border"
          style="border-color: var(--color-border); background: var(--color-bg-card)"
          title="กลับคืน"
        >
          <i class="fa-solid fa-arrow-left text-gray-500"></i>
        </button>
        <div>
          <h1 class="text-[20px] font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
            ฟอมร์ส่งรายการ
            <span
              v-if="editMode"
              class="px-2 py-0.5 rounded-full text-[11px] font-medium border"
              style="border-color: rgba(249, 115, 22, 0.35); color: #f97316"
            >
              แก้ไขข้อมูล
            </span>
            <span v-if="editLoading" class="text-[12px] font-normal" style="color: var(--color-text-muted)">กำลังโหลด...</span>
          </h1>
          <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">บันทึกข้อมูลจากตาราง ap_requests</p>
        </div>
      </div>
    </div>

    <div class="rounded-xl border p-4 md:p-6" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">เลขที่ AP</label>
          <div class="relative">
            <input
              v-model="apSearchText"
              type="text"
              class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
              style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
              placeholder="พิมพ์เพื่อค้นหา/เลือก"
              @input="onApInput"
              @focus="openApDropdown"
              @blur="closeApDropdown"
              @keydown="onApKeydown"
            />

            <div
              v-if="apDropdownOpen"
              class="absolute z-20 mt-1 w-full rounded-md border shadow-lg overflow-hidden"
              style="border-color: var(--color-border); background: var(--color-bg-card)"
            >
              <div v-if="apSearching" class="px-3 py-2 text-[12px]" style="color: var(--color-text-muted)">กำลังค้นหา...</div>
              <div v-else-if="!(filteredApNumberOptions || []).length" class="px-3 py-2 text-[12px]" style="color: var(--color-text-muted)">
                ไม่พบรายการ
              </div>
              <div v-else class="max-h-[260px] overflow-y-auto">
                <button
                  v-for="(opt, idx) in filteredApNumberOptions"
                  :key="`${opt}-${idx}`"
                  type="button"
                  class="w-full text-left px-3 py-2 text-[13px] transition-colors"
                  :class="idx === apActiveIndex ? 'bg-blue-600 text-white' : ''"
                  :style="idx === apActiveIndex ? { color: '#ffffff' } : { color: 'var(--color-text-primary)' }"
                  @mousedown.prevent="selectApOption(opt)"
                >
                  {{ opt }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div>
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">เลขที่ PO</label>
          <input
            v-model="form.po_id"
            type="text"
            class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
            style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
            placeholder="กรุณาป้อนข้อมูล"
          />
        </div>
        <div>
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">วันที่เปิด PO</label>
          <input
            v-model="form.po_date"
            type="date"
            class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
            style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
          />
        </div>
        <div>
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ผู้ขาย / Supplier</label>
          <input
            v-model="form.supplier_name"
            type="text"
            class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
            style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
            placeholder="กรุณาป้อนข้อมูล"
          />
        </div>
      </div>

      <div class="mt-4 border rounded-lg" style="border-color: var(--color-border); background: var(--color-bg-card)">
        <div
          class="px-4 py-2 border-b text-[13px] font-medium flex items-center gap-2 rounded-t-lg"
          style="border-color: var(--color-border); color: var(--color-text-primary); background: var(--color-bg-card)"
        >
          <i class="fa-solid fa-table-list" style="color: var(--color-text-muted)"></i>
          ข้อมูลรายละเอียด
        </div>

        <div class="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="border rounded-md p-3" style="border-color: var(--color-border); background: var(--color-bg-body)">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="md:col-span-3">
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">รายการ / อะไหล่</label>
                <input
                  v-model="form.item_ref"
                  type="text"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จำนวนสั่ง</label>
                <input
                  v-model="form.qty_order"
                  type="number"
                  step="any"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จำนวนที่รับแล้ว</label>
                <input
                  v-model="form.qty_received"
                  type="number"
                  step="any"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จำนวนค้างรับ (อัตโนมัติ)</label>
                <input
                  :value="qtyAutoPreview"
                  type="text"
                  readonly
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px]"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-muted)"
                />
              </div>

              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">แผนกที่ขอ</label>
                <select
                  v-model="form.department"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                >
                  <option value="">— เลือก —</option>
                  <option
                    v-for="dep in departmentOptions"
                    :key="dep"
                    :value="dep"
                    style="background-color: var(--color-bg-card)"
                  >
                    {{ dep }}
                  </option>
                </select>
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">คนเปิด PO</label>
                <input
                  v-model="form.po_created_by"
                  type="text"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ระดับความเร่งด่วน</label>
                <select
                  v-model="form.option_name"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                >
                  <option value="">— เลือก —</option>
                  <option v-for="opt in urgentOptions" :key="opt" :value="opt">{{ opt }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="border rounded-md p-3" style="border-color: var(--color-border); background: var(--color-bg-body)">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">วันที่โอนเงิน (แผน)</label>
                <input
                  v-model="form.date_transfer"
                  type="date"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สถานะ AP</label>
                <select
                  v-model="form.ap_status"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                >
                  <option value="">— เลือก —</option>
                  <option value="ยังไม่ชำระ">ยังไม่ชำระ</option>
                  <option value="ชำระแล้ว">ชำระแล้ว</option>
                </select>
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ราคารวม</label>
                <input
                  v-model="form.total_price"
                  type="number"
                  step="any"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:col-span-3">
                <div>
                  <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สกุลเงิน</label>
                  <select
                    v-model="form.currency_name"
                    class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                    style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                  >
                    <option value="">— เลือก —</option>
                    <option value="THB">THB</option>
                    <option value="LAK">LAK</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">วันที่ต้องการของ</label>
                  <input
                    v-model="form.desired_date"
                    type="date"
                    class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                    style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                  />
                </div>
              </div>
              <div class="md:col-span-3">
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">เหตุผลที่ต้องการ</label>
                <textarea
                  v-model="form.remark"
                  rows="3"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <div class="px-4 pb-4 flex flex-col md:flex-row md:items-center gap-2">
          <div v-if="editMode" class="w-full flex flex-col md:flex-row md:items-center gap-2">
            <button
              type="button"
              class="px-4 py-2 rounded-md border text-[13px] font-medium inline-flex items-center gap-2"
              style="border-color: #f97316; color: #f97316; background: var(--color-bg-card)"
              :disabled="saving || editLoading"
              @click="submitEdit"
            >
              <i class="fa-solid fa-floppy-disk"></i>
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข' }}
            </button>
            <button
              type="button"
              class="px-4 py-2 rounded-md border text-[13px] font-medium inline-flex items-center gap-2"
              style="border-color: var(--color-border); color: var(--color-text-secondary); background: var(--color-bg-card)"
              :disabled="saving || editLoading"
              @click="cancelEdit"
            >
              <i class="fa-solid fa-arrow-left"></i>
              กลับไปตารางติดตาม
            </button>
          </div>
          <button
            v-else
            type="button"
            class="px-4 py-2 rounded-md border text-[13px] font-medium inline-flex items-center gap-2"
            style="border-color: #8b5cf6; color: #7c3aed; background: var(--color-bg-card)"
            @click="addRow"
          >
            <i class="fa-solid fa-plus"></i>
            เพิ่มรายการ
          </button>
          <button
            v-if="!editMode"
            type="button"
            class="px-4 py-2 rounded-md border text-[13px] font-medium inline-flex items-center gap-2"
            style="border-color: #ef4444; color: #ef4444; background: var(--color-bg-card)"
            @click="clearRows"
          >
            <i class="fa-solid fa-trash-can"></i>
            ล้างรายการ
          </button>
          <div v-if="!editMode" class="md:ml-auto flex items-center gap-2">
            <div class="text-[12px]" style="color: var(--color-text-muted)">รายการทั้งหมด {{ (rows || []).length }} รายการ</div>
            <button
              type="button"
              class="px-5 py-2 rounded-full text-[13px] font-medium border inline-flex items-center gap-2"
              style="border-color: #22c55e; color: #16a34a; background: var(--color-bg-card)"
              :disabled="saving"
              @click="submitAll"
            >
              <i class="fa-solid fa-floppy-disk"></i>
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล' }}
            </button>
          </div>
        </div>
      </div>

      <div ref="addedTableRef" class="mt-4 rounded-lg border overflow-hidden" style="border-color: var(--color-border); background: var(--color-bg-card)">
        <button
          type="button"
          class="w-full px-4 py-2 border-b text-[13px] font-medium flex items-center gap-2"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
          @click="showAddedTable = !showAddedTable"
        >
          <i class="fa-solid fa-list" style="color: var(--color-text-muted)"></i>
          <span>รายการที่เพิ่ม</span>
          <span class="text-[12px] font-normal" style="color: var(--color-text-muted)">({{ (rows || []).length }} รายการ)</span>
          <i class="fa-solid fa-chevron-down ml-auto transition-transform duration-200" :class="showAddedTable ? 'rotate-180' : ''" style="color: var(--color-text-muted)"></i>
        </button>
        <div v-if="showAddedTable" class="overflow-x-auto">
          <table class="w-full text-[12px] min-w-[1500px] border-collapse" style="border: 1px solid var(--color-border)">
            <thead>
              <tr style="background: #FDBA74; border-bottom: 1px solid rgba(0, 0, 0, 0.08)">
                <th class="w-[56px] px-3 py-2 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"></th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">AP / PO</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้ขาย</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">รายการ / อะไหล่</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">จำนวน</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ความเร่งด่วน</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">แผนก</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สถานะ</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ยอดเงิน</th>
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(r, idx) in rows" :key="r._tmp_id">
              <tr class="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors" style="border-bottom: 1px solid var(--color-border)">
                <td class="px-3 py-2 text-center" style="border-right: 1px solid var(--color-border)">
                  <button
                    type="button"
                    class="w-9 h-9 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors"
                    :class="isRowExpanded(r._tmp_id) ? 'text-red-600 border-red-300' : 'text-gray-800 border-gray-300'"
                    style="background: var(--color-bg-body)"
                    :title="isRowExpanded(r._tmp_id) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'"
                    @click="toggleRowExpanded(r._tmp_id)"
                  >
                    <i class="fa-solid text-[18px]" :class="isRowExpanded(r._tmp_id) ? 'fa-minus' : 'fa-plus'"></i>
                  </button>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <div class="font-semibold" style="color: #2563eb">AP: {{ r.ap_number || '-' }}</div>
                  <div class="font-medium" style="color: var(--color-text-primary)">PO: {{ r.po_id || '-' }}</div>
                  <div class="text-[11px]" style="color: var(--color-text-muted)">เปิด PO: {{ formatThaiDate(r.po_date) }}</div>
                </td>
                <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.supplier_name || '-' }}</td>
                <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">
                  <div
                    :title="r.item_ref || ''"
                    style="white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden"
                  >
                    {{ r.item_ref || '-' }}
                  </div>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <div style="color: var(--color-text-primary)">{{ formatNumber(r.qty_order) }}</div>
                  <div class="text-[11px]" style="color: var(--color-text-muted)">รับแล้ว: {{ formatNumber(r.qty_received) }} • ค้าง: {{ formatNumber(r._qty_auto_preview) }}</div>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-medium border" style="border-color: rgba(239, 68, 68, 0.35); color: #ef4444">
                    {{ r.option_name || '-' }}
                  </span>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ r.department || '-' }}</td>
                <td class="px-3 py-2 whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-medium border" style="border-color: rgba(37, 99, 235, 0.25); color: #2563eb">
                    {{ r.ap_status || '-' }}
                  </span>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <div class="font-semibold" style="color: var(--color-text-primary)">{{ formatNumber(r.total_price) }} {{ r.currency_name || '' }}</div>
                  <div class="text-[11px]" style="color: var(--color-text-muted)">รับแล้ว: {{ formatNumber(r.amount_received) }} • คงเหลือ: {{ formatNumber(r.amount_balance) }}</div>
                </td>
                <td class="px-3 py-2 whitespace-nowrap" style="color: var(--color-text-primary)">
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-red-600 dark:text-red-300"
                      title="ลบแถวนี้"
                      @click="removeRow(r._tmp_id)"
                    >
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <div class="text-[11px]" style="color: var(--color-text-muted)">#{{ rows.length - idx }}</div>
                  </div>
                </td>
              </tr>
              <tr v-if="isRowExpanded(r._tmp_id)" style="border-bottom: 1px solid var(--color-border)">
                <td colspan="10" class="px-3 py-3" style="background: var(--color-bg-body)">
                  <div class="rounded-lg border p-4" style="border-color: var(--color-border); background: var(--color-bg-card)">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
                      <div>
                        <div style="color: var(--color-text-muted)">วันที่โอนเงิน (แผน)</div>
                        <div class="font-medium" style="color: var(--color-text-primary)">{{ formatThaiDate(r.date_transfer) }}</div>
                      </div>
                      <div>
                        <div style="color: var(--color-text-muted)">วันที่ต้องการของ</div>
                        <div class="font-medium" style="color: var(--color-text-primary)">{{ formatThaiDate(r.desired_date) }}</div>
                      </div>
                      <div>
                        <div style="color: var(--color-text-muted)">คนเปิด PO</div>
                        <div class="font-medium" style="color: var(--color-text-primary)">{{ r.po_created_by || '-' }}</div>
                      </div>
                      <div class="md:col-span-3">
                        <div style="color: var(--color-text-muted)">เหตุผลที่ต้องการ</div>
                        <div class="font-medium" style="color: var(--color-text-primary); white-space: pre-line">{{ r.remark || '-' }}</div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
              </template>
              <tr v-if="!(rows || []).length">
                <td colspan="10" class="px-4 py-10 text-center" style="color: var(--color-text-muted)">ยังไม่มีรายการ</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
