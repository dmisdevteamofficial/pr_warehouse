<script setup>
import { ref, onMounted } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import * as XLSX from 'xlsx'

const auth = useAuthStore()

const items = ref([])
const loading = ref(false)
const processing = ref(false)
const dropActive = ref(false)
const message = ref('')
const successCount = ref(0)
const errorCount = ref(0)
const errorRows = ref([])
const attachmentFile = ref(null)
const dataFile = ref(null)
const pendingRows = ref([])

const DOCUMENT_BUCKET = 'document_url'
const supportedKeys = ['item_code', 'item_name', 'unit', 'amount', 'remark']
const requiredKeys = ['item_code', 'amount']

function makeStoragePath(file, type) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const timestamp = Date.now()
  const baseName = file.name.replace(/\.[^/.]+$/, '')
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${auth.user?.id || 'anonymous'}/${type}/${timestamp}-${safeName}.${ext}`
}

async function uploadDocumentToStorage(file, type) {
  if (!file) return null
  const path = makeStoragePath(file, type)
  const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { upsert: false })
  if (uploadError) throw uploadError
  const { data } = supabase.storage.from(DOCUMENT_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

async function fetchItems() {
  const { data, error } = await supabase
    .from('items')
    .select('id,item_code,item_name,unit')
    .order('item_code')
  if (!error) items.value = data || []
}

onMounted(() => {
  fetchItems()
})

function downloadTemplate() {
  const headers = ['รหัสสินค้า (item_code)', 'ชื่อสินค้า (item_name)', 'หน่วย (unit)', 'จำนวน (amount)', 'หมายเหตุ (remark)']
  const rows = items.value.map((it) => [it.item_code, it.item_name, it.unit, '', ''])
  const data = [headers, ...rows]

  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'template')
  XLSX.writeFile(wb, `import_template_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function onDragOver(e) {
  e.preventDefault()
  dropActive.value = true
}
function onDragLeave() {
  dropActive.value = false
}
function onDrop(e) {
  e.preventDefault()
  dropActive.value = false
  const file = e.dataTransfer.files?.[0]
  if (file) onDataFileSelected(file)
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (file) onDataFileSelected(file)
  e.target.value = ''
}

function onAttachmentChange(e) {
  attachmentFile.value = e.target.files?.[0] || null
  e.target.value = ''
}

async function onDataFileSelected(file) {
  dataFile.value = file || null
  successCount.value = 0
  errorCount.value = 0
  errorRows.value = []
  pendingRows.value = []
  await handleFile(file)
}

async function confirmUpload() {
  if (processing.value) return
  if (!auth.user?.id) {
    message.value = 'ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่'
    return
  }
  if (!pendingRows.value.length) {
    message.value = 'ยังไม่มีข้อมูลที่พร้อมอัปโหลด'
    return
  }
  await processRows(pendingRows.value)
  pendingRows.value = []
  dataFile.value = null
}

function normalizeItemCode(value) {
  return String(value || '').trim().toUpperCase()
}

