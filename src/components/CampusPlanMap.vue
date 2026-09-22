<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  JIANGNING_BUILDINGS,
  buildingPowerSummary,
  buildingSeries,
  HV_INFO,
  DATA_NOTE
} from '../data/campus'
import mapImg from '../assets/江宁校园地图.jpg'

const emit = defineEmits(['back'])

// 10kV 中心站主接线 Topo：跳转（iframe 弹窗）到配网仿真系统
// 与 Building3D.vue 中 EMBED_URL 同一地址，校区参数改为江宁校区
const TOPO_URL = `http://localhost:5173/?campus=${encodeURIComponent('南京-河海大学-江宁校区')}`
const showTopo = ref(false)
const topoLoading = ref(false)
function openTopo() {
  showTopo.value = true
  topoLoading.value = true
}
function closeTopo() {
  showTopo.value = false
  topoLoading.value = false
}

// ---------- 选中楼宇与功率总览 ----------
const selected = ref(null)
const summary = computed(() => (selected.value ? buildingPowerSummary(selected.value) : null))

// ---------- 曲线范围 ----------
const toInput = (d) => {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const now = new Date()
const todayStr = toInput(now)
const range = reactive({
  type: '30', // today | 7 | 30 | custom
  start: toInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)),
  end: todayStr
})
const RANGE_TABS = [
  { id: 'today', label: '今日' },
  { id: '7', label: '近 7 日' },
  { id: '30', label: '近 30 日' },
  { id: 'custom', label: '自定义' }
]
function setRange(type) {
  range.type = type
  if (type === '7') {
    range.start = toInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
    range.end = todayStr
  } else if (type === '30') {
    range.start = toInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
    range.end = todayStr
  }
}
function onDateInput() {
  range.type = 'custom'
  if (range.start > range.end) range.end = range.start
}

const series = computed(() => {
  if (!selected.value) return []
  if (range.type === 'today') return buildingSeries(selected.value, 'today')
  const s = new Date(`${range.start}T00:00:00`)
  const e = new Date(`${range.end}T00:00:00`)
  return buildingSeries(selected.value, 'day', s, e)
})

const seriesMeta = computed(() => {
  const pts = series.value
  if (!pts.length) return null
  const vs = pts.map((p) => p.v)
  const max = Math.max(...vs)
  const min = Math.min(...vs)
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length
  return { max, min, avg }
})

