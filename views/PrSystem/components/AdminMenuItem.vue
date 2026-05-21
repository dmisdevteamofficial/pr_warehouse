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
  },
  isStep: {
    type: Boolean,
    default: false
  },
  isFirstStep: {
    type: Boolean,
    default: false
  },
  isLastStep: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <li
    :class="[
      'relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
      active && !danger
        ? isStep 
          ? 'bg-blue-50/50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' 
          : 'bg-blue-50 dark:bg-blue-500/30 text-primary-DEFAULT border-l-[3px] border-blue-600 dark:border-blue-500 pl-[9px]'
        : danger
          ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
    ]"
  >
    <!-- Step Indicator -->
    <div v-if="isStep && !collapsed" class="relative flex flex-col items-center justify-center w-5 h-full">
      <!-- Top Line -->
      <div 
        v-if="!isFirstStep" 
        class="absolute top-0 w-[2px] h-1/2 bg-gray-200 dark:bg-gray-800"
        :class="{ 'bg-blue-500/50': active }"
      ></div>
      <!-- Bottom Line -->
      <div 
        v-if="!isLastStep" 
        class="absolute bottom-0 w-[2px] h-1/2 bg-gray-200 dark:bg-gray-800"
        :class="{ 'bg-blue-500/50': active }"
      ></div>
      <!-- Circle -->
      <div 
        :class="[
          'relative z-10 w-2.5 h-2.5 rounded-full border-2 transition-all duration-300',
          active 
            ? 'bg-blue-600 border-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.5)]' 
            : 'bg-white dark:bg-gray-950 border-gray-300 dark:border-gray-600'
        ]"
      ></div>
    </div>

    <template v-else>
      <i v-if="typeof props.icon === 'string'" class="fa-solid w-5 text-center" :class="props.icon"></i>
      <component v-else :is="props.icon" class="w-5 h-5 flex-shrink-0" />
    </template>

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
