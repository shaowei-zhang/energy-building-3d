<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CAMPUSES } from '../data/campus'
import emblemUrl from '../assets/hhu-emblem.svg'

const emit = defineEmits(['enter3d', 'enter-plan', 'zoom'])

// 最深层级：既是底图上限，也是 3D 楼宇的出现层级
const Z3D = 18
// 初始缩放级别（同时是初始视野的上限，用于完整展示三个校区）
const INITIAL_ZOOM = 11
// 主底图：高德中文栅格（国内访问稳定、无需 key）。
// 瓦片本身是浅色，通过 CSS filter 反转为深色（见 .leaflet-tile-pane），与青色 HUD 适配
const GAODE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
// 弹窗、标记与视口边界之间需要保留的安全间距
const EDGE_GAP = 12
// 弹窗被压缩时的最小内容高度（低于此值不再压缩，改为视口裁切）
const POPUP_MIN_HEIGHT = 96

const mapEl = ref(null)
const transitioning = ref(false)
const showEnterBtn = ref(false)
// 最近点击 / 下钻的校区：江宁校区进入平面地图，其余进入 3D 楼宇
const activeCampusId = ref(null)
const activeCampus = computed(() => CAMPUSES.find((c) => c.id === activeCampusId.value) || null)
const isPlanTarget = computed(() => !!activeCampus.value?.hasPlan)
const enterText = computed(() => (isPlanTarget.value ? '进入平面地图' : '进入 3D 楼宇'))
const transitionText = computed(() => (isPlanTarget.value ? '正在进入江宁校区平面地图…' : '正在进入能源楼 3D 楼宇…'))

function emitEnter() {
  if (isPlanTarget.value) emit('enter-plan')
  else emit('enter3d')
}

let map = null
// 本次到达 z18 是否由点击点位触发（点击下钻不自动进 3D）
let clickDrill = false
let enterTimer = 0

// 校区标记：校徽 + 脉冲环（文字名供无障碍读取）
function campusIcon(name) {
  const html = `
    <div class="campus-marker">
      <div class="campus-emblem" aria-hidden="true"><img src="${emblemUrl}" alt=""></div>
      <span class="sr-only">${name}</span>
      <div class="campus-pin"></div>
      <div class="campus-dot"></div>
    </div>`
  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] })
}

function popupHtml(c) {
  return `
    <div class="campus-popup-inner">
      <div class="popup-logo"><img src="${emblemUrl}" alt="河海大学校徽"></div>
      <div class="popup-name">${c.name}</div>
      <div class="popup-region">${c.city} · ${c.district}</div>
      <div class="popup-line"><span class="popup-label">详细地址</span><span class="popup-text">${c.addr}</span></div>
      <div class="popup-line"><span class="popup-label">经纬度</span><span class="popup-text">${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}</span></div>
      <button class="popup-enter-3d" type="button">
        ${c.hasPlan ? `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6.5l6-2.5 6 2.5L21 4v13.5l-6 2.5-6-2.5L3 20z" fill="currentColor" fill-opacity=".25"/>
          <path d="M9 4v13.5M15 6.5V20"/>
        </svg>
        进入平面地图` : `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.6l7.4 4.2L12 11 4.6 6.8 12 2.6z" fill="currentColor" opacity=".9"/>
          <path d="M4.6 6.8L12 11v10.4l-7.4-4.2V6.8z" fill="currentColor" opacity=".55"/>
          <path d="M19.4 6.8L12 11v10.4l7.4-4.2V6.8z" fill="currentColor" opacity=".75"/>
        </svg>
        进入 3D 楼宇`}
      </button>
    </div>`
}

function cancelEnter() {
  if (enterTimer) {
    window.clearTimeout(enterTimer)
    enterTimer = 0
  }
  transitioning.value = false
}

