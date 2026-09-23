// 河海大学三校区 + 能源楼 3D 楼宇内的标注点数据
// 说明：楼宇运行数据均为演示用示例数据，非实时监测

export const CAMPUSES = [
  {
    id: 'xikanglu',
    name: '南京 - 河海大学 - 西康路校区',
    short: '西康路校区',
    city: '南京',
    district: '鼓楼区',
    addr: '江苏省南京市鼓楼区西康路 1 号',
    lat: 32.055706,
    lng: 118.759579,
    has3d: true
  },
  {
    id: 'jiangning',
    name: '南京 - 河海大学 - 江宁校区',
    short: '江宁校区',
    city: '南京',
    district: '江宁区',
    addr: '江苏省南京市江宁区佛城西路 8 号',
    lat: 31.914453,
    lng: 118.785843,
    has3d: false,
    hasPlan: true
  },
  {
    id: 'changzhou',
    name: '常州 - 河海大学 - 常州校区',
    short: '常州校区',
    city: '常州',
    district: '金坛区',
    addr: '江苏省常州市金坛区河海大道 1915 号',
    lat: 31.733,
    lng: 119.48,
    has3d: false
  }
]

// 4 个 3D 标注点：靠近建筑外墙，悬浮于不同高度
export const BUILDING_NODES = [
  {
    id: 'system',
    tone: 'blue',
    title: '能源楼系统',
    pos: [-7, 5.5, 5.5],
    rows: [
      { label: '运行状态', value: '运行正常', state: 'ok' },
      { label: '光伏出力', value: '86 kW' },
      { label: '储能 SOC', value: '72 %' },
      { label: '并网功率', value: '312 kW' },
      { label: '自给率', value: '34 %' }
    ]
  },
  {
    id: 'energy',
    tone: 'green',
    title: '能源楼用能信息',
    pos: [7, 4.0, 5.5],
    rows: [
      { label: '今日用电', value: '4.86 MWh' },
      { label: '空调', value: '42 %' },
      { label: '照明', value: '18 %' },
      { label: '动力', value: '26 %' },
      { label: '插座', value: '14 %' }
    ]
  },
  {
    id: 'device',
    tone: 'amber',
    title: '能源楼仿真系统',
    pos: [-7, 5.0, -5.5],
    rows: [
      { label: '变压器 ×2', value: '运行', state: 'ok' },
      { label: '冷水机组', value: '运行', state: 'ok' },
      { label: '循环水泵', value: '运行', state: 'ok' },
      { label: '逆变器', value: '运行', state: 'ok' },
      { label: '储能 PCS', value: '待机', state: 'warn' }
    ]
  },
  {
    id: 'alarm',
    tone: 'red',
    title: '能源楼能耗告警',
    pos: [7, 6.5, -5.5],
    rows: [
      { label: '09:24', value: '3F 空调回路功率越上限', state: 'warn' },
      { label: '11:02', value: '储能 PCS 通讯短时中断', state: 'warn' },
      { label: '14:37', value: '光伏逆变器效率偏低', state: 'warn' }
    ]
  }
]

export const DATA_NOTE = '示例数据・非实时监测'

