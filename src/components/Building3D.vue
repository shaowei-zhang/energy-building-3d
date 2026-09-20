<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { BUILDING_NODES, DATA_NOTE } from '../data/campus'
import CampusInfoPanel from './CampusInfoPanel.vue'

const emit = defineEmits(['back'])

const hostEl = ref(null)
const failed = ref(false)
const active = ref(null)
const panelPos = ref({ x: 0, y: 0 })
const visible = ref(BUILDING_NODES.map(() => true))
const panelScale = ref(0)

// 统一打开弹窗的方法
function openPanel(node) {
  active.value = node
  panelScale.value = 0
  setTimeout(() => { panelScale.value = 1 }, 50)
}

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
let pmremGenerator = null

const TONE_COLORS = {
  blue: 0x46A8D6,
  green: 0x5BC98C,
  amber: 0xE0B04C,
  red: 0xE3706B
}

// ---------- 纹理生成 ----------

// 1. 科技感外墙（冷灰金属/石材）
function makeStoneTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')

  // 冷灰色底色
  ctx.fillStyle = '#B0B8C4'
  ctx.fillRect(0, 0, 1024, 1024)

  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    const r = Math.random() * 1.5 + 0.5
    ctx.fillStyle = `rgba(${180 + Math.random() * 20}, ${190 + Math.random() * 20}, ${200 + Math.random() * 20}, ${Math.random() * 0.15})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 科技感分割线（暗灰色）
  ctx.strokeStyle = 'rgba(80, 90, 100, 0.4)'
  ctx.lineWidth = 2
  for (let y = 0; y < 1024; y += 128) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(1024, y)
    ctx.stroke()
  }
  for (let x = 0; x < 1024; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 1024)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 3)
  tex.anisotropy = 8
  return tex
}

// 2. 发光金属纹理（楼梯、门框）
function makeMetalTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#8A9AA8'
  ctx.fillRect(0, 0, 512, 512)

  for (let x = 0; x < 512; x += 2) {
    const alpha = 0.05 + Math.random() * 0.15
    ctx.strokeStyle = `rgba(${200 + Math.random() * 55}, ${210 + Math.random() * 45}, ${230 + Math.random() * 25}, ${alpha})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 512)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.anisotropy = 8
  return tex
}

// 3. 科技窗户纹理（深空蓝玻璃 + 发光）
function makeWindowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  // 深空蓝底色
  const grad = ctx.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, '#0A1A2A')
  grad.addColorStop(0.5, '#1A3A5A')
  grad.addColorStop(1, '#0A1A2A')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)

  // 内部发光（青色高光）
  ctx.fillStyle = 'rgba(0, 255, 255, 0.2)'
  ctx.fillRect(50, 50, 412, 412)

  // 反光
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.beginPath()
  ctx.moveTo(0, 512)
  ctx.lineTo(512, 0)
  ctx.lineTo(512, 100)
  ctx.lineTo(100, 512)
  ctx.fill()

  // 暗色窗框
  ctx.strokeStyle = '#1A1A1A'
  ctx.lineWidth = 12
  ctx.strokeRect(6, 6, 500, 500)

  // 十字分隔
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(256, 6)
  ctx.lineTo(256, 506)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(6, 256)
  ctx.lineTo(506, 256)
  ctx.stroke()

  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 8
  return tex
}

// 4. 科技地面纹理（深灰网格 + 微光）
function makeGroundTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')

  // 深灰色底
  ctx.fillStyle = '#1A1F26'
  ctx.fillRect(0, 0, 1024, 1024)

  // 细节噪点
  for (let i = 0; i < 10000; i++) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    ctx.fillStyle = `rgba(100, 120, 140, ${Math.random() * 0.1})`
    ctx.fillRect(x, y, 2, 2)
  }

  // 科技感网格线（青色微光）
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)'
  ctx.lineWidth = 2
  for (let y = 0; y < 1024; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(1024, y)
    ctx.stroke()
  }
  for (let x = 0; x < 1024; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 1024)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(10, 10)
  tex.anisotropy = 8
  return tex
}