onMounted(() => {
  map = L.map(mapEl.value, {
    center: [31.88, 119.1],
    zoom: INITIAL_ZOOM,
    minZoom: 8,
    maxZoom: Z3D,
    zoomControl: false,
    attributionControl: true
  })

  L.control.zoom({ position: 'topleft' }).addTo(map)

  // 弹窗展开/关闭时切换 class，控制网格 HUD 的淡出/恢复
  map.on('popupopen', () => map.getContainer().classList.add('has-popup'))
  map.on('popupclose', () => map.getContainer().classList.remove('has-popup'))

  // 主底图：高德栅格（深色由 .leaflet-tile-pane 的 CSS filter 完成）
  L.tileLayer(GAODE_URL, {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: Z3D,
    attribution: '© <a href="https://ditu.amap.com/" target="_blank">高德地图</a>'
  }).addTo(map)

  // 三校区点位
  const campusMarkers = []
  CAMPUSES.forEach((c) => {
    const marker = L.marker([c.lat, c.lng], {
      icon: campusIcon(c.short),
      riseOnHover: true,
      title: c.name
    }).addTo(map)
    campusMarkers.push(marker)

    marker.bindPopup(popupHtml(c), {
      className: 'campus-popup',
      offset: [0, -58],
      closeButton: true,
      autoPan: false,
      maxWidth: 300
    })

    // 去掉点击即展开弹窗的默认行为：下钻动画期间弹窗会被缩放重排（看起来扭曲），
    // 改为等 flyTo 落位后再展开，展开后的对齐由 popupopen 里的 placePopup 完成
    marker.off('click')

    // 弹窗里的按钮由 Leaflet 动态插入，需要手动绑定。
    // 注意：必须委托到弹窗根元素而不是按钮本身——placePopup() 在视口
    // 高度不足时会调用 popup.update()，Leaflet 会重写 contentNode.innerHTML
    // 重建按钮 DOM，直接绑在按钮上的监听器会随之丢失（表现为点击无反应）。
    // .leaflet-popup 根元素在 update 中保留，委托监听不受影响。
    marker.on('popupopen', (e) => {
      const popupEl = e.popup.getElement()
      if (popupEl && !popupEl.dataset.enterBound) {
        popupEl.dataset.enterBound = '1'
        popupEl.addEventListener('click', (ev) => {
          if (ev.target.closest && ev.target.closest('.popup-enter-3d')) emitEnter()
        })
      }
      // 进页面后点击点位、下钻落位、已到位再点击，弹窗都要在视口内完整可见
      placePopup(marker)
    })

    marker.on('click', () => {
      activeCampusId.value = c.id
      // 已在最深层级：不自动进入下一层，只给出浮动入口
      if (map.getZoom() >= Z3D) {
        clickDrill = false
        showEnterBtn.value = true
        marker.openPopup()
        return
      }
      clickDrill = true
      map.flyTo([c.lat, c.lng], Z3D, { duration: 1.4 })
      // 落位后再展开弹窗
      map.once('moveend', () => marker.openPopup())
    })
  })

  // 弹窗向上展开，必须完整可见，处理分两步：
  // 1) 把地图内容整体下移，尽量在标记上方腾出空间（以视口内最南侧标记不被顶出为限）
  // 2) 空间仍不足时压缩弹窗高度，交给 Leaflet 内部滚动，避免被视口裁切
  function placePopup(marker, attempt = 0) {
    const popup = marker.getPopup()
    const popupEl = popup?.getElement()
    const markerEl = marker.getElement()?.querySelector('.campus-marker')
    if (!popupEl || !markerEl) return
    // 缩放动画进行中弹窗正处于缩放变换中，此时的测量与压缩都不准确，
    // 等动画结束（最多等 30 帧）后再处理；Leaflet 把 leaflet-zoom-anim 加在 map-pane 上
    const pane = map.getPane('mapPane')
    if (pane && pane.classList.contains('leaflet-zoom-anim')) {
      if (attempt < 30) window.requestAnimationFrame(() => placePopup(marker, attempt + 1))
      return
    }

    const hostRect = map.getContainer().getBoundingClientRect()

    let room = hostRect.bottom - EDGE_GAP
    campusMarkers.forEach((m) => {
      const el = m.getElement()?.querySelector('.campus-marker')
      if (!el) return
      const rect = el.getBoundingClientRect()
      // 已经不在视口内的标记不参与限制
      if (rect.top < hostRect.top || rect.bottom > hostRect.bottom) return
      room = Math.min(room, hostRect.bottom - rect.bottom - EDGE_GAP)
    })

    const overflow = EDGE_GAP - popupEl.getBoundingClientRect().top
    const shift = Math.min(Math.max(overflow, 0), Math.max(room, 0))
    if (shift > 0) {
      // 内容下移 shift 像素 = 视野中心在容器坐标里上移 shift 像素
      const center = map.latLngToContainerPoint(map.getCenter())
      map.panTo(map.containerPointToLatLng(center.subtract([0, shift])), { animate: false })
    }

    // 先还原自然高度，避免上一次的压缩量被累积
    if (popup.options.maxHeight) {
      popup.options.maxHeight = 0
      popup.update()
    }
    // 逐步压缩到刚好放下（通常一次即可，多迭代用于消除测量误差）
    const content = popupEl.querySelector('.leaflet-popup-content')
    for (let i = 0; i < 3; i++) {
      const need = hostRect.top + EDGE_GAP - popupEl.getBoundingClientRect().top
      if (need <= 1) break
      popup.options.maxHeight = Math.max(POPUP_MIN_HEIGHT, Math.round(content.offsetHeight - need))
      popup.update()
    }
  }

  map.on('zoomend', () => {
    const z = map.getZoom()
    emit('zoom', z)

    if (z < Z3D) {
      showEnterBtn.value = false
      cancelEnter()
      return
    }

    // 点击点位下钻：只显示浮动入口按钮
    if (clickDrill) {
      clickDrill = false
      showEnterBtn.value = true
      return
    }

    // 手动缩放到位：过渡遮罩停留 650ms 后自动进入对应视图
    // （江宁校区 → 平面地图，其余 → 能源楼 3D）
    transitioning.value = true
    showEnterBtn.value = false
    enterTimer = window.setTimeout(() => {
      enterTimer = 0
      transitioning.value = false
      emitEnter()
    }, 650)
  })

  // 初始视野：按规则固定 z11，中心对准三校区的地理中心；
  // 视口装不下三校区时才退让（fitBounds 仍以 z11 为上限），保证三个标记都在视野内
  const campusBounds = L.latLngBounds(CAMPUSES.map((c) => [c.lat, c.lng]))
  map.setView(campusBounds.getCenter(), INITIAL_ZOOM, { animate: false })
  if (!map.getBounds().contains(campusBounds)) {
    map.fitBounds(campusBounds, { animate: false, maxZoom: INITIAL_ZOOM, padding: [80, 80] })
  }

  emit('zoom', map.getZoom())

  // 支持 URL #3d 直达 3D
  if (window.location.hash.replace('#', '').toLowerCase() === '3d') emit('enter3d')
})

