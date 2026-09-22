<script setup>
import { computed, ref } from 'vue'
import CampusMap from '../components/CampusMap.vue'
import Building3D from '../components/Building3D.vue'
import CampusPlanMap from '../components/CampusPlanMap.vue'
import emblemUrl from '../assets/hhu-emblem.svg'

// 支持 URL #3d / #plan 直达对应视图
const initialHash = window.location.hash.replace('#', '').toLowerCase()

const mode = ref(initialHash === '3d' ? '3d' : initialHash === 'plan' ? 'plan' : 'map')
const zoom = ref(initialHash === '3d' ? 18 : 11)

const modeMeta = {
  map: { badge: '地图态', title: '能源楼 3D 总览', sub: '河海大学 · 三校区分布与能源楼运行示例' },
  '3d': { badge: '3D 态', title: '能源楼 3D 总览', sub: '河海大学 · 能源楼 3D 楼宇运行示例' },
  plan: { badge: '平面态', title: '江宁校区 · 平面功率监测', sub: '河海大学江宁校区 · 10kV 高压功率示例数据' }
}
const meta = computed(() => modeMeta[mode.value])

function syncHash(value) {
  const next = `${window.location.pathname}${window.location.search}${value}`
  window.history.replaceState(null, '', next)
}

function enter3d() {
  mode.value = '3d'
  syncHash('#3d')
}

function enterPlan() {
  mode.value = 'plan'
  syncHash('#plan')
}

function backToMap() {
  mode.value = 'map'
  syncHash('')
}
</script>

<template>
  <div class="eb-root">
    <header class="eb-topbar">
      <div class="eb-brand">
        <img class="eb-logo" :src="emblemUrl" alt="河海大学校徽" />
        <div class="eb-brand-text">
          <h1 class="eb-title">{{ meta.title }}</h1>
          <p class="eb-sub">{{ meta.sub }}</p>
        </div>
      </div>

      <div class="eb-status">
        <span class="eb-badge" :class="`is-${mode}`">{{ meta.badge }}</span>
        <span v-if="mode !== 'plan'" class="eb-zoom">
          <span class="eb-zoom-label">缩放级别</span>
          <b class="eb-zoom-value">z{{ zoom }}</b>
        </span>
      </div>
    </header>

    <main class="eb-stage">
      <CampusMap v-if="mode === 'map'" @enter3d="enter3d" @enter-plan="enterPlan" @zoom="zoom = $event" />
      <CampusPlanMap v-else-if="mode === 'plan'" @back="backToMap" />
      <Building3D v-else @back="backToMap" />
    </main>
  </div>
</template>

<style scoped>
.eb-root {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--txt);
}

.eb-topbar {
  flex: none;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 22px;
  background: linear-gradient(180deg, rgba(10,20,35,.98), rgba(6,15,25,.95));
  border-bottom: 1px solid rgba(0,212,255,0.3);
  box-shadow: 0 2px 20px rgba(0,212,255,0.15);
  backdrop-filter: blur(6px);
  z-index: 1000;
}

.eb-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.eb-logo {
  width: 38px; height: 38px; flex: none;
  filter: drop-shadow(0 4px 8px rgba(11,32,56,.32));
}
.eb-brand-text { min-width: 0; }
.eb-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .06em;
  color: #00e5ff;
  white-space: nowrap;
  text-shadow: 0 0 10px rgba(0,229,255,0.5);
}
.eb-sub {
  font-size: 11px;
  letter-spacing: .08em;
  color: rgba(0,212,255,0.7);
  white-space: nowrap;
}

.eb-status { display: flex; align-items: center; gap: 12px; flex: none; }
.eb-badge {
  padding: 4px 11px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: .1em;
  border-radius: 999px;
  border: 1px solid transparent;
}
.eb-badge.is-map {
  color: #00e5ff;
  background: rgba(0,212,255,0.1);
  border-color: rgba(0,212,255,0.5);
  box-shadow: 0 0 10px rgba(0,212,255,0.3);
}
.eb-badge.is-3d,
.eb-badge.is-plan {
  color: #00e5ff;
  background: linear-gradient(135deg, #0A1A2E, #061220);
  border-color: rgba(0,212,255,0.6);
  box-shadow: 0 0 15px rgba(0,212,255,0.4);
}
.eb-zoom {
  display: flex; align-items: baseline; gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(10,20,35,0.8);
  border: 1px solid rgba(0,212,255,0.4);
  box-shadow: 0 0 10px rgba(0,212,255,0.2);
}
.eb-zoom-label { font-size: 10.5px; letter-spacing: .1em; color: rgba(0,212,255,0.7); }
.eb-zoom-value {
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 700;
  color: #00e5ff;
  text-shadow: 0 0 8px rgba(0,229,255,0.5);
  letter-spacing: .04em;
}

.eb-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

@media (max-width: 720px) {
  .eb-sub { display: none; }
  .eb-zoom-label { display: none; }
}
</style>