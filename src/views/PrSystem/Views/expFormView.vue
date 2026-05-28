<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { supabase, supabaseEmployee } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTrcloudStore } from '@/stores/trcloud'
import { useUiStore } from '@/stores/ui'
import Swal from 'sweetalert2'

const auth = useAuthStore()
const trcloudStore = useTrcloudStore()
const ui = useUiStore()
const emit = defineEmits(['edited', 'cancelEdit', 'selectPage'])
const props = defineProps({
  editId: { type: [Number, String], default: null },
  type: { type: String, default: 'exp' },
})

const saving = ref(false)
const editMode = ref(false)
const editRowId = ref(null)
const editLoading = ref(false)
const urgentOptions = ref([])
const departmentOptions = ref([])
const apSearchText = computed({
  get: () => trcloudStore.expApSearchTextState,
  set: (val) => trcloudStore.expApSearchTextState = val
})
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
const editingTmpId = ref(null) // ID ของรายการในตารางชั่วคราวที่กำลังแก้ไข

const form = computed({
  get: () => trcloudStore.expFormState,
  set: (val) => trcloudStore.expFormState = val
})

const rows = computed({
  get: () => trcloudStore.expRowsState,
  set: (val) => trcloudStore.expRowsState = val
})

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
    if (!trcloudStore.expenseRows.length) fetchPromises.push(trcloudStore.fetchTrcloudData('expense'))
    
    if (fetchPromises.length) await Promise.all(fetchPromises)

    // Combine items from AP, PO, PR, and EXP
    const allItems = [
      ...(trcloudStore.apItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'AP' })),
      ...(trcloudStore.poItemRows || []).map(r => ({ doc: r.expense || r.doc_number || r.invoice_number, item: r.item_name, type: 'PO' })),
      ...(trcloudStore.prItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'PR' })),
      ...(trcloudStore.expenseItemRows || []).map(r => ({ doc: r.doc_number || r.invoice_number, item: r.item_name, type: 'EXP' }))
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
    // Ensure data is loaded
    const typeMatch = identity.match(/\[(AP|PO|PR|EXP)\]$/)
    const type = typeMatch ? typeMatch[1] : null

    if (type === 'AP' && !trcloudStore.apRows.length) await trcloudStore.fetchTrcloudData('ap')
    if (type === 'PO' && !trcloudStore.poRows.length) await trcloudStore.fetchTrcloudData('po')
    if (type === 'PR' && !trcloudStore.prRows.length) await trcloudStore.fetchTrcloudData('pr')
    if (type === 'EXP' && !trcloudStore.expenseRows.length) await trcloudStore.fetchTrcloudData('expense')
    
    let cleanIdentity = identity
    if (type) {
      cleanIdentity = identity.replace(` [${type}]`, '')
    }

    const [docNum, ...itemParts] = cleanIdentity.split(' | ')
    const itemName = itemParts.join(' | ')

    let trcloudItem = null
    
    const searchInAp = () => trcloudStore.apItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)
    const searchInPo = () => trcloudStore.poItemRows.find(r => (r.expense === docNum || r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)
    const searchInPr = () => trcloudStore.prItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)
    const searchInExp = () => trcloudStore.expenseItemRows.find(r => (r.doc_number === docNum || r.invoice_number === docNum) && r.item_name === itemName)

    if (type === 'AP') trcloudItem = searchInAp()
    else if (type === 'PO') trcloudItem = searchInPo()
    else if (type === 'PR') trcloudItem = searchInPr()
    else if (type === 'EXP') trcloudItem = searchInExp()
    else {
      trcloudItem = searchInAp() || searchInPo() || searchInPr() || searchInExp()
    }

    if (trcloudItem) {
      const poDateIso = isoDateFromAny(trcloudItem.issue_date)
      
      // If PO type, use 'expense' (อ้างอิงEXP) as ap_number for Exp form
      if (type === 'PO') {
        form.value.ap_number = trcloudItem.expense || ''
        form.value.po_id = trcloudItem.doc_number || trcloudItem.invoice_number || ''
      } else {
        form.value.ap_number = (type === 'AP' || type === 'EXP') ? (trcloudItem.doc_number || trcloudItem.invoice_number || '') : ''
        form.value.po_id = type === 'PO' ? (trcloudItem.doc_number || trcloudItem.invoice_number || '') : (trcloudItem.ref_po || '')
      }
      
      let staff = trcloudItem.staff || ''
      let poId = form.value.po_id
      
      if ((type === 'AP' || type === 'EXP') || !staff) {
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

      const rawQty = trcloudItem.quantity || trcloudItem.qty || 0
      form.value.qty_order = !isNaN(parseFloat(rawQty)) ? parseFloat(rawQty) : null
      
      let dept = trcloudItem.department || trcloudItem.department_name || ''
      
      if (!dept) {
        const targetItemName = String(trcloudItem.item_name || '').trim().toLowerCase()
        const relatedPr = trcloudStore.prItemRows.find(p => {
          const prItemName = String(p.item_name || '').trim().toLowerCase()
          return prItemName === targetItemName && targetItemName !== ''
        })
        
        if (relatedPr) {
          dept = relatedPr.department || relatedPr.department_name || relatedPr.project || ''
        }
      }
      
      if (dept && !departmentOptions.value.includes(dept)) {
        departmentOptions.value = [...departmentOptions.value, dept].sort()
      }
      
      form.value.department = dept
      form.value.supplier_name = trcloudItem.organization || ''
      
      // Use invoice_note for item_ref if available (matches what's shown in the table)
      form.value.item_ref = trcloudItem.invoice_note || trcloudItem.item_name || ''
      
      const rawPrice = trcloudItem.item_total || trcloudItem.total || trcloudItem.price || 0
      form.value.total_price = !isNaN(parseFloat(rawPrice)) ? parseFloat(rawPrice) : null
      
      form.value.po_date = poDateIso

      // Force status to "ยังไม่ชำระ" for any data pulled into this form
      form.value.ap_status = 'ยังไม่ชำระ'

      form.value.currency_name = String(trcloudItem.currency || 'LAK').toUpperCase() 
      
      // If we don't use it for item_ref, we don't force it into remark
      // form.value.remark = ...

      apInfo.value = {
        po_id: form.value.po_id || '-',
        po_date: poDateIso ? formatThaiDate(poDateIso) : '-',
        supplier_name: trcloudItem.organization || '-',
        item_ref: form.value.item_ref || '-',
        qty_order: form.value.qty_order || '-',
        total_price: form.value.total_price || '-',
        option_name: '-',
        department: form.value.department || '-',
        po_created_by: form.value.po_created_by || `TRCloud ${type || 'Data'}`,
      }
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
  const docPart = v.split(' | ')[0].trim()
  form.value.ap_number = docPart
  apDropdownOpen.value = false
  apActiveIndex.value = -1
  await fetchApAutofill(v)
}

function goBack() {
  emit('selectPage', { itemId: "/#/pr_po_items", itemLabel: "TRCloud PO รายการสินค้า" })
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

const availableApStatuses = computed(() => {
  return ['ยังไม่ชำระ', 'ชำระแล้ว']
})

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
    ap_status: 'ยังไม่ชำระ',
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

if (!form.value.ap_number && !form.value.po_id && rows.value.length === 0) {
  resetForm(false)
}

onMounted(() => {
  fetchUrgentOptions()
  fetchDepartmentOptions()
  trcloudStore.fetchTrcloudData('ap')
  trcloudStore.fetchTrcloudData('po')
  trcloudStore.fetchTrcloudData('pr')
  apSearchText.value = form.value.ap_number || ''
  showAddedTable.value = (rows.value || []).length > 0

  if (trcloudStore.pendingAutofill) {
    handleAutofill(trcloudStore.pendingAutofill)
    trcloudStore.pendingAutofill = null
  }
})

watch(() => trcloudStore.pendingAutofill, (val) => {
  if (val) {
    handleAutofill(val)
    trcloudStore.pendingAutofill = null
  }
})

async function isDuplicateInDb(item, excludeId = null) {
  try {
    let query = supabase
      .from('exp_requests')
      .select('id')
    
    // เงื่อนไข: เลขที่ AP (Exp)
    if (item.ap_number) query = query.eq('ap_number', item.ap_number)
    else query = query.is('ap_number', null)

    // เงื่อนไข: เลขที่ PO
    if (item.po_id) query = query.eq('po_id', item.po_id)
    else query = query.is('po_id', null)

    // เงื่อนไข: วันที่เปิด PO
    if (item.po_date) query = query.eq('po_date', item.po_date)
    else query = query.is('po_date', null)

    // เงื่อนไข: รายการ / อะไหล่
    if (item.item_ref) query = query.eq('item_ref', item.item_ref)
    else query = query.is('item_ref', null)

    // ถ้าเป็นการแก้ไข ให้ยกเว้น ID ของตัวเอง
    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return !!data
  } catch (err) {
    console.error('Duplicate check error:', err)
    return false
  }
}

async function handleAutofill(val) {
  const list = Array.isArray(val) ? val : [val]
  if (list.length === 0) return

  ui.showToast(`กำลังโหลดข้อมูล ${list.length} รายการ...`, 'info')
  
  for (const identity of list) {
    await fetchApAutofill(identity)
    if (apInfo.value) {
      const payload = {
        ap_number: (form.value.ap_number || '').trim() || null,
        po_id: (form.value.po_id || '').trim() || null,
        po_date: form.value.po_date || null,
        item_ref: (form.value.item_ref || '').trim() || null,
        // fields for UI/Other data
        supplier_name: (form.value.supplier_name || '').trim() || null,
        qty_order: form.value.qty_order === null || form.value.qty_order === '' ? null : Number(form.value.qty_order),
        department: (form.value.department || '').trim() || null,
        po_created_by: (form.value.po_created_by || '').trim() || null,
        date_transfer: form.value.date_transfer || null,
        option_name: '', 
        total_price: form.value.total_price === null || form.value.total_price === '' ? null : Number(form.value.total_price),
        currency_name: (form.value.currency_name || '').trim() || 'LAK',
        ap_status: 'ยังไม่ชำระ',
        qty_received: form.value.qty_received === null || form.value.qty_received === '' ? null : Number(form.value.qty_received),
        desired_date: form.value.desired_date || null,
        remark: (form.value.remark || '').trim() || null,
        _qty_auto_preview: qtyAutoPreview.value,
      }

      // ตรวจสอบซ้ำใน DB เพื่อแสดงสีแดง
      const exists = await isDuplicateInDb(payload)
      payload._is_duplicate = exists

      rows.value = [{ _tmp_id: crypto.randomUUID(), ...payload }, ...(rows.value || [])]
    }
  }

  resetForm(false)
  showAddedTable.value = true
  await nextTick()
  scrollToAddedTable()
  ui.showToast('โหลดข้อมูลสำเร็จ', 'success')
}

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
  if (!base.ap_number && !base.po_id) {
    ui.showToast('กรุณากรอก เลขที่ AP หรือ เลขที่ PO ก่อน', 'warning')
    return
  }

  const payload = {
    ...base,
    item_ref: (form.value.item_ref || '').trim() || null,
    qty_order: form.value.qty_order === null || form.value.qty_order === '' ? null : Number(form.value.qty_order),
    department: (form.value.department || '').trim() || null,
    po_created_by: (form.value.po_created_by || '').trim() || null,
    date_transfer: form.value.date_transfer || null,
    option_name: (form.value.option_name || '').trim() || null,
    total_price: form.value.total_price === null || form.value.total_price === '' ? null : Number(form.value.total_price),
    currency_name: (form.value.currency_name || '').trim() || 'LAK',
    ap_status: (form.value.ap_status || '').trim() || 'ยังไม่ชำระ', // Default to unpaid when adding
    qty_received: form.value.qty_received === null || form.value.qty_received === '' ? null : Number(form.value.qty_received),
    desired_date: form.value.desired_date || null,
    remark: (form.value.remark || '').trim() || null,
    _qty_auto_preview: qtyAutoPreview.value,
  }

  // ตรวจสอบซ้ำใน DB เพื่อแสดงสีแดง
  saving.value = true
  try {
    const exists = await isDuplicateInDb(payload)
    payload._is_duplicate = exists
  } finally {
    saving.value = false
  }

  if (editingTmpId.value) {
    const index = rows.value.findIndex(r => r._tmp_id === editingTmpId.value)
    if (index !== -1) {
      rows.value[index] = { ...rows.value[index], ...payload }
    }
    editingTmpId.value = null
  } else {
    rows.value = [{ _tmp_id: crypto.randomUUID(), ...payload }, ...(rows.value || [])]
  }

  resetForm(false)
  showAddedTable.value = true
  await nextTick()
  scrollToAddedTable()
}

function editTmpRow(row) {
  editingTmpId.value = row._tmp_id
  form.value = {
    ap_number: row.ap_number || '',
    po_id: row.po_id || '',
    po_date: row.po_date || '',
    supplier_name: row.supplier_name || '',
    item_ref: row.item_ref || '',
    qty_order: row.qty_order ?? null,
    department: row.department || '',
    po_created_by: row.po_created_by || '',
    date_transfer: row.date_transfer || '',
    option_name: row.option_name || '',
    total_price: row.total_price ?? null,
    currency_name: row.currency_name || '',
    ap_status: row.ap_status || '',
    qty_received: row.qty_received ?? null,
    desired_date: row.desired_date || '',
    remark: row.remark || '',
  }
  apSearchText.value = form.value.ap_number
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function cancelTmpEdit() {
  editingTmpId.value = null
  resetForm(false)
}

function bulkUpdateCurrency(newCurrency) {
  if (!newCurrency) return
  if (!rows.value || rows.value.length === 0) return
  rows.value = rows.value.map(r => ({
    ...r,
    currency_name: newCurrency
  }))
  form.value.currency_name = newCurrency
}

function bulkUpdateUrgency(newUrgency) {
  if (!newUrgency) return
  if (!rows.value || rows.value.length === 0) return
  rows.value = rows.value.map(r => ({
    ...r,
    option_name: newUrgency
  }))
  form.value.option_name = newUrgency
}

function bulkUpdateStatus(newStatus) {
  if (!newStatus) return
  if (!rows.value || rows.value.length === 0) return
  rows.value = rows.value.map(r => ({
    ...r,
    ap_status: newStatus
  }))
  form.value.ap_status = newStatus
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
      .from('exp_requests')
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
    form.value.currency_name = data.currency_name || 'LAK'
    form.value.ap_status = data.ap_status || ''
    form.value.qty_received = data.qty_received ?? null
    form.value.desired_date = data.desired_date ? isoDateFromAny(data.desired_date) : ''
    form.value.remark = data.remark || ''

    showAddedTable.value = false
  } catch (err) {
    editMode.value = false
    editRowId.value = null
    ui.showToast('โหลดข้อมูลสำหรับแก้ไขไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'), 'error')
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
      currency_name: (form.value.currency_name || '').trim() || 'LAK',
      ap_status: (form.value.ap_status || '').trim() || null,
      qty_received: form.value.qty_received === null || form.value.qty_received === '' ? null : Number(form.value.qty_received),
      desired_date: form.value.desired_date || null,
      remark: (form.value.remark || '').trim() || null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }

    // ตรวจสอบซ้ำใน DB (ยกเว้นตัวเอง)
    const exists = await isDuplicateInDb(payload, editRowId.value)
    if (exists) {
      await Swal.fire({
        title: 'พบข้อมูลซ้ำในระบบ',
        text: 'ไม่สามารถบันทึกได้ เนื่องจากมีข้อมูลรายการนี้ในระบบแล้ว (เลขที่ AP, เลขที่ PO, วันที่ และรายการ ซ้ำ)',
        icon: 'warning',
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#3085d6',
      })
      saving.value = false
      return
    }

    const { error } = await supabase.from('exp_requests').update(payload).eq('id', editRowId.value)
    if (error) throw error

    editMode.value = false
    editRowId.value = null
    resetForm(false)
    ui.showToast('บันทึกการแก้ไขสำเร็จ', 'success')
    emit('edited')
  } catch (err) {
    ui.showToast('บันทึกการแก้ไขไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'), 'error')
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
  if (!(rows.value || []).length) {
    ui.showToast('ยังไม่มีรายการในตาราง กรุณากด "เพิ่มรายการ" ก่อน', 'warning')
    return
  }
  saving.value = true
  try {
    const duplicates = []
    
    // 1. ตรวจสอบข้อมูลซ้ำในฐานข้อมูล
    for (const r of rows.value) {
      const exists = await isDuplicateInDb(r)
      if (exists) {
        duplicates.push(`- ${r.ap_number || r.po_id || 'ไม่ระบุ'} : ${r.item_ref || 'ไม่ระบุรายการ'}`)
      }
    }

    if (duplicates.length > 0) {
      await Swal.fire({
        title: 'พบข้อมูลซ้ำในระบบ',
        html: `<div class="text-left mt-2">รายการต่อไปนี้มีอยู่ในฐานข้อมูลแล้ว:<br><br>${duplicates.join('<br>')}</div>`,
        icon: 'warning',
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#3085d6',
      })
      saving.value = false
      return
    }

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
      currency_name: r.currency_name || 'LAK',
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

    const { error } = await supabase.from('exp_requests').insert(payload)
    if (error) throw error

    rows.value = []
    resetForm(false)
    ui.showToast('บันทึกข้อมูลสำเร็จ', 'success')
  } catch (err) {
    ui.showToast('บันทึกข้อมูลไม่สำเร็จ: ' + String(err?.message || err || 'เกิดข้อผิดพลาด'), 'error')
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
        <div class="md:col-span-3 flex items-center justify-between">
          <div>
            <h1 class="text-[20px] font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
              ฟอมร์ส่งรายการ Exp
              <span
                v-if="editMode"
                class="px-2 py-0.5 rounded-full text-[11px] font-medium border"
                style="border-color: rgba(249, 115, 22, 0.35); color: #f97316"
              >
                แก้ไขข้อมูล
              </span>
              <span
                v-else-if="editingTmpId"
                class="px-2 py-0.5 rounded-full text-[11px] font-medium border"
                style="border-color: rgba(139, 92, 246, 0.35); color: #8b5cf6"
              >
                กำลังแก้ไขรายการในตาราง
              </span>
              <span v-if="editLoading" class="text-[12px] font-normal" style="color: var(--color-text-muted)">กำลังโหลด...</span>
            </h1>
            <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">บันทึกข้อมูลจากตาราง exp_requests</p>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-xl border p-4 md:p-6" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">เลขที่ AP (Exp)</label>
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
          ข้อมูลรายละเอียด Exp
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
                  <option v-for="st in availableApStatuses" :key="st" :value="st">{{ st }}</option>
                </select>
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ราคาทั้งหมด</label>
                <div class="relative">
                  <input
                    v-model="form.total_price"
                    type="number"
                    step="any"
                    class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                    style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                  />
                  <div class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold" style="color: var(--color-text-muted)">
                    {{ form.currency_name || 'LAK' }}
                  </div>
                </div>
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">สกุลเงิน</label>
                <select
                  v-model="form.currency_name"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                >
                  <option value="LAK">LAK</option>
                  <option value="THB">THB</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">วันที่ต้องการสินค้า</label>
                <input
                  v-model="form.desired_date"
                  type="date"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                />
              </div>
              <div class="md:col-span-3">
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">หมายเหตุ</label>
                <textarea
                  v-model="form.remark"
                  rows="2"
                  class="w-full mt-1 px-3 py-2 border rounded-md text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <div class="px-4 py-3 border-t flex items-center justify-end gap-3" style="border-color: var(--color-border)">
          <template v-if="editMode">
            <button
              @click="cancelEdit"
              class="px-4 py-2 rounded-md text-[13px] font-medium border transition-colors"
              style="border-color: var(--color-border); color: var(--color-text-muted)"
            >
              ยกเลิกแก้ไข
            </button>
            <button
              @click="submitEdit"
              :disabled="saving"
              class="px-4 py-2 rounded-md text-[13px] font-medium text-white transition-opacity bg-blue-600 hover:bg-blue-700"
            >
              <i v-if="saving" class="fa-solid fa-spinner fa-spin mr-1"></i>
              บันทึกการแก้ไข
            </button>
          </template>
          <template v-else>
            <button
              v-if="editingTmpId"
              @click="cancelTmpEdit"
              class="px-4 py-2 rounded-md text-[13px] font-medium border transition-colors"
              style="border-color: var(--color-border); color: var(--color-text-muted)"
            >
              ยกเลิกการแก้ไข
            </button>
            <button
              @click="addRow"
              class="px-4 py-2 rounded-md text-[13px] font-medium text-white transition-opacity bg-blue-600 hover:bg-blue-700"
            >
              <i class="fa-solid fa-plus mr-1"></i>
              {{ editingTmpId ? 'อัปเดตรายการ' : 'เพิ่มรายการลงตาราง' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- ตารางรายการที่เตรียมบันทึก -->
    <div v-if="showAddedTable && !editMode" ref="addedTableRef" class="mt-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">
          รายการที่เตรียมบันทึก ({{ (rows || []).length }} รายการ)
        </h2>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 border rounded-lg p-1 bg-white dark:bg-gray-800">
             <span class="text-[11px] px-2 text-gray-500">ปรับทั้งหมด:</span>
             <select 
               class="px-2 py-1 text-[11px] border rounded bg-transparent focus:outline-none"
               @change="bulkUpdateUrgency($event.target.value)"
             >
               <option value="">— ความเร่งด่วน —</option>
               <option v-for="opt in urgentOptions" :key="opt" :value="opt">{{ opt }}</option>
             </select>
             <select 
               class="px-2 py-1 text-[11px] border rounded bg-transparent focus:outline-none"
               @change="bulkUpdateStatus($event.target.value)"
             >
               <option value="">— สถานะ —</option>
               <option value="ยังไม่ชำระ">ยังไม่ชำระ</option>
               <option value="ชำระแล้ว">ชำระแล้ว</option>
             </select>
             <div class="h-4 w-[1px] bg-gray-300 mx-1"></div>
             <button @click="bulkUpdateCurrency('LAK')" class="px-2 py-1 text-[11px] rounded hover:bg-gray-100 dark:hover:bg-gray-700">LAK</button>
             <button @click="bulkUpdateCurrency('THB')" class="px-2 py-1 text-[11px] rounded hover:bg-gray-100 dark:hover:bg-gray-700">THB</button>
             <button @click="bulkUpdateCurrency('USD')" class="px-2 py-1 text-[11px] rounded hover:bg-gray-100 dark:hover:bg-gray-700">USD</button>
          </div>
          <button
            @click="clearRows"
            class="text-[12px] font-medium text-red-500 hover:underline"
          >
            ล้างทั้งหมด
          </button>
        </div>
      </div>

      <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="overflow-x-auto overflow-y-auto max-h-[500px]">
          <table class="w-full text-left text-[13px] table-fixed min-w-[1400px]">
            <thead class="sticky top-0 z-10" style="background: var(--color-bg-card); border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="p-3 w-12 text-center">#</th>
                <th class="p-3 w-40">เลขที่ AP / PO</th>
                <th class="p-3 w-60">รายการ</th>
                <th class="p-3 w-32">จำนวนสั่ง</th>
                <th class="p-3 w-32">ราคาทั้งหมด</th>
                <th class="p-3 w-40">แผนก</th>
                <th class="p-3 w-40">ความเร่งด่วน</th>
                <th class="p-3 w-40">สถานะ</th>
                <th class="p-3 w-28 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody class="divide-y" style="border-color: var(--color-border)">
              <tr v-for="(row, idx) in rows" :key="row._tmp_id" class="hover:bg-gray-50/50 transition-colors">
                <td class="p-3 text-center text-gray-400">{{ rows.length - idx }}</td>
                <td class="p-3">
                  <div 
                    class="font-medium" 
                    :class="row._is_duplicate ? 'text-red-500' : ''"
                    :style="row._is_duplicate ? { color: '#ef4444' } : { color: 'var(--color-text-primary)' }"
                  >
                    {{ row.ap_number || '-' }}
                  </div>
                  <div 
                    class="text-[11px]" 
                    :class="row._is_duplicate ? 'text-red-400' : ''"
                    :style="row._is_duplicate ? { color: '#f87171' } : { color: 'var(--color-text-muted)' }"
                  >
                    PO: {{ row.po_id || '-' }}
                  </div>
                </td>
                <td class="p-3">
                  <div class="truncate font-medium" style="color: var(--color-text-primary)" :title="row.item_ref">
                    {{ row.item_ref || '-' }}
                  </div>
                  <div class="text-[11px]" style="color: var(--color-text-muted)">
                    โดย: {{ row.po_created_by || '-' }}
                  </div>
                </td>
                <td class="p-3">
                  <div class="font-bold" style="color: var(--color-text-primary)">
                    {{ formatNumber(row.qty_order) }}
                  </div>
                </td>
                <td class="p-3">
                  <div class="font-bold text-blue-600">
                    {{ formatNumber(row.total_price) }} <span class="text-[10px]">{{ row.currency_name }}</span>
                  </div>
                </td>
                <td class="p-3">
                  <span class="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px]">
                    {{ row.department || '-' }}
                  </span>
                </td>
                <td class="p-3">
                  <span 
                    class="px-2 py-0.5 rounded text-[11px] border"
                    :style="row.option_name?.includes('ด่วน') ? 'background: #fef2f2; color: #ef4444; border-color: #fecaca' : 'background: #f0fdf4; color: #22c55e; border-color: #bbf7d0'"
                  >
                    {{ row.option_name || '-' }}
                  </span>
                </td>
                <td class="p-3">
                   <span 
                    class="px-2 py-0.5 rounded text-[11px]"
                    :class="row.ap_status === 'ชำระแล้ว' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'"
                  >
                    {{ row.ap_status || '-' }}
                  </span>
                </td>
                <td class="p-3 text-center">
                  <div class="flex items-center justify-center gap-2">
                    <button @click="editTmpRow(row)" class="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors" title="แก้ไข">
                      <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button @click="removeRow(row._tmp_id)" class="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors" title="ลบ">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="px-6 py-4 border-t flex items-center justify-between" style="border-color: var(--color-border); background: var(--color-bg-card)">
          <p class="text-[12px]" style="color: var(--color-text-muted)">
            * ตรวจสอบข้อมูลให้ถูกต้องก่อนบันทึกลงฐานข้อมูล
          </p>
          <button
            @click="submitAll"
            :disabled="saving"
            class="px-8 py-2.5 rounded-lg text-[14px] font-bold text-white shadow-lg transition-all hover:scale-105 active:scale-95 bg-blue-600 hover:bg-blue-700"
          >
            <i v-if="saving" class="fa-solid fa-spinner fa-spin mr-2"></i>
            <i v-else class="fa-solid fa-cloud-arrow-up mr-2"></i>
            บันทึกข้อมูลทั้งหมด ({{ rows.length }} รายการ)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
