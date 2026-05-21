<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ProfileEditSidebar from '@/components/layout/ProfileEditSidebar.vue'

const auth = useAuthStore()
const router = useRouter()
const isOpen = ref(false)
const showConfirmLogout = ref(false)
const showEditProfile = ref(false)
const profileImg = ref('')
const switchOpen = ref(false)

// Load profile image from localStorage
function loadProfileImage() {
  if (auth.user) {
    profileImg.value = localStorage.getItem(`profile_img_${auth.user.id}`) || ''
  }
}

onMounted(() => {
  loadProfileImage()
})

const fullname = computed(() => auth.user?.fullname || '-')
const empCode = computed(() => auth.user?.emp_code || '')
const username = computed(() => auth.user?.username || '')
const position = computed(() => auth.user?.position || 'Staff')
const department = computed(() => auth.user?.department || '-')

function toggleDropdown() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    loadProfileImage()
    switchOpen.value = false
  }
}

function handleLogout() {
  isOpen.value = false
  showConfirmLogout.value = true
}

function confirmLogout() {
  showConfirmLogout.value = false
  auth.logout()
}

function openEditProfile() {
  isOpen.value = false
  switchOpen.value = false
  showEditProfile.value = true
}

function toggleSwitch() {
  switchOpen.value = !switchOpen.value
}

function goToPrSystem() {
  isOpen.value = false
  switchOpen.value = false
  router.push('/pr/admin')
}

function onProfileUpdated() {
  loadProfileImage()
}
</script>

<template>
  <div class="relative">
    <!-- Profile Button -->
    <button @click="toggleDropdown"
            class="hidden sm:flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-full border transition-all hover:shadow-md"
            style="border-color: var(--color-border); background: var(--color-bg-card)">
      <div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-white grid place-items-center text-[12px] font-bold overflow-hidden">
        <img v-if="profileImg" :src="profileImg" class="w-full h-full object-cover" />
        <span v-else>{{ fullname.charAt(0) }}</span>
      </div>
      <div class="hidden sm:block text-left leading-4">
        <div class="text-[12px] font-semibold" style="color: var(--color-text-primary)">{{ fullname }}</div>
        <div class="text-[10px]" style="color: var(--color-text-muted)">{{ empCode }}</div>
      </div>
      <i class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200" 
         :class="{ 'rotate-180': isOpen }"
         style="color: var(--color-text-muted)"></i>
    </button>

    <!-- Dropdown Modal Card -->
    <transition name="dropdown">
      <div v-if="isOpen" 
           class="absolute right-0 top-full mt-3 w-72 rounded-2xl shadow-2xl border z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
           style="background: var(--color-bg-card); border-color: var(--color-border)">
        
        <!-- User Info Header -->
        <div class="px-5 py-6 text-center">
          <div class="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 p-1 mb-3">
            <div class="w-full h-full rounded-full bg-white dark:bg-slate-800 flex items-center justify-center overflow-hidden">
              <img v-if="profileImg" :src="profileImg" class="w-full h-full object-cover" />
              <span v-else class="text-2xl font-bold bg-gradient-to-br from-blue-500 to-indigo-500 bg-clip-text text-transparent">
                {{ fullname.charAt(0) }}
              </span>
            </div>
          </div>
          <h3 class="text-[15px] font-bold" style="color: var(--color-text-primary)">{{ fullname }}</h3>
          <p class="text-[12px] mb-1" style="color: var(--color-text-muted)">{{ empCode }} ({{ username }})</p>
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">
            <i class="fa-solid fa-briefcase"></i>
            {{ position }}
          </div>
          <div class="text-[10px] mt-1" style="color: var(--color-text-muted)">( {{ department }} )</div>
        </div>

        <hr style="border-color: var(--color-border)" />

        <!-- Menu Actions -->
        <div class="p-2">
          <button @click="openEditProfile"
                  class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50 text-left"
                  style="color: var(--color-text-secondary)">
            <div class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
              <i class="fa-solid fa-user-pen text-blue-500"></i>
            </div>
            แก้ไขข้อมูลโปรไฟล์
          </button>

          <div v-if="auth.user?.role === 'super_admin'">
            <button
              type="button"
              @click="toggleSwitch"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50 text-left"
              style="color: var(--color-text-secondary)"
            >
              <div class="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                <i class="fa-solid fa-right-left text-purple-600 dark:text-purple-300"></i>
              </div>
              สลับระบบ
              <i
                class="fa-solid fa-chevron-down text-[10px] ml-auto transition-transform duration-200"
                :class="{ 'rotate-180': switchOpen }"
                style="color: var(--color-text-muted)"
              ></i>
            </button>

            <div v-if="switchOpen" class="px-4 pb-2">
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50 text-left"
                style="color: var(--color-text-secondary)"
                @click="goToPrSystem"
              >
                <div class="w-7 h-7 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <i class="fa-solid fa-file-circle-check text-purple-600 dark:text-purple-300"></i>
                </div>
                ไป ระบบ PR
              </button>
            </div>
          </div>
          
          <button @click="handleLogout"
                  class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/10 text-left text-red-600">
            <div class="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <i class="fa-solid fa-right-from-bracket"></i>
            </div>
            ออกจากระบบ
          </button>
        </div>

        <div class="px-5 py-3 border-t text-center text-[10px]"
             style="border-color: var(--color-border); color: var(--color-text-muted)">
          เข้าสู่ระบบเมื่อ: {{ new Date().toLocaleDateString('th-TH') }}
        </div>
      </div>
    </transition>

    <!-- Backdrop for Dropdown -->
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="isOpen = false" />
  </div>

  <!-- Logout Confirmation -->
  <ConfirmDialog 
    :show="showConfirmLogout"
    title="ออกจากระบบ"
    message="คุณต้องการออกจากระบบใช่หรือไม่?"
    confirmText="ใช่, ออกจากระบบ"
    cancelText="ยกเลิก"
    type="danger"
    @confirm="confirmLogout"
    @cancel="showConfirmLogout = false"
  />

  <!-- Edit Profile Sidebar -->
  <ProfileEditSidebar 
    :show="showEditProfile"
    @close="showEditProfile = false"
    @updated="onProfileUpdated"
  />
</template>

<style scoped>
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.2s ease-out; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-10px); }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide-in-from-top-2 { from { transform: translateY(-0.5rem); } to { transform: translateY(0); } }

.animate-in { animation-duration: 0.2s; animation-timing-function: ease-out; animation-fill-mode: both; }
.fade-in { animation-name: fade-in; }
.slide-in-from-top-2 { animation-name: slide-in-from-top-2; }
</style>
