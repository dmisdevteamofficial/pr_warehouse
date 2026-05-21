<script setup>
const props = defineProps({
  icon: [String, Object, Function],
  label: String,
  danger: {
    type: Boolean,
    default: false
  },
  active: {
    type: Boolean,
    default: false
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  badge: {
    type: Number,
    default: null
  }
})
</script>

<template>
  <li
    :class="[
      'relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
      active && !danger
        ? 'bg-blue-50 dark:bg-blue-500/30 text-primary-DEFAULT border-l-[3px] border-blue-600 dark:border-blue-500 pl-[9px]'
        : danger
          ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
    ]"
  >
    <i v-if="typeof props.icon === 'string'" class="fa-solid w-5 text-center" :class="props.icon"></i>
    <component v-else :is="props.icon" class="w-5 h-5 flex-shrink-0" />
    <span v-if="!collapsed" class="text-sm font-medium whitespace-nowrap transition-all duration-300">
      {{ label }}
    </span>
    <span
      v-if="badge && !collapsed"
      class="ml-auto bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center"
    >
      {{ badge }}
    </span>
    <span v-if="badge && collapsed" class="absolute top-1 right-1 bg-blue-500 text-white text-xs rounded-full w-3 h-3" />
  </li>
</template>
