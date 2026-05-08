import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useTrcloudStore = defineStore('trcloud', () => {
  const prRows = ref([])
  const poRows = ref([])
  const apRows = ref([])
  const pvRows = ref([])
  const activeRequests = new Map()
  const typeLastFetchedAt = ref({
    pr: null,
    po: null,
    ap: null,
    pv: null
  })
  const typeLastRange = ref({
    pr: '',
    po: '',
    ap: '',
    pv: ''
  })
  
  const loading = ref(false)
  const lastFetched = ref(null)
  
  // Default date range is all historical data.
  const getInitialDates = () => {
    const now = new Date()
    const to = now.toISOString().split('T')[0] // Today's date
    const from = '2000-01-01'
    
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
    return pvRows.value
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
    const { force = false } = options
    if (shouldUseTypeCache(type, force)) return
    if (activeRequests.has(type)) return activeRequests.get(type)

    const isIndependentFetch = !loading.value
    if (isIndependentFetch) loading.value = true
    console.log(`Starting fetch for ${type}...`)
    const requestPromise = (async () => {
      try {
      const companyId = import.meta.env.VITE_TRCLOUD_COMPANY_ID
      const passkey = import.meta.env.VITE_TRCLOUD_PASSKEY
      
      if (!companyId || !passkey) {
        console.error('TRCLOUD API Credentials missing! Please check your VITE_TRCLOUD_COMPANY_ID and VITE_TRCLOUD_PASSKEY in .env file.')
        return
      }

      // Only log first 4 chars for security
      console.log(`Fetch ${type} using Company ID: ${companyId}`)
      
      let endpoint = ''
      let docType = 'project'
      let useJson = false
      
      if (type === 'pv') {
        endpoint = '/application/finance/api/engine-payment/payment_search_keyword.php'
        docType = ''
        useJson = true
      } else if (type === 'pr') {
        endpoint = '/application/expense/api/engine-pr/pr_search_keyword.php'
      } else if (type === 'po') {
        endpoint = '/application/expense/api/engine-po/po_search_keyword.php'
      } else if (type === 'ap') {
        endpoint = '/application/expense/api/engine-expense/expense_search_keyword.php'
        docType = 'ap'
      }

      const url = `/trcloud-api${endpoint}`
      let results = []
      let seen = new Set()
      let page = 0
      let total = null

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

        const body = useJson
          ? new URLSearchParams({ json: JSON.stringify(payload) })
          : new URLSearchParams(payload)

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
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
        
        // Success check: res.success can be 1 or true. Some APIs return result array directly or in 'data'
        const isSuccess = res.success == 1 || res.success === true || Array.isArray(res.result) || Array.isArray(res.data)
        
        if (!isSuccess) {
          if (res.message === 'No data is received!') {
             console.log(`${type}: End of data reached or no data in range.`)
             break
          }
          // If we have some results already, don't treat this as a fatal error
          if (results.length > 0) {
            console.warn(`⚠️ Partial fetch for ${type} due to API response:`, res.message)
            break
          }
          console.error(`❌ API Error for ${type}:`, res.message || 'Unknown Error', res)
          break
        }
        if (total === null) total = parseInt(res.count || res.total || 0)

        let items = res.result || res.data || []
        if (!Array.isArray(items)) {
          if (typeof items === 'object' && items !== null) {
            items = [items] // Wrap single object in array
          } else {
            items = []
          }
        }
        
        if (items.length === 0) break
        
        const newItems = []
        for (const it of items) {
          // Normalize PV fields
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

          const pid = it.po_id || it.pr_id || it.expense_id || it.payment_id || it.id || it.invoice_number || it.document_number
          if (pid && !seen.has(pid)) {
            seen.add(pid)
            newItems.push(it)
          }
        }

        if (newItems.length > 0) {
          results.push(...newItems)
          // Update store progressively so user sees data immediately
          if (type === 'pr') prRows.value = [...results]
          else if (type === 'po') poRows.value = [...results]
          else if (type === 'pv') pvRows.value = [...results]
          else if (type === 'ap') {
            // AP needs normalization before showing
            const apList = results.map(x => {
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

        if (total && results.length >= total) break
        page++
        // Small delay to allow UI to breathe
        await new Promise(resolve => setTimeout(resolve, 10))
        if (page > 50) break // Reduced from 100 to 50 for better performance
      }

      typeLastFetchedAt.value[type] = new Date()
      typeLastRange.value[type] = getCurrentRangeKey()

      // After all pages are fetched, do the background AP status check
      if (type === 'ap' && apRows.value.length > 0) {
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
                    'X-Requested-With': 'XMLHttpRequest'
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
    const { force = false } = options
    if (loading.value) return
    loading.value = true
    try {
      // Fetch in parallel to reduce total waiting time.
      await Promise.all([
        fetchTrcloudData('pr', { force }),
        fetchTrcloudData('po', { force }),
        fetchTrcloudData('ap', { force }),
        fetchTrcloudData('pv', { force })
      ])
      lastFetched.value = new Date()
    } finally {
      loading.value = false
    }
  }

  return {
    prRows, poRows, apRows, pvRows,
    loading, lastFetched, isLoaded,
    dateFrom, dateTo,
    fetchAll, fetchTrcloudData
  }
})
