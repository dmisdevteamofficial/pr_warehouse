<script setup>
import { computed, onMounted, ref } from "vue"
import { useTrcloudStore } from "@/stores/trcloud"

const trcloudStore = useTrcloudStore()
const trcloudLoading = computed(() => trcloudStore.loading)
const filter = ref("")

function normalizeKey(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function firstValue(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return v
  }
  return ""
}

function splitRefTokens(v) {
  const raw = String(v || "").toUpperCase()
  return raw
    .split(/[^A-Z0-9]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function getPrNo(r) {
  return String(firstValue(r.document_number, r.pr_id, r.id) || "")
}
function getPoNo(r) {
  return String(firstValue(r.document_number, r.po_id, r.id) || "")
}
function getApNo(r) {
  return String(firstValue(r.invoice_number, r.document_number, r.expense_id, r.id) || "")
}
function getPvNo(r) {
  return String(firstValue(r.document_number, r.payment_id, r.id) || "")
}
function getExpenseNo(r) {
  return String(firstValue(r.document_number, r.expense_id, r.id) || "")
}

/** ลบ HTML แบบย่อ (API บางตัวส่ง description เป็น HTML เหมือนรายงาน Excel) */
function stripHtmlToPlainText(raw) {
  if (raw === null || raw === undefined) return ""
  let text = String(raw)
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n")
  text = text.replace(/<\/\s*(p|div|li|tr)\s*>/gi, "\n")
  text = text.replace(/<[^>]+>/g, "")
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea")
      ta.innerHTML = text
      text = ta.value
    } catch {
      /* ignore */
    }
  }
  return text.replace(/\s+/g, " ").trim()
}

function isNonEmptyString(v) {
  return v !== null && v !== undefined && String(v).trim() !== ""
}

/** ดึงข้อความรายการจากแถว TRCloud — ไม่ใช้ organization/department เป็นคำอธิบาย */
function getDescriptionFromTrcloudRow(r, isLineItem = false) {
  if (!r || typeof r !== "object") return ""

  const skipKeys = new Set([
    "organization",
    "department",
    "project",
    "staff",
    "status",
    "reference",
    "document_number",
    "invoice_number",
    "pr_id",
    "po_id",
    "expense_id",
    "payment_id",
    "id",
    "company_id",
    "passkey",
    "grand_total",
    "total",
    "quantity",
    "price",
    "issue_date",
    "date",
    "due_date",
  ])

  const headerTryKeys = [
    "description",
    "Description",
    "item_description",
    "product_description",
    "line_description",
    "desc",
    "detail",
    "details",
    "title",
    "subject",
    "list_name",
    "remark",
    "note",
  ]

  const lineExtraKeys = ["name", "product_name", "item_name"]
  const tryKeys = isLineItem ? [...headerTryKeys, ...lineExtraKeys] : headerTryKeys

  for (const k of tryKeys) {
    if (skipKeys.has(String(k).toLowerCase())) continue
    const v = r[k]
    if (typeof v === "string" && isNonEmptyString(v)) {
      const plain = stripHtmlToPlainText(v)
      if (plain) return plain
    }
  }

  // คีย์ใดก็ตามที่ชื่อคล้าย description / detail (ยกเว้นหน่วยงาน)
  for (const k of Object.keys(r)) {
    const low = String(k).toLowerCase()
    if (skipKeys.has(low)) continue
    if (low.includes("organization") || low.includes("department")) continue
    if (!isLineItem && (low === "name" || low.endsWith("_name"))) continue
    if (!(low.includes("desc") || low.includes("detail") || low === "title" || low === "subject")) continue
    const v = r[k]
    if (typeof v !== "string" || !isNonEmptyString(v)) continue
    const plain = stripHtmlToPlainText(v)
    if (plain) return plain
  }

  const listCandidates = [
    r.items,
    r.item_list,
    r.detail_list,
    r.details_list,
    r.products,
    r.lines,
    r.result,
    r.data,
  ]
  for (const list of listCandidates) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== "object") continue
      const line = getDescriptionFromTrcloudRow(item, true)
      if (line) return line
    }
  }

  return ""
}

function includesDocRef(refValue, docNo) {
  const refNorm = normalizeKey(refValue)
  const docNorm = normalizeKey(docNo)
  if (!refNorm || !docNorm) return false
  if (refNorm.includes(docNorm)) return true
  return splitRefTokens(refValue).includes(docNorm)
}

