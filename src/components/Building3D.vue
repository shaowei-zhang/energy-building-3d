<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { BUILDING_NODES, DATA_NOTE } from '../data/campus'
import CampusInfoPanel from './CampusInfoPanel.vue'

const emit = defineEmits(['back'])

const hostEl = ref(null)
const failed = ref(false)
const active = ref(null)
// 标签显隐（背面隐藏），只在状态变化时写回，避免逐帧触发重渲染
const visible = ref(BUILDING_NODES.map(() => true))

// 标签 DOM 逐帧直接改 transform，不走响应式
const labelEls = []
function setLabelEl(el, i) {
  labelEls[i] = el
}

const nodes = []
let THREE = null
let renderer = null
let scene = null
let camera = null
let controls = null
let host = null
let rafId = 0
let resumeTimer = 0
let resizeObserver = null
let reduceMotion = false

const TONE_COLORS = {
  blue: 0x46A8D6,
  green: 0x5BC98C,
  amber: 0xE0B04C,
  red: 0xE3706B
}

// ---------- 纹理生成函数 ----------

// 主楼：米白石材立面 + 深色窄窗 + 阳台（canvas 动态生成）
function makeFacadeTexture(opts = {}) {
  const {
    width = 512,
    height = 1024,
    windowCols = 8,
    windowRows = 6,
    litProbability = 0.35
  } = opts

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // 1. 石材底色
  ctx.fillStyle = '#E8DFD0'
  ctx.fillRect(0, 0, width, height)

  // 砖缝网格
  const brickH = height / windowRows
  const brickW = width / windowCols
  ctx.strokeStyle = 'rgba(160,145,120,.28)'
  ctx.lineWidth = 1.5
  for (let r = 0; r <= windowRows; r++) {
    ctx.beginPath()
    ctx.moveTo(0, r * brickH)
    ctx.lineTo(width, r * brickH)
    ctx.stroke()
  }
  for (let c = 0; c <= windowCols; c++) {
    const offset = (c % 2) * (brickW / 2)
    ctx.beginPath()
    ctx.moveTo(offset, 0)
    ctx.lineTo(offset, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(c * brickW, 0)
    ctx.lineTo(c * brickW, height)
    ctx.stroke()
  }

  // 2. 窗户
  const winPadX = brickW * 0.22
  const winPadY = brickH * 0.28
  const winW = brickW - winPadX * 2
  const winH = brickH - winPadY * 2
  for (let r = 0; r < windowRows; r++) {
    for (let c = 0; c < windowCols; c++) {
      const seed = ((r * windowCols + c) * 37 + 13) % 100
      const x = c * brickW + winPadX
      const y = r * brickH + winPadY
      ctx.fillStyle = '#1A2A3A'
      ctx.fillRect(x, y, winW, winH)
      if (seed < litProbability * 100) {
        ctx.fillStyle = 'rgba(180,215,245,.55)'
        ctx.fillRect(x + 1, y + 1, winW - 2, winH - 2)
      } else {
        ctx.fillStyle = 'rgba(20,35,55,.85)'
        ctx.fillRect(x + 1, y + 1, winW - 2, winH - 2)
      }
      ctx.strokeStyle = '#121E2D'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, winW, winH)
      ctx.beginPath()
      ctx.moveTo(x + winW / 2, y)
      ctx.lineTo(x + winW / 2, y + winH)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y + winH / 2)
      ctx.lineTo(x + winW, y + winH / 2)
      ctx.stroke()
    }
  }

  // 3. 阳台
  const balconyRows = [1, 3]
  const balconyCols = [1, 2, 3]
  for (const r of balconyRows) {
    for (const c of balconyCols) {
      const bx = c * brickW + winPadX - 3
      const by = r * brickH + winPadY + winH
      const bw = winW + 6
      const bh = brickH * 0.22
      ctx.fillStyle = '#B8A898'
      ctx.fillRect(bx, by, bw, bh)
      const railH = brickH * 0.28
      ctx.strokeStyle = '#4A3F35'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + bw, by)
      ctx.stroke()
      const postCount = Math.floor(bw / 10)
      for (let p = 0; p <= postCount; p++) {
        const px = bx + (p / postCount) * bw
        ctx.beginPath()
        ctx.moveTo(px, by)
        ctx.lineTo(px, by - railH)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(bx, by - railH)
      ctx.lineTo(bx + bw, by - railH)
      ctx.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  return tex
}

// 基座纹理
function makePedestalTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#8C8278'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = 'rgba(100,90,80,.3)'
  ctx.lineWidth = 1
  const rows = 4, cols = 8
  const rh = 128 / rows, rw = 256 / cols
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * rh); ctx.lineTo(256, r * rh); ctx.stroke()
  }
  for (let c = 0; c <= cols; c++) {
    const off = (c % 2) * (rw / 2)
    ctx.beginPath(); ctx.moveTo(off, 0); ctx.lineTo(off, 128); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(c * rw, 0); ctx.lineTo(c * rw, 128); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 2
  return tex
}

