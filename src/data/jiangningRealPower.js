// 江宁校区 10kV 中心站真实功率 / 负载率数据适配
// 数据源：src/mock/中心站高压功率数据_负载率.json（6-9 月，1#/2# 中心站）
// 输出与 campus.js 中 buildingPowerSummary / buildingSeries 相同形态，供面板直接使用
import raw from '../mock/中心站高压功率数据_负载率.json'

const SQRT3 = 1.732
const HV_VOLTAGE = 10
const HV_COSP = 0.92
const YEAR = 2026
const MONTHS = [['6月', 6], ['7月', 7], ['8月', 8], ['9月', 9]]
// 数据中每日的时刻点（按时间顺序）
const HOUR_ORDER = [0, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22]

function ymd(date) {
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
function mdLabel(date) { return `${date.getMonth() + 1}/${date.getDate()}` }
function addDays(date, delta) {
  const d = new Date(date)
  d.setDate(d.getDate() + delta)
  return d
}
const numCN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
// 从“/一号配电房”“/2号配电房”这类后缀中解析编号
function suffixNo(s) {
  const m = s.match(/([0-9]+|[一二两三四五六七八九十])\s*号/)
  if (!m) return null
  return /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : numCN[m[1]]
}

// ---------- 解析为按配电房索引的结构 ----------
// rooms: name -> { station, caps:[{no,cap,source}], days:[{date, hours:[v|null 按 HOUR_ORDER]}] }
const rooms = new Map()

for (const [monthKey, mo] of MONTHS) {
  const arr = raw[monthKey] || []
  arr.forEach((day, di) => {
    const date = new Date(YEAR, mo - 1, di + 1)
    for (const st of day['中心站'] || []) {
      for (const r of st['配电房'] || []) {
        let rec = rooms.get(r['名称'])
        if (!rec) {
          rec = { station: st['站名'], caps: [], days: [] }
          rooms.set(r['名称'], rec)
        }
        // 变压器元信息（容量/来源可能缺失，用后续非空值补全）
        r['变压器'].forEach((t) => {
          let c = rec.caps.find((x) => x.no === t['编号'])
          if (!c) { c = { no: t['编号'], cap: null, source: null }; rec.caps.push(c) }
          if ((c.cap == null || isNaN(c.cap)) && t['容量kVA'] != null && !isNaN(t['容量kVA'])) c.cap = t['容量kVA']
          if (!c.source && t['来源']) c.source = t['来源']
        })
        rec.caps.sort((a, b) => a.no - b.no)
        // hours: 配电房总功率（多变压器求和）；ratePts: 各变压器 JSON 负载率（0-1），查询时按容量加权
        const hours = []
        const ratePts = []
        HOUR_ORDER.forEach((h) => {
          const key = `${h}:00`
          let sum = 0
          let hit = false
          const rs = []
          for (const t of r['变压器']) {
            const no = t['编号']
            const v = t['功率kW']?.[key]
            if (v != null && !isNaN(v)) { sum += v; hit = true }
            const rt = t['负载率']?.[key]
            if (rt != null && !isNaN(rt)) rs.push({ no, r: rt })
          }
          hours.push(hit ? sum : null)
          ratePts.push(rs.length ? rs : null)
        })
        rec.days.push({ date, hours, ratePts })
      }
    }
  })
}

// ---------- 名称适配：页面自定义名 → 真实数据名称 ----------
function coreOf(name) {
  return String(name).split('/')[0].replace(/\s+/g, '').replace(/配电房$/, '')
}
// 真实名称 -> { core, no(编号尾缀) }
const realIndex = [...rooms.keys()].map((name) => {
  const core = coreOf(name)
  const m = core.match(/^(.+?)(\d+)$/)
  return { name, core: m ? m[1] : core, no: m ? parseInt(m[2], 10) : null }
})

export function resolveRealRoom(marker) {
  if (!marker) return null
  // 显式指定优先
  if (marker.refName && rooms.has(marker.refName)) return marker.refName
  const full = String(marker.name || '').replace(/\s+/g, '')
  if (rooms.has(full)) return full
  const core = coreOf(full)
  const no = suffixNo(full)
  const cands = realIndex.filter((r) => r.core === core)
  if (!cands.length) return null
  if (no != null) {
    const hit = cands.find((r) => r.no === no)
    if (hit) return hit.name
  }
  // 核心名唯一时直接采用（如“致远楼/2号配电房” → 致远楼配电房）
  if (cands.length === 1) return cands[0].name
  // 核心名有多个编号候选（二三组团 10/11 号）且无法判断时不匹配
  return null
}

export function realRoomMeta(realName) {
  return rooms.get(realName) || null
}

// 数据覆盖区间（以各配电房自身最后有效日为准）
function validDays(rec) {
  return rec.days.filter((d) => d.hours.some((v) => v != null))
}
function dayAvg(d) {
  const vals = d.hours.filter((v) => v != null)
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}

// ---------- 负载率（取自 JSON 各变压器“负载率”字段，按容量加权聚合） ----------
// 权重：覆盖后的有效容量；显式 0（未安装）不参与；容量未知时退化为权重 1（简单平均）
function capWeight(no, capMap) {
  const c = capMap?.get(no)
  if (c === null || c === undefined || isNaN(c)) return 1
  return c > 0 ? c : 0
}
function hourRate(pts, capMap) {
  if (!pts || !pts.length) return null
  let s = 0
  let sw = 0
  for (const p of pts) {
    const w = capWeight(p.no, capMap)
    if (w <= 0) continue
    s += p.r * w
    sw += w
  }
  return sw ? s / sw : null
}
function dayRates(d, capMap) {
  return (d.ratePts || []).map((pts) => hourRate(pts, capMap))
}
function rateDayAvg(d, capMap) {
  const vals = dayRates(d, capMap).filter((v) => v != null)
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}

// 总览统计：今日=最后一个数据完整日（有效时刻 ≥ 一半采样点）；近一周/近一月相对其回溯
const FULL_HOUR_MIN = Math.ceil(HOUR_ORDER.length / 2)
function anchorDays(rec) {
  const vdAll = validDays(rec)
  if (!vdAll.length) return null
  let anchorIdx = vdAll.length - 1
  while (anchorIdx > 0 && vdAll[anchorIdx].hours.filter((v) => v != null).length < FULL_HOUR_MIN) anchorIdx--
  const vd = vdAll.slice(0, anchorIdx + 1)
  return { vd, anchor: vd[anchorIdx] }
}

export function realDateRange(realName) {
  const rec = rooms.get(realName)
  if (!rec) return null
  const info = anchorDays(rec)
  if (!info) return null
  return { min: info.vd[0].date, max: info.anchor.date }
}

// 应用页面保存的容量覆盖：{ 变压器编号: 容量kVA }
// 显式保存的 0 表示该位置未安装变压器（容量按 0 计）；未填写的键才沿用原始数据
export function capsWithOverrides(realName, overrides) {
  const rec = rooms.get(realName)
  if (!rec) return []
  return rec.caps.map((c) => {
    const ov = overrides?.[c.no]
    if (ov === null || ov === undefined || isNaN(ov)) return { ...c }
    return { ...c, cap: Number(ov) >= 0 ? Number(ov) : c.cap }
  })
}

export function realPowerSummary(realName, overrides) {
  const rec = rooms.get(realName)
  if (!rec) return null
  const info = anchorDays(rec)
  if (!info) return null
  const { vd, anchor } = info

  const slice = (n) => vd.slice(Math.max(0, vd.length - n))
  const rangeStats = (days) => {
    const avgs = days.map(dayAvg).filter((v) => v != null)
    let max = 0
    for (const d of days) for (const v of d.hours) if (v != null && v > max) max = v
    const avg = avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : 0
    const energy = avgs.reduce((s, v) => s + v * 24, 0) / 1000
    return { avg, max, energy }
  }
  // 负载率区间统计（数据全部取自 JSON“负载率”字段，不做 P/S 换算）
  const rangeRateStats = (days) => {
    const avgs = days.map((d) => rateDayAvg(d, capMap)).filter((v) => v != null)
    let max = 0
    for (const d of days) for (const v of dayRates(d, capMap)) if (v != null && v > max) max = v
    const avg = avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null
    return { avg, max }
  }
  const transformers = capsWithOverrides(realName, overrides)
  const capMap = new Map(transformers.map((c) => [c.no, c.cap]))
  const caps = transformers.map((c) => c.cap).filter((v) => v != null && !isNaN(v))
  const totalCap = caps.length === transformers.length && caps.length
    ? caps.reduce((s, v) => s + v, 0)
    : null

  const todayVals = anchor.hours.filter((v) => v != null)
  const todayRateVals = dayRates(anchor, capMap).filter((v) => v != null)
  const today = {
    avg: todayVals.reduce((s, v) => s + v, 0) / todayVals.length,
    max: Math.max(...todayVals),
    min: Math.min(...todayVals),
    current: [...anchor.hours].reverse().find((v) => v != null),
    rateAvg: todayRateVals.length ? todayRateVals.reduce((s, v) => s + v, 0) / todayRateVals.length : null,
    rateMax: todayRateVals.length ? Math.max(...todayRateVals) : null,
    rateMin: todayRateVals.length ? Math.min(...todayRateVals) : null,
    rateCurrent: [...dayRates(anchor, capMap)].reverse().find((v) => v != null) ?? null
  }
  const week = rangeStats(slice(7))
  const month = rangeStats(slice(30))
  const weekRate = rangeRateStats(slice(7))
  const monthRate = rangeRateStats(slice(30))

  return {
    real: true,
    station: rec.station,
    transformers,
    anchorDate: anchor.date,
    dateRange: { min: vd[0].date, max: anchor.date },
    today,
    week,
    month,
    weekRate,
    monthRate,
    currentA: month.avg / (SQRT3 * HV_VOLTAGE * HV_COSP),
    // 月均负载率：直接使用 JSON 负载率；仅当 JSON 完全缺失时回退 P/S 估算
    loadRate: monthRate.avg != null ? monthRate.avg : (totalCap ? month.avg / totalCap : null),
    totalCap
  }
}

// 曲线：today=锚定日 11 个时刻点；其余=区间内每日均值
// metric: 'power'(kW，默认) | 'rate'(JSON 负载率，0-1)
export function realPowerSeries(realName, type, start, end, metric = 'power', overrides = null) {
  const rec = rooms.get(realName)
  if (!rec) return []
  const info = anchorDays(rec)
  if (!info) return []
  const { vd, anchor } = info
  const capMap = new Map(capsWithOverrides(realName, overrides).map((c) => [c.no, c.cap]))
  if (type === 'today') {
    const pts = []
    HOUR_ORDER.forEach((h, i) => {
      const v = metric === 'rate' ? hourRate(anchor.ratePts?.[i], capMap) : anchor.hours[i]
      if (v == null) return
      pts.push({
        label: `${`${h}`.padStart(2, '0')}:00`,
        full: `${ymd(anchor.date)} ${`${h}`.padStart(2, '0')}:00`,
        v
      })
    })
    return pts
  }
  if (!start || !end || start > end) return []
  const pts = []
  for (const d of vd) {
    if (d.date < start || d.date > end) continue
    const avg = metric === 'rate' ? rateDayAvg(d, capMap) : dayAvg(d)
    if (avg == null) continue
    pts.push({ label: mdLabel(d.date), full: ymd(d.date), v: avg })
  }
  return pts
}

export const REAL_HV_INFO = { voltage: HV_VOLTAGE, cosPhi: HV_COSP }
