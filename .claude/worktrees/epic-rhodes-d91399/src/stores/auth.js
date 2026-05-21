import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import router from '@/router'
import bcrypt from 'bcryptjs'

async function getPublicIp() {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2000)
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const json = await res.json()
    return json?.ip || null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const initialUser = JSON.parse(localStorage.getItem('mwm_session')) || null
  if (initialUser?.role === 'admin') initialUser.role = 'admin_store'
  const user = ref(initialUser)
  const isLoggedIn = computed(() => !!user.value)
  const initials = computed(() => user.value?.fullname?.slice(0, 2).toUpperCase() || 'US')

  async function login(username, password) {
    try {
      // 1. Fetch user from system_users
      const { data: userData, error: userError } = await supabase
        .from('system_users')
        .select('*')
        .eq('username', username)
        .single()
      
      if (userError || !userData) {
        return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' }
      }

      // 2. Compare hashed password
      const isMatch = await bcrypt.compare(password, userData.password_hash)
      if (!isMatch) {
        return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' }
      }

      // 3. Prepare safe user object
      const { password_hash: _, ...safeUser } = userData
      if (safeUser?.role === 'admin') safeUser.role = 'admin_store'
      user.value = safeUser
      localStorage.setItem('mwm_session', JSON.stringify(safeUser))

      // 4. Log the action in user_logs
      const ip = await getPublicIp()
      await supabase.from('user_logs').insert({
        system_user_id: userData.id,
        action: 'login',
        user_agent: navigator.userAgent,
        ip_address: ip,
        old_value: { login_at: new Date().toISOString() }
      })

      return { success: true }
    } catch (err) {
      console.error('Login Error:', err.message)
      return { success: false, message: 'เกิดข้อผิดพลาดในการเชื่อมต่อ' }
    }
  }

  function logout() {
    user.value = null
    localStorage.removeItem('mwm_session')
    router.push('/')
  }

  return { user, isLoggedIn, initials, login, logout }
})
