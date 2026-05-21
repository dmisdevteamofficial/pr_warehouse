<script setup>
import UserAppToolbar from '@/components/layout/UserAppToolbar.vue'
import InspectionForm from './InspectionForm.vue'
</script>

<template>
  <UserAppToolbar>
    <div class="h-full p-4 overflow-hidden">
      <InspectionForm />
    </div>
  </UserAppToolbar>
</template>