onBeforeUnmount(() => {
  cancelEnter()
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="campus-map">
    <div ref="mapEl" class="campus-map-canvas">
      <!-- 高科技网格 HUD 覆盖层：必须位于 Leaflet 容器内部（与 map-pane 同级），
           否则会被 Leaflet 合成层整体压在下方；青色系与图标、3D 模型发光色一致 -->
      <div class="map-hud" aria-hidden="true">
        <div class="hud-grid"></div>
        <div class="hud-scan"></div>
        <div class="hud-ruler hud-ruler-x"></div>
        <div class="hud-ruler hud-ruler-y"></div>
        <span class="hud-corner is-tl"></span>
        <span class="hud-corner is-tr"></span>
        <span class="hud-corner is-bl"></span>
        <span class="hud-corner is-br"></span>
      </div>
    </div>

    <!-- 缩放到位后的过渡遮罩 -->
    <div v-if="transitioning" class="map-transition">
      <div class="map-spinner" aria-hidden="true"></div>
      <p class="map-transition-text">{{ transitionText }}</p>
    </div>

    <!-- 点击点位下钻后出现的浮动入口 -->
    <button v-if="showEnterBtn" class="enter-3d-btn" type="button" @click="emitEnter">
      <template v-if="isPlanTarget">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6.5l6-2.5 6 2.5L21 4v13.5l-6 2.5-6-2.5L3 20z" fill="currentColor" fill-opacity=".25"/>
          <path d="M9 4v13.5M15 6.5V20"/>
        </svg>
      </template>
      <template v-else>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.6l7.4 4.2L12 11 4.6 6.8 12 2.6z" fill="currentColor" opacity=".9"/>
          <path d="M4.6 6.8L12 11v10.4l-7.4-4.2V6.8z" fill="currentColor" opacity=".55"/>
          <path d="M19.4 6.8L12 11v10.4l7.4-4.2V6.8z" fill="currentColor" opacity=".75"/>
        </svg>
      </template>
      {{ enterText }}
    </button>
  </div>
</template>

<!-- Leaflet 的标记与弹窗是动态插入的 DOM，样式必须保持全局作用域 -->
<style>
.campus-map {
  position: absolute;
  inset: 0;
}
.campus-map-canvas {
  position: absolute;
  inset: 0;
}

/* ---------- Leaflet 基础外观 ---------- */
/* 注意：这里不能给 .leaflet-container 设 position，
   否则会以同优先级覆盖 .campus-map-canvas 的 absolute 定位，使容器高度塌陷为 0 */
.leaflet-container {
  background: #060D15;
  font-family: var(--font);
  outline: none;
}
/* 浅色高德瓦片反转为深色底图：
   invert 明暗反转 → hue-rotate 180 让水系/道路的原有色相回归；
   再降饱和、压亮度，使冷灰底图衬托青色网格与发光图标 */
.leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) saturate(0.55) brightness(0.9) contrast(0.92);
}
/* 科技感覆盖层：暗角 + 扫描线 + 微光（z450 才能盖在 map-pane z400 之上） */
.leaflet-container::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 450;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, rgba(0,0,0,0.5) 100%),
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.015) 2px, rgba(0,212,255,0.015) 4px);
  border: 1px solid rgba(0,212,255,0.2);
  border-radius: 2px;
  box-shadow: inset 0 0 60px rgba(0,212,255,0.05);
}
/* 科技网格 HUD 覆盖层：位于 Leaflet map-pane(z400) 之上、控件(z1000) 之下，不拦截交互。
   注意 z 必须 >400，否则整个 HUD 会被 Leaflet 合成层压在下方而完全不可见 */
