<script setup>
import { ref } from 'vue'
import CampusMap from '../components/CampusMap.vue'
import Building3D from '../components/Building3D.vue'
import emblemUrl from '../assets/hhu-emblem.svg'

// 支持 URL #3d 直达 3D 态
const initialHash = window.location.hash.replace('#', '').toLowerCase()

const mode = ref(initialHash === '3d' ? '3d' : 'map')
const zoom = ref(initialHash === '3d' ? 18 : 11)

function syncHash(value) {
  const next = `${window.location.pathname}${window.location.search}${value}`
  window.history.replaceState(null, '', next)
}

function enter3d() {
  mode.value = '3d'
  syncHash('#3d')
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
          <h1 class="eb-title">能源楼 3D 总览</h1>
          <p class="eb-sub">河海大学 · 三校区分布与能源楼运行示例</p>
        </div>
      </div>

      <div class="eb-status">
        <span class="eb-badge" :class="mode === 'map' ? 'is-map' : 'is-3d'">
          {{ mode === 'map' ? '地图态' : '3D 态' }}
        </span>
        <span class="eb-zoom">
          <span class="eb-zoom-label">缩放级别</span>
          <b class="eb-zoom-value">z{{ zoom }}</b>
        </span>
      </div>
    </header>

    <main class="eb-stage">
      <CampusMap v-if="mode === 'map'" @enter3d="enter3d" @zoom="zoom = $event" />
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
  background: linear-gradient(180deg, rgba(11, 26, 44, .96), rgba(8, 19, 34, .94));
  border-bottom: 1px solid rgba(94, 170, 216, .22);
  box-shadow: 0 2px 16px rgba(2, 10, 22, .55);
  backdrop-filter: blur(8px);
  z-index: 1000;
}

.eb-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.eb-logo {
  width: 38px; height: 38px; flex: none;
  filter: drop-shadow(0 4px 8px rgba(3, 12, 24, .6)) drop-shadow(0 0 10px rgba(70, 168, 214, .35));
}
.eb-brand-text { min-width: 0; }
.eb-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .06em;
  color: var(--txt);
  white-space: nowrap;
}
.eb-sub {
  font-size: 11px;
  letter-spacing: .08em;
  color: var(--txt-dim);
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
  color: #9BDDF8;
  background: rgba(70, 168, 214, .14);
  border-color: rgba(70, 168, 214, .5);
}
.eb-badge.is-3d {
  color: #EAF6FF;
  background: linear-gradient(135deg, #1B3E5E, #102637);
  border-color: rgba(143,216,247,.4);
}
.eb-zoom {
  display: flex; align-items: baseline; gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(13, 32, 50, .7);
  border: 1px solid var(--line);
}
.eb-zoom-label { font-size: 10.5px; letter-spacing: .1em; color: var(--txt-dim); }
.eb-zoom-value {
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
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