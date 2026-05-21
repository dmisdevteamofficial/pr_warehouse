<script setup>
defineProps({
  label: String,
  collapsed: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <div class="mb-4">
    <p
      v-if="!collapsed"
      class="text-xs text-gray-500 dark:text-gray-600 uppercase font-semibold px-3 mb-2 tracking-widest"
    >
      {{ label }}
    </p>
    <ul class="space-y-1">
      <slot />
    </ul>
  </div>
</template>
