<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { BUILDING_NODES, DATA_NOTE } from '../data/campus'
import CampusInfoPanel from './CampusInfoPanel.vue'
// 可切换的模型：能源楼整体 + 各楼层（?url 让 Vite 以静态资源方式提供，不内联）
import buildingAllUrl from '../model/能源楼.glb?url'
import floor1Url from '../model/能源楼一楼.glb?url'
import floor2Url from '../model/能源楼二楼.glb?url'

const emit = defineEmits(['back'])

const FLOORS = [
  { id: 'all', name: '整体', url: buildingAllUrl, sizeText: '约 232 MB' },
  { id: 'floor1', name: '一楼', url: floor1Url, sizeText: '约 56 MB' },
  { id: 'floor2', name: '二楼', url: floor2Url, sizeText: '约 155 MB' }
]

const hostEl = ref(null)
const bgEl = ref(null)
const failed = ref(false)
const loading = ref(true)
const loadProgress = ref(0)
const currentFloorId = ref(FLOORS[0].id)
const currentFloor = computed(() => FLOORS.find((f) => f.id === currentFloorId.value) ?? FLOORS[0])
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
let envRT = null
let baseMesh = null
let ringMesh = null
let gridMesh = null
let buildingGroup = null // 当前建筑（GLB 楼层或降级示意楼）的容器
let loadToken = 0 // 模型加载竞态令牌，快速切换时丢弃过期结果
let anchorGeo = null // 锚点小球共享几何体
let anchorGlowTex = null // 锚点光晕共享纹理

// 流光背景（独立 2D canvas，位于 WebGL 画布下层）
let bgCtx = null
let bgRafId = 0
let bgWidth = 0
let bgHeight = 0
let bgDpr = 1
let bgParticles = []

// 展台科技装饰环
let haloRing = null
let dashRing = null

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

