import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { trcloudProxyExtraHeaders } from '@/utils/trcloudSession'

export const useTrcloudStore = defineStore('trcloud', () => {
  const prRows = ref([])
  const poRows = ref([])
  const apRows = ref([])
  const pvRows = ref([])
  const expenseRows = ref([])
  const activeRequests = new Map()
  const typeLastFetchedAt = ref({
    pr: null,
    po: null,
    ap: null,
    pv: null,
    expense: null
  })
  const typeLastRange = ref({
    pr: '',
    po: '',
    ap: '',
    pv: '',
    expense: ''
  })

  const apItemListKeys = [
    'items', 'rows', 'detail', 'item', 'products', 'product_list', 'rows_list', 'details', 'line_items', 'order_items'
  ]

  const findApItemList = (invoice) => {
    for (const key of apItemListKeys) {
      const value = invoice?.[key]
      if (Array.isArray(value) && value.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return [key, value]
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed) && parsed.length && parsed.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
            return [key, parsed]
          }
        } catch {
          // ignore parse failures
        }
      }
    }
    return [null, null]
  }

  const cleanApText = (raw) => {
    if (raw == null) return ''
    let text = String(raw)
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<[^>]+>/g, '')
    text = text.replace(/\s+/g, ' ')
    return text.trim()
  }

  const buildApItemRow = (invoice, item) => {
    const invoiceNumber = invoice?.invoice_number || invoice?.doc_number || invoice?.reference || invoice?.id || ''
    const companyFormat = invoice?.company_format || ''
    const docNumber = companyFormat ? `${companyFormat}${invoiceNumber}` : String(invoiceNumber || '')
    const itemName = item?.product_name || item?.name || item?.title || item?.description || item?.item_name || item?.item || item?.product || ''
    const status = invoice?.payment_status || invoice?.status || invoice?.status_payment || invoice?.status_text || invoice?.invoice_status || ''

    return {
      doc_number: docNumber,
      invoice_number: invoiceNumber,
      issue_date: invoice?.issue_date || invoice?.date || invoice?.issueDate || '',
      due_date: invoice?.due_date || invoice?.dueDate || '',
      organization: invoice?.organization || invoice?.name || invoice?.supplier || '',
      contact_type: invoice?.contact_type || '',
      status,
      item_name: cleanApText(itemName),
      quantity: item?.quantity || item?.qty || item?.amount || item?.qty_unit || '',
      unit: item?.unit || item?.unit_name || item?.uom || '',
      price: item?.price || item?.unit_price || item?.cost || item?.sale_price || '',
      item_total: item?.total || item?.line_total || item?.amount || item?.item_total || '',
      category: item?.category || invoice?.category || '',
      staff: invoice?.staff || invoice?.created_by || '',
      department: invoice?.department || invoice?.department_name || '',
      currency: invoice?.currency || invoice?.currency_name || 'THB',
      ref_po: invoice?.po || invoice?.reference || invoice?.po_number || ''
    }
  }

  const extractApItemRows = (apData) => {
    if (!Array.isArray(apData) || !apData.length) return []
    const rows = []
    for (const invoice of apData) {
      const [itemKey, itemList] = findApItemList(invoice)
      if (itemList) {
        const baseInvoice = { ...invoice }
        delete baseInvoice[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(baseInvoice, item))
        }
      } else {
        const itemName = invoice?.description || invoice?.remark || invoice?.note || invoice?.title || ''
        const invoiceNumber = invoice?.invoice_number || invoice?.doc_number || invoice?.reference || invoice?.id || ''
        const companyFormat = invoice?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${invoiceNumber}` : String(invoiceNumber || '')
        rows.push({
          doc_number: docNumber,
          invoice_number: invoiceNumber,
          issue_date: invoice?.issue_date || invoice?.date || invoice?.issueDate || '',
          due_date: invoice?.due_date || invoice?.dueDate || '',
          organization: invoice?.organization || invoice?.name || invoice?.supplier || '',
          contact_type: invoice?.contact_type || '',
          status: invoice?.payment_status || invoice?.status || invoice?.status_payment || invoice?.status_text || invoice?.invoice_status || '',
          item_name: cleanApText(itemName),
          quantity: invoice?.quantity || invoice?.qty || '',
          unit: invoice?.unit || invoice?.unit_name || invoice?.uom || '',
          price: invoice?.price || invoice?.unit_price || invoice?.cost || invoice?.sale_price || '',
          item_total: invoice?.total || invoice?.before_vat || invoice?.item_total || '',
          category: invoice?.category || '',
          staff: invoice?.staff || invoice?.created_by || '',
          department: invoice?.department || invoice?.department_name || '',
          currency: invoice?.currency || invoice?.currency_name || 'THB',
          ref_po: invoice?.po || invoice?.reference || invoice?.po_number || ''
        })
      }
    }
    return rows
  }

  const extractPoItemRows = (poData) => {
    if (!Array.isArray(poData) || !poData.length) return []
    const rows = []
    for (const po of poData) {
      // Reuse the same item-list detection as AP
      const [itemKey, itemList] = findApItemList(po)
      if (itemList) {
        const basePo = { ...po }
        delete basePo[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(basePo, item))
        }
      } else {
        const itemName = po?.description || po?.remark || po?.note || po?.title || ''
        const poNumber = po?.po_number || po?.document_number || po?.reference || po?.id || ''
        const companyFormat = po?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${poNumber}` : String(poNumber || '')
        rows.push({
          doc_number: docNumber,
          invoice_number: poNumber,
          issue_date: po?.issue_date || po?.date || po?.issueDate || '',
          due_date: po?.due_date || po?.dueDate || '',
          organization: po?.organization || po?.name || po?.supplier || '',
          contact_type: po?.contact_type || '',
          status: po?.status || '',
          item_name: cleanApText(itemName),
          quantity: po?.quantity || po?.qty || '',
          unit: po?.unit || po?.unit_name || po?.uom || '',
          price: po?.price || po?.unit_price || po?.cost || po?.sale_price || '',
          item_total: po?.total || po?.before_vat || po?.item_total || '',
          category: po?.category || '',
          staff: po?.staff || po?.created_by || '',
          department: po?.department || po?.department_name || '',
          currency: po?.currency || po?.currency_name || 'THB',
          ref_po: po?.po || po?.reference || po?.po_number || ''
        })
      }
    }
    return rows
  }

  const extractPrItemRows = (prData) => {
    if (!Array.isArray(prData) || !prData.length) return []
    const rows = []
    for (const pr of prData) {
      const [itemKey, itemList] = findApItemList(pr)
      if (itemList) {
        const basePr = { ...pr }
        delete basePr[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(basePr, item))
        }
      } else {
        const itemName = pr?.description || pr?.remark || pr?.note || pr?.title || ''
        const prNumber = pr?.pr_number || pr?.document_number || pr?.reference || pr?.id || ''
        const companyFormat = pr?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${prNumber}` : String(prNumber || '')
        rows.push({
          doc_number: docNumber,
          invoice_number: prNumber,
          issue_date: pr?.issue_date || pr?.date || pr?.issueDate || '',
          due_date: pr?.due_date || pr?.dueDate || '',
          organization: pr?.organization || pr?.name || pr?.supplier || '',
          contact_type: pr?.contact_type || '',
          status: pr?.status || '',
          item_name: cleanApText(itemName),
          quantity: pr?.quantity || pr?.qty || '',
          unit: pr?.unit || pr?.unit_name || pr?.uom || '',
          price: pr?.price || pr?.unit_price || pr?.cost || pr?.sale_price || '',
          item_total: pr?.total || pr?.before_vat || pr?.item_total || '',
          category: pr?.category || '',
          staff: pr?.staff || pr?.created_by || '',
          department: pr?.department || pr?.department_name || '',
          currency: pr?.currency || pr?.currency_name || 'THB',
          ref_po: pr?.po || pr?.reference || pr?.po_number || ''
        })
      }
    }
    return rows
  }

  const apItemRows = computed(() => extractApItemRows(apRows.value))
  const poItemRows = computed(() => extractPoItemRows(poRows.value))
  const prItemRows = computed(() => extractPrItemRows(prRows.value))
  
  const loading = ref(false)
  const lastFetched = ref(null)
  const pendingAutofill = ref(null) // สำหรับส่งข้อมูลข้ามหน้า
  
  // Default date range is rolling 4 months (current month + previous 3 months).
  const getInitialDates = () => {
    const formatLocalYmd = (d) => {
      const yyyy = String(d.getFullYear())
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

    const now = new Date()
    const to = formatLocalYmd(now) // Today's date
    const fromDate = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const from = formatLocalYmd(fromDate)
    
    return { from, to }
  }

  const initialDates = getInitialDates()
  const dateFrom = ref(initialDates.from)
  const dateTo = ref(initialDates.to)

  const isLoaded = computed(() => !!lastFetched.value)

  const getRowsByType = (type) => {
    if (type === 'pr') return prRows.value
    if (type === 'po') return poRows.value
    if (type === 'ap') return apRows.value
    if (type === 'pv') return pvRows.value
    return expenseRows.value
  }

  const getCurrentRangeKey = () => `${dateFrom.value || ''}_${dateTo.value || ''}`

  const shouldUseTypeCache = (type, force = false) => {
    if (force) return false
    const rows = getRowsByType(type)
    if (!rows.length) return false

    const sameRange = typeLastRange.value[type] === getCurrentRangeKey()
    if (!sameRange) return false

    const lastAt = typeLastFetchedAt.value[type]
    if (!lastAt) return false

    const freshMs = Date.now() - new Date(lastAt).getTime()
    return freshMs < 5 * 60 * 1000
  }

  async function fetchTrcloudData(type = 'pr', options = {}) {
    const { force = false, skipApStatusSync = false } = options
    if (shouldUseTypeCache(type, force)) return
    if (activeRequests.has(type)) return activeRequests.get(type)

    const isIndependentFetch = !loading.value
    if (isIndependentFetch) loading.value = true
    console.log(`Starting fetch for ${type}...`)
    const requestPromise = (async () => {
      try {
      const companyId = (import.meta.env.VITE_TRCLOUD_COMPANY_ID || '25').trim()
      const passkey = (import.meta.env.VITE_TRCLOUD_PASSKEY || '6a05946b357765415b4c931d2122a8c8').trim()
      
      if (!companyId || !passkey) {
        console.error('TRCLOUD API Credentials missing!')
        return
      }

      // Keep logs safe but useful for diagnosing stale/invalid env values.
      console.log(`Fetch ${type} using Company ID: ${companyId}, passkey length: ${passkey.length}`)
      
      let endpoint = ''
      let docType = 'project'
      let useJson = false
      let isApFallback = false
      let candidateEndpoints = []
      
      if (type === 'pv') {
        endpoint = '/application/finance/api/engine-payment/payment_search_keyword.php'
        docType = ''
        useJson = true
        candidateEndpoints = [endpoint]
      } else if (type === 'pr') {
        endpoint = '/application/expense/api/engine-pr/pr_search_keyword.php'
        candidateEndpoints = [endpoint]
      } else if (type === 'po') {
        endpoint = '/application/expense/api/engine-po/po_search_keyword.php'
        // Prefer the report-style PO list (contains item detail) as first candidate
        candidateEndpoints = [
          '/application/expense_report/api/engine-po/po_list.php',
          '/application/expense/api/engine-po/po_search_keyword.php'
        ]
        useJson = true
      } else if (type === 'ap') {
        endpoint = '/application/expense_report/api/engine-report/invoice_list.php'
        docType = ''
        useJson = true
        isApFallback = true
        candidateEndpoints = [
          '/application/expense_report/api/engine-report/invoice_list.php',
          '/application/expense_report/api/engine-report/invoice_by_supplier.php'
        ]
      } else if (type === 'expense') {
        endpoint = '/application/expense/api/engine-expense/expense_search_keyword.php'
        docType = ''
        candidateEndpoints = [endpoint]
      }

      let results = []
      let seen = new Set()
      let total = null
      let selectedEndpoint = endpoint

      for (const nextEndpoint of candidateEndpoints) {
        selectedEndpoint = nextEndpoint
        let page = 0
        let pageResults = []
        let endpointTotal = null

        // Determine if this specific endpoint needs JSON payload
        let currentUseJson = useJson
        if (selectedEndpoint.includes('_search_keyword.php')) {
          currentUseJson = false
        } else if (selectedEndpoint.includes('invoice_list.php') || selectedEndpoint.includes('po_list.php')) {
          currentUseJson = true
        }

        while (true) {
          const payload = {
            company_id: companyId,
            passkey: passkey,
            start: page,
            keyword: '',
            filter: '',
            from: dateFrom.value,
            to: dateTo.value,
            date_from: dateFrom.value,
            date_to: dateTo.value,
            activate_date: 'on',
            department: '',
            sort: '',
            advance_search: '1',
            project: '',
            staff: '',
            source: '',
            title: '',
            name: '',
            organization: '',
            tax_id: '',
            doc_from: '',
            doc_to: '',
            total_from: '',
            total_to: '',
            gtotal_from: '',
            gtotal_to: '',
            vat: 'all',
            type: docType
          }

          let finalPayload = payload
          if (type === 'ap' && String(selectedEndpoint || '').toLowerCase().includes('invoice_list.php')) {
            finalPayload = {
              company_id: companyId,
              passkey: passkey,
              from: dateFrom.value,
              to: dateTo.value,
              date_type: 'issue_date',
              status_paid: 'paid',
              status_debtor: 'debtor',
              status_overdue: 'overdue',
              credit_note: '',
              staff_from: '*',
              staff_to: '*',
              project: '*',
              department: '*',
              keyword: '',
              start: page
            }
          }

          if (type === 'po' && String(selectedEndpoint || '').toLowerCase().includes('po_list.php')) {
            finalPayload = {
              company_id: companyId,
              passkey: passkey,
              from: dateFrom.value,
              to: dateTo.value,
              status_new: 1,
              status_partial: 1,
              status_success: 1,
              status_confirm: 1,
              status_rejected: 0,
              status_force: 1,
              status_sent: 0,
              status_email: 0,
              date_type: 'issue_date',
              remain_status: '',
              sales_from: '*',
              sales_to: '*',
              project: '*',
              department: '*',
              keyword: '',
              start: page
            }
          }

          const body = currentUseJson
            ? new URLSearchParams({ json: JSON.stringify(finalPayload) })
            : new URLSearchParams(finalPayload)

          const url = `/trcloud-api${selectedEndpoint}`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              ...trcloudProxyExtraHeaders(),
            },
            body: body,
          })

          if (!response.ok) {
            console.error(`HTTP error for ${type}: status ${response.status}`)
            break
          }
          const res = await response.json()
          if (type === 'pv') {
            console.log(`Response for PV (page ${page}):`, res)
          }
          
          const isSuccess = res.success == 1 || res.success === true || Array.isArray(res.result) || Array.isArray(res.data)
          if (!isSuccess) {
            if (res.message === 'No data is received!') {
              console.log(`${type}: End of data reached or no data in range.`)
              break
            }
            if (pageResults.length > 0) {
              console.warn(`⚠️ Partial fetch for ${type} due to API response:`, res.message)
              break
            }
            console.error(`❌ API Error for ${type}:`, res.message || 'Unknown Error', res)
            break
          }

          if (endpointTotal === null) endpointTotal = parseInt(res.count || res.total || 0)

          let items = res.result || res.data || []
          if (!Array.isArray(items)) {
            if (typeof items === 'object' && items !== null) {
              items = [items]
            } else {
              items = []
            }
          }
          
          if (items.length === 0) break
          
          const newItems = []
          for (const it of items) {
            if (type === 'pv') {
              if (!it.issue_date && it.payment_date) it.issue_date = it.payment_date
              if (!it.issue_date && it.date) it.issue_date = it.date
              if (!it.grand_total && it.amount) it.grand_total = it.amount
              if (!it.grand_total && it.total_amount) it.grand_total = it.total_amount
              if (!it.grand_total && it.total) it.grand_total = it.total

              let rawStatus = (it.status || it.payment_status || it.status_payment || '').toString().toLowerCase()
              let status = it.status || 'ชำระแล้ว'
              if (rawStatus.includes('ชำระแล้ว') || rawStatus.includes('paid') || rawStatus.includes('success') || rawStatus.includes('complete') || rawStatus.includes('อนุมัติ')) {
                status = 'ชำระแล้ว'
              } else if (rawStatus.includes('ยังไม่') || rawStatus.includes('unpaid') || rawStatus.includes('pending')) {
                status = 'ยังไม่ชำระ'
              } else if (rawStatus.includes('ยกเลิก') || rawStatus.includes('cancel')) {
                status = 'ยกเลิก'
              }
              it.status = status
              if (!it.payment_status) it.payment_status = status
            }

            let pid
            if (type === 'ap') {
              pid = it.item_id || it.ap_item_id || (`${it.expense_id || it.invoice_number || ''}_${it.product_id || it.item_id || ''}_${(it.description || it.item_name || it.product || '')}`)
            } else if (type === 'po') {
              pid = it.item_id || it.po_item_id || (`${it.po_id || it.id || it.document_number || ''}_${it.product_id || it.item_id || ''}_${(it.description || it.item_name || it.product || '')}`)
            } else {
              pid = it.po_id || it.pr_id || it.expense_id || it.payment_id || it.id || it.invoice_number || it.document_number
            }

            if (pid) {
              if (!seen.has(pid)) {
                seen.add(pid)
                newItems.push(it)
              }
            } else {
              // If no identifier available, include the row to avoid losing data
              newItems.push(it)
            }
          }

          if (newItems.length > 0) {
            pageResults.push(...newItems)
            if (type === 'pr') prRows.value = [...pageResults]
            else if (type === 'po') poRows.value = [...pageResults]
            else if (type === 'pv') pvRows.value = [...pageResults]
            else if (type === 'expense') expenseRows.value = [...pageResults]
            else if (type === 'ap') {
              const apList = pageResults.map(x => {
                let rawStatus = (x.payment_status || x.status || x.status_payment || '').toString().toLowerCase()
                let status = 'ยังไม่ชำระ'
                const remain = parseFloat(x.remain || x.balance || -1)
                const total = parseFloat(x.grand_total || x.total || 0)
                if (remain === 0 || rawStatus.includes('paid') || rawStatus.includes('ชำระแล้ว') || rawStatus.includes('success') || rawStatus.includes('complete') || rawStatus.includes('อนุมัติ')) {
                  status = 'ชำระแล้ว'
                } else if (remain > 0 && remain < total) {
                  status = 'ชำระบางส่วน'
                }
                return { ...x, payment_status: status }
              })
              apRows.value = apList
            }
          }

          if (endpointTotal && pageResults.length >= endpointTotal) break
          page++
          await new Promise(resolve => setTimeout(resolve, 10))
          if (page > 50) break
        }

        if (pageResults.length > 0) {
          results = pageResults
          total = endpointTotal
          if (isApFallback && selectedEndpoint.includes('invoice_by_supplier.php')) {
            console.log(`TRCloud AP fallback used endpoint: ${selectedEndpoint}`)
          }
          break
        }
      }

      typeLastFetchedAt.value[type] = new Date()
      typeLastRange.value[type] = getCurrentRangeKey()

      // After all pages are fetched, do the background AP status check
      if (type === 'ap' && !skipApStatusSync && apRows.value.length > 0) {
        const needsUpdate = apRows.value.filter(ap => ap.payment_status === 'ยังไม่ชำระ')
        if (needsUpdate.length > 0) {
          // We limit background check to the most recent 30 items to save resources
          const recentNeedsUpdate = needsUpdate.slice(0, 30)
          const updateStatuses = async () => {
            const fetchStatus = async (ap) => {
              const eid = ap.expense_id || ap.id
              if (!eid) return
              try {
                const inner = { company_id: companyId, passkey: passkey, activate_date: 'on', expense_id: eid }
                const r = await fetch(`/trcloud-api/application/expense/api/engine-expense/invoice-payment.php`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...trcloudProxyExtraHeaders(),
                  },
                  body: new URLSearchParams({ json: JSON.stringify(inner) })
                })
                const payRes = await r.json()
                const pays = payRes.success === 1 ? payRes.result || [] : []
                if (pays.length > 0) {
                  ap.payment_status = 'ชำระแล้ว'
                }
              } catch (e) {}
            }
            // Fetch in chunks of 10
            for (let i = 0; i < recentNeedsUpdate.length; i += 10) {
              const chunk = recentNeedsUpdate.slice(i, i + 10)
              await Promise.all(chunk.map(ap => fetchStatus(ap)))
              apRows.value = [...apRows.value] // Update UI
              await new Promise(resolve => setTimeout(resolve, 100)) // Small delay
            }
          }
          updateStatuses()
        }
      }
      } catch (err) {
        console.error(`TRCLOUD Fetch Error (${type}):`, err)
      } finally {
        activeRequests.delete(type)
        if (isIndependentFetch) loading.value = false
      }
    })()

    activeRequests.set(type, requestPromise)
    return requestPromise
  }

  async function fetchAll(options = {}) {
    const { force = false, skipApStatusSync = false } = options
    if (loading.value) return
    loading.value = true
    try {
      // Fetch in parallel to reduce total waiting time.
      await Promise.all([
        fetchTrcloudData('pr', { force, skipApStatusSync }),
        fetchTrcloudData('po', { force, skipApStatusSync }),
        fetchTrcloudData('ap', { force, skipApStatusSync }),
        fetchTrcloudData('pv', { force, skipApStatusSync }),
        fetchTrcloudData('expense', { force, skipApStatusSync })
      ])
      lastFetched.value = new Date()
    } finally {
      loading.value = false
    }
  }

  return {
    prRows, poRows, apRows, pvRows, expenseRows,
    apItemRows, poItemRows,
    loading, lastFetched, isLoaded,
    dateFrom, dateTo,
    fetchAll, fetchTrcloudData
  }
})