.map-hud {
  position: absolute;
  inset: 0;
  z-index: 450;
  pointer-events: none;
  overflow: hidden;
  transition: opacity 0.3s ease;
}
/* 弹窗展开时淡出网格，保证弹窗内容最干净、最聚焦 */
.leaflet-container.has-popup .map-hud { opacity: 0; }
/* 双层科技网格：主网格 + 微网格，中心亮、四周径向淡出；
   统一使用 3D 模型/图标同款青色 #00D4FF */
.hud-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(0,212,255,0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,212,255,0.11) 1px, transparent 1px),
    linear-gradient(rgba(0,212,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,212,255,0.04) 1px, transparent 1px);
  background-size: 88px 88px, 88px 88px, 17.6px 17.6px, 17.6px 17.6px;
  -webkit-mask-image: radial-gradient(ellipse 76% 66% at 50% 45%, #000 0%, rgba(0,0,0,0.55) 52%, transparent 82%);
  mask-image: radial-gradient(ellipse 76% 66% at 50% 45%, #000 0%, rgba(0,0,0,0.55) 52%, transparent 82%);
}
/* 雷达扫描光带：自上而下周期扫过，扫过处网格被"激活"提亮 */
.hud-scan {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 0;
  height: 28%;
  background: linear-gradient(180deg,
    transparent 0%,
    rgba(0,212,255,0.02) 55%,
    rgba(0,212,255,0.07) 88%,
    rgba(0,229,255,0.18) 100%);
  border-bottom: 1px solid rgba(0,229,255,0.5);
  box-shadow: 0 0 60px 8px rgba(0,212,255,0.12);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  transform: translateY(-110%);
  animation: hudScan 9.5s cubic-bezier(0.45,0,0.55,1) infinite;
}
@keyframes hudScan {
  0%, 12% { transform: translateY(-110%); }
  88%, 100% { transform: translateY(460%); }
}
/* 边缘刻度：顶部 + 右侧，两端淡出避开四角标 */
.hud-ruler { position: absolute; }
.hud-ruler-x {
  top: 0; left: 0; right: 0; height: 22px;
  background:
    repeating-linear-gradient(90deg, rgba(0,212,255,0.30) 0 1px, transparent 1px 56px),
    repeating-linear-gradient(90deg, rgba(0,212,255,0.14) 0 1px, transparent 1px 14px);
  -webkit-mask-image: linear-gradient(90deg, transparent 56px, #000 96px, #000 calc(100% - 96px), transparent calc(100% - 56px));
  mask-image: linear-gradient(90deg, transparent 56px, #000 96px, #000 calc(100% - 96px), transparent calc(100% - 56px));
}
.hud-ruler-y {
  top: 0; bottom: 0; right: 0; width: 22px;
  background:
    repeating-linear-gradient(0deg, rgba(0,212,255,0.30) 0 1px, transparent 1px 56px),
    repeating-linear-gradient(0deg, rgba(0,212,255,0.14) 0 1px, transparent 1px 14px);
  -webkit-mask-image: linear-gradient(0deg, transparent 56px, #000 96px, #000 calc(100% - 96px), transparent calc(100% - 56px));
  mask-image: linear-gradient(0deg, transparent 56px, #000 96px, #000 calc(100% - 96px), transparent calc(100% - 56px));
}
/* HUD 四角括弧 */
.hud-corner {
  position: absolute;
  width: 28px;
  height: 28px;
  border: 0 solid rgba(0,229,255,0.6);
  filter: drop-shadow(0 0 6px rgba(0,212,255,0.45));
}
.hud-corner.is-tl { top: 10px; left: 10px; border-top-width: 2px; border-left-width: 2px; }
.hud-corner.is-tr { top: 10px; right: 10px; border-top-width: 2px; border-right-width: 2px; }
.hud-corner.is-bl { bottom: 10px; left: 10px; border-bottom-width: 2px; border-left-width: 2px; }
.hud-corner.is-br { bottom: 10px; right: 10px; border-bottom-width: 2px; border-right-width: 2px; }
.leaflet-control-zoom {
  margin: 52px 0 0 12px !important;
  border: 1px solid rgba(0,212,255,0.3) !important;
  box-shadow: 0 0 20px rgba(0,212,255,0.2), inset 0 0 10px rgba(0,20,40,0.5) !important;
  border-radius: 6px !important;
  overflow: hidden;
  background: rgba(10,20,35,0.9) !important;
}
.leaflet-control-zoom a {
  width: 34px !important; height: 34px !important; line-height: 34px !important;
  background: transparent !important;
  color: #00d4ff !important;
  border: none !important;
  border-bottom: 1px solid rgba(0,212,255,0.15) !important;
  backdrop-filter: blur(8px);
  font-size: 18px !important;
  text-shadow: 0 0 8px rgba(0,212,255,0.6);
}
.leaflet-control-zoom a:hover {
  background: rgba(0,212,255,0.15) !important;
  color: #fff !important;
  text-shadow: 0 0 12px rgba(0,212,255,1);
}
.leaflet-control-zoom a:last-child { border-bottom: none !important; }
.leaflet-control-attribution {
  background: rgba(10,20,35,0.85) !important;
  color: rgba(0,212,255,0.5) !important;
  font-size: 10px;
  backdrop-filter: blur(8px);
  padding: 2px 8px;
  margin-right: 48px !important;
  margin-bottom: 16px !important;
  border-radius: 4px;
  border: 1px solid rgba(0,212,255,0.15);
}
.leaflet-control-attribution a { color: rgba(0,212,255,0.7) !important; }

/* ---------- 校区标记 ---------- */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.campus-marker {
  transform: translate(-50%, -100%);
  display: flex; flex-direction: column; align-items: center;
  gap: 0; cursor: pointer; user-select: none;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.35));
}
.campus-emblem {
  width: 42px; height: 42px; border-radius: 50%;
  margin-bottom: 3px;
  border: 2px solid rgba(0,212,255,0.8);
  box-shadow: 0 0 20px rgba(0,212,255,0.6), 0 0 40px rgba(0,150,255,0.4), inset 0 0 10px rgba(0,212,255,0.2);
  transition: transform .2s, filter .2s;
  animation: emblemPulse 2s ease-in-out infinite;
}
@keyframes emblemPulse {
  0%, 100% { box-shadow: 0 0 20px rgba(0,212,255,0.6), 0 0 40px rgba(0,150,255,0.4), inset 0 0 10px rgba(0,212,255,0.2); }
  50% { box-shadow: 0 0 30px rgba(0,212,255,0.9), 0 0 60px rgba(0,150,255,0.6), inset 0 0 15px rgba(0,212,255,0.3); }
}
.campus-emblem img { display: block; width: 100%; height: 100%; }
.campus-marker:hover .campus-emblem,
.campus-marker:focus-visible .campus-emblem {
  transform: scale(1.1);
  border-color: #00e5ff;
  box-shadow: 0 0 30px rgba(0,229,255,0.8), 0 0 60px rgba(0,150,255,0.5);
}
.campus-pin {
  width: 0; height: 0;
  border-left: 7px solid transparent; border-right: 7px solid transparent;
  border-top: 8px solid #00e5ff; margin-top: -1px;
  filter: drop-shadow(0 0 6px rgba(0,229,255,0.8));
}
.campus-dot {
  position: relative; width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle, #00e5ff 0%, #0088aa 100%);
  border: 2.5px solid rgba(0,229,255,0.9);
  box-shadow: 0 0 15px rgba(0,229,255,0.9), 0 0 30px rgba(0,150,255,0.5), 0 0 50px rgba(0,212,255,0.3);
  margin-top: -2px;
}
.campus-dot::before {
  content: ""; position: absolute; inset: -12px; border-radius: 50%;
  border: 1.5px solid rgba(0,229,255,0.3);
  animation: dotRing 3s linear infinite;
}
.campus-dot::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid rgba(0,229,255,0.5);
  animation: dotPulse 2.6s ease-out infinite;
}
@keyframes dotPulse {
  0% { transform: scale(.5); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}
@keyframes dotRing {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ---------- 科技感弹窗 ---------- */
.campus-popup .leaflet-popup-content-wrapper {
  background: linear-gradient(160deg, #0A1A2E 0%, #061220 100%);
  color: #E8F1F8;
  border: 1.5px solid rgba(0,212,255,0.6);
  border-radius: 8px;
  box-shadow:
    0 0 40px rgba(0,212,255,0.4),
    0 0 80px rgba(0,100,200,0.2),
    inset 0 0 30px rgba(0,30,60,0.6);
  /* 弹窗根元素承担 Leaflet 的定位 transform，动画放在内层包裹层 */
  animation: popIn .4s cubic-bezier(.22,1.5,.42,1) both;
  transform-origin: 50% 100%;
}
.campus-popup .leaflet-popup-content {
  margin: 0;
  padding: 14px 16px 15px;
  font-size: 12.5px;
  line-height: 1.6;
}
.campus-popup .leaflet-popup-tip {
  background: #061220;
  border: 1.5px solid rgba(0,212,255,0.6);
  box-shadow: 0 0 20px rgba(0,212,255,0.3);
}
/* 视口高度不足时弹窗被压缩，内容内部滚动 */
.campus-popup .leaflet-popup-scrolled {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(143,216,247,.45) transparent;
}
.campus-popup .leaflet-popup-scrolled::-webkit-scrollbar { width: 5px; }
.campus-popup .leaflet-popup-scrolled::-webkit-scrollbar-thumb {
  background: rgba(143,216,247,.45); border-radius: 3px;
}
.campus-popup a.leaflet-popup-close-button {
  color: #7FA6C0 !important;
  font-size: 20px !important;
  padding: 6px 8px 0 0 !important;
}
.campus-popup a.leaflet-popup-close-button:hover { color: #8FD8F7 !important; }

.popup-logo {
  display: flex; justify-content: center;
  margin-bottom: 9px;
  animation: logoPop .55s cubic-bezier(.22,1.5,.42,1) both;
}
.popup-logo img {
  width: 58px; height: 58px;
  filter: drop-shadow(0 0 20px rgba(0,212,255,0.8)) drop-shadow(0 0 40px rgba(0,150,255,0.4));
  animation: logoGlow 2.5s ease-in-out infinite alternate;
}
@keyframes logoGlow {
  from { filter: drop-shadow(0 0 15px rgba(0,212,255,0.6)) drop-shadow(0 0 30px rgba(0,150,255,0.3)); }
  to   { filter: drop-shadow(0 0 25px rgba(0,212,255,1)) drop-shadow(0 0 50px rgba(0,150,255,0.6)); }
}
.popup-name,
.popup-region,
.popup-line,
.popup-enter-3d { animation: fadeUp .42s ease-out both; }
.popup-name {
  font-size: 13.5px; font-weight: 600; color: #00e5ff;
  letter-spacing: .08em; text-align: center;
  text-shadow: 0 0 10px rgba(0,229,255,0.5);
  animation-delay: .12s;
}
.popup-region {
  text-align: center; color: #00b8d4; font-size: 11.5px;
  letter-spacing: .15em; margin: 2px 0 10px;
  animation-delay: .18s;
}
.popup-line {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 3px 0;
  border-top: 1px solid rgba(0,212,255,0.3);
}
.popup-region ~ .popup-line { animation-delay: .24s; }
.popup-region ~ .popup-line + .popup-line { animation-delay: .3s; }
.popup-region ~ .popup-line + .popup-line + .popup-line { animation-delay: .36s; }
.popup-label { flex: none; width: 72px; color: rgba(0,212,255,0.7); }
.popup-text { color: #C8E6F0; }
.popup-enter-3d {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  width: 100%; margin-top: 12px; padding: 9px 12px;
  font-family: var(--font); font-size: 12.5px; font-weight: 600;
  letter-spacing: .08em; color: #001a2e; cursor: pointer;
  background: linear-gradient(135deg, #00e5ff 0%, #0099cc 100%);
  border: 1.5px solid rgba(0,229,255,0.8); border-radius: 6px;
  box-shadow:
    0 0 25px rgba(0,229,255,0.6),
    0 6px 20px rgba(0,150,255,0.4),
    inset 0 1px 0 rgba(255,255,255,0.25);
  animation: fadeUp .42s ease-out .42s both, btnPulse 2s ease-in-out infinite;
  transition: transform .18s, box-shadow .18s;
}
@keyframes btnPulse {
  0%, 100% { box-shadow: 0 0 25px rgba(0,229,255,0.6), 0 6px 20px rgba(0,150,255,0.4); }
  50% { box-shadow: 0 0 45px rgba(0,229,255,0.9), 0 6px 30px rgba(0,150,255,0.6); }
}
.popup-enter-3d:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 50px rgba(0,229,255,1), 0 10px 30px rgba(0,150,255,0.6);
}
@keyframes popIn {
  from { opacity: 0; transform: translateY(10px) scale(.88); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes logoPop {
  from { opacity: 0; transform: rotate(-22deg) scale(.55); }
  to { opacity: 1; transform: rotate(0) scale(1); }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---------- 过渡遮罩与浮动入口 ---------- */
.map-transition {
  position: absolute; inset: 0; z-index: 900;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px;
  background: rgba(5,12,20,0.88);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(0,212,255,0.3);
  animation: fadeUp .22s ease-out both;
}
.map-spinner {
  width: 42px; height: 42px; border-radius: 50%;
  border: 3px solid rgba(0,212,255,0.2);
  border-top-color: #00e5ff;
  box-shadow: 0 0 20px rgba(0,229,255,0.6), 0 0 40px rgba(0,150,255,0.3);
  animation: spin .82s linear infinite;
}
.map-transition-text {
  color: #00e5ff; font-size: 13px; letter-spacing: .15em;
  text-shadow: 0 0 10px rgba(0,229,255,0.6);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.enter-3d-btn {
  position: absolute; right: 26px; bottom: 26px; z-index: 800;
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  font-family: var(--font); font-size: 13px; font-weight: 600;
  letter-spacing: .08em; color: #001a2e; cursor: pointer;
  background: linear-gradient(135deg, #00e5ff 0%, #0088aa 100%);
  border: 1.5px solid rgba(0,229,255,0.8); border-radius: 6px;
  box-shadow:
    0 0 30px rgba(0,229,255,0.6),
    0 8px 25px rgba(0,100,200,0.4),
    inset 0 1px 0 rgba(255,255,255,0.25);
  animation: fadeUp .34s ease-out both, btnPulse 2.5s ease-in-out infinite;
  transition: transform .18s, box-shadow .18s;
}
.enter-3d-btn:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow:
    0 0 45px rgba(0,229,255,0.9),
    0 12px 35px rgba(0,100,200,0.5),
    inset 0 1px 0 rgba(255,255,255,0.3);
}

@media (prefers-reduced-motion: reduce) {
  .campus-popup .leaflet-popup-content-wrapper,
  .popup-logo,
  .popup-name,
  .popup-region,
  .popup-line,
  .popup-enter-3d,
  .map-transition,
  .enter-3d-btn { animation: none !important; }
  .hud-scan { animation: none !important; }
  .campus-dot::after { animation: none !important; opacity: 0; }
  .map-spinner { animation-duration: 2s; }
}
</style>