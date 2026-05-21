<script setup>
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { supabase } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['close', 'updated'])

const auth = useAuthStore()
const ui = useUiStore()
const loading = ref(false)

// Form data
const formData = ref({
  fullname: '',
  username: '',
  profileImage: ''
})

// Password data
const showPasswordFields = ref(false)
const passwordData = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// Image menu
const showImageMenu = ref(false)

// Initialize form data
function initForm() {
  if (auth.user) {
    formData.value.fullname = auth.user.fullname || ''
    formData.value.username = auth.user.username || ''
    // Get profile image from localStorage
    formData.value.profileImage = localStorage.getItem(`profile_img_${auth.user.id}`) || ''
  }
  // Reset states
  showPasswordFields.value = false
  showImageMenu.value = false
  passwordData.value = {
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  }
}

watch(() => props.show, (newVal) => {
  if (newVal) initForm()
})

onMounted(() => {
  initForm()
})

// Handle image upload
function handleImageUpload(e) {
  const file = e.target.files[0]
  if (!file) return

  if (file.size > 2 * 1024 * 1024) {
    ui.showToast('รูปภาพต้องมีขนาดไม่เกิน 2MB', 'error')
    return
  }

  const reader = new FileReader()
  reader.onload = (event) => {
    formData.value.profileImage = event.target.result
    localStorage.setItem(`profile_img_${auth.user.id}`, event.target.result)
    showImageMenu.value = false
  }
  reader.readAsDataURL(file)
}

// Handle image delete
function deleteProfileImage() {
  formData.value.profileImage = ''
  localStorage.removeItem(`profile_img_${auth.user.id}`)
  showImageMenu.value = false
  ui.showToast('ลบรูปภาพโปรไฟล์เรียบร้อยแล้ว', 'success')
}

