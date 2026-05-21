<script setup>
defineProps({
  title: String,
  value: Number,
  unit: String,
  icon: String,
  trend: String,
  trendType: String,
  accentColor: String,
})
</script>

<template>
  <div class="rounded-xl border p-4 flex items-start gap-4"
       :style="`background: var(--color-bg-card); border-color: var(--color-border); border-left: 4px solid ${accentColor}`">
    <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
         :style="`background: ${accentColor}18`">
      <i :class="`fa-solid ${icon} text-[16px]`" :style="`color: ${accentColor}`"></i>
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-[12px]" style="color: var(--color-text-muted)">{{ title }}</p>
      <p class="text-[22px] font-semibold leading-tight mt-0.5" style="color: var(--color-text-primary)">
        {{ value.toLocaleString() }}
        <span class="text-[13px] font-normal" style="color: var(--color-text-muted)">{{ unit }}</span>
      </p>
      <p class="text-[12px] mt-1 flex items-center gap-1">
        <i :class="trendType === 'up' ? 'fa-solid fa-arrow-up' : trendType === 'down' ? 'fa-solid fa-arrow-down' : 'fa-solid fa-minus'"
           :style="trendType === 'up' ? 'color: var(--color-success)' : trendType === 'down' ? 'color: var(--color-danger)' : 'color: var(--color-text-muted)'"></i>
        <span :style="trendType === 'up' ? 'color: var(--color-success)' : trendType === 'down' ? 'color: var(--color-danger)' : 'color: var(--color-text-muted)'">
          {{ trend }}
        </span>
      </p>
    </div>
  </div>
</template>
