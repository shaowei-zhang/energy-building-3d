<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CAMPUSES } from '../data/campus'
import emblemUrl from '../assets/hhu-emblem.svg'

const emit = defineEmits(['enter3d', 'zoom'])

// 最深层级：既是底图上限，也是 3D 楼宇的出现层级
const Z3D = 18
// 初始缩放级别（同时是初始视野的上限，用于完整展示三个校区）
const INITIAL_ZOOM = 11
// 高德栅格瓦片（注意 scale 必须为 1，scale=2 服务端返回 404 会被浏览器 ORB 拦截）
const GAODE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
// 瓦片累计错误阈值，超过后自动切换备用底图
const TILE_ERROR_LIMIT = 10
// 弹窗、标记与视口边界之间需要保留的安全间距
const EDGE_GAP = 12
// 弹窗被压缩时的最小内容高度（低于此值不再压缩，改为视口裁切）
const POPUP_MIN_HEIGHT = 96

const mapEl = ref(null)
const transitioning = ref(false)
const showEnterBtn = ref(false)

let map = null
let tileErrors = 0
let fellBack = false
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.6l7.4 4.2L12 11 4.6 6.8 12 2.6z" fill="currentColor" opacity=".9"/>
          <path d="M4.6 6.8L12 11v10.4l-7.4-4.2V6.8z" fill="currentColor" opacity=".55"/>
          <path d="M19.4 6.8L12 11v10.4l7.4-4.2V6.8z" fill="currentColor" opacity=".75"/>
        </svg>
        进入 3D 楼宇
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

  const gaode = L.tileLayer(GAODE_URL, {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: Z3D,
    attribution: '© <a href="https://ditu.amap.com/" target="_blank">高德地图</a>'
  })
  const osm = L.tileLayer(OSM_URL, {
    maxZoom: Z3D,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
  })

  // 底图异常自动降级
  gaode.on('tileerror', () => {
    tileErrors += 1
    if (!fellBack && tileErrors > TILE_ERROR_LIMIT) {
      fellBack = true
      map.removeLayer(gaode)
      osm.addTo(map)
    }
  })
  gaode.addTo(map)

  // 弹窗按钮点击：使用事件委托。
  // 原因：placePopup 会调用 popup.update()，Leaflet 内部以 innerHTML 重建弹窗内容，
  // 直接绑在按钮上的监听器会随旧 DOM 一起失效；委托在地图容器上则始终有效
  map.getContainer().addEventListener('click', (e) => {
    if (e.target.closest('.popup-enter-3d')) emit('enter3d')
  })

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

    // 弹窗内容定位（按钮点击改用容器事件委托，见下方）
    marker.on('popupopen', () => {
      placePopup(marker)
    })

    marker.on('click', () => {
      // 已在最深层级：不自动进 3D，只给出浮动入口
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

    // 手动缩放到位：过渡遮罩停留 650ms 后自动进入 3D
    transitioning.value = true
    showEnterBtn.value = false
    enterTimer = window.setTimeout(() => {
      enterTimer = 0
      transitioning.value = false
      emit('enter3d')
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
    <div ref="mapEl" class="campus-map-canvas"></div>

    <!-- 缩放到位后的过渡遮罩 -->
    <div v-if="transitioning" class="map-transition">
      <div class="map-spinner" aria-hidden="true"></div>
      <p class="map-transition-text">正在进入能源楼 3D 楼宇…</p>
    </div>

    <!-- 点击点位下钻后出现的浮动入口 -->
    <button v-if="showEnterBtn" class="enter-3d-btn" type="button" @click="emit('enter3d')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2.6l7.4 4.2L12 11 4.6 6.8 12 2.6z" fill="currentColor" opacity=".9"/>
        <path d="M4.6 6.8L12 11v10.4l-7.4-4.2V6.8z" fill="currentColor" opacity=".55"/>
        <path d="M19.4 6.8L12 11v10.4l7.4-4.2V6.8z" fill="currentColor" opacity=".75"/>
      </svg>
      进入 3D 楼宇
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
  background: var(--bg);
  font-family: var(--font);
  outline: none;
}
/* 浅色高德/OSM 瓦片整体转为深色科技底：反相 + 色相 180° 保持水系为青蓝。
   滤镜只加在 tilePane，标记、弹窗、控件所在的其它 pane 不受影响 */
.leaflet-tile-pane {
  filter: invert(.92) hue-rotate(180deg) brightness(.94) saturate(.72) contrast(.94);
}
.leaflet-container::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 350;
  pointer-events: none;
  background: radial-gradient(130% 90% at 50% 0%, rgba(70, 168, 214, .10), transparent 55%),
              linear-gradient(180deg, rgba(46, 134, 171, .05), rgba(6, 18, 36, .12));
}
.leaflet-control-zoom { border: none !important; box-shadow: 0 4px 16px rgba(2, 10, 22, .5) !important; }
.leaflet-control-zoom a {
  width: 34px !important; height: 34px !important; line-height: 34px !important;
  background: rgba(13, 32, 50, .9) !important;
  color: #9BDDF8 !important;
  border: 1px solid rgba(143, 216, 247, .3) !important;
  backdrop-filter: blur(4px);
  font-size: 18px !important;
}
.leaflet-control-zoom a:hover { background: rgba(27, 58, 84, .95) !important; color: #EAF6FF !important; }
.leaflet-control-attribution {
  background: rgba(8, 21, 34, .78) !important;
  color: var(--txt-dim) !important;
  font-size: 10px;
  backdrop-filter: blur(4px);
  padding: 2px 8px;
  border-radius: 6px 0 0;
}
.leaflet-control-attribution a { color: var(--accent) !important; }

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
  filter: drop-shadow(0 6px 9px rgba(3,12,24,.55)) drop-shadow(0 0 13px rgba(70,168,214,.65));
  transition: transform .2s, filter .2s;
}
.campus-emblem img { display: block; width: 100%; height: 100%; }
.campus-marker:hover .campus-emblem,
.campus-marker:focus-visible .campus-emblem {
  transform: scale(1.09);
  filter: drop-shadow(0 8px 13px rgba(3,12,24,.6)) drop-shadow(0 0 22px rgba(70,168,214,.95));
}
.campus-pin {
  width: 0; height: 0;
  border-left: 7px solid transparent; border-right: 7px solid transparent;
  border-top: 8px solid #46A8D6; margin-top: -1px;
}
.campus-dot {
  position: relative; width: 18px; height: 18px; border-radius: 50%;
  background: #46A8D6; border: 2.5px solid #EAF6FF;
  box-shadow: 0 0 12px rgba(70,168,214,.9), 0 0 24px rgba(70,168,214,.55);
  margin-top: -2px;
}
.campus-dot::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid rgba(143,216,247,.7);
  animation: dotPulse 2.6s ease-out infinite;
}
@keyframes dotPulse {
  0% { transform: scale(.5); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
}

/* ---------- 暗色弹窗 ---------- */
.campus-popup .leaflet-popup-content-wrapper {
  background: linear-gradient(160deg, #16293F, #0B1826);
  color: #E8F1F8;
  border: 1px solid rgba(46,134,171,.5);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(6,16,28,.5), 0 0 0 1px rgba(143,216,247,.08);
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
  background: #0B1826;
  border: 1px solid rgba(46,134,171,.5);
  box-shadow: none;
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
  filter: drop-shadow(0 8px 14px rgba(3,10,20,.55)) drop-shadow(0 0 16px rgba(46,134,171,.55));
}
.popup-name,
.popup-region,
.popup-line,
.popup-enter-3d { animation: fadeUp .42s ease-out both; }
.popup-name {
  font-size: 13.5px; font-weight: 600; color: #F2F9FF;
  letter-spacing: .02em; text-align: center;
  animation-delay: .12s;
}
.popup-region {
  text-align: center; color: #8FD8F7; font-size: 11.5px;
  letter-spacing: .1em; margin: 2px 0 10px;
  animation-delay: .18s;
}
.popup-line {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 3px 0;
  border-top: 1px solid rgba(143,216,247,.14);
}
.popup-region ~ .popup-line { animation-delay: .24s; }
.popup-region ~ .popup-line + .popup-line { animation-delay: .3s; }
.popup-region ~ .popup-line + .popup-line + .popup-line { animation-delay: .36s; }
.popup-label { flex: none; width: 72px; color: #7FA6C0; }
.popup-text { color: #D6E6F2; }
.popup-enter-3d {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  width: 100%; margin-top: 12px; padding: 9px 12px;
  font-family: var(--font); font-size: 12.5px; font-weight: 600;
  letter-spacing: .06em; color: #06202E; cursor: pointer;
  background: linear-gradient(135deg, #8FD8F7, #46A8D6);
  border: none; border-radius: 9px;
  box-shadow: 0 6px 16px rgba(46,134,171,.42);
  animation-delay: .42s;
  transition: transform .18s, box-shadow .18s;
}
.popup-enter-3d:hover {
  transform: translateY(-1px);
  box-shadow: 0 9px 22px rgba(46,134,171,.6);
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
  background: rgba(11,24,38,.74);
  backdrop-filter: blur(3px);
  animation: fadeUp .22s ease-out both;
}
.map-spinner {
  width: 42px; height: 42px; border-radius: 50%;
  border: 3px solid rgba(143,216,247,.24);
  border-top-color: #8FD8F7;
  animation: spin .82s linear infinite;
}
.map-transition-text {
  color: #D6E6F2; font-size: 13px; letter-spacing: .1em;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.enter-3d-btn {
  position: absolute; right: 26px; bottom: 26px; z-index: 800;
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  font-family: var(--font); font-size: 13px; font-weight: 600;
  letter-spacing: .06em; color: #EAF6FF; cursor: pointer;
  background: linear-gradient(140deg, #1B3350, #0F2233);
  border: 1px solid rgba(46,134,171,.6); border-radius: 11px;
  box-shadow: 0 10px 26px rgba(11,32,56,.4), 0 0 20px rgba(46,134,171,.28);
  animation: fadeUp .34s ease-out both;
  transition: transform .18s, box-shadow .18s, border-color .18s;
}
.enter-3d-btn:hover {
  transform: translateY(-2px);
  border-color: #5BB3E0;
  box-shadow: 0 14px 32px rgba(11,32,56,.5), 0 0 30px rgba(46,134,171,.5);
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
  .campus-dot::after { animation: none !important; opacity: 0; }
  .map-spinner { animation-duration: 2s; }
}
</style>