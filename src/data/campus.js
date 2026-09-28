// 河海大学三校区 + 能源楼 3D 楼宇内的标注点数据
// 说明：楼宇运行数据均为演示用示例数据，非实时监测

export const CAMPUSES = [
  {
    id: 'xikanglu',
    name: '南京 - 河海大学 - 西康路联合',
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
    has3d: false
  },
  {
    id: 'changzhou',
    name: '常州 - 河海大学 - 常州联合',
    short: '常州校区',
    city: '常州',
    district: '金坛区',
    addr: '江苏省常州市金坛区河海大道 1915 号',
    // GCJ02 坐标（与高德底图同坐标系）：长荡湖畔常州新校区，
    // 由 OSM 收录 POI（WGS84 31.676107,119.571270）按国测局偏移转换得到
    lat: 31.673983,
    lng: 119.574844,
    has3d: false
  }
]

// 4 个 3D 标注点：位置贴合主楼外表面（主楼 7 宽 × 12 深 × 5 高）
export const BUILDING_NODES = [
  {
    id: 'system',
    tone: 'blue',
    title: '能源楼系统',
    pos: [0, 3.4, 6.5],
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
    pos: [4.0, 3.4, 0],
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
    title: '能源楼设备状态',
    pos: [0, 3.4, -6.5],
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
    pos: [-4.0, 3.4, 0],
    rows: [
      { label: '09:24', value: '3F 空调回路功率越上限', state: 'warn' },
      { label: '11:02', value: '储能 PCS 通讯短时中断', state: 'warn' },
      { label: '14:37', value: '光伏逆变器效率偏低', state: 'warn' }
    ]
  }
]

export const DATA_NOTE = '示例数据・非实时监测'