// 展台虚线环纹理（沿圆周方向的虚线段，配合旋转产生扫描感）
function makeRingDashTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 16)
  // 每 32px 一段：18px 亮段 + 14px 间隔；沿径向画柔和渐变线
  for (let x = 0; x < 256; x += 32) {
    const grad = ctx.createLinearGradient(x, 0, x + 18, 0)
    grad.addColorStop(0, 'rgba(140,220,250,0)')
    grad.addColorStop(0.5, 'rgba(170,232,255,.95)')
    grad.addColorStop(1, 'rgba(140,220,250,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, 5, 18, 6)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

// 自定义环带几何体：U 沿圆周均匀展开（0~1），V 沿径向（内 0 / 外 1），
// 这样贴虚线纹理时每段都在环上等距排列，旋转即可形成扫描效果
function makeCircularRingGeometry(inner, outer, segments = 192) {
  const positions = []
  const uvs = []
  const indices = []

  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const theta = u * Math.PI * 2
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    positions.push(inner * sin, inner * cos, 0)
    positions.push(outer * sin, outer * cos, 0)
    uvs.push(u, 0)
    uvs.push(u, 1)
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c, b, d, c)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// ---------- 流光溢彩背景（独立 2D 画布） ----------

// 缓慢漂移的彩色极光光团（相对画面尺寸定位，色彩偏冷并点缀青紫，营造展台氛围）
const BG_BLOBS = [
  { rgb: [46, 168, 214], baseX: 0.26, baseY: 0.32, ampX: 0.16, ampY: 0.12, speed: 0.00013, speed2: 0.00009, phase: 0.0, radius: 0.62, alpha: 0.30 },
  { rgb: [86, 110, 240], baseX: 0.80, baseY: 0.24, ampX: 0.13, ampY: 0.16, speed: -0.00010, speed2: 0.00012, phase: 2.1, radius: 0.58, alpha: 0.26 },
  { rgb: [156, 92, 232], baseX: 0.74, baseY: 0.80, ampX: 0.18, ampY: 0.10, speed: 0.00008, speed2: -0.00011, phase: 4.2, radius: 0.55, alpha: 0.18 },
  { rgb: [48, 210, 190], baseX: 0.16, baseY: 0.84, ampX: 0.14, ampY: 0.12, speed: -0.00012, speed2: 0.00008, phase: 1.3, radius: 0.50, alpha: 0.20 },
  { rgb: [120, 190, 255], baseX: 0.50, baseY: -0.06, ampX: 0.24, ampY: 0.08, speed: 0.00007, speed2: 0.00005, phase: 3.4, radius: 0.72, alpha: 0.15 }
]

function initBackground() {
  const canvas = bgEl.value
  if (!canvas) return
  bgCtx = canvas.getContext('2d')
  if (!bgCtx) return
  resizeBackground()

  // 悬浮微粒：缓慢上浮 + 明暗呼吸
  bgParticles = Array.from({ length: 70 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.6 + Math.random() * 1.5,
    vx: (Math.random() - 0.5) * 0.000004,
    vy: 0.000006 + Math.random() * 0.000012,
    tw: 0.0008 + Math.random() * 0.0016,
    phase: Math.random() * Math.PI * 2
  }))

  if (reduceMotion) {
    renderBackground(0)
  } else {
    bgRafId = requestAnimationFrame(tickBackground)
  }
}

function tickBackground(t) {
  bgRafId = requestAnimationFrame(tickBackground)
  renderBackground(t)
}

function renderBackground(t) {
  const ctx = bgCtx
  if (!ctx || bgWidth === 0) return
  const w = bgWidth
  const h = bgHeight

  // 深空蓝底色：上亮下深，中心略透青
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#0A1C33')
  g.addColorStop(0.45, '#08172A')
  g.addColorStop(1, '#040D1C')
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // 极光光团（lighter 叠加 = 流光溢彩）
  ctx.globalCompositeOperation = 'lighter'
  const unit = Math.min(w, h)
  for (const b of BG_BLOBS) {
    const x = w * (b.baseX + Math.sin(t * b.speed + b.phase) * b.ampX)
    const y = h * (b.baseY + Math.cos(t * b.speed2 + b.phase * 1.7) * b.ampY)
    const r = unit * b.radius * (1 + 0.08 * Math.sin(t * b.speed * 2 + b.phase))
    const [cr, cg, cb] = b.rgb
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, `rgba(${cr},${cg},${cb},${b.alpha})`)
    rg.addColorStop(0.55, `rgba(${cr},${cg},${cb},${b.alpha * 0.42})`)
    rg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
    ctx.fillStyle = rg
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // 微粒
  for (const p of bgParticles) {
    const x = ((p.x * w + t * p.vx) % w + w) % w
    const y = h - (((p.y * h + t * p.vy) % h + h) % h)
    const a = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * p.tw + p.phase))
    ctx.fillStyle = `rgba(170,222,250,${a})`
    ctx.beginPath()
    ctx.arc(x, y, p.r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalCompositeOperation = 'source-over'
}

function resizeBackground() {
  const canvas = bgEl.value
  if (!canvas || !bgCtx) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  bgDpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(w * bgDpr)
  canvas.height = Math.round(h * bgDpr)
  bgCtx.setTransform(bgDpr, 0, 0, bgDpr, 0, 0)
  bgWidth = w
  bgHeight = h
  if (!bgRafId) renderBackground(performance.now())
}

function stopBackground() {
  if (bgRafId) cancelAnimationFrame(bgRafId)
  bgRafId = 0
  bgCtx = null
  bgParticles = []
}

// ---------- 场景构建 ----------

const GROUND_R = 11.5 // 底座基准半径，加载模型后按模型尺寸缩放
const MODEL_TARGET_SIZE = 15 // GLB 归一化后的最大边长

// 标注点对应模型包围盒的四个立面：system 前(+z)、energy 右(+x)、device 后(-z)、alarm 左(-x)
const NODE_SIDE = {
  system: { axis: 'z', sign: 1 },
  energy: { axis: 'x', sign: 1 },
  device: { axis: 'z', sign: -1 },
  alarm: { axis: 'x', sign: -1 }
}

// 只包含与楼宇模型无关的部分：渲染器 / 相机 / 控制器 / 灯光 / 底座 / 拾取
function initScene(Controls, RoomEnvironment) {
  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500)
  camera.position.set(13, 12, 17)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // ACES 电影级色调映射：暗部更深邃、高光不刺眼，配合深色流光背景更有展品质感
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  host.appendChild(renderer.domElement)

  // IBL 环境贴图：GLB 多为 PBR 材质，缺少环境反射会发暗/发黑
  const roomEnv = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  envRT = pmrem.fromScene(roomEnv, 0.04)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()
  if (roomEnv.dispose) roomEnv.dispose()

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
  baseMesh = new THREE.Mesh(
    new THREE.CircleGeometry(GROUND_R, 64),
    new THREE.MeshBasicMaterial({ color: 0x1B4A6B, transparent: true, opacity: 0.22 })
  )
  baseMesh.rotation.x = -Math.PI / 2
  baseMesh.position.y = -0.04
  scene.add(baseMesh)

  ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(GROUND_R, GROUND_R + 0.35, 64),
    new THREE.MeshBasicMaterial({ color: 0x46A8D6, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  )
  ringMesh.rotation.x = -Math.PI / 2
  ringMesh.position.y = -0.03
  scene.add(ringMesh)

  gridMesh = new THREE.GridHelper(24, 24, 0x2C6B90, 0x18384F)
  gridMesh.position.y = -0.02
  gridMesh.material.transparent = true
  gridMesh.material.opacity = 0.45
  scene.add(gridMesh)

  // 外层呼吸光晕环（AdditiveBlending 叠加发光，透明度在 tick 中脉动）
  haloRing = new THREE.Mesh(
    new THREE.RingGeometry(GROUND_R + 0.7, GROUND_R + 1.9, 96),
    new THREE.MeshBasicMaterial({
      color: 0x3FA8E6,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  haloRing.rotation.x = -Math.PI / 2
  haloRing.position.y = -0.025
  scene.add(haloRing)

  // 旋转扫描虚线环（UV 沿环向均匀展开，rotation.z 变化形成等距流动扫描）
  const dashTex = makeRingDashTexture()
  dashTex.repeat.set(3, 1)
  dashRing = new THREE.Mesh(
    makeCircularRingGeometry(GROUND_R + 2.1, GROUND_R + 2.35, 192),
    new THREE.MeshBasicMaterial({
      map: dashTex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  dashRing.rotation.x = -Math.PI / 2
  dashRing.position.y = -0.02
  scene.add(dashRing)

  // 展台青色底光：从地面向建筑打光，强化"艺术品聚光展台"氛围
  const stageLight = new THREE.PointLight(0x46B8E8, 1.4, 40, 2)
  stageLight.position.set(0, 1.2, 0)
  scene.add(stageLight)

  // 建筑容器：GLB 楼层模型 / 降级示意楼宇都挂在这里，切换楼层时整组清理
  buildingGroup = new THREE.Group()
  scene.add(buildingGroup)

  // 点击锚点小球打开信息面板（nodes 在模型加载后填充）
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

// ---------- 内置示意楼宇（GLB 加载失败时的降级方案） ----------
function buildProceduralBuilding() {
  // ---------- 裙楼基座 ----------
  const pedestalTex = makePedestalTexture()
  const podiumMat = new THREE.MeshStandardMaterial({
    map: pedestalTex,
    roughness: 0.82,
    metalness: 0.15
  })
  const podium = new THREE.Mesh(new THREE.BoxGeometry(9.4, 1.9, 14.4), podiumMat)
  podium.position.y = 0.95
  buildingGroup.add(podium)

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
  buildingGroup.add(main)

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
  buildingGroup.add(longPanel)
  const longPanelBack = longPanel.clone()
  longPanelBack.position.z = -6.1
  buildingGroup.add(longPanelBack)
  const shortPanel = new THREE.Mesh(
    new THREE.BoxGeometry(parapetT, parapetH, 12.4),
    railingMat
  )
  shortPanel.position.set(3.7, 1.9 + 5 + parapetH / 2, 0)
  buildingGroup.add(shortPanel)
  const shortPanelL = shortPanel.clone()
  shortPanelL.position.x = -3.7
  buildingGroup.add(shortPanelL)

  const topBeamMat = new THREE.MeshStandardMaterial({ color: 0x8C8278, roughness: 0.7, metalness: 0.15 })
  const topBeamLong = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.24), topBeamMat)
  topBeamLong.position.set(0, 1.9 + 5 + parapetH, 6.1)
  buildingGroup.add(topBeamLong)
  const topBeamLongB = topBeamLong.clone()
  topBeamLongB.position.z = -6.1
  buildingGroup.add(topBeamLongB)
  const topBeamShort = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 12.4), topBeamMat)
  topBeamShort.position.set(3.7, 1.9 + 5 + parapetH, 0)
  buildingGroup.add(topBeamShort)
  const topBeamShortL = topBeamShort.clone()
  topBeamShortL.position.x = -3.7
  buildingGroup.add(topBeamShortL)

  // ---------- 楼顶机房 ----------
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9E958A, roughness: 0.72, metalness: 0.18 })
  const roofRoom = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 3.3), roofMat)
  roofRoom.position.set(-1.2, 1.9 + 5 + 0.65, 1.4)
  buildingGroup.add(roofRoom)

  // ---------- 楼顶水箱 ----------
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x6B8E9E, roughness: 0.5, metalness: 0.45 })
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 18), tankMat)
  tank.position.set(1.9, 1.9 + 5 + 0.75, -3.4)
  buildingGroup.add(tank)
}