// Save profile
async function saveProfile() {
  loading.value = true

  try {
    // 1. Password validation if requested
    let updatedPasswordHash = null
    if (showPasswordFields.value) {
      if (!passwordData.value.oldPassword || !passwordData.value.newPassword || !passwordData.value.confirmPassword) {
        throw new Error('กรุณากรอกข้อมูลรหัสผ่านให้ครบถ้วน')
      }

      // Check if new passwords match
      if (passwordData.value.newPassword !== passwordData.value.confirmPassword) {
        throw new Error('รหัสผ่านใหม่ไม่ตรงกัน')
      }

      // Check new password length
      if (passwordData.value.newPassword.length < 4) {
        throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร')
      }

      // Verify old password with database
      const { data: userData, error: userError } = await supabase
        .from('system_users')
        .select('password_hash')
        .eq('id', auth.user.id)
        .single()
      
      if (userError || !userData) throw new Error('ไม่พบข้อมูลผู้ใช้งาน')

      const isMatch = await bcrypt.compare(passwordData.value.oldPassword, userData.password_hash)
      if (!isMatch) {
        throw new Error('รหัสผ่านเดิมไม่ถูกต้อง')
      }

      // Hash new password
      updatedPasswordHash = await bcrypt.hash(passwordData.value.newPassword, 10)
    }

    // 2. Prepare update data
    const updatePayload = {
      fullname: formData.value.fullname,
      username: formData.value.username,
      updated_at: new Date().toISOString()
    }

    if (updatedPasswordHash) {
      updatePayload.password_hash = updatedPasswordHash
    }

    // 3. Update database
    const { error } = await supabase
      .from('system_users')
      .update(updatePayload)
      .eq('id', auth.user.id)

    if (error) throw error

    // Update local session
    const updatedUser = { ...auth.user, fullname: formData.value.fullname, username: formData.value.username }
    auth.user = updatedUser
    localStorage.setItem('mwm_session', JSON.stringify(updatedUser))

    ui.showToast('บันทึกข้อมูลเรียบร้อยแล้ว', 'success')
    emit('updated')
    
    // Reset password fields if updated
    if (updatedPasswordHash) {
      showPasswordFields.value = false
      passwordData.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    }

    // Auto close after 1s
    setTimeout(() => {
      emit('close')
    }, 1000)
  } catch (err) {
    ui.showToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <transition name="slide">
    <div v-if="show" class="fixed inset-0 z-[100] flex justify-end">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')"></div>
      
      <!-- Sidebar Content -->
      <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col animate-slide-in"
           style="background: var(--color-bg-card)">
        
        <!-- Header -->
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <div>
            <h2 class="text-[16px] font-bold" style="color: var(--color-text-primary)">แก้ไขข้อมูลโปรไฟล์</h2>
            <p class="text-[12px]" style="color: var(--color-text-muted)">จัดการข้อมูลส่วนตัวของคุณ</p>
          </div>
          <button @click="emit('close')" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
            <i class="fa-solid fa-xmark text-lg" style="color: var(--color-text-muted)"></i>
          </button>
        </div>

        <!-- Form Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <!-- Profile Image -->
          <div class="flex flex-col items-center">
            <div class="relative">
              <div class="w-24 h-24 rounded-full border-4 border-blue-500/20 overflow-hidden bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                <img v-if="formData.profileImage" :src="formData.profileImage" class="w-full h-full object-cover" />
                <span v-else class="text-3xl font-bold text-blue-500">{{ formData.fullname.charAt(0) }}</span>
              </div>
              
              <!-- Camera Button to Toggle Menu -->
              <button @click="showImageMenu = !showImageMenu" 
                      class="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg hover:bg-blue-700 transition-colors z-10">
                <i class="fa-solid fa-camera text-[12px]"></i>
              </button>

              <!-- Image Menu Overlay -->
              <transition name="dropdown-pop">
                <div v-if="showImageMenu" 
                     class="absolute top-0 left-full ml-25 w-40 rounded-xl border bg-white dark:bg-slate-800 shadow-2xl z-20 overflow-hidden animate-in fade-in zoom-in duration-200"
                     style="border-color: var(--color-border)">
                  <div class="p-1">
                    <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                           style="color: var(--color-text-primary)">
                      <div class="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                        <i class="fa-solid fa-cloud-arrow-up text-blue-600"></i>
                      </div>
                      อัปโหลดรูปภาพ
                      <input type="file" class="hidden" accept="image/*" @change="handleImageUpload" />
                    </label>
                    
                    <button @click="deleteProfileImage" 
                            :disabled="!formData.profileImage"
                            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            :class="formData.profileImage ? 'hover:bg-red-50 dark:hover:bg-red-900/10 text-red-600' : 'text-gray-400'">
                      <div class="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                        <i class="fa-solid fa-trash-can"></i>
                      </div>
                      ลบรูปภาพ
                    </button>
                  </div>
                </div>
              </transition>
              
              <!-- Backdrop for Image Menu -->
              <div v-if="showImageMenu" class="fixed inset-0 z-0" @click="showImageMenu = false"></div>
            </div>
            <p class="text-[11px] mt-2" style="color: var(--color-text-muted)">จัดการรูปภาพโปรไฟล์ของคุณ</p>
          </div>

          <!-- Input Fields -->
          <div class="space-y-4">
            <div class="space-y-1.5">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ชื่อ-นามสกุล</label>
              <div class="relative">
                <i class="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
                <input v-model="formData.fullname" type="text" disabled
                       class="w-full pl-10 pr-4 py-2.5 rounded-xl border text-[14px] cursor-not-allowed"
                       style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)"
                       placeholder="กรอกชื่อ-นามสกุล"  />
              </div>
            </div>

            <div class="space-y-1.5">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ชื่อผู้ใช้งาน (Username)</label>
              <div class="relative">
                <i class="fa-solid fa-at absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
                <input v-model="formData.username" type="text" 
                       class="w-full pl-10 pr-4 py-2.5 rounded-xl border text-[14px] outline-none focus:border-blue-500 transition-colors"
                       style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)"
                       placeholder="กรอกชื่อผู้ใช้งาน" />
              </div>
            </div>

            <div class="space-y-1.5 opacity-60">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">รหัสพนักงาน (ไม่สามารถแก้ไขได้)</label>
              <div class="relative">
                <i class="fa-solid fa-id-card absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
                <input :value="auth.user?.emp_code" type="text" disabled
                       class="w-full pl-10 pr-4 py-2.5 rounded-xl border text-[14px] cursor-not-allowed"
                       style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)" />
              </div>
            </div>
            <div class="space-y-1.5 pt-2">
              <button v-if="!showPasswordFields" 
                      @click="showPasswordFields = true"
                      class="text-[13px] font-bold hover:underline text-blue-600 dark:text-blue-400 flex items-center gap-2">
                <i class="fa-solid fa-key"></i>
                แก้ไขรหัสผ่าน?
              </button>

              <div v-else class="space-y-4 p-4 rounded-2xl border bg-gray-50/50 dark:bg-slate-800/50" style="border-color: var(--color-border)">
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-[13px] font-bold" style="color: var(--color-text-primary)">เปลี่ยนรหัสผ่าน</h3>
                  <button @click="showPasswordFields = false" class="text-[11px] text-red-500 hover:underline">ยกเลิก</button>
                </div>

                <div class="space-y-3">
                  <div class="space-y-1">
                    <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">รหัสผ่านเดิม</label>
                    <div class="relative">
                      <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
                      <input v-model="passwordData.oldPassword" type="password" 
                             class="w-full pl-9 pr-4 py-2 rounded-xl border text-[13px] outline-none focus:border-blue-500 transition-colors"
                             style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)"
                             placeholder="กรอกรหัสผ่านเดิม" />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">รหัสผ่านใหม่</label>
                    <div class="relative">
                      <i class="fa-solid fa-shield-halved absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
                      <input v-model="passwordData.newPassword" type="password" 
                             class="w-full pl-9 pr-4 py-2 rounded-xl border text-[13px] outline-none focus:border-blue-500 transition-colors"
                             style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)"
                             placeholder="กรอกรหัสผ่านใหม่ (4 ตัวขึ้นไป)" />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">ยืนยันรหัสผ่านใหม่</label>
                    <div class="relative">
                      <i class="fa-solid fa-circle-check absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
                      <input v-model="passwordData.confirmPassword" type="password" 
                             class="w-full pl-9 pr-4 py-2 rounded-xl border text-[13px] outline-none focus:border-blue-500 transition-colors"
                             style="background: var(--color-bg-input); border-color: var(--color-border); color: var(--color-text-primary)"
                             placeholder="ยืนยันรหัสผ่านใหม่อีกครั้ง" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="p-6 border-t" style="border-color: var(--color-border)">
          <button @click="saveProfile" :disabled="loading"
                  class="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-[14px] shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
            <i v-if="loading" class="fa-solid fa-spinner fa-spin"></i>
            {{ loading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: all 0.3s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; }
.slide-enter-from .animate-slide-in { transform: translateX(100%); }
.slide-leave-to .animate-slide-in { transform: translateX(100%); }

.animate-slide-in { transition: transform 0.3s ease-out; }

/* Dropdown Pop Animation */
.dropdown-pop-enter-active,
.dropdown-pop-leave-active { transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
.dropdown-pop-enter-from,
.dropdown-pop-leave-to { opacity: 0; transform: scale(0.95) translateX(-10px); }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes zoom-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.animate-in { animation-duration: 0.2s; animation-timing-function: ease-out; animation-fill-mode: both; }
.fade-in { animation-name: fade-in; }
.zoom-in { animation-name: zoom-in; }
</style>
