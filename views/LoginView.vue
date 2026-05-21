<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน'
    return
  }
  loading.value = true
  try {
    const result = await auth.login(username.value, password.value)
    if (!result.success) {
      error.value = result.message
    } else {
      const role = auth.user?.role || 'staff'
      if (role === 'super_admin') {
        router.push('/pr/admin')
      } else if (role === 'admin_store') {
        router.push('/dashboard')
      } else {
        router.push('/u/home')
      }
    }
  } catch (err) {
    error.value = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4" style="background: var(--color-bg-base)">
    <div class="w-full max-w-sm rounded-2xl border p-9 shadow-sm" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="text-center mb-6">
        <i class="fa-solid fa-warehouse text-[32px] text-blue-600 mb-3 block"></i>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">MWM System</h1>
        <p class="text-[12px] mt-1" style="color: var(--color-text-muted)">Mine Warehouse Management System</p>
      </div>

      <hr class="mb-6" style="border-color: var(--color-border)" />

      <h2 class="text-[18px] font-bold mb-4 text-center" style="color: var(--color-text-primary)">เข้าสู่ระบบ</h2>

      <div class="space-y-4">
        <div>
          <label class="block text-[13px] font-medium mb-1.5" style="color: var(--color-text-secondary)">ชื่อผู้ใช้งาน</label>
          <div class="relative">
            <i class="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style="color: var(--color-text-muted)"></i>
            <input v-model="username" type="text" @keyup.enter="handleLogin"
                   class="w-full pl-9 pr-4 py-2.5 rounded-lg border text-[14px] outline-none focus:ring-2 focus:ring-primary-DEFAULT/30 transition-all"
                   style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
                   placeholder="กรอกชื่อผู้ใช้งาน" />
          </div>
        </div>

        <div>
          <label class="block text-[13px] font-medium mb-1.5" style="color: var(--color-text-secondary)">รหัสผ่าน</label>
          <div class="relative">
            <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style="color: var(--color-text-muted)"></i>
            <input v-model="password" :type="showPassword ? 'text' : 'password'" @keyup.enter="handleLogin"
                   class="w-full pl-9 pr-10 py-2.5 rounded-lg border text-[14px] outline-none focus:ring-2 focus:ring-primary-DEFAULT/30 transition-all"
                   style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
                   placeholder="กรอกรหัสผ่าน" />
            <button @click="showPassword = !showPassword"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-[13px]"
                    style="color: var(--color-text-muted)">
              <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
            </button>
          </div>
        </div>

        <p v-if="error" class="text-[13px]" style="color: var(--color-danger)">
          <i class="fa-solid fa-circle-exclamation mr-1"></i>{{ error }}
        </p>

        <button @click="handleLogin" :disabled="loading"
                class="w-full py-2.5 rounded-lg font-medium text-[14px] bg-blue-500 text-white hover:bg-primary-hover transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          <i v-if="loading" class="fa-solid fa-spinner fa-spin"></i>
          <i v-else class="fa-solid fa-arrow-right-to-bracket"></i>
          {{ loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ' }}
        </button>
      </div>

      <p class="text-center text-[11px] mt-6" style="color: var(--color-text-muted)">
        ระบบจัดการคลังสินค้าเหมืองแร่  v1.0.0
      </p>
    </div>
  </div>
</template>