// ---------- 发光锚点 ----------
// getPos(data) 返回该标注点在场景中的世界坐标
function createAnchors(getPos) {
  // 几何体与光晕纹理在楼层切换间共享，避免重复分配
  anchorGeo = anchorGeo ?? new THREE.SphereGeometry(0.26, 18, 18)
  anchorGlowTex = anchorGlowTex ?? makeGlowTexture()

  BUILDING_NODES.forEach((data) => {
    const color = TONE_COLORS[data.tone] ?? TONE_COLORS.blue
    const pos = getPos(data)

    const mesh = new THREE.Mesh(
      anchorGeo,
      new THREE.MeshBasicMaterial({ color })
    )
    mesh.position.copy(pos)
    mesh.userData.nodeId = data.id
    scene.add(mesh)

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: anchorGlowTex,
        color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    glow.scale.set(2.4, 2.4, 1)
    glow.position.copy(pos)
    scene.add(glow)

    const normal = new THREE.Vector3(pos.x, 0, pos.z)
    if (normal.lengthSq() === 0) normal.set(0, 0, 1)
    normal.normalize()

    nodes.push({
      data,
      mesh,
      glow,
      world: pos.clone(),
      normal
    })
  })
}

// ---------- GLB 能源楼模型 ----------

// 等比归一化：最大边缩放到 MODEL_TARGET_SIZE，XZ 居中，底部落在 y=0
function normalizeModel(root) {
  let box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  root.scale.setScalar(MODEL_TARGET_SIZE / maxDim)
  root.updateMatrixWorld(true)

  box = new THREE.Box3().setFromObject(root)
  const center = box.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box.min.y
  root.updateMatrixWorld(true)
}