// ========== 江宁校区平面地图 ==========
// x / y 为楼宇在《江宁校园地图.jpg》上的百分比坐标（0~100，原点左上角）
// base：典型工作日平均功率(kW)；cap：配变额定容量(kVA)
// profile：日内负荷曲线类型  dorm=宿舍  teach=教学/办公  canteen=食堂  gym=文体场馆
export const JIANGNING_BUILDINGS = [
  { id: 'jn-lib',      name: '江宁图书馆',   x: 46.9, y: 59.2, base: 820, cap: 1250, profile: 'teach',   station: '10kV 中区1#开关站 · 1T' },
  { id: 'jn-siyuan',   name: '思源楼',       x: 55.2, y: 32.6, base: 430, cap: 800,  profile: 'teach',   station: '10kV 中区1#开关站 · 2T' },
  { id: 'jn-boxue',    name: '博学楼',       x: 52.2, y: 41.0, base: 460, cap: 800,  profile: 'teach',   station: '10kV 中区1#开关站 · 3T' },
  { id: 'jn-zhigao',   name: '致高楼',       x: 36.8, y: 66.9, base: 400, cap: 630,  profile: 'teach',   station: '10kV 南区2#箱变 · 1T' },
  { id: 'jn-zhili',    name: '致理楼',       x: 36.8, y: 74.1, base: 390, cap: 630,  profile: 'teach',   station: '10kV 南区2#箱变 · 2T' },
  { id: 'jn-qinxue',   name: '勤学楼',       x: 58.6, y: 66.9, base: 380, cap: 630,  profile: 'teach',   station: '10kV 南区3#箱变 · 1T' },
  { id: 'jn-teach1',   name: '教学一楼',     x: 57.5, y: 74.1, base: 350, cap: 630,  profile: 'teach',   station: '10kV 南区3#箱变 · 2T' },
  { id: 'jn-research', name: '教学科研楼',   x: 81.8, y: 18.5, base: 440, cap: 800,  profile: 'teach',   station: '10kV 东区4#箱变 · 1T' },
  { id: 'jn-waterlab', name: '水资源实验大厅', x: 28.5, y: 70.9, base: 310, cap: 500, profile: 'teach',  station: '10kV 西区5#箱变 · 1T' },
  { id: 'jn-canteen67',name: '六七食堂',     x: 36.8, y: 15.3, base: 480, cap: 800,  profile: 'canteen', station: '10kV 北区生活箱变 · 1T' },
  { id: 'jn-canteen2', name: '二期食堂',     x: 66.1, y: 9.5,  base: 360, cap: 630,  profile: 'canteen', station: '10kV 北区生活箱变 · 2T' },
  { id: 'jn-canteen5', name: '第五食堂',     x: 21.5, y: 37.9, base: 300, cap: 500,  profile: 'canteen', station: '10kV 西区5#箱变 · 2T' },
  { id: 'jn-gym',      name: '文体中心',     x: 81.5, y: 32.2, base: 520, cap: 1000, profile: 'gym',     station: '10kV 东区4#箱变 · 2T' },
  { id: 'jn-pool',     name: '游泳训练馆',   x: 83.1, y: 49.6, base: 280, cap: 500,  profile: 'gym',     station: '10kV 东区4#箱变 · 3T' },
  { id: 'jn-dorm1',    name: '教学区一舍',   x: 57.8, y: 21.0, base: 260, cap: 400,  profile: 'dorm',    station: '10kV 北区宿舍箱变 · 1T' },
  { id: 'jn-dorm12',   name: '教学区十二舍', x: 27.9, y: 33.4, base: 240, cap: 400,  profile: 'dorm',    station: '10kV 西区宿舍箱变 · 1T' },
  { id: 'jn-dorm17',   name: '教学区十七舍', x: 15.1, y: 37.9, base: 220, cap: 400,  profile: 'dorm',    station: '10kV 西区宿舍箱变 · 2T' },
  { id: 'jn-dorm24',   name: '教学区二十四舍', x: 74.2, y: 20.5, base: 250, cap: 400, profile: 'dorm',    station: '10kV 北区宿舍箱变 · 2T' }
]

// ---------- 高压功率示例数据生成（确定性伪随机，刷新数值不变） ----------
const SQRT3 = 1.732
// 10kV、平均功率因数
const HV_VOLTAGE = 10
const HV_COSP = 0.92

// 24 小时负荷形态（均值约为 1）
const LOAD_SHAPE = {
  teach:   [0.32, 0.30, 0.28, 0.27, 0.28, 0.34, 0.52, 0.82, 1.05, 1.12, 1.10, 0.86, 0.70, 0.94, 1.10, 1.14, 1.02, 0.80, 0.62, 0.70, 0.62, 0.52, 0.42, 0.35],
  dorm:    [0.42, 0.38, 0.34, 0.30, 0.30, 0.40, 0.62, 0.82, 0.62, 0.50, 0.46, 0.44, 0.40, 0.42, 0.46, 0.50, 0.58, 0.78, 1.05, 1.22, 1.20, 0.95, 0.70, 0.52],
  canteen: [0.28, 0.24, 0.22, 0.24, 0.42, 0.82, 1.18, 1.02, 0.62, 0.48, 0.58, 0.96, 1.20, 0.78, 0.52, 0.62, 0.92, 1.18, 0.92, 0.62, 0.44, 0.36, 0.32, 0.28],
  gym:     [0.34, 0.32, 0.30, 0.30, 0.32, 0.38, 0.48, 0.62, 0.72, 0.78, 0.76, 0.70, 0.66, 0.72, 0.78, 0.82, 0.92, 1.08, 1.22, 1.26, 1.18, 0.92, 0.62, 0.44]
}
// 归一化，使全日均值 = 1
Object.keys(LOAD_SHAPE).forEach((k) => {
  const arr = LOAD_SHAPE[k]
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  LOAD_SHAPE[k] = arr.map((v) => v / mean)
})

