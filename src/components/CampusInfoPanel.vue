<script setup>
import { DATA_NOTE } from '../data/campus'

defineProps({
  title: { type: String, required: true },
  tone: { type: String, default: 'blue' },
  rows: { type: Array, default: () => [] },
  note: { type: String, default: DATA_NOTE }
})

const emit = defineEmits(['close'])
</script>

<template>
  <aside class="info-panel" :class="`is-${tone}`">
    <header class="info-head">
      <span class="info-dot" aria-hidden="true"></span>
      <h3 class="info-title">{{ title }}</h3>
      <button class="info-close" type="button" aria-label="关闭信息面板" @click="emit('close')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18"/>
        </svg>
      </button>
    </header>

    <ul class="info-rows">
      <li v-for="row in rows" :key="row.label" class="info-row">
        <span class="info-label">{{ row.label }}</span>
        <span class="info-value" :class="row.state ? `is-${row.state}` : ''">{{ row.value }}</span>
      </li>
    </ul>

    <p class="info-note">{{ note }}</p>
  </aside>
</template>

<style scoped>
.info-panel {
  position: absolute;
  right: 26px;
  bottom: 26px;
  z-index: 820;
  width: 268px;
  padding: 14px 16px 12px;
  color: #E8F1F8;
  background: linear-gradient(160deg, rgba(22,41,63,.96), rgba(11,24,38,.96));
  border: 1px solid var(--tone-border);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(4,12,22,.55), 0 0 24px var(--tone-glow);
  backdrop-filter: blur(8px);
  animation: panelIn .34s cubic-bezier(.22,1.3,.44,1) both;
}
.info-panel.is-blue { --tone: #46A8D6; --tone-border: rgba(70,168,214,.55); --tone-glow: rgba(70,168,214,.22); }
.info-panel.is-green { --tone: #5BC98C; --tone-border: rgba(91,201,140,.55); --tone-glow: rgba(91,201,140,.22); }
.info-panel.is-amber { --tone: #E0B04C; --tone-border: rgba(224,176,76,.55); --tone-glow: rgba(224,176,76,.22); }
.info-panel.is-red { --tone: #E3706B; --tone-border: rgba(227,112,107,.55); --tone-glow: rgba(227,112,107,.22); }

.info-head {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 9px;
  border-bottom: 1px solid rgba(143,216,247,.16);
}
.info-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 10px var(--tone);
}
.info-title {
  flex: 1;
  font-size: 13.5px; font-weight: 600; letter-spacing: .04em;
  color: #F2F9FF;
}
.info-close {
  display: flex; padding: 3px;
  color: #7FA6C0; cursor: pointer;
  background: none; border: none;
  transition: color .16s;
}
.info-close:hover { color: #8FD8F7; }

.info-rows { margin: 8px 0 0; padding: 0; list-style: none; }
.info-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 5px 0;
  font-size: 12.5px;
}
.info-row + .info-row { border-top: 1px dashed rgba(143,216,247,.12); }
.info-label { color: #7FA6C0; }
.info-value { color: #DCEAF5; text-align: right; }
.info-value.is-ok { color: #6FD39B; }
.info-value.is-warn { color: #E8B85C; }

.info-note {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(143,216,247,.16);
  font-size: 11px;
  letter-spacing: .06em;
  color: #6D8CA6;
  text-align: center;
}

@keyframes panelIn {
  from { opacity: 0; transform: translateY(14px) scale(.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .info-panel { animation: none !important; }
}
</style>