// 按模型包围盒把锚点放到对应立面外侧（高度取 45% 处）
function modelAnchorPos(box, data) {
  const side = NODE_SIDE[data.id] ?? { axis: 'z', sign: 1 }
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const y = box.min.y + size.y * 0.45
  const OFFSET = 0.55

  if (side.axis === 'z') {
    return new THREE.Vector3(center.x, y, center.z + side.sign * (size.z / 2 + OFFSET))
  }
  return new THREE.Vector3(center.x + side.sign * (size.x / 2 + OFFSET), y, center.z)
}

// 底座/网格/装饰环随模型占地大小缩放
function fitGround(footR) {
  const s = footR / GROUND_R
  baseMesh.scale.setScalar(s)
  ringMesh.scale.setScalar(s)
  gridMesh.scale.setScalar(s)
  if (haloRing) haloRing.scale.setScalar(s)
  if (dashRing) dashRing.scale.setScalar(s)
}

// 按包围盒自动取景（系数偏小 = 相机更近 = 模型默认更大，约占画面八成）
function frameBox(box) {
  if (!box || box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fitDist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))

  controls.target.copy(center)
  camera.position.copy(center).add(
    new THREE.Vector3(fitDist * 0.72, fitDist * 0.55, fitDist * 0.86)
  )
  controls.minDistance = fitDist * 0.4
  controls.maxDistance = fitDist * 2.6
  controls.update()
}