function fnv1a(str) {
  let h = 0x811C9DC5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function ymd(date) {
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
function mdLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}
function addDays(date, delta) {
  const d = new Date(date)
  d.setDate(d.getDate() + delta)
  return d
}

// 某楼宇某日的日均功率(kW)
function dayAverage(b, date) {
  const dow = date.getDay()
  const weekend = dow === 0 || dow === 6
  // 教学类周末显著下降，宿舍基本持平，场馆/食堂周末略升
  const weekendFactor = { teach: 0.58, dorm: 0.98, canteen: 0.86, gym: 1.18 }[b.profile]
  const wf = weekend ? weekendFactor : 1
  // 季节性慢波动（9 月开学季整体略高）
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000)
  const season = 1 + 0.07 * Math.sin(((dayOfYear - 240) / 365) * Math.PI * 2)
  const rnd = mulberry32(fnv1a(`${b.id}|${ymd(date)}`))()
  const noise = 0.9 + rnd * 0.2
  return b.base * 0.82 * wf * season * noise
}

// 某楼宇某日 24 小时功率序列
function dayHourly(b, date) {
  const dayBase = dayAverage(b, date)
  const shape = LOAD_SHAPE[b.profile]
  const rnd = mulberry32(fnv1a(`${b.id}|h|${ymd(date)}`))
  return shape.map((f, h) => {
    const v = dayBase * f * (0.94 + rnd() * 0.12)
    return { h, v: Math.max(0, v) }
  })
}

function avg(arr) { return arr.reduce((s, p) => s + p.v, 0) / arr.length }
function maxV(arr) { return arr.reduce((m, p) => Math.max(m, p.v), 0) }
function minV(arr) { return arr.reduce((m, p) => Math.min(m, p.v), Infinity) }

// 某楼宇的监测总览：今日 / 近一周 / 近一月 统计
export function buildingPowerSummary(b, today = new Date()) {
  const todayPts = dayHourly(b, today)

  const weekDays = []
  for (let i = 6; i >= 0; i--) weekDays.push(addDays(today, -i))
  const weekDaily = weekDays.map((d) => ({ date: d, v: dayAverage(b, d) }))
  // 近一周峰值按时段形态估算
  const fMax = LOAD_SHAPE[b.profile].reduce((m, v) => Math.max(m, v), 0)

  const monthDays = []
  for (let i = 29; i >= 0; i--) monthDays.push(addDays(today, -i))
  const monthDaily = monthDays.map((d) => ({ date: d, v: dayAverage(b, d) }))

  const weekAvgV = avg(weekDaily)
  const monthAvgV = avg(monthDaily)
  const energyMwh = (arr) => arr.reduce((s, p) => s + p.v * 24, 0) / 1000

  return {
    today: {
      avg: avg(todayPts), max: maxV(todayPts), min: minV(todayPts),
      current: todayPts[Math.min(today.getHours(), 23)].v
    },
    week: { avg: weekAvgV, max: maxV(weekDaily) * fMax * 1.02, energy: energyMwh(weekDaily) },
    month: { avg: monthAvgV, max: maxV(monthDaily) * fMax * 1.02, energy: energyMwh(monthDaily) },
    // 10kV 线电流：I = P / (√3 × U × cosφ)
    currentA: monthAvgV / (SQRT3 * HV_VOLTAGE * HV_COSP),
    loadRate: monthAvgV / b.cap
  }
}

// 曲线数据：today → 24 点；day 范围 → 每日均值
export function buildingSeries(b, type, start, end, today = new Date()) {
  if (type === 'today') {
    return dayHourly(b, today).map((p) => ({
      label: `${`${p.h}`.padStart(2, '0')}:00`,
      full: `${ymd(today)} ${`${p.h}`.padStart(2, '0')}:00`,
      v: p.v
    }))
  }
  const pts = []
  const maxSpan = 90
  let s = start
  let e = end
  if (!s || !e || s > e) return []
  if ((e - s) / 86400000 + 1 > maxSpan) s = addDays(e, -(maxSpan - 1))
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
    pts.push({ label: mdLabel(d), full: ymd(d), v: dayAverage(b, d) })
  }
  return pts
}

export const HV_INFO = { voltage: HV_VOLTAGE, cosPhi: HV_COSP }