// 栏杆纹理
function makeRailingTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#9E958A'
  ctx.fillRect(0, 0, 256, 64)
  ctx.strokeStyle = '#5A5045'
  ctx.lineWidth = 2
  const count = 16
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * 256
    ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 56); ctx.stroke()
  }
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(256, 12); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, 52); ctx.lineTo(256, 52); ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

// 锚点光晕 sprite 纹理
function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,.95)')
  grad.addColorStop(.28, 'rgba(255,255,255,.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

// ---------- 场景构建 ----------

function buildScene(Controls) {
  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300)
  camera.position.set(13, 12, 17)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  controls = new Controls(camera, renderer.domElement)
  controls.target.set(0, 4.3, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = 8
  controls.maxDistance = 42
  controls.maxPolarAngle = Math.PI * 0.495
  controls.autoRotate = !reduceMotion
  controls.autoRotateSpeed = 0.7
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    if (resumeTimer) {
      window.clearTimeout(resumeTimer)
      resumeTimer = 0
    }
  })
  controls.addEventListener('end', () => {
    if (reduceMotion) return
    resumeTimer = window.setTimeout(() => {
      resumeTimer = 0
      if (controls) controls.autoRotate = true
    }, 3000)
  })

  // 灯光
  scene.add(new THREE.AmbientLight(0xC8D8E8, 0.85))
  const dirLight = new THREE.DirectionalLight(0xFFF4E0, 1.2)
  dirLight.position.set(9, 15, 10)
  scene.add(dirLight)
  const fillLight = new THREE.DirectionalLight(0xA8C8E0, 0.4)
  fillLight.position.set(-6, 8, -8)
  scene.add(fillLight)
  const pointLight = new THREE.PointLight(0x46A8D6, 1.2, 46, 2)
  pointLight.position.set(-7, 8, -7)
  scene.add(pointLight)

  // ---------- 底座 ----------
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(11.5, 64),
    new THREE.MeshBasicMaterial({ color: 0x1B4A6B, transparent: true, opacity: 0.22 })
  )
  base.rotation.x = -Math.PI / 2
  base.position.y = -0.04
  scene.add(base)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(11.5, 11.85, 64),
    new THREE.MeshBasicMaterial({ color: 0x46A8D6, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -0.03
  scene.add(ring)

  const grid = new THREE.GridHelper(24, 24, 0x2C6B90, 0x18384F)
  grid.position.y = -0.02
  grid.material.transparent = true
  grid.material.opacity = 0.45
  scene.add(grid)

  // ---------- 裙楼基座 ----------
  const pedestalTex = makePedestalTexture()
  const podiumMat = new THREE.MeshStandardMaterial({
    map: pedestalTex,
    roughness: 0.82,
    metalness: 0.15
  })
  const podium = new THREE.Mesh(new THREE.BoxGeometry(9.4, 1.9, 14.4), podiumMat)
  podium.position.y = 0.95
  scene.add(podium)

  // ---------- 主楼 ----------
  const facadeTex = makeFacadeTexture({ windowCols: 8, windowRows: 6 })
  const wallMat = new THREE.MeshStandardMaterial({
    map: facadeTex,
    roughness: 0.78,
    metalness: 0.08
  })
  const main = new THREE.Mesh(
    new THREE.BoxGeometry(7, 5, 12),
    [wallMat, wallMat, wallMat, wallMat, wallMat, wallMat]
  )
  main.position.y = 1.9 + 2.5
  scene.add(main)

  // ---------- 屋顶女儿墙 ----------
  const railingTex = makeRailingTexture()
  const railingMat = new THREE.MeshStandardMaterial({
    map: railingTex,
    roughness: 0.65,
    metalness: 0.2
  })
  const parapetH = 1.1
  const parapetT = 0.18
  const longPanel = new THREE.Mesh(
    new THREE.BoxGeometry(7.4, parapetH, parapetT),
    railingMat
  )
  longPanel.position.set(0, 1.9 + 5 + parapetH / 2, 6.1)
  scene.add(longPanel)
  const longPanelBack = longPanel.clone()
  longPanelBack.position.z = -6.1
  scene.add(longPanelBack)
  const shortPanel = new THREE.Mesh(
    new THREE.BoxGeometry(parapetT, parapetH, 12.4),
    railingMat
  )
  shortPanel.position.set(3.7, 1.9 + 5 + parapetH / 2, 0)
  scene.add(shortPanel)
  const shortPanelL = shortPanel.clone()
  shortPanelL.position.x = -3.7
  scene.add(shortPanelL)

  const topBeamMat = new THREE.MeshStandardMaterial({ color: 0x8C8278, roughness: 0.7, metalness: 0.15 })
  const topBeamLong = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.24), topBeamMat)
  topBeamLong.position.set(0, 1.9 + 5 + parapetH, 6.1)
  scene.add(topBeamLong)
  const topBeamLongB = topBeamLong.clone()
  topBeamLongB.position.z = -6.1
  scene.add(topBeamLongB)
  const topBeamShort = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 12.4), topBeamMat)
  topBeamShort.position.set(3.7, 1.9 + 5 + parapetH, 0)
  scene.add(topBeamShort)
  const topBeamShortL = topBeamShort.clone()
  topBeamShortL.position.x = -3.7
  scene.add(topBeamShortL)

  // ---------- 楼顶机房 ----------
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9E958A, roughness: 0.72, metalness: 0.18 })
  const roofRoom = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 3.3), roofMat)
  roofRoom.position.set(-1.2, 1.9 + 5 + 0.65, 1.4)
  scene.add(roofRoom)

  // ---------- 楼顶水箱 ----------
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x6B8E9E, roughness: 0.5, metalness: 0.45 })
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 18), tankMat)
  tank.position.set(1.9, 1.9 + 5 + 0.75, -3.4)
  scene.add(tank)

  // ---------- 4 个发光锚点 ----------
  const glowTex = makeGlowTexture()
  const sphereGeo = new THREE.SphereGeometry(0.26, 18, 18)

  BUILDING_NODES.forEach((data) => {
    const color = TONE_COLORS[data.tone] ?? TONE_COLORS.blue

    const mesh = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshBasicMaterial({ color })
    )
    mesh.position.set(data.pos[0], data.pos[1], data.pos[2])
    mesh.userData.nodeId = data.id
    scene.add(mesh)

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    glow.scale.set(2.4, 2.4, 1)
    glow.position.copy(mesh.position)
    scene.add(glow)

    const normal = new THREE.Vector3(data.pos[0], 0, data.pos[2])
    if (normal.lengthSq() === 0) normal.set(0, 0, 1)
    normal.normalize()

    nodes.push({
      data,
      mesh,
      glow,
      world: new THREE.Vector3(data.pos[0], data.pos[1], data.pos[2]),
      normal
    })
  })

  // ---------- 自动按包围盒居中（忽略底座与网格） ----------
  const box = new THREE.Box3()
  scene.traverse((obj) => {
    if (obj.isMesh && obj !== base && obj !== ring) {
      box.expandByObject(obj)
    }
  })
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fitDist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))

    controls.target.copy(center)
    camera.position.copy(center).add(
      new THREE.Vector3(fitDist * 0.95, fitDist * 0.75, fitDist * 1.15)
    )
    controls.minDistance = fitDist * 0.55
    controls.maxDistance = fitDist * 3.2
    controls.update()
  }

  // 点击锚点小球打开信息面板
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(nodes.map((n) => n.mesh), false)[0]
    if (!hit) return
    const node = nodes.find((n) => n.mesh === hit.object)
    if (node) active.value = node.data
  })
}