// ---------- 资源清理与楼层切换 ----------

// 释放一个 Object3D 子树下的几何/材质/纹理（用 Set 去重，兼容共享资源）
function disposeObject(root) {
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()

  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry)
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m) => {
        materials.add(m)
        for (const key of Object.keys(m)) {
          const v = m[key]
          if (v && v.isTexture) textures.add(v)
        }
      })
    }
  })

  geometries.forEach((g) => g.dispose())
  textures.forEach((t) => t.dispose())
  materials.forEach((m) => m.dispose())
}

// 移除并销毁当前锚点（共享几何体/光晕纹理保留）
function clearAnchors() {
  nodes.forEach((n) => {
    scene.remove(n.mesh)
    scene.remove(n.glow)
    n.mesh.material.dispose()
    n.glow.material.dispose()
  })
  nodes.length = 0
}

// 清空当前建筑与锚点，并把底座复位
function clearBuilding() {
  clearAnchors()
  for (let i = buildingGroup.children.length - 1; i >= 0; i--) {
    const child = buildingGroup.children[i]
    buildingGroup.remove(child)
    disposeObject(child)
  }
  fitGround(GROUND_R)
}

// 加载指定楼层模型；通过 loadToken 处理快速连续切换的竞态
async function loadFloor(floor) {
  const token = ++loadToken
  loading.value = true
  loadProgress.value = 0
  clearBuilding()

  let gltf
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    gltf = await new Promise((resolve, reject) => {
      loader.load(
        floor.url,
        resolve,
        (ev) => {
          if (ev.total) {
            loadProgress.value = Math.min(99, Math.round((ev.loaded / ev.total) * 100))
          }
        },
        reject
      )
    })
  } catch (err) {
    if (token !== loadToken) return // 已被更新的切换取代
    throw err
  }

  // 加载期间用户已切换到其它楼层：丢弃本次结果并释放
  if (token !== loadToken) {
    disposeObject(gltf.scene)
    return
  }

  const root = gltf.scene
  normalizeModel(root)
  buildingGroup.add(root)

  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  fitGround(Math.max(size.x, size.z) * 0.5 * 1.18 + 1)

  createAnchors((data) => modelAnchorPos(box, data))
  frameBox(box)
  loadProgress.value = 100
  loading.value = false
}

// 左侧楼层按钮点击（加载中也可切换，过期结果由 loadToken 丢弃）
function selectFloor(floor) {
  if (floor.id === currentFloorId.value) return
  currentFloorId.value = floor.id
  loadFloor(floor).catch((err) => {
    console.error('[Building3D] 楼层模型加载失败，使用内置示意楼宇', err)
    clearBuilding()
    useProceduralFallback()
    loading.value = false
  })
}

// GLB 加载失败时使用内置示意楼宇，保证页面可用
function useProceduralFallback() {
  buildProceduralBuilding()
  createAnchors((data) => new THREE.Vector3(data.pos[0], data.pos[1], data.pos[2]))
  fitGround(GROUND_R)
  frameBox(new THREE.Box3().setFromObject(buildingGroup))
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
  resizeBackground()
}

