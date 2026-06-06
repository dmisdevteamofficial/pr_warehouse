import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { trcloudItemKeys } from '@/utils/trackingSync'

// แหล่งข้อมูลของแต่ละประเภท: ตาราง *_requests + action ของ log LINE
export const TRACKING_SOURCES = {
  ap: { table: 'ap_requests', idField: 'ap_request_id', lineAction: 'line_copy_ap_request' },
  exp: { table: 'exp_requests', idField: 'exp_request_id', lineAction: 'line_copy_exp_request' },
}

/**
 * โหลดสถานะการจัดการของรายการ TRCloud:
 *   addedKeys    = source_key ที่ถูกบันทึกเข้าตารางจัดการแล้ว (กรอกมือแล้ว)
 *   lineSentKeys = source_key ที่ถูกดึงเข้าไปทำรายการส่ง LINE แล้ว
 * รองรับหลายแหล่ง (เช่นหน้า PO items ที่ส่งได้ทั้งฝั่ง AP และ EXP)
 */
export function useTrackingStatus() {
  const addedKeys = ref(new Set())
  const lineSentKeys = ref(new Set())

  async function load(sourceKeysList) {
    const sources = (Array.isArray(sourceKeysList) ? sourceKeysList : [sourceKeysList])
      .map((s) => (typeof s === 'string' ? TRACKING_SOURCES[s] : s))
      .filter(Boolean)

    const added = new Set()
    const lineSent = new Set()

    for (const s of sources) {
      try {
        const { data: reqRows, error: reqErr } = await supabase
          .from(s.table)
          .select('id, source_key')
          .not('source_key', 'is', null)
        if (reqErr) throw reqErr

        const idToKey = new Map()
        for (const r of reqRows || []) {
          if (!r.source_key) continue
          added.add(r.source_key)
          idToKey.set(r.id, r.source_key)
        }

        if (idToKey.size) {
          const { data: logs, error: logErr } = await supabase
            .from('user_logs')
            .select('old_value')
            .eq('action', s.lineAction)
            .limit(5000)
          if (logErr) throw logErr
          for (const l of logs || []) {
            const reqId = l?.old_value?.[s.idField]
            if (reqId != null && idToKey.has(reqId)) lineSent.add(idToKey.get(reqId))
          }
        }
      } catch (err) {
        console.warn(`โหลดสถานะการจัดการจาก ${s.table} ไม่สำเร็จ:`, err?.message || err)
      }
    }

    addedKeys.value = added
    lineSentKeys.value = lineSent
  }

  function isAdded(row) {
    return addedKeys.value.has(trcloudItemKeys(row).source_key)
  }

  function isLineSent(row) {
    return lineSentKeys.value.has(trcloudItemKeys(row).source_key)
  }

  return { addedKeys, lineSentKeys, load, isAdded, isLineSent }
}