function stripLeadingZeros(value) {
  const s = normalizeItemCode(value)
  if (!/^\d+$/.test(s)) return null
  const stripped = s.replace(/^0+/, '')
  return stripped || '0'
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function mapHeaderToKey(headerText) {
  const raw = String(headerText || '').trim()
  const normalized = normalizeHeader(raw)
  if (!normalized) return null

  if (normalized.includes('item_code') || raw.includes('รหัสสินค้า')) return 'item_code'
  if (normalized.includes('item_name') || raw.includes('ชื่อสินค้า')) return 'item_name'
  if (normalized.includes('unit') || raw.includes('หน่วย')) return 'unit'
  if (normalized.includes('amount') || raw.includes('จำนวน')) return 'amount'
  if (normalized.includes('remark') || raw.includes('หมายเหตุ')) return 'remark'

  return null
}

async function handleFile(file) {
  const lower = file.name.toLowerCase()
  const isCsv = lower.endsWith('.csv')
  const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls')
  if (!isCsv && !isXlsx) {
    message.value = 'อนุญาตเฉพาะไฟล์ .csv, .xlsx เท่านั้น'
    pendingRows.value = []
    return
  }

  let wb
  if (isCsv) {
    const text = await file.text()
    wb = XLSX.read(text, { type: 'string' })
  } else {
    const buf = await file.arrayBuffer()
    wb = XLSX.read(buf, { type: 'array' })
  }

  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
  if (!data.length) {
    message.value = 'ไฟล์ว่าง ไม่พบข้อมูล'
    pendingRows.value = []
    return
  }

  const headersRaw = (data[0] || []).map((h) => String(h || '').trim())
  const colIndexByKey = {}
  for (let i = 0; i < headersRaw.length; i++) {
    const key = mapHeaderToKey(headersRaw[i])
    if (!key) continue
    if (colIndexByKey[key] !== undefined) {
      message.value = 'พบชื่อคอลัมน์ซ้ำ: ' + headersRaw[i]
      pendingRows.value = []
      return
    }
    colIndexByKey[key] = i
  }

  const missing = requiredKeys.filter((k) => colIndexByKey[k] === undefined)
  if (missing.length) {
    message.value = 'รูปแบบคอลัมน์ไม่ถูกต้อง (ต้องมีอย่างน้อย): item_code, amount'
    pendingRows.value = []
    return
  }

  const rows = data
    .slice(1)
    .map((r) => {
      const row = {}
      supportedKeys.forEach((key) => {
        const idx = colIndexByKey[key]
        row[key] = idx !== undefined && r[idx] !== undefined ? String(r[idx]).trim() : ''
      })
      return row
    })
    .filter((r) => r.item_code)

  if (!rows.length) {
    message.value = 'ไม่พบแถวข้อมูลสำหรับนำเข้า'
    pendingRows.value = []
    return
  }
  pendingRows.value = rows
  message.value = `ตรวจสอบไฟล์แล้ว พร้อมอัปโหลด ${rows.length} รายการ`
}

async function processRows(rows) {
  processing.value = true
  message.value = ''
  successCount.value = 0
  errorCount.value = 0
  errorRows.value = []

  try {
    if (!auth.user?.id) throw new Error('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')

    const codeToItem = new Map()
    for (const it of items.value) {
      const key = normalizeItemCode(it.item_code)
      if (key) codeToItem.set(key, it)
      const noZero = stripLeadingZeros(it.item_code)
      if (noZero) codeToItem.set(noZero, it)
    }

    let uploadedDocumentUrl = null
    if (attachmentFile.value) {
      try {
        uploadedDocumentUrl = await uploadDocumentToStorage(attachmentFile.value, 'bulk-import')
      } catch (err) {
        errorRows.value.push({ item_code: '', item_name: '', unit: '', amount: '', remark: '', error: `อัปโหลดไฟล์แนบไม่สำเร็จ: ${err.message}` })
      }
    }

    const validInserts = []
    const touchedItemIds = new Set()

    for (const r of rows) {
      const inputKey = normalizeItemCode(r.item_code)
      const inputNoZero = stripLeadingZeros(r.item_code)
      const it = codeToItem.get(inputKey) || (inputNoZero ? codeToItem.get(inputNoZero) : null)
      if (!it) {
        errorRows.value.push({ ...r, error: 'ไม่พบรหัสสินค้าในระบบ' })
        continue
      }
      if (r.item_name && r.item_name !== it.item_name) {
        errorRows.value.push({ ...r, error: 'ชื่อสินค้าไม่ตรงกับระบบ' })
        continue
      }
      const amt = Number(r.amount)
      if (!Number.isFinite(amt) || amt <= 0) {
        errorRows.value.push({ ...r, error: 'จำนวนต้องเป็นตัวเลขมากกว่า 0' })
        continue
      }
      const payload = {
        item_id: it.id,
        amount: amt,
        unit: it.unit,
        remark: r.remark || null,
        note: 'เติมสินค้า (Restock)',
        created_by: auth.user.id,
        updated_by: auth.user.id
      }
      if (uploadedDocumentUrl) payload.document_url = uploadedDocumentUrl
      validInserts.push(payload)
      touchedItemIds.add(it.id)
    }

    if (validInserts.length) {
      let insErr = null
      let insertedCount = 0

      const attemptWithDoc = uploadedDocumentUrl ? true : false
      if (attemptWithDoc) {
        const { error } = await supabase.from('inventory_imports').insert(validInserts)
        insErr = error
        if (insErr && String(insErr.message || '').includes('document_url')) {
          const stripped = validInserts.map(({ document_url, ...rest }) => rest)
          const { error: retryErr } = await supabase.from('inventory_imports').insert(stripped)
          insErr = retryErr
        }
      } else {
        const { error } = await supabase.from('inventory_imports').insert(validInserts)
        insErr = error
      }

      if (insErr) {
        message.value = 'บันทึกข้อมูลล้มเหลว: ' + (insErr.message || '')
        validInserts.forEach((v) => {
          const code = rows.find((r) => {
            const k = normalizeItemCode(r.item_code)
            const kz = stripLeadingZeros(r.item_code)
            const item = codeToItem.get(k) || (kz ? codeToItem.get(kz) : null)
            return item?.id === v.item_id
          })?.item_code || ''
          errorRows.value.push({ item_code: code, item_name: '', unit: '', amount: String(v.amount), remark: v.remark || '', error: 'บันทึกข้อมูลล้มเหลว' })
        })
      } else {
        insertedCount = validInserts.length
        successCount.value = insertedCount
        if (touchedItemIds.size) {
          await supabase.from('items').update({ updated_by: auth.user.id }).in('id', Array.from(touchedItemIds))
        }
        await supabase.from('user_logs').insert({
          system_user_id: auth.user.id,
          action: 'bulk_import_items',
          user_agent: navigator.userAgent,
          old_value: {
            total: rows.length,
            success: insertedCount,
            error: errorRows.value.length,
            has_attachment: Boolean(uploadedDocumentUrl)
          }
        })
      }
    }
    errorCount.value = errorRows.value.length
    if (!successCount.value && !errorCount.value) {
      message.value = 'ไม่มีรายการที่สามารถบันทึกได้'
    } else {
      message.value = `อัปโหลดสำเร็จ ${successCount.value} รายการ, ผิดพลาด ${errorCount.value} รายการ`
    }
    if (successCount.value) await fetchItems()
  } catch (e) {
    message.value = 'เกิดข้อผิดพลาดระหว่างประมวลผล โปรดติดต่อผู้ดูแลระบบ'
  } finally {
    processing.value = false
  }
}

function downloadErrorCsv() {
  if (!errorRows.value.length) return
  const ws = XLSX.utils.json_to_sheet(errorRows.value)
  const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `import_errors_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <AppLayout>
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">นำเข้าสินค้าแบบหลายรายการ (CSV / XLSX)</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">รองรับไฟล์ CSV และ Excel (XLSX)</p>
      </div>
      <div class="flex gap-2">
        <button @click="downloadTemplate"
                class="px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95">
          <i class="fa-solid fa-file-excel mr-1"></i> ดาวน์โหลดเทมเพลต
        </button>
        <button v-if="errorRows.length"
                @click="downloadErrorCsv"
                class="px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-amber-600 hover:bg-amber-700 text-white active:scale-95">
          <i class="fa-solid fa-triangle-exclamation mr-1"></i> ดาวน์โหลดข้อผิดพลาด
        </button>
      </div>
    </div>

    <div class="grid md:grid-cols-3 gap-6">
      <div class="md:col-span-2">
        <div class="rounded-2xl border p-6 text-center"
             :class="dropActive ? 'ring-2 ring-blue-400' : ''"
             style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="mb-3">
            <i class="fa-solid fa-cloud-arrow-up text-4xl text-blue-500"></i>
          </div>
          <p class="text-[14px] font-medium mb-1" style="color: var(--color-text-primary)">ลากไฟล์ .csv หรือ .xlsx มาวางที่นี่</p>
          <p class="text-[12px] mb-4" style="color: var(--color-text-muted)">หรือคลิกเพื่อเลือกไฟล์จากเครื่อง</p>
          <div @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop"
               class="border-2 border-dashed rounded-xl p-8 cursor-pointer"
               :class="dropActive ? 'border-blue-400 bg-blue-50/40 dark:bg-blue-900/10' : ''"
               style="border-color: var(--color-border)">
            <input type="file" accept=".csv,.xlsx,.xls" @change="onFileChange" class="hidden" id="csvInput">
            <label for="csvInput" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-blue-600 hover:bg-blue-700 text-white active:scale-95 cursor-pointer">
              <i class="fa-solid fa-file-arrow-up"></i>
              เลือกไฟล์
            </label>
          </div>

          <div class="mt-4 flex items-center justify-center gap-3">
            <input type="file" @change="onAttachmentChange" class="hidden" id="attachmentInput">
            <label for="attachmentInput" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all border hover:bg-gray-50 active:scale-95 cursor-pointer"
                   style="border-color: var(--color-border); color: var(--color-text-primary)">
              <i class="fa-solid fa-paperclip"></i>
              แนบไฟล์หลักฐาน
            </label>
            <span class="text-[12px]" style="color: var(--color-text-muted)">{{ attachmentFile?.name || 'ยังไม่ได้แนบไฟล์' }}</span>
          </div>

          <div class="mt-3 flex items-center justify-center gap-3">
            <span class="text-[12px]" style="color: var(--color-text-muted)">{{ dataFile?.name || 'ยังไม่ได้เลือกไฟล์ข้อมูล' }}</span>
            <button
              type="button"
              @click="confirmUpload"
              :disabled="processing || !pendingRows.length"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all border disabled:opacity-60 disabled:cursor-not-allowed"
              style="border-color: var(--color-border); color: var(--color-text-primary); background: var(--color-bg-card)"
            >
              <i class="fa-solid fa-circle-check text-emerald-600"></i>
              ยืนยันอัปโหลด
            </button>
          </div>

          <div class="mt-4 text-[13px]" :style="errorCount ? 'color: var(--color-danger)' : 'color: var(--color-text-secondary)'">
            {{ message }}
          </div>
          <div class="mt-2 text-[12px]" style="color: var(--color-text-muted)">
            คอลัมน์ที่รองรับ: item_code, item_name, unit, amount, remark (รองรับหัวคอลัมน์ภาษาไทยในเทมเพลต)
          </div>
        </div>
      </div>

      <div>
        <div class="rounded-2xl border p-5 space-y-2" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px]" style="color: var(--color-text-secondary)">สถานะการประมวลผล</span>
            <i v-if="processing" class="fa-solid fa-spinner fa-spin text-blue-500"></i>
          </div>
          <div class="flex items-center justify-between text-[13px]">
            <span style="color: var(--color-text-muted)">สำเร็จ</span>
            <span class="font-semibold text-emerald-600 dark:text-emerald-400">{{ successCount }}</span>
          </div>
          <div class="flex items-center justify-between text-[13px]">
            <span style="color: var(--color-text-muted)">ผิดพลาด</span>
            <span class="font-semibold text-amber-600 dark:text-amber-400">{{ errorCount }}</span>
          </div>
          <hr style="border-color: var(--color-border)" />
          <div class="text-[12px]" style="color: var(--color-text-muted)">
            ดาวน์โหลดเทมเพลต แล้วกรอกเฉพาะคอลัมน์จำนวนและหมายเหตุ ห้ามแก้ไขรหัสและชื่อสินค้า
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