function tick() {
  rafId = requestAnimationFrame(tick)
  controls.update()

  // 展台装饰环：光晕呼吸 + 虚线环缓慢扫描
  if (!reduceMotion) {
    const t = performance.now() * 0.001
    if (haloRing) haloRing.material.opacity = 0.10 + 0.09 * (0.5 + 0.5 * Math.sin(t * 1.1))
    if (dashRing) {
      // 先绕 X 躺平，再绕自身 Z（躺平后的竖直轴）旋转
      dashRing.rotation.set(-Math.PI / 2, 0, t * 0.18)
    }
  }

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
  if (envRT) {
    envRT.dispose()
    envRT = null
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
  baseMesh = null
  ringMesh = null
  gridMesh = null
  haloRing = null
  dashRing = null
  buildingGroup = null
  if (anchorGeo) {
    anchorGeo.dispose()
    anchorGeo = null
  }
  if (anchorGlowTex) {
    anchorGlowTex.dispose()
    anchorGlowTex = null
  }
  nodes.length = 0
}

onMounted(async () => {
  host = hostEl.value
  if (!host) return
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 先启动流光背景，three.js 与模型加载期间画面即有氛围
  initBackground()

  try {
    const three = await import('three')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js')
    THREE = three
    initScene(OrbitControls, RoomEnvironment)
  } catch (err) {
    console.error('[Building3D] three.js 初始化失败，已降级为静态标注列表', err)
    failed.value = true
    loading.value = false
    return
  }

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  tick()

  // 默认加载能源楼整体模型，失败时降级为内置示意楼宇
  try {
    await loadFloor(FLOORS[0])
  } catch (err) {
    console.error('[Building3D] 楼层模型加载失败，使用内置示意楼宇', err)
    clearBuilding()
    useProceduralFallback()
    loading.value = false
  }
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
  stopBackground()
  disposeScene()
  host = null
})
</script>

<template>
  <div class="b3d-root">
    <!-- 流光溢彩背景层（WebGL 画布透明，背景透出） -->
    <canvas ref="bgEl" class="b3d-bg"></canvas>
    <div class="b3d-vignette" aria-hidden="true"></div>
    <div ref="hostEl" class="b3d-canvas"></div>

    <!-- 左侧楼层切换 -->
    <nav v-if="!failed" class="b3d-floors" aria-label="楼层切换">
      <p class="b3d-floors-title">楼层视图</p>
      <button
        v-for="floor in FLOORS"
        :key="floor.id"
        type="button"
        class="b3d-floor-btn"
        :class="{ 'is-active': floor.id === currentFloorId, 'is-busy': loading && floor.id === currentFloorId }"
        @click="selectFloor(floor)"
      >
        <span class="b3d-floor-name">{{ floor.name }}</span>
        <span class="b3d-floor-size">{{ floor.sizeText }}</span>
      </button>
    </nav>

    <!-- 模型加载遮罩 -->
    <div v-if="loading" class="b3d-loading">
      <div class="b3d-spinner" aria-hidden="true"></div>
      <p class="b3d-loading-title">正在加载能源楼{{ currentFloor.name }}模型</p>
      <div class="b3d-loading-bar">
        <div class="b3d-loading-bar-inner" :style="{ width: loadProgress + '%' }"></div>
      </div>
      <p class="b3d-loading-meta">
        <span>{{ loadProgress }}%</span>
      </p>
      <p class="b3d-loading-tip">模型{{ currentFloor.sizeText }}，首次加载请耐心等待</p>
    </div>

    <!-- 锚点标签层（每帧投影定位） -->
    <div v-if="!failed && !loading" class="b3d-labels" aria-hidden="false">
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
  /* 深色兜底：流光背景画布绘制前/不可用时的底色 */
  background: #040D1C;
}