// 5. 光伏板纹理（深色发光菱形板）
function makePVTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  // 深蓝色底
  ctx.fillStyle = '#0A0F1A'
  ctx.fillRect(0, 0, 512, 512)

  // 菱形网格线（发光青色）
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.4)'
  ctx.lineWidth = 2
  for (let i = -512; i < 1024; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 512, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 512); ctx.lineTo(i + 512, 0); ctx.stroke();
  }

  // 表面高光
  const grad = ctx.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, 'rgba(0, 255, 255, 0.15)')
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
  grad.addColorStop(1, 'rgba(0, 150, 255, 0.1)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  tex.anisotropy = 8
  return tex
}

// ---------- 场景构建 ----------

function buildScene(Controls) {
  scene = new THREE.Scene()

  // 科技感环境背景（深色渐变）
  scene.background = new THREE.Color(0x0A101A)
  scene.fog = new THREE.FogExp2(0x0A101A, 0.005)

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
  camera.position.set(22, 18, 28)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  host.appendChild(renderer.domElement)

  // 环境贴图（冷色科技环境）
  pmremGenerator = new THREE.PMREMGenerator(renderer)
  pmremGenerator.compileEquirectangularShader()
  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0x1A2A3A)
  const envLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1)
  envScene.add(envLight)
  const envMap = pmremGenerator.fromScene(envScene).texture
  scene.environment = envMap
  pmremGenerator.dispose()

  controls = new Controls(camera, renderer.domElement)
  controls.target.set(0, 4, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = 15
  controls.maxDistance = 80
  controls.maxPolarAngle = Math.PI * 0.48
  controls.autoRotate = !reduceMotion
  controls.autoRotateSpeed = 0.5

  controls.addEventListener('start', () => {
    controls.autoRotate = false
    if (resumeTimer) { window.clearTimeout(resumeTimer); resumeTimer = 0 }
  })
  controls.addEventListener('end', () => {
    if (reduceMotion) return
    resumeTimer = window.setTimeout(() => {
      resumeTimer = 0
      if (controls) controls.autoRotate = true
    }, 3000)
  })

  // 灯光系统：冷白光 + 蓝色辅光
  const hemiLight = new THREE.HemisphereLight(0xE0F0FF, 0x101820, 1.2)
  hemiLight.position.set(0, 20, 0)
  scene.add(hemiLight)

  const sunLight = new THREE.DirectionalLight(0xE0F0FF, 2.5)
  sunLight.position.set(25, 35, 20)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.width = 4096
  sunLight.shadow.mapSize.height = 4096
  sunLight.shadow.camera.near = 1
  sunLight.shadow.camera.far = 100
  sunLight.shadow.camera.left = -35
  sunLight.shadow.camera.right = 35
  sunLight.shadow.camera.top = 35
  sunLight.shadow.camera.bottom = -35
  sunLight.shadow.bias = -0.0005
  scene.add(sunLight)

  // 蓝色辅光（增加科技感）
  const fillLight = new THREE.DirectionalLight(0x0088FF, 1.0)
  fillLight.position.set(-15, 15, -20)
  scene.add(fillLight)

  // 地面
  const groundTex = makeGroundTexture()
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.4,
    metalness: 0.8,
    envMapIntensity: 1.0
  })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // 建筑基础平台（增加发光条带感）
  const foundationMat = new THREE.MeshStandardMaterial({
    color: 0x2A3440,
    roughness: 0.3,
    metalness: 0.9,
    envMapIntensity: 1.5
  })
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 14), foundationMat)
  foundation.position.y = 0.25
  foundation.receiveShadow = true
  foundation.castShadow = true
  scene.add(foundation)

  // 材质准备
  const stoneTex = makeStoneTexture()
  const wallMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    color: 0xD0D8E0, // 冷银灰
    roughness: 0.4,
    metalness: 0.6, // 增加金属感
    envMapIntensity: 1.2
  })

  const windowTex = makeWindowTexture()
  const windowMat = new THREE.MeshPhysicalMaterial({
    map: windowTex,
    roughness: 0.1,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    emissive: 0x002244, // 内部发光
    emissiveIntensity: 0.5,
    envMapIntensity: 2.0
  })

  const metalTex = makeMetalTexture()
  const metalMat = new THREE.MeshStandardMaterial({
    map: metalTex,
    color: 0xA0B0C0,
    roughness: 0.1, // 高亮金属
    metalness: 1.0,
    envMapIntensity: 2.5
  })

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x4A5568, // 深空灰
    roughness: 0.6,
    metalness: 0.2,
    envMapIntensity: 0.8
  })

  // 玻璃自动门材质
  const doorMat = new THREE.MeshPhysicalMaterial({
    color: 0x1A2A3A,
    roughness: 0.1,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    emissive: 0x0055AA, // 发光蓝
    emissiveIntensity: 0.8,
    envMapIntensity: 2.0
  })

  const pvTex = makePVTexture()
  const pvMat = new THREE.MeshStandardMaterial({
    map: pvTex,
    roughness: 0.1,
    metalness: 0.95,
    envMapIntensity: 2.0
  })

  // ========== 主建筑（二层） ==========
  const buildingGroup = new THREE.Group()

  const floor1Wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3.5, 10), wallMat)
  floor1Wall.position.set(0, 2.25, 0)
  floor1Wall.castShadow = true
  floor1Wall.receiveShadow = true
  buildingGroup.add(floor1Wall)

  const floor2Wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 10), wallMat)
  floor2Wall.position.set(0, 5.65, 0)
  floor2Wall.castShadow = true
  floor2Wall.receiveShadow = true
  buildingGroup.add(floor2Wall)

  const floorSlab = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.4, 10.4), concreteMat)
  floorSlab.position.set(0, 4.2, 0)
  floorSlab.castShadow = true
  floorSlab.receiveShadow = true
  buildingGroup.add(floorSlab)

  // 屋顶走道（金属拉丝）
  const roofWalkway = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.4, 10.4), metalMat)
  roofWalkway.position.set(0, 7.45, 0)
  roofWalkway.castShadow = true
  roofWalkway.receiveShadow = true
  buildingGroup.add(roofWalkway)

  // 人字形坡屋顶（光伏板）
  const roofW = 10
  const roofD = 8
  const roofH = 1.8
  
  const slopeLen = Math.sqrt((roofW/2)*(roofW/2) + roofH*roofH)
  const angle = Math.atan2(roofH, roofW/2)
  
  const slopeGeo = new THREE.BoxGeometry(slopeLen, 0.15, roofD)
  
  const slopeL = new THREE.Mesh(slopeGeo, pvMat)
  slopeL.position.set(-roofW/4, roofH/2, 0)
  slopeL.rotation.z = angle
  slopeL.castShadow = true; slopeL.receiveShadow = true;
  
  const slopeR = new THREE.Mesh(slopeGeo, pvMat)
  slopeR.position.set(roofW/4, roofH/2, 0)
  slopeR.rotation.z = -angle
  slopeR.castShadow = true; slopeR.receiveShadow = true;
  
  const pvRoofGroup = new THREE.Group()
  pvRoofGroup.add(slopeL)
  pvRoofGroup.add(slopeR)
  pvRoofGroup.position.set(0, 7.65, 0)
  buildingGroup.add(pvRoofGroup)

  // 窗户生成（科技蓝玻璃）
  function addWindows(group, cols, startY, width, height, zOffset, skipCenter = false) {
    for (let c = 0; c < cols; c++) {
      if (skipCenter && (c === 1 || c === 2)) continue;
      const win = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.15), windowMat)
      win.position.set(-5.4 + c * 3.6, startY, zOffset)
      win.castShadow = true
      group.add(win)
    }
  }
  
  addWindows(buildingGroup, 4, 2.25, 2.0, 2.2, 5.08, true)
  addWindows(buildingGroup, 4, 5.65, 2.0, 2.0, 5.08, false)
  addWindows(buildingGroup, 4, 2.25, 2.0, 2.2, -5.08, false)
  addWindows(buildingGroup, 4, 5.65, 2.0, 2.0, -5.08, false)

  // ========== 一楼正门（科技自动门） ==========
  const doorGroup = new THREE.Group()

  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.3), metalMat)
  doorFrame.position.set(0, 1.6, 5.05)
  doorFrame.castShadow = true
  doorGroup.add(doorFrame)

  // 透明玻璃门扇（发光蓝）
  const doorPanelL = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.8, 0.1), doorMat)
  doorPanelL.position.set(-0.75, 1.5, 5.12)
  doorPanelL.castShadow = true
  doorGroup.add(doorPanelL)

  const doorPanelR = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.8, 0.1), doorMat)
  doorPanelR.position.set(0.75, 1.5, 5.12)
  doorPanelR.castShadow = true
  doorGroup.add(doorPanelR)

  // 门把手（发光条）
  const handleGeo = new THREE.BoxGeometry(0.04, 2.0, 0.04)
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x00FFFF, emissive: 0x00FFFF, emissiveIntensity: 2.0 })
  
  const handleL = new THREE.Mesh(handleGeo, handleMat)
  handleL.position.set(-1.4, 1.5, 5.18)
  doorGroup.add(handleL)

  const handleR = new THREE.Mesh(handleGeo, handleMat)
  handleR.position.set(1.4, 1.5, 5.18)
  doorGroup.add(handleR)

  // 雨棚（带有发光底边）
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.15, 1.8), metalMat)
  canopy.position.set(0, 3.4, 5.5)
  canopy.castShadow = true
  doorGroup.add(canopy)

  // 雨棚发光条
  const canopyLight = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.05, 1.8), handleMat)
  canopyLight.position.set(0, 3.3, 5.5)
  doorGroup.add(canopyLight)

  // 门头台阶
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.15, 0.8), concreteMat)
  step1.position.set(0, 0.5, 5.5)
  step1.castShadow = true
  step1.receiveShadow = true
  doorGroup.add(step1)

  const step2 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 0.6), concreteMat)
  step2.position.set(0, 0.35, 5.8)
  step2.castShadow = true
  step2.receiveShadow = true
  doorGroup.add(step2)

  scene.add(buildingGroup)
  scene.add(doorGroup)

  // ========== 左侧弧形旋转楼梯（发光科技感） ==========
  const stairGroup = new THREE.Group()
  
  const spiralRadius = 2.2
  const spiralCenterX = -10
  const spiralCenterZ = 0
  const steps = 45 
  const totalHeight = 7.45 
  const stepHeight = totalHeight / steps
  const stepAngle = (Math.PI * 1.5) / steps 

  const centralPillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, totalHeight, 16),
    metalMat
  )
  centralPillar.position.set(spiralCenterX, totalHeight / 2, spiralCenterZ)
  centralPillar.castShadow = true
  stairGroup.add(centralPillar)

  // 发光条材质
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x00FFFF,
    emissive: 0x00FFFF,
    emissiveIntensity: 2.0,
    roughness: 0.1,
    metalness: 0.5
  })

  // 生成螺旋踏步（去掉顶部台阶，并添加发光条）
  for (let i = 0; i < steps - 1; i++) {
    const angle = Math.PI * 2 - i * stepAngle
    const y = i * stepHeight + stepHeight / 2

    const stepGeo = new THREE.BoxGeometry(1.8, 0.08, 0.4)
    const step = new THREE.Mesh(stepGeo, metalMat)
    
    step.position.set(
      spiralCenterX + Math.sin(angle) * spiralRadius,
      y,
      spiralCenterZ + Math.cos(angle) * spiralRadius
    )
    step.rotation.y = -angle
    step.castShadow = true
    step.receiveShadow = true
    stairGroup.add(step)

    // 踏步发光条（科技感细节）
    const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.02, 0.05), glowMat)
    glowStrip.position.set(
      spiralCenterX + Math.sin(angle) * spiralRadius,
      y + 0.05,
      spiralCenterZ + Math.cos(angle) * spiralRadius
    )
    glowStrip.rotation.y = -angle
    stairGroup.add(glowStrip)

    const railPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8),
      metalMat
    )
    railPost.position.set(
      spiralCenterX + Math.sin(angle) * (spiralRadius + 0.8),
      y + 0.5,
      spiralCenterZ + Math.cos(angle) * (spiralRadius + 0.8)
    )
    railPost.castShadow = true
    stairGroup.add(railPost)
  }

  // 弧形金属扶手（与台阶同步截止）
  const curvePoints = []
  for (let i = 0; i <= steps - 2; i++) {
    const angle = Math.PI * 2 - i * stepAngle
    const y = i * stepHeight + stepHeight / 2
    curvePoints.push(new THREE.Vector3(
      spiralCenterX + Math.sin(angle) * (spiralRadius + 0.8),
      y + 1.0,
      spiralCenterZ + Math.cos(angle) * (spiralRadius + 0.8)
    ))
  }
  const helixCurve = new THREE.CatmullRomCurve3(curvePoints)
  const handrailGeo = new THREE.TubeGeometry(helixCurve, 80, 0.06, 8, false)
  const handrail = new THREE.Mesh(handrailGeo, metalMat)
  handrail.castShadow = true
  stairGroup.add(handrail)

  // 扶手发光带
  const handrailGlowGeo = new THREE.TubeGeometry(helixCurve, 80, 0.02, 8, false)
  const handrailGlow = new THREE.Mesh(handrailGlowGeo, glowMat)
  handrailGlow.position.y = 0.05
  stairGroup.add(handrailGlow)

  scene.add(stairGroup)

  // ========== 楼顶连接平台 ==========
  const landingPlatform = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.2, 3.0),
    metalMat
  )
  landingPlatform.position.set(-7.25, 7.45, 0) 
  landingPlatform.castShadow = true
  landingPlatform.receiveShadow = true
  scene.add(landingPlatform)

  // 平台发光边缘
  const platformGlow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 3.0), glowMat)
  platformGlow.position.set(-7.25, 7.55, 0)
  scene.add(platformGlow)

  // 楼顶护栏
  const railMat = metalMat.clone()
  railMat.color.setHex(0xCCCCCC)
  railMat.metalness = 0.9
  railMat.roughness = 0.2

  function addRoofRail(x, z, len, isX) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(isX ? len : 0.1, 1.0, isX ? 0.1 : len), railMat)
    rail.position.set(x, 8.0, z)
    rail.castShadow = true
    scene.add(rail)
  }
  addRoofRail(0, 5.2, 14.4, true) // 前
  addRoofRail(0, -5.2, 14.4, true) // 后
  addRoofRail(7.2, 0, 10.4, false) // 右

  // ========== 锚点标注 ==========
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = 128
  glowCanvas.height = 128
  const gctx = glowCanvas.getContext('2d')
  const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  gctx.fillStyle = grad
  gctx.fillRect(0, 0, 128, 128)
  const glowTex = new THREE.CanvasTexture(glowCanvas)
  const sphereGeo = new THREE.SphereGeometry(0.25, 16, 16)

  BUILDING_NODES.forEach((data) => {
    const color = TONE_COLORS[data.tone] ?? TONE_COLORS.blue

    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color }))
    mesh.position.set(data.pos[0] * 2.2, data.pos[1] * 1.1 + 0.5, data.pos[2] * 1.1)
    mesh.userData.nodeId = data.id
    scene.add(mesh)

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    glow.scale.set(2.2, 2.2, 1)
    glow.position.copy(mesh.position)
    scene.add(glow)

    const normal = new THREE.Vector3(data.pos[0] * 2.2, 0, data.pos[2] * 1.1)
    if (normal.lengthSq() === 0) normal.set(0, 0, 1)
    normal.normalize()

    nodes.push({
      data,
      mesh,
      glow,
      world: new THREE.Vector3(data.pos[0] * 2.2, data.pos[1] * 1.1 + 0.5, data.pos[2] * 1.1),
      normal
    })
  })

  // ========== 点击检测 ==========
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
    if (node) {
      openPanel(node.data)
    }
  })
}

