export const mockUsers = [
  { id: 'u1', emp_code: 'EMP001', fullname: 'สมชาย ใจดี', position: 'ผู้จัดการคลัง', department: 'คลังสินค้า', username: 'admin', password: 'admin1234', role: 'admin' },
  { id: 'u2', emp_code: 'EMP002', fullname: 'สมหญิง รักงาน', position: 'เจ้าหน้าที่คลัง', department: 'คลังสินค้า', username: 'staff01', password: 'staff1234', role: 'staff' },
  { id: 'u3', emp_code: 'EMP003', fullname: 'วิชัย ขยันดี', position: 'พนักงานทั่วไป', department: 'ปฏิบัติการ', username: 'staff02', password: 'staff1234', role: 'viewer' },
]

export const mockCategories = [
  { id: 'c1', category_name: 'อะไหล่เครื่องยนต์' },
  { id: 'c2', category_name: 'อุปกรณ์ไฟฟ้า' },
  { id: 'c3', category_name: 'อุปกรณ์ความปลอดภัย' },
  { id: 'c4', category_name: 'วัสดุสิ้นเปลือง' },
  { id: 'c5', category_name: 'เครื่องมือช่าง' },
]

export const mockItems = [
  { id: 'i1', item_code: 'ITM-001', item_name: 'ฟิลเตอร์น้ำมันเครื่อง', category_id: 'c1', current_stock: 42, unit: 'ชิ้น' },
  { id: 'i2', item_code: 'ITM-002', item_name: 'สายพานไทม์มิ่ง', category_id: 'c1', current_stock: 3, unit: 'เส้น' },
  { id: 'i3', item_code: 'ITM-003', item_name: 'หลอดไฟ LED 36W', category_id: 'c2', current_stock: 18, unit: 'หลอด' },
  { id: 'i4', item_code: 'ITM-004', item_name: 'สายไฟ NYY 4x10', category_id: 'c2', current_stock: 5, unit: 'เมตร' },
  { id: 'i5', item_code: 'ITM-005', item_name: 'หมวกนิรภัย', category_id: 'c3', current_stock: 30, unit: 'ใบ' },
  { id: 'i6', item_code: 'ITM-006', item_name: 'ถุงมือกันบาด', category_id: 'c3', current_stock: 2, unit: 'คู่' },
  { id: 'i7', item_code: 'ITM-007', item_name: 'น้ำมันไฮดรอลิค', category_id: 'c4', current_stock: 60, unit: 'ลิตร' },
  { id: 'i8', item_code: 'ITM-008', item_name: 'กระดาษทราย #120', category_id: 'c4', current_stock: 4, unit: 'แผ่น' },
  { id: 'i9', item_code: 'ITM-009', item_name: 'ประแจปากตาย 17mm', category_id: 'c5', current_stock: 12, unit: 'อัน' },
  { id: 'i10', item_code: 'ITM-010', item_name: 'สว่านไฟฟ้า 13mm', category_id: 'c5', current_stock: 6, unit: 'เครื่อง' },
]

const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (6 - i))
  return d.toISOString().split('T')[0]
})

export const mockChartData = {
  labels: days,
  imports: [12, 19, 8, 24, 15, 10, 18],
  transactions: [8, 14, 5, 20, 9, 7, 12],
}

export const mockTransactions = [
  { id: 't1', item_id: 'i1', amount: 5, unit: 'ชิ้น', category_id: 'c1', created_by: 'u2', created_at: new Date(Date.now() - 1*3600000).toISOString() },
  { id: 't2', item_id: 'i3', amount: 2, unit: 'หลอด', category_id: 'c2', created_by: 'u1', created_at: new Date(Date.now() - 3*3600000).toISOString() },
  { id: 't3', item_id: 'i5', amount: 4, unit: 'ใบ', category_id: 'c3', created_by: 'u3', created_at: new Date(Date.now() - 5*3600000).toISOString() },
  { id: 't4', item_id: 'i7', amount: 10, unit: 'ลิตร', category_id: 'c4', created_by: 'u2', created_at: new Date(Date.now() - 24*3600000).toISOString() },
  { id: 't5', item_id: 'i9', amount: 1, unit: 'อัน', category_id: 'c5', created_by: 'u1', created_at: new Date(Date.now() - 26*3600000).toISOString() },
]

export const mockOrderReqs = [
  { id: 'o1', item_id: 'i2', amount: 5, unit: 'เส้น', status: 'pending', created_by: 'u2', created_at: new Date(Date.now() - 2*3600000).toISOString() },
  { id: 'o2', item_id: 'i6', amount: 10, unit: 'คู่', status: 'approved', created_by: 'u3', created_at: new Date(Date.now() - 6*3600000).toISOString() },
  { id: 'o3', item_id: 'i4', amount: 20, unit: 'เมตร', status: 'pending', created_by: 'u2', created_at: new Date(Date.now() - 10*3600000).toISOString() },
  { id: 'o4', item_id: 'i8', amount: 50, unit: 'แผ่น', status: 'rejected', created_by: 'u3', created_at: new Date(Date.now() - 30*3600000).toISOString() },
  { id: 'o5', item_id: 'i1', amount: 12, unit: 'ชิ้น', status: 'completed', created_by: 'u1', created_at: new Date(Date.now() - 48*3600000).toISOString() },
]

export const mockNotifications = [
  { id: 'n1', system_user_id: 'u1', title: 'สินค้าใกล้หมด', message: 'สายพานไทม์มิ่ง เหลือเพียง 3 เส้น', is_read: false, created_at: new Date(Date.now() - 30*60000).toISOString() },
  { id: 'n2', system_user_id: 'u1', title: 'คำขอเบิกใหม่', message: 'มีคำขอเบิกสินค้ารออนุมัติ 2 รายการ', is_read: false, created_at: new Date(Date.now() - 2*3600000).toISOString() },
  { id: 'n3', system_user_id: 'u1', title: 'นำเข้าสินค้าสำเร็จ', message: 'นำเข้าฟิลเตอร์น้ำมันเครื่อง 20 ชิ้น', is_read: false, created_at: new Date(Date.now() - 4*3600000).toISOString() },
  { id: 'n4', system_user_id: 'u1', title: 'สินค้าวิกฤต', message: 'ถุงมือกันบาด เหลือเพียง 2 คู่', is_read: true, created_at: new Date(Date.now() - 24*3600000).toISOString() },
  { id: 'n5', system_user_id: 'u1', title: 'อนุมัติคำขอเบิก', message: 'คำขอเบิก #o2 ได้รับการอนุมัติแล้ว', is_read: true, created_at: new Date(Date.now() - 26*3600000).toISOString() },
  { id: 'n6', system_user_id: 'u1', title: 'รายงานประจำวัน', message: 'สรุปการเบิกจ่ายประจำวันพร้อมแล้ว', is_read: true, created_at: new Date(Date.now() - 48*3600000).toISOString() },
]