/* 流光背景层 */
.b3d-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* 暗角 + 顶部聚光：把视线收向画面中心的模型，强化展台/艺术品氛围 */
.b3d-vignette {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(78% 62% at 50% 46%, rgba(0,0,0,0) 52%, rgba(2,8,18,.55) 100%),
    radial-gradient(60% 32% at 50% -6%, rgba(90,170,230,.14) 0%, rgba(0,0,0,0) 72%);
}

.b3d-canvas { position: absolute; inset: 0; z-index: 2; }

/* 关键修复：强制 canvas 填满容器，避免高分屏下 2 倍尺寸溢出 */
.b3d-canvas canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* ---------- 模型加载遮罩 ---------- */
.b3d-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(8, 21, 34, 0.72);
  backdrop-filter: blur(4px);
}
.b3d-spinner {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 3px solid rgba(143, 216, 247, 0.18);
  border-top-color: #46A8D6;
  animation: b3d-spin 0.9s linear infinite;
}
@keyframes b3d-spin {
  to { transform: rotate(360deg); }
}
.b3d-loading-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .08em;
  color: #EAF6FF;
}
.b3d-loading-bar {
  width: min(320px, 60vw);
  height: 6px;
  border-radius: 999px;
  background: rgba(143, 216, 247, 0.16);
  overflow: hidden;
}
.b3d-loading-bar-inner {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2C7FA8, #6FC8EE);
  box-shadow: 0 0 12px rgba(70, 168, 214, 0.7);
  transition: width .2s ease;
}
.b3d-loading-meta {
  font-family: var(--font-num);
  font-size: 13px;
  font-weight: 700;
  color: #9BDDF8;
}
.b3d-loading-tip {
  font-size: 11.5px;
  letter-spacing: .05em;
  color: rgba(198, 222, 238, 0.55);
}

/* ---------- 左侧楼层切换 ---------- */
.b3d-floors {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30; /* 高于加载遮罩(20)，加载中也能切换楼层 */
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px;
  background: rgba(12, 30, 46, 0.72);
  border: 1px solid rgba(143, 216, 247, 0.22);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  box-shadow: 0 10px 28px rgba(3, 10, 20, 0.45);
}
.b3d-floors-title {
  margin: 0 2px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .22em;
  color: rgba(198, 222, 238, 0.55);
  text-align: center;
}
.b3d-floor-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 76px;
  padding: 11px 14px;
  font-family: var(--font);
  color: #C4DCEC;
  cursor: pointer;
  background: rgba(27, 58, 84, 0.55);
  border: 1px solid rgba(143, 216, 247, 0.18);
  border-radius: 10px;
  transition: border-color .18s, background .18s, transform .18s, box-shadow .18s;
}
.b3d-floor-btn:hover {
  border-color: rgba(143, 216, 247, 0.55);
  transform: translateX(2px);
}
.b3d-floor-btn.is-active {
  color: #EAF6FF;
  background: linear-gradient(160deg, rgba(70, 168, 214, 0.92), rgba(31, 99, 136, 0.92));
  border-color: rgba(155, 221, 248, 0.75);
  box-shadow: 0 6px 18px rgba(30, 110, 150, 0.45), inset 0 0 12px rgba(155, 221, 248, 0.18);
}
.b3d-floor-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .12em;
  line-height: 1.2;
}
.b3d-floor-size {
  font-size: 10px;
  letter-spacing: .04em;
  opacity: .62;
}
.b3d-floor-btn.is-busy .b3d-floor-name::after {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  vertical-align: -1px;
  animation: b3d-spin 0.9s linear infinite;
}

/* ---------- 锚点标签 ---------- */
.b3d-labels { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
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
  z-index: 3;
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
  z-index: 3;
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
  .b3d-floors { left: 10px; padding: 8px 7px; gap: 6px; }
  .b3d-floor-btn { min-width: 60px; padding: 8px 10px; }
  .b3d-floor-size { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .b3d-label, .b3d-back, .b3d-fallback-btn { transition: none; }
}
</style>