const relationRows = computed(() => {
  const prRows = trcloudStore.prRows || []
  const poRows = trcloudStore.poRows || []
  const apRows = trcloudStore.apRows || []
  const pvRows = trcloudStore.pvRows || []
  const expenseRows = trcloudStore.expenseRows || []

  const rows = prRows.map((pr) => {
    const prNo = getPrNo(pr)
    const pos = poRows.filter((po) => includesDocRef(po.reference, prNo))
    const poNos = pos.map(getPoNo).filter(Boolean)

    const aps = apRows.filter((ap) => {
      const apRef = firstValue(ap.po, ap.reference)
      return poNos.some((poNo) => includesDocRef(apRef, poNo))
    })
    const apNos = aps.map(getApNo).filter(Boolean)

    const exps = expenseRows.filter((ex) => {
      const exRef = firstValue(ex.po, ex.reference)
      return poNos.some((poNo) => includesDocRef(exRef, poNo))
    })
    const expNos = exps.map(getExpenseNo).filter(Boolean)

    // รายการสินค้า: ลองจาก PR ก่อน ถ้า API ค้นหาไม่ส่ง description ที่หัว PR ให้ใช้จาก PO ที่ผูก (ใกล้เคียงรายงาน Excel ที่เป็นบรรทัด PO)
    const finalDesc =
      getDescriptionFromTrcloudRow(pr) ||
      (pos.length > 0 ? getDescriptionFromTrcloudRow(pos[0]) : "") ||
      "-"

    const pvs = pvRows.filter((pv) => {
      const pvRef = firstValue(pv.reference, pv.remark, pv.note)
      return apNos.some((apNo) => includesDocRef(pvRef, apNo)) || 
             poNos.some((poNo) => includesDocRef(pvRef, poNo)) ||
             expNos.some((expNo) => includesDocRef(pvRef, expNo))
    })

    return {
      prNo: prNo || "-",
      prDate: firstValue(pr.issue_date, pr.date, "-"),
      prStatus: firstValue(pr.status, "-"),
      prDescription: finalDesc,
      poNos: pos.map(getPoNo).filter(Boolean),
      poDates: pos.map((po) => firstValue(po.issue_date, po.date, "")).filter(Boolean),
      apNos: aps.map(getApNo).filter(Boolean),
      apDates: aps.map((ap) => firstValue(ap.issue_date, ap.date, "")).filter(Boolean),
      pvNos: pvs.map(getPvNo).filter(Boolean),
      pvDates: pvs.map((pv) => firstValue(pv.issue_date, pv.date, "")).filter(Boolean),
      expNos: exps.map(getExpenseNo).filter(Boolean),
      expDates: exps.map((ex) => firstValue(ex.issue_date, ex.date, "")).filter(Boolean)
    }
  })

  const q = filter.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
})

function showValues(values) {
  if (!values || !values.length) return "-"
  return values.join(", ")
}

function mergeDocDate(docNo, docDate) {
  const no = String(docNo || "").trim()
  const dt = String(docDate || "").trim()
  if (!no && !dt) return "-"
  if (!no) return dt
  if (!dt) return no
  return `${no} (${dt})`
}

function mergeDocDateList(docNos, docDates) {
  const docs = Array.isArray(docNos) ? docNos : []
  const dates = Array.isArray(docDates) ? docDates : []
  const size = Math.max(docs.length, dates.length)
  if (size === 0) return "-"
  const merged = []
  for (let i = 0; i < size; i += 1) {
    merged.push(mergeDocDate(docs[i], dates[i]))
  }
  return merged.join("\n")
}

onMounted(() => {
  if (!trcloudStore.isLoaded) trcloudStore.fetchAll()
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">สถานะเชื่อมโยง PR-PO-AP-PV</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
        ตรวจสอบความต่อเนื่องของเอกสารว่า PR ต่อไป PO, AP และ PV ตรงกันหรือไม่
      </p>
    </div>

    <div class="mb-5 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="relative w-full">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="filter"
          type="text"
          placeholder="ค้นหา PR/PO/AP/PV..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[1100px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PR / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">description</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PO / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">AP / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PV / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">Expense / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">สถานะ PR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trcloudLoading">
              <td colspan="7" class="px-4 py-12 text-center">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
              </td>
            </tr>
            <tr v-else-if="!relationRows.length">
              <td colspan="7" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลสำหรับตรวจสอบความเชื่อมโยง</td>
            </tr>
            <tr
              v-for="row in relationRows"
              :key="row.prNo"
              class="hover:bg-gray-50/50 transition-colors"
              style="border-bottom: 1px solid var(--color-border)"
            >
              <td
                class="px-4 py-3 font-mono font-semibold text-cyan-600 break-words whitespace-normal align-top"
                style="border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDate(row.prNo, row.prDate) }}
              </td>
              <td
                class="px-4 py-3 break-words whitespace-normal align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ row.prDescription || "-" }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.poNos, row.poDates) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.apNos, row.apDates) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.pvNos, row.pvDates) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.expNos, row.expDates) }}
              </td>
              <td class="px-4 py-3 break-words whitespace-normal align-top" style="color: var(--color-text-primary); word-break: break-word">{{ row.prStatus || "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