// 每帧把锚点投影到屏幕，更新 HTML 标签位置与背面显隐
function updateLabels() {
  if (!host) return
  const w = host.clientWidth
  const h = host.clientHeight
  nodes.forEach((node, i) => {
    const el = labelEls[i]
    if (!el) return

    const p = node.world.clone().project(camera)
    const x = (p.x * 0.5 + 0.5) * w
    const y = (-p.y * 0.5 + 0.5) * h
    const behind = p.z > 1
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`

    const toCamera = camera.position.clone().sub(node.world)
    const facing = !behind && toCamera.dot(node.normal) > 0.35
    if (visible.value[i] !== facing) visible.value[i] = facing
  })
}

function resize() {
  if (!host || !renderer || !camera) return
  const w = host.clientWidth
  const h = host.clientHeight
  if (w === 0 || h === 0) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  // 注意：去掉第三个 false，让 canvas 的 CSS 尺寸与容器同步，避免高分屏下溢出
  renderer.setSize(w, h)
}

function tick() {
  rafId = requestAnimationFrame(tick)
  controls.update()
  renderer.render(scene, camera)
  updateLabels()
}

function disposeScene() {
  if (scene) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach((m) => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      }
    })
  }
  if (controls) {
    controls.dispose()
    controls = null
  }
  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }
  scene = null
  camera = null
  nodes.length = 0
}

onMounted(async () => {
  host = hostEl.value
  if (!host) return
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  try {
    const three = await import('three')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    THREE = three
    buildScene(OrbitControls)
  } catch (err) {
    console.error('[Building3D] three.js 初始化失败，已降级为静态标注列表', err)
    failed.value = true
    return
  }

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  tick()
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  if (resumeTimer) {
    window.clearTimeout(resumeTimer)
    resumeTimer = 0
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  disposeScene()
  host = null
})
</script>

<template>
  <div class="b3d-root">
    <div ref="hostEl" class="b3d-canvas"></div>

    <!-- 锚点标签层（每帧投影定位） -->
    <div v-if="!failed" class="b3d-labels" aria-hidden="false">
      <button
        v-for="(node, i) in BUILDING_NODES"
        :key="node.id"
        :ref="(el) => setLabelEl(el, i)"
        class="b3d-label"
        :class="`is-${node.tone}`"
        :style="{ opacity: visible[i] ? 1 : 0, pointerEvents: visible[i] ? 'auto' : 'none' }"
        type="button"
        @click="active = node"
      >
        <span class="b3d-label-dot" aria-hidden="true"></span>
        <span class="b3d-label-text">{{ node.title }}</span>
      </button>
    </div>

    <header class="b3d-toolbar">
      <button class="b3d-back" type="button" @click="emit('back')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
          <path d="M15 5l-7 7 7 7"/>
        </svg>
        返回地图
      </button>
      <p class="b3d-hint">拖拽旋转 · 滚轮缩放 · 点击发光锚点查看详情</p>
    </header>

    <CampusInfoPanel
      v-if="active"
      :title="active.title"
      :tone="active.tone"
      :rows="active.rows"
      :note="DATA_NOTE"
      @close="active = null"
    />

    <!-- three.js 不可用时的降级视图 -->
    <div v-if="failed" class="b3d-fallback" role="status">
      <h2 class="b3d-fallback-title">3D 楼宇暂时无法加载</h2>
      <p class="b3d-fallback-desc">已降级为静态标注入口，点击下方按钮仍可查看各标注点信息。</p>
      <ul class="b3d-fallback-list">
        <li v-for="node in BUILDING_NODES" :key="node.id">
          <button class="b3d-fallback-btn" :class="`is-${node.tone}`" type="button" @click="active = node">
            <span class="b3d-label-dot" aria-hidden="true"></span>
            {{ node.title }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.b3d-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 50% 0%, #1B3E5E 0%, #102637 46%, #081522 100%);
}
.b3d-canvas { position: absolute; inset: 0; }

/* 关键修复：强制 canvas 填满容器，避免高分屏下 2 倍尺寸溢出 */
.b3d-canvas canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* ---------- 锚点标签 ---------- */
.b3d-labels { position: absolute; inset: 0; pointer-events: none; }
.b3d-label {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px 5px 9px;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  white-space: nowrap;
  color: var(--tone-text);
  cursor: pointer;
  background: var(--tone-bg);
  border: 1px solid var(--tone-border);
  border-radius: 999px;
  box-shadow: 0 6px 18px rgba(3,10,20,.5), 0 0 14px var(--tone-glow);
  backdrop-filter: blur(6px);
  pointer-events: auto;
  transform: translate(-50%, -50%);
  transition: opacity .22s ease, box-shadow .18s, border-color .18s;
}
.b3d-label:hover { border-color: var(--tone-text); box-shadow: 0 8px 22px rgba(3,10,20,.6), 0 0 22px var(--tone-glow); }
.b3d-label-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 9px currentColor;
  flex: none;
}
.b3d-label.is-blue { --tone-text: #9BDDF8; --tone-bg: rgba(18,50,74,.86); --tone-border: rgba(70,168,214,.6); --tone-glow: rgba(70,168,214,.34); }
.b3d-label.is-green { --tone-text: #86E2AF; --tone-bg: rgba(17,54,42,.86); --tone-border: rgba(91,201,140,.6); --tone-glow: rgba(91,201,140,.34); }
.b3d-label.is-amber { --tone-text: #F0CE86; --tone-bg: rgba(60,47,18,.86); --tone-border: rgba(224,176,76,.6); --tone-glow: rgba(224,176,76,.34); }
.b3d-label.is-red { --tone-text: #F2A6A2; --tone-bg: rgba(62,26,26,.86); --tone-border: rgba(227,112,107,.6); --tone-glow: rgba(227,112,107,.34); }

/* ---------- 顶部工具条 ---------- */
.b3d-toolbar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 22px;
  pointer-events: none;
}
.b3d-back {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  font-family: var(--font); font-size: 12.5px; font-weight: 600;
  letter-spacing: .05em; color: #EAF6FF; cursor: pointer;
  background: rgba(19,42,63,.8);
  border: 1px solid rgba(143,216,247,.36);
  border-radius: 9px;
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 20px rgba(3,10,20,.4);
  pointer-events: auto;
  transition: border-color .18s, transform .18s;
}
.b3d-back:hover { border-color: #8FD8F7; transform: translateY(-1px); }
.b3d-hint {
  font-size: 11.5px;
  letter-spacing: .08em;
  color: rgba(198,222,238,.6);
}

/* ---------- 降级视图 ---------- */
.b3d-fallback {
  position: absolute;
  inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px;
  padding: 0 24px;
  text-align: center;
}
.b3d-fallback-title { font-size: 17px; font-weight: 600; color: #EAF6FF; }
.b3d-fallback-desc { font-size: 12.5px; color: rgba(198,222,238,.72); }
.b3d-fallback-list {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px; margin-top: 10px; padding: 0; list-style: none;
}
.b3d-fallback-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 18px;
  font-family: var(--font); font-size: 12.5px; font-weight: 600;
  color: var(--tone-text); cursor: pointer;
  background: var(--tone-bg);
  border: 1px solid var(--tone-border);
  border-radius: 10px;
  transition: transform .18s, border-color .18s;
}
.b3d-fallback-btn:hover { transform: translateY(-1px); border-color: var(--tone-text); }
.b3d-fallback-btn.is-blue { --tone-text: #9BDDF8; --tone-bg: rgba(18,50,74,.86); --tone-border: rgba(70,168,214,.6); }
.b3d-fallback-btn.is-green { --tone-text: #86E2AF; --tone-bg: rgba(17,54,42,.86); --tone-border: rgba(91,201,140,.6); }
.b3d-fallback-btn.is-amber { --tone-text: #F0CE86; --tone-bg: rgba(60,47,18,.86); --tone-border: rgba(224,176,76,.6); }
.b3d-fallback-btn.is-red { --tone-text: #F2A6A2; --tone-bg: rgba(62,26,26,.86); --tone-border: rgba(227,112,107,.6); }

@media (max-width: 720px) {
  .b3d-hint { display: none; }
  .b3d-fallback-list { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .b3d-label, .b3d-back, .b3d-fallback-btn { transition: none; }
}
</style>