// 每帧把锚点投影到屏幕
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

  // 更新弹窗位置（跟随当前激活的点位）
  if (active.value) {
    const node = nodes.find(n => n.data.id === active.value.id)
    if (node) {
      const p = node.world.clone().project(camera)
      const x = (p.x * 0.5 + 0.5) * w
      const y = (-p.y * 0.5 + 0.5) * h
      // 弹窗在点位右侧，稍微偏上
      panelPos.value = { x: x + 20, y: y - 30 }
    }
  }
}

function resize() {
  if (!host || !renderer || !camera) return
  const w = host.clientWidth
  const h = host.clientHeight
  if (w === 0 || h === 0) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function tick() {
  rafId = requestAnimationFrame(tick)
  controls?.update()
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
          if (m.envMap) m.envMap.dispose()
          m.dispose()
        })
      }
    })
  }
  if (pmremGenerator) {
    pmremGenerator.dispose()
    pmremGenerator = null
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
    console.error('[Building3D] three.js 初始化失败', err)
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

    <div v-if="!failed" class="b3d-labels" aria-hidden="false">
      <button
        v-for="(node, i) in BUILDING_NODES"
        :key="node.id"
        :ref="(el) => setLabelEl(el, i)"
        class="b3d-label"
        :class="`is-${node.tone}`"
        :style="{ opacity: visible[i] ? 1 : 0, pointerEvents: visible[i] ? 'auto' : 'none' }"
        type="button"
        @click="openPanel(node)"
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
      :style="{ left: `${panelPos.x}px`, top: `${panelPos.y}px`, transform: `scale(${panelScale})` }"
      @close="active = null; panelScale = 0"
    />

    <div v-if="failed" class="b3d-fallback" role="status">
      <h2 class="b3d-fallback-title">3D 楼宇暂时无法加载</h2>
      <p class="b3d-fallback-desc">已降级为静态标注入口，点击下方按钮仍可查看各标注点信息。</p>
      <ul class="b3d-fallback-list">
        <li v-for="node in BUILDING_NODES" :key="node.id">
          <button class="b3d-fallback-btn" :class="`is-${node.tone}`" type="button" @click="openPanel(node)">
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
  background: radial-gradient(120% 80% at 50% 0%, #0A101A 0%, #1A2A3A 50%, #0A101A 100%);
}
.b3d-canvas { position: absolute; inset: 0; }
.b3d-canvas canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.b3d-labels { position: absolute; inset: 0; pointer-events: none; }
.b3d-label {
  position: absolute;
  top: 0; left: 0;
  display: flex; align-items: center; gap: 7px;
  padding: 6px 12px 6px 10px;
  font-family: var(--font);
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  white-space: nowrap;
  color: var(--tone-text);
  cursor: pointer;
  background: linear-gradient(135deg, var(--tone-bg) 0%, rgba(10,20,30,.9) 100%);
  border: 1px solid var(--tone-border);
  border-left: 3px solid var(--tone-accent, currentColor);
  border-radius: 4px;
  box-shadow:
    0 4px 20px rgba(0,0,0,.4),
    0 0 12px var(--tone-glow),
    inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter: blur(8px);
  pointer-events: auto;
  transform: translate(-50%, -50%);
  transition: all .2s ease;
}
.b3d-label:hover {
  border-left-color: var(--tone-text);
  box-shadow:
    0 6px 28px rgba(0,0,0,.5),
    0 0 20px var(--tone-glow),
    inset 0 1px 0 rgba(255,255,255,.1);
  transform: translate(-50%, -50%) scale(1.05);
}
.b3d-label-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--tone-accent, currentColor);
  box-shadow: 0 0 8px var(--tone-accent, currentColor), 0 0 16px var(--tone-glow);
  flex: none;
  animation: techPulse 2s ease-in-out infinite;
}
@keyframes techPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .6; transform: scale(1.3); }
}
.b3d-label.is-blue {
  --tone-text: #00D4FF;
  --tone-bg: rgba(0,30,60,.88);
  --tone-border: rgba(0,212,255,.4);
  --tone-accent: #00D4FF;
  --tone-glow: rgba(0,212,255,.35);
}
.b3d-label.is-green {
  --tone-text: #00FF88;
  --tone-bg: rgba(0,40,20,.88);
  --tone-border: rgba(0,255,136,.4);
  --tone-accent: #00FF88;
  --tone-glow: rgba(0,255,136,.35);
}
.b3d-label.is-amber {
  --tone-text: #FFAA00;
  --tone-bg: rgba(50,35,0,.88);
  --tone-border: rgba(255,170,0,.4);
  --tone-accent: #FFAA00;
  --tone-glow: rgba(255,170,0,.35);
}
.b3d-label.is-red {
  --tone-text: #FF3366;
  --tone-bg: rgba(60,10,20,.88);
  --tone-border: rgba(255,51,102,.4);
  --tone-accent: #FF3366;
  --tone-glow: rgba(255,51,102,.35);
}

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
  letter-spacing: .05em; color: #1A2A3A; cursor: pointer;
  background: rgba(255,255,255,.85);
  border: 1px solid rgba(100,150,200,.4);
  border-radius: 9px;
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
  pointer-events: auto;
  transition: border-color .18s, transform .18s;
}
.b3d-back:hover { border-color: #46A8D6; transform: translateY(-1px); }
.b3d-hint {
  font-size: 11.5px;
  letter-spacing: .08em;
  color: rgba(40,60,80,.7);
}

.b3d-fallback {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 0 24px; text-align: center;
  background: rgba(240,248,255,.95);
}
.b3d-fallback-title { font-size: 17px; font-weight: 600; color: #1A2A3A; }
.b3d-fallback-desc { font-size: 12.5px; color: rgba(40,60,80,.72); }
.b3d-fallback-list {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px; margin-top: 10px; padding: 0; list-style: none;
}
.b3d-fallback-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 18px;
  font-family: var(--font); font-size: 12.5px; font-weight: 600;
  color: var(--tone-text); cursor: pointer;
  background: var(--tone-bg); border: 1px solid var(--tone-border);
  border-radius: 10px;
  transition: transform .18s, border-color .18s;
}
.b3d-fallback-btn:hover { transform: translateY(-1px); border-color: var(--tone-text); }
.b3d-fallback-btn.is-blue { --tone-text: #1A6B9A; --tone-bg: rgba(200,230,250,.9); --tone-border: rgba(70,168,214,.6); }
.b3d-fallback-btn.is-green { --tone-text: #2A7A4A; --tone-bg: rgba(200,240,220,.9); --tone-border: rgba(91,201,140,.6); }
.b3d-fallback-btn.is-amber { --tone-text: #8A6A1A; --tone-bg: rgba(250,240,200,.9); --tone-border: rgba(224,176,76,.6); }
.b3d-fallback-btn.is-red { --tone-text: #8A2A2A; --tone-bg: rgba(250,220,215,.9); --tone-border: rgba(227,112,107,.6); }

@media (max-width: 720px) {
  .b3d-hint { display: none; }
  .b3d-fallback-list { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .b3d-label, .b3d-back, .b3d-fallback-btn { transition: none; }
  .info-panel { animation: none !important; transform: none !important; }
}

/* 弹窗跟随动画 */
.info-panel {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 900;
  transition: left 0.08s linear, top 0.08s linear, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: top left;
  will-change: transform, left, top;
}
</style>