// ---------- SVG 曲线几何 ----------
const PW = 600
const PH = 190
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * p
}
const chart = computed(() => {
  const pts = series.value
  const n = pts.length
  if (!n) return null
  const rawMax = Math.max(...pts.map((p) => p.v), 1)
  const yMax = niceCeil(rawMax * 1.12)
  const xAt = (i) => (n <= 1 ? PW / 2 : (i / (n - 1)) * PW)
  const yAt = (v) => PH - (v / yMax) * PH
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${xAt(n - 1).toFixed(1)},${PH} L${xAt(0).toFixed(1)},${PH} Z`
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((r) => ({ y: PH - r * PH, value: yMax * r }))
  // x 轴稀疏刻度
  const want = n <= 7 ? n : 7
  const ticks = []
  for (let k = 0; k < want; k++) {
    const i = want === 1 ? 0 : Math.round((k / (want - 1)) * (n - 1))
    ticks.push({ i, x: xAt(i), label: pts[i].label })
  }
  return { line, area, gridY, ticks, yMax, xAt, yAt }
})

const hoverIdx = ref(-1)
function onChartMove(e) {
  const n = series.value.length
  if (!n || !chart.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  hoverIdx.value = n <= 1 ? 0 : Math.round(ratio * (n - 1))
}
function onChartLeave() { hoverIdx.value = -1 }
const hoverPoint = computed(() => {
  if (hoverIdx.value < 0 || !chart.value) return null
  const p = series.value[hoverIdx.value]
  return {
    p,
    left: chart.value.xAt(hoverIdx.value) / PW * 100,
    top: chart.value.yAt(p.v) / PH * 100
  }
})

const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))

function selectBuilding(b) {
  if (dragMoved.value) return
  selected.value = selected.value?.id === b.id ? null : b
  hoverIdx.value = -1
}
function closePanel() { selected.value = null }

// ---------- 平面图缩放 / 平移 ----------
const stageEl = ref(null)
const worldEl = ref(null)
const imgEl = ref(null)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const imgRatio = ref(1792 / 1241)
const base = reactive({ w: 0, h: 0 })
const stage = reactive({ w: 0, h: 0 })
const dragging = ref(false)
const dragMoved = ref(false)
let dragStart = null
let downOnImg = false

const worldStyle = computed(() => ({
  width: `${base.w}px`,
  height: `${base.h}px`,
  transform: `translate(-50%, -50%) translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`
}))

// Topo 按钮对齐底图实际渲染边缘（contain 居中，两侧可能有黑边）
const TOPO_GAP = 16
const topoStyle = computed(() => {
  if (stage.w <= 900) return { right: '12px', top: '14px' }
  const edgeLeft = Math.max(0, (stage.w - base.w) / 2) + TOPO_GAP
  const edgeTop = Math.max(0, (stage.h - base.h) / 2) + TOPO_GAP
  return { left: `${edgeLeft}px`, top: `${edgeTop}px` }
})

function recalcBase() {
  if (!stageEl.value) return
  const r = stageEl.value.getBoundingClientRect()
  stage.w = r.width
  stage.h = r.height
  const ar = imgRatio.value
  let w = stage.w
  let h = w / ar
  if (h > stage.h) { h = stage.h; w = h * ar }
  base.w = w
  base.h = h
  clampPan()
}
function clampPan() {
  const maxX = Math.max(0, (base.w * scale.value - stage.w) / 2)
  const maxY = Math.max(0, (base.h * scale.value - stage.h) / 2)
  tx.value = Math.min(maxX, Math.max(-maxX, tx.value))
  ty.value = Math.min(maxY, Math.max(-maxY, ty.value))
}
function zoomAt(factor, cx = 0, cy = 0) {
  const next = Math.min(3, Math.max(1, +(scale.value * factor).toFixed(3)))
  if (next === scale.value) return
  tx.value = (tx.value - cx) * (next / scale.value) + cx
  ty.value = (ty.value - cy) * (next / scale.value) + cy
  scale.value = next
  clampPan()
}
function onWheel(e) {
  e.preventDefault()
  const r = stageEl.value.getBoundingClientRect()
  const cx = e.clientX - r.left - r.width / 2
  const cy = e.clientY - r.top - r.height / 2
  zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, cx, cy)
}
function zoomCenter(f) { zoomAt(f) }
function resetView() { scale.value = 1; tx.value = 0; ty.value = 0 }

function onPointerDown(e) {
  if (e.button !== 0) return
  // 从楼宇光点按下时不拦截，交给 @click 处理
  if (e.target.closest && e.target.closest('.bmap-pin')) return
  dragging.value = true
  dragMoved.value = false
  downOnImg = e.target === imgEl.value
  dragStart = { x: e.clientX - tx.value, y: e.clientY - ty.value }
  stageEl.value.setPointerCapture(e.pointerId)
}
function onPointerMove(e) {
  if (!dragging.value) return
  const nx = e.clientX - dragStart.x
  const ny = e.clientY - dragStart.y
  if (Math.abs(nx - tx.value) > 4 || Math.abs(ny - ty.value) > 4) dragMoved.value = true
  tx.value = nx
  ty.value = ny
  clampPan()
}
function onPointerUp(e) {
  if (!dragging.value) return
  dragging.value = false
  try { stageEl.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  // 点击图片空白处收起面板（拖拽不收起）
  if (!dragMoved.value && downOnImg) selected.value = null
  window.setTimeout(() => { dragMoved.value = false }, 0)
}
function onImgLoad() {
  if (imgEl.value?.naturalWidth) imgRatio.value = imgEl.value.naturalWidth / imgEl.value.naturalHeight
  recalcBase()
}

let ro = null
function onKey(e) {
  if (e.key !== 'Escape') return
  if (showTopo.value) closeTopo()
  else closePanel()
}

onMounted(() => {
  recalcBase()
  ro = new ResizeObserver(recalcBase)
  ro.observe(stageEl.value)
  stageEl.value.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  stageEl.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="plan-root" :class="{ 'is-dragging': dragging }">
    <!-- 科技感 HUD 覆盖层（与能源楼 3D 同一青色体系） -->
    <div class="plan-hud" aria-hidden="true">
      <div class="hud-grid"></div>
      <div class="hud-scan"></div>
      <span class="hud-corner is-tl"></span>
      <span class="hud-corner is-tr"></span>
      <span class="hud-corner is-bl"></span>
      <span class="hud-corner is-br"></span>
    </div>

    <!-- 可拖拽 / 缩放的平面图舞台 -->
    <div
      ref="stageEl"
      class="plan-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="world-anchor">
        <div ref="worldEl" class="plan-world" :style="worldStyle">
          <img
            ref="imgEl"
            class="plan-img"
            :src="mapImg"
            alt="河海大学江宁校区总平面图"
            draggable="false"
            @load="onImgLoad"
          />
          <div class="img-wash" aria-hidden="true"></div>

          <!-- 楼宇高压功率监测点 -->
          <button
            v-for="b in JIANGNING_BUILDINGS"
            :key="b.id"
            type="button"
            class="bmap-pin"
            :class="{ 'is-active': selected?.id === b.id, 'is-dim': selected && selected.id !== b.id }"
            :style="{ left: b.x + '%', top: b.y + '%' }"
            @click.stop="selectBuilding(b)"
          >
            <span class="pin-core">
              <span class="pin-pulse"></span>
              <span class="pin-dot"></span>
            </span>
            <span class="pin-name">{{ b.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 左上：返回 -->
    <div class="plan-tl">
      <button class="back-btn" type="button" @click="emit('back')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7"/>
        </svg>
        返回校区地图
      </button>
    </div>

    <!-- 10kV 中心站主接线 Topo 入口（红线标注位置） -->
    <button class="topo-entry" type="button" :style="topoStyle" @click="openTopo">
      <span class="topo-entry-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="5" cy="6" r="2.2"/>
          <circle cx="5" cy="18" r="2.2"/>
          <circle cx="13" cy="12" r="2.2"/>
          <circle cx="19.5" cy="7" r="1.8"/>
          <circle cx="19.5" cy="17" r="1.8"/>
          <path d="M7.2 6.6L11 11M7.2 17.4L11 13M15.1 11l2.7-3M15.1 13l2.7 3"/>
        </svg>
      </span>
      <span class="topo-entry-text">
        <b>10kV 中心站主接线 Topo</b>
        <i>进入配网仿真系统</i>
      </span>
      <svg class="topo-entry-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 5l7 7-7 7"/>
      </svg>
    </button>

    <!-- 缩放控件 -->
    <div class="plan-zoom">
      <button type="button" aria-label="放大" @click="zoomCenter(1.25)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button type="button" aria-label="缩小" @click="zoomCenter(1 / 1.25)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>
      </button>
      <button type="button" class="zoom-reset" aria-label="复位视图" @click="resetView">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/></svg>
      </button>
    </div>

    <!-- 楼宇高压功率面板 -->
    <transition name="panel-slide">
      <aside v-if="selected && summary" class="power-panel">
        <header class="pp-head">
          <div class="pp-head-main">
            <span class="pp-dot"></span>
            <div>
              <h3 class="pp-name">{{ selected.name }}</h3>
              <p class="pp-station">{{ selected.station }}</p>
            </div>
          </div>
          <button class="pp-close" type="button" aria-label="关闭" @click="closePanel">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>

        <!-- 回路参数 -->
        <div class="pp-meta">
          <span>额定容量 <b>{{ selected.cap }} kVA</b></span>
          <span>电压 <b>{{ HV_INFO.voltage }} kV</b></span>
          <span>cosφ <b>{{ HV_INFO.cosPhi }}</b></span>
          <span>月均电流 <b>{{ fmt(summary.currentA) }} A</b></span>
        </div>

        <!-- 三段统计 -->
        <div class="pp-stat-grid">
          <div class="pp-stat">
            <p class="pp-stat-label">今日均值</p>
            <p class="pp-stat-value">{{ fmt(summary.today.avg) }} <i>kW</i></p>
            <p class="pp-stat-rows">
              <span>当前 <b>{{ fmt(summary.today.current) }}</b></span>
              <span>峰 <b>{{ fmt(summary.today.max) }}</b></span>
              <span>谷 <b>{{ fmt(summary.today.min) }}</b></span>
            </p>
          </div>
          <div class="pp-stat">
            <p class="pp-stat-label">近一周均值</p>
            <p class="pp-stat-value">{{ fmt(summary.week.avg) }} <i>kW</i></p>
            <p class="pp-stat-rows">
              <span>最大 <b>{{ fmt(summary.week.max) }}</b></span>
              <span>电量 <b>{{ summary.week.energy.toFixed(1) }} MWh</b></span>
            </p>
          </div>
          <div class="pp-stat">
            <p class="pp-stat-label">近一月均值</p>
            <p class="pp-stat-value">{{ fmt(summary.month.avg) }} <i>kW</i></p>
            <p class="pp-stat-rows">
              <span>最大 <b>{{ fmt(summary.month.max) }}</b></span>
              <span>电量 <b>{{ summary.month.energy.toFixed(1) }} MWh</b></span>
            </p>
          </div>
        </div>
        <p class="pp-loadbar">
          <span class="pp-loadbar-label">月均负载率</span>
          <span class="pp-loadbar-track"><i :style="{ width: Math.min(100, summary.loadRate * 100).toFixed(1) + '%' }"></i></span>
          <b>{{ (summary.loadRate * 100).toFixed(1) }}%</b>
        </p>

        <!-- 曲线范围选择 -->
        <div class="pp-range">
          <div class="range-tabs">
            <button
              v-for="t in RANGE_TABS"
              :key="t.id"
              type="button"
              :class="{ 'is-on': range.type === t.id }"
              @click="setRange(t.id)"
            >{{ t.label }}</button>
          </div>
          <div v-if="range.type === 'custom'" class="range-dates">
            <label>起 <input type="date" v-model="range.start" :max="todayStr" @change="onDateInput"></label>
            <label>止 <input type="date" v-model="range.end" :min="range.start" :max="todayStr" @change="onDateInput"></label>
          </div>
        </div>

        <!-- 功率曲线 -->
        <div class="pp-chart-head">
          <span class="pp-chart-title">高压有功功率曲线</span>
          <span v-if="seriesMeta" class="pp-chart-avg">区间均值 <b>{{ fmt(seriesMeta.avg) }}</b> kW</span>
        </div>
        <div v-if="chart" class="pp-chart">
          <div class="chart-y">
            <span v-for="g in [...chart.gridY].reverse()" :key="g.y">{{ fmt(g.value) }}</span>
          </div>
          <div class="chart-plot" @mousemove="onChartMove" @mouseleave="onChartLeave">
            <svg :viewBox="`0 0 ${PW} ${PH}`" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="ppArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.42"/>
                  <stop offset="100%" stop-color="#00E5FF" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              <g class="chart-grid">
                <line v-for="g in chart.gridY" :key="g.y" x1="0" :x2="PW" :y1="g.y" :y2="g.y"/>
              </g>
              <path class="chart-area" :d="chart.area"/>
              <path class="chart-line" :d="chart.line"/>
            </svg>
            <template v-if="hoverPoint">
              <span class="chart-cross" :style="{ left: hoverPoint.left + '%' }"></span>
              <span class="chart-dot" :style="{ left: hoverPoint.left + '%', top: hoverPoint.top + '%' }"></span>
              <span
                class="chart-tip"
                :class="{ 'is-right': hoverPoint.left > 72 }"
                :style="{ left: hoverPoint.left + '%', top: hoverPoint.top + '%' }"
              >
                <b>{{ fmt(hoverPoint.p.v) }} kW</b>{{ hoverPoint.p.full }}
              </span>
            </template>
          </div>
          <div class="chart-x">
            <span v-for="t in chart.ticks" :key="t.i" :style="{ left: (t.x / PW * 100) + '%' }">{{ t.label }}</span>
          </div>
        </div>

        <p class="pp-note">{{ DATA_NOTE }}</p>
      </aside>
    </transition>

    <!-- 10kV 中心站主接线 Topo：配网仿真系统弹窗 -->
    <transition name="topo-fade">
      <div v-if="showTopo" class="topo-mask" @click.self="closeTopo">
        <div class="topo-modal" role="dialog" aria-modal="true" aria-label="10kV 中心站主接线 Topo 配网仿真系统">
          <header class="topo-head">
            <span class="topo-head-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="5" cy="6" r="2.2"/>
                <circle cx="5" cy="18" r="2.2"/>
                <circle cx="13" cy="12" r="2.2"/>
                <circle cx="19.5" cy="7" r="1.8"/>
                <circle cx="19.5" cy="17" r="1.8"/>
                <path d="M7.2 6.6L11 11M7.2 17.4L11 13M15.1 11l2.7-3M15.1 13l2.7 3"/>
              </svg>
            </span>
            <div class="topo-head-text">
              <h3>10kV 中心站主接线 Topo</h3>
              <p>配网仿真系统 · 南京 - 河海大学 - 江宁校区</p>
            </div>
            <a class="topo-open-ext" :href="TOPO_URL" target="_blank" rel="noopener" title="在新标签页打开">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>
              </svg>
              新窗口
            </a>
            <button class="topo-close" type="button" aria-label="关闭仿真系统" @click="closeTopo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </header>
          <div class="topo-body">
            <div v-if="topoLoading" class="topo-loading">
              <div class="topo-spinner"></div>
              <p>正在进入配网仿真系统…</p>
            </div>
            <iframe
              :src="TOPO_URL"
              title="10kV 中心站主接线 Topo 配网仿真系统"
              allow="fullscreen"
              @load="topoLoading = false"
            ></iframe>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.plan-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(ellipse 90% 80% at 50% 42%, #0c1b2c 0%, #060d16 62%, #04080f 100%);
  font-family: var(--font);
  color: #dceaf5;
}
.plan-root.is-dragging { cursor: grabbing; }

/* ---------- 舞台与平面图 ---------- */
.plan-stage {
  position: absolute;
  inset: 0;
  cursor: grab;
  touch-action: none;
}
.world-anchor {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}
.plan-world {
  position: absolute;
  left: 0;
  top: 0;
  /* transform-origin 默认 50%/50%，配合 translate(-50%,-50%) 保证缩放绕画面中心 */
  will-change: transform;
}
.plan-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  -webkit-user-drag: none;
  user-select: none;
  /* 浅色总平面反转为深色，与高德底图同一处理，再压一点亮度衬托青色 */
  filter: invert(1) hue-rotate(180deg) saturate(0.62) brightness(0.82) contrast(0.95);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.35), 0 0 50px rgba(0, 150, 220, 0.22), 0 30px 80px rgba(0, 0, 0, 0.6);
}
.img-wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 75% 65% at 50% 45%, rgba(0, 120, 170, 0.08), transparent 70%),
    linear-gradient(180deg, rgba(2, 14, 26, 0.12), rgba(2, 10, 20, 0.32));
  box-shadow: inset 0 0 90px rgba(0, 60, 100, 0.35);
}

/* ---------- 楼宇监测点 ---------- */
.bmap-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 6px;
  border: none;
  background: none;
  cursor: pointer;
  z-index: 2;
}
.pin-core {
  position: relative;
  flex: none;
  width: 11px;
  height: 11px;
}
.pin-dot {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #aef4ff 0%, #00e5ff 45%, #007fa8 100%);
  border: 1.5px solid rgba(190, 246, 255, 0.95);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.95), 0 0 22px rgba(0, 150, 220, 0.6);
  transition: transform 0.16s ease;
}
.pin-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 229, 255, 0.7);
  animation: pinPulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes pinPulse {
  0% { transform: scale(0.6); opacity: 0.95; }
  100% { transform: scale(2.6); opacity: 0; }
}
.pin-name {
  white-space: nowrap;
  padding: 2px 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #bfeaff;
  background: rgba(5, 16, 28, 0.78);
  border: 1px solid rgba(0, 212, 255, 0.4);
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45), 0 0 10px rgba(0, 150, 220, 0.18);
  opacity: 0.82;
  transition: opacity 0.16s, color 0.16s, border-color 0.16s, background 0.16s;
  pointer-events: none;
}
.bmap-pin:hover .pin-name,
.bmap-pin.is-active .pin-name {
  opacity: 1;
  color: #eafaff;
  border-color: rgba(0, 229, 255, 0.85);
  background: rgba(8, 28, 46, 0.92);
}
.bmap-pin:hover .pin-dot,
.bmap-pin.is-active .pin-dot {
  transform: scale(1.35);
}
.bmap-pin.is-dim { opacity: 0.35; }
.bmap-pin.is-active { z-index: 5; }
.bmap-pin.is-active .pin-dot {
  background: radial-gradient(circle at 35% 30%, #fff4cf 0%, #ffd25c 48%, #a8740d 100%);
  border-color: rgba(255, 236, 170, 0.95);
  box-shadow: 0 0 12px rgba(255, 210, 92, 0.95), 0 0 26px rgba(255, 170, 40, 0.55);
}
.bmap-pin.is-active .pin-pulse { border-color: rgba(255, 210, 92, 0.75); }
.bmap-pin.is-active .pin-name {
  border-color: rgba(255, 210, 92, 0.8);
  color: #ffecc4;
}

/* ---------- HUD ---------- */
.plan-hud {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}
.hud-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(0, 212, 255, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 212, 255, 0.08) 1px, transparent 1px);
  background-size: 72px 72px, 72px 72px;
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 0%, rgba(0, 0, 0, 0.4) 55%, transparent 85%);
  mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 0%, rgba(0, 0, 0, 0.4) 55%, transparent 85%);
}
.hud-scan {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 0;
  height: 26%;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 212, 255, 0.05) 70%, rgba(0, 229, 255, 0.16) 100%);
  border-bottom: 1px solid rgba(0, 229, 255, 0.4);
  transform: translateY(-120%);
  animation: planScan 11s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes planScan {
  0%, 14% { transform: translateY(-120%); }
  86%, 100% { transform: translateY(480%); }
}
.hud-corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 0 solid rgba(0, 229, 255, 0.55);
  filter: drop-shadow(0 0 6px rgba(0, 212, 255, 0.4));
}
.hud-corner.is-tl { top: 12px; left: 12px; border-top-width: 2px; border-left-width: 2px; }
.hud-corner.is-tr { top: 12px; right: 12px; border-top-width: 2px; border-right-width: 2px; }
.hud-corner.is-bl { bottom: 12px; left: 12px; border-bottom-width: 2px; border-left-width: 2px; }
.hud-corner.is-br { bottom: 12px; right: 12px; border-bottom-width: 2px; border-right-width: 2px; }

/* ---------- 左上信息 ---------- */
.plan-tl {
  position: absolute;
  left: 22px;
  top: 18px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}
.back-btn {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  font-family: var(--font);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #00e5ff;
  cursor: pointer;
  background: rgba(8, 20, 34, 0.85);
  border: 1px solid rgba(0, 212, 255, 0.55);
  border-radius: 6px;
  box-shadow: 0 0 18px rgba(0, 150, 220, 0.25), inset 0 0 12px rgba(0, 40, 70, 0.4);
  backdrop-filter: blur(8px);
  transition: transform 0.16s, color 0.16s, box-shadow 0.16s;
}
.back-btn:hover {
  transform: translateX(-2px);
  color: #eafaff;
  box-shadow: 0 0 26px rgba(0, 229, 255, 0.5);
}

/* ---------- 10kV 中心站主接线 Topo 入口 ---------- */
.topo-entry {
  position: absolute;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px 9px 11px;
  font-family: var(--font);
  text-align: left;
  color: #cdeefb;
  cursor: pointer;
  background: linear-gradient(135deg, rgba(10, 32, 54, 0.92), rgba(6, 20, 34, 0.92));
  border: 1.5px solid rgba(0, 212, 255, 0.55);
  border-radius: 8px;
  box-shadow:
    0 10px 26px rgba(3, 10, 18, 0.5),
    0 0 20px rgba(0, 150, 220, 0.28),
    inset 0 0 14px rgba(0, 50, 80, 0.35);
  backdrop-filter: blur(8px);
  transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
  animation: topoBtnGlow 2.8s ease-in-out infinite;
}
@keyframes topoBtnGlow {
  0%, 100% { box-shadow: 0 10px 26px rgba(3, 10, 18, 0.5), 0 0 18px rgba(0, 150, 220, 0.25), inset 0 0 14px rgba(0, 50, 80, 0.35); }
  50% { box-shadow: 0 10px 26px rgba(3, 10, 18, 0.5), 0 0 34px rgba(0, 212, 255, 0.5), inset 0 0 18px rgba(0, 70, 110, 0.45); }
}
.topo-entry:hover {
  transform: translateY(-2px);
  color: #eafaff;
  border-color: rgba(0, 229, 255, 0.95);
}
.topo-entry-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 7px;
  color: #001a2e;
  background: linear-gradient(135deg, #00e5ff, #0099cc);
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.topo-entry-text { display: flex; flex-direction: column; gap: 2px; line-height: 1.25; }
.topo-entry-text b {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #eafaff;
  white-space: nowrap;
}
.topo-entry-text i {
  font-style: normal;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: #7fb6d2;
}
.topo-entry-arrow {
  flex: none;
  color: #00d4ff;
  transition: transform 0.16s;
}
.topo-entry:hover .topo-entry-arrow { transform: translateX(3px); }

/* ---------- 配网仿真系统弹窗 ---------- */
.topo-mask {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 36px;
  background: rgba(3, 9, 16, 0.72);
  backdrop-filter: blur(4px);
}
.topo-modal {
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: 100%;
  overflow: hidden;
  background: linear-gradient(170deg, #0e2238, #070f1b);
  border: 1.5px solid rgba(0, 212, 255, 0.6);
  border-radius: 12px;
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.65),
    0 0 50px rgba(0, 150, 220, 0.3),
    inset 0 0 34px rgba(0, 30, 60, 0.5);
}
.topo-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 14px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.3);
  background: linear-gradient(90deg, rgba(0, 90, 130, 0.35), rgba(6, 20, 34, 0.6));
}
.topo-head-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 7px;
  color: #00e5ff;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid rgba(0, 212, 255, 0.45);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.25);
}
.topo-head-text { flex: 1; min-width: 0; }
.topo-head-text h3 {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #eafaff;
}
.topo-head-text p {
  margin-top: 1px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #7fb6d2;
}
.topo-open-ext {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 6px 10px;
  font-size: 11.5px;
  letter-spacing: 0.05em;
  color: #8fd8f7;
  text-decoration: none;
  border: 1px solid rgba(0, 212, 255, 0.4);
  border-radius: 6px;
  background: rgba(6, 20, 34, 0.7);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.topo-open-ext:hover {
  color: #eafaff;
  border-color: rgba(0, 229, 255, 0.8);
  background: rgba(0, 212, 255, 0.12);
}
.topo-close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: #7fa6c0;
  cursor: pointer;
  background: none;
  border: 1px solid rgba(127, 166, 192, 0.3);
  border-radius: 6px;
  transition: color 0.15s, border-color 0.15s;
}
.topo-close:hover {
  color: #ff9c98;
  border-color: rgba(227, 112, 107, 0.6);
}
.topo-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #060d16;
}
.topo-body iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #060d16;
}
.topo-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: #060d16;
}
.topo-loading p {
  font-size: 12.5px;
  letter-spacing: 0.15em;
  color: #00e5ff;
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
}
.topo-spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid rgba(0, 212, 255, 0.2);
  border-top-color: #00e5ff;
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.5);
  animation: topoSpin 0.82s linear infinite;
}
@keyframes topoSpin { to { transform: rotate(360deg); } }

.topo-fade-enter-active,
.topo-fade-leave-active { transition: opacity 0.22s ease; }
.topo-fade-enter-active .topo-modal,
.topo-fade-leave-active .topo-modal { transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s; }
.topo-fade-enter-from,
.topo-fade-leave-to { opacity: 0; }
.topo-fade-enter-from .topo-modal,
.topo-fade-leave-to .topo-modal { transform: translateY(16px) scale(0.97); opacity: 0; }

/* ---------- 缩放控件 ---------- */
.plan-zoom {
  position: absolute;
  left: 22px;
  bottom: 20px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(8, 20, 34, 0.9);
  box-shadow: 0 0 20px rgba(0, 150, 220, 0.22);
  backdrop-filter: blur(8px);
}
.plan-zoom button {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #00d4ff;
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(0, 212, 255, 0.18);
  transition: background 0.15s, color 0.15s;
}
.plan-zoom button:last-child { border-bottom: none; }
.plan-zoom button:hover { background: rgba(0, 212, 255, 0.15); color: #eafaff; }

/* ---------- 数据面板 ---------- */
.power-panel {
  position: absolute;
  right: 20px;
  top: 18px;
  bottom: 18px;
  z-index: 70;
  width: 372px;
  display: flex;
  flex-direction: column;
  padding: 15px 16px 12px;
  overflow-y: auto;
  color: #e8f1f8;
  background: linear-gradient(170deg, rgba(18, 38, 60, 0.96), rgba(7, 17, 29, 0.97));
  border: 1.5px solid rgba(0, 212, 255, 0.5);
  border-radius: 12px;
  box-shadow: 0 22px 55px rgba(3, 10, 20, 0.6), 0 0 34px rgba(0, 150, 220, 0.25), inset 0 0 30px rgba(0, 30, 60, 0.4);
  backdrop-filter: blur(10px);
  scrollbar-width: thin;
  scrollbar-color: rgba(143, 216, 247, 0.4) transparent;
}
.power-panel::-webkit-scrollbar { width: 5px; }
.power-panel::-webkit-scrollbar-thumb { background: rgba(143, 216, 247, 0.4); border-radius: 3px; }

.pp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(143, 216, 247, 0.18);
}
.pp-head-main { display: flex; align-items: center; gap: 10px; }
.pp-dot {
  width: 9px; height: 9px; border-radius: 50%; flex: none;
  background: #00e5ff;
  box-shadow: 0 0 10px #00e5ff, 0 0 22px rgba(0, 229, 255, 0.6);
}
.pp-name {
  font-size: 15.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f2f9ff;
  text-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
}
.pp-station {
  margin-top: 2px;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  color: #7fa6c0;
}
.pp-close {
  flex: none;
  padding: 4px;
  color: #7fa6c0;
  cursor: pointer;
  background: none;
  border: none;
  transition: color 0.15s;
}
.pp-close:hover { color: #8fd8f7; }

.pp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  padding: 9px 0 10px;
  font-size: 11px;
  color: #8fb4cc;
  border-bottom: 1px dashed rgba(143, 216, 247, 0.16);
}
.pp-meta b {
  font-family: var(--font-num);
  font-weight: 600;
  color: #cdeefb;
  margin-left: 3px;
}

.pp-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 11px 0 9px;
}
.pp-stat {
  padding: 9px 8px 8px;
  text-align: center;
  background: rgba(6, 20, 34, 0.65);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 8px;
  box-shadow: inset 0 0 14px rgba(0, 50, 80, 0.35);
}
.pp-stat-label {
  font-size: 10.5px;
  letter-spacing: 0.05em;
  color: #7fa6c0;
  white-space: nowrap;
}
.pp-stat-value {
  margin-top: 3px;
  font-family: var(--font-num);
  font-size: 19px;
  font-weight: 700;
  color: #00e5ff;
  line-height: 1.1;
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.5);
}
.pp-stat-value i {
  font-style: normal;
  font-size: 10px;
  font-weight: 500;
  color: #6fa6c2;
  margin-left: 1px;
}
.pp-stat-rows {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: #7fa6c0;
  white-space: nowrap;
}
.pp-stat-rows b {
  font-family: var(--font-num);
  font-weight: 600;
  color: #bfe0f0;
  margin-left: 2px;
}

.pp-loadbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 11px;
  font-size: 10.5px;
  color: #8fb4cc;
}
.pp-loadbar-label { flex: none; }
.pp-loadbar-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(0, 60, 90, 0.6);
  overflow: hidden;
  box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.5);
}
.pp-loadbar-track i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #0088aa, #00e5ff);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.7);
}
.pp-loadbar b {
  flex: none;
  font-family: var(--font-num);
  color: #00e5ff;
  font-size: 11px;
}

.pp-range { padding-bottom: 10px; }
.range-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.range-tabs button {
  padding: 6px 0;
  font-family: var(--font);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: #8fb4cc;
  cursor: pointer;
  background: rgba(6, 20, 34, 0.6);
  border: 1px solid rgba(0, 212, 255, 0.22);
  border-radius: 6px;
  transition: all 0.15s;
}
.range-tabs button:hover { color: #cdeefb; border-color: rgba(0, 212, 255, 0.5); }
.range-tabs button.is-on {
  color: #001a2e;
  font-weight: 700;
  background: linear-gradient(135deg, #00e5ff, #0099cc);
  border-color: rgba(0, 229, 255, 0.8);
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.45);
}
.range-dates {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  font-size: 11px;
  color: #8fb4cc;
}
.range-dates label { display: flex; align-items: center; gap: 5px; flex: 1; }
.range-dates input {
  flex: 1;
  min-width: 0;
  padding: 5px 6px;
  font-family: var(--font-num);
  font-size: 11px;
  color: #cdeefb;
  background: rgba(6, 20, 34, 0.85);
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 5px;
  color-scheme: dark;
  outline: none;
}
.range-dates input:focus { border-color: #00e5ff; box-shadow: 0 0 8px rgba(0, 229, 255, 0.35); }

.pp-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 2px 0 6px;
}
.pp-chart-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #bfe0f0;
}
.pp-chart-avg { font-size: 10.5px; color: #7fa6c0; }
.pp-chart-avg b {
  font-family: var(--font-num);
  color: #00e5ff;
  font-size: 12.5px;
  margin: 0 2px;
}

.pp-chart {
  position: relative;
  padding-left: 40px;
}
.chart-y {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 18px;
  width: 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: right;
}
.chart-y span {
  font-family: var(--font-num);
  font-size: 9px;
  color: #5f8199;
  transform: translateY(4px);
}
.chart-y span:first-child { transform: translateY(-4px); }
.chart-plot {
  position: relative;
  height: 190px;
}
.chart-plot svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.chart-grid line {
  stroke: rgba(0, 212, 255, 0.14);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 3 4;
}
.chart-area {
  fill: url(#ppArea);
}
.chart-line {
  fill: none;
  stroke: #00e5ff;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.75));
}
.chart-cross {
  position: absolute;
  top: 0; bottom: 0;
  width: 1px;
  background: rgba(0, 229, 255, 0.45);
  transform: translateX(-0.5px);
  pointer-events: none;
}
.chart-dot {
  position: absolute;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #eafaff;
  border: 2px solid #00e5ff;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.9);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.chart-tip {
  position: absolute;
  transform: translate(10px, -50%);
  padding: 4px 8px;
  white-space: nowrap;
  font-size: 10.5px;
  color: #9cc4dc;
  background: rgba(5, 16, 28, 0.94);
  border: 1px solid rgba(0, 212, 255, 0.55);
  border-radius: 5px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.chart-tip.is-right { transform: translate(calc(-100% - 10px), -50%); }
.chart-tip b {
  display: block;
  font-family: var(--font-num);
  font-size: 12px;
  color: #00e5ff;
}
.chart-x {
  position: relative;
  height: 16px;
  margin-top: 2px;
}
.chart-x span {
  position: absolute;
  transform: translateX(-50%);
  font-family: var(--font-num);
  font-size: 9px;
  color: #5f8199;
  white-space: nowrap;
}
.chart-x span:first-child { transform: translateX(0); }
.chart-x span:last-child { transform: translateX(-100%); }

.pp-note {
  margin-top: auto;
  padding-top: 10px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #5f8199;
}

/* 面板入场 */
.panel-slide-enter-active,
.panel-slide-leave-active { transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s; }
.panel-slide-enter-from,
.panel-slide-leave-to { transform: translateX(24px); opacity: 0; }

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .power-panel {
    right: 10px; left: 10px;
    top: auto;
    bottom: 10px;
    width: auto;
    max-height: 56%;
  }
  .plan-tl { left: 14px; top: 14px; }
  .topo-entry {
    padding: 8px 10px;
    gap: 8px;
  }
  .topo-entry-icon { width: 30px; height: 30px; }
  .topo-entry-text i { display: none; }
  .topo-entry-arrow { display: none; }
  .topo-mask { padding: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .hud-scan, .pin-pulse, .topo-entry { animation: none; }
  .pin-pulse { opacity: 0; }
  .panel-slide-enter-active, .panel-slide-leave-active { transition: none; }
  .topo-fade-enter-active, .topo-fade-leave-active { transition: none; }
}
</style>
