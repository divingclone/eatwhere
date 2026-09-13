import snapshot from './data/metro.json' with { type: 'json' };
import type { Coordinate, District, Friend, MetroLine, MetroStation } from './types';

export const metroStations: MetroStation[] = snapshot.stations;
export const metroLines: MetroLine[] = snapshot.lines;

export const dataInfo = {
  source: snapshot.source,
  updatedAt: snapshot.fetchedAt.slice(0, 10),
  description: `${snapshot.stations.length} 座车站 · ${snapshot.lines.length} 组线路（2 / 8 号线贯通）· 高德公开地铁图快照，已转 WGS84。不保证包含最新开通线路；抓取日期不是线路更新时间。非实时班次，站间连线与商圈范围均为示意。`,
};

function nearStation(name: string, east = 0, north = 0): Coordinate {
  const station = metroStations.find((entry) => entry.name === name);
  if (!station) throw new Error(`Unknown district station: ${name}`);
  return { lng: station.location.lng + east, lat: station.location.lat + north };
}

// Business-area centroids are approximate locations relative to their metro anchors,
// not geocoded restaurant entrances. Walking is estimated again by the routing engine.
export const districts: District[] = [
  {
    id: 'chegongmiao',
    name: '车公庙',
    area: '福田区',
    location: nearStation('车公庙', 0.0012, -0.0007),
    stationName: '车公庙',
    description:
      '写字楼之间藏着密集的餐厅和小店，丰盛町、深业泰然一带适合下班后随意约一顿。多条地铁交会，东西两边的朋友都好接上。',
    tags: ['交通枢纽', '下班小聚', '选择丰富'],
    highlights: ['丰盛町', '深业泰然', '街巷小馆'],
    walkMinutes: 5,
  },
  {
    id: 'futian',
    name: '福田中心',
    area: '福田区',
    location: nearStation('购物公园', -0.0014, -0.0008),
    stationName: '购物公园',
    description:
      '以 COCO Park 和购物公园为中心，商场餐饮、咖啡与夜间小聚选择集中。适合想吃完继续坐坐的朋友。',
    tags: ['聚餐热门', '夜间小聚', '商场餐饮'],
    highlights: ['福田 COCO Park', '购物公园', '中心城'],
    walkMinutes: 6,
  },
  {
    id: 'gangxia',
    name: '岗厦 · 卓悦中心',
    area: '福田区',
    location: nearStation('岗厦', 0.0017, 0.0017),
    stationName: '岗厦',
    description:
      '卓悦中心周边街区连着商场与开放步行空间，适合先吃饭，再沿街散步。岗厦与岗厦北可根据来向灵活选择。',
    tags: ['开放街区', '朋友聚餐', '饭后散步'],
    highlights: ['卓悦中心', '中央大街', '岗厦北枢纽'],
    walkMinutes: 7,
  },
  {
    id: 'meilin',
    name: '上梅林',
    area: '福田区',
    location: nearStation('上梅林', -0.0014, 0.0009),
    stationName: '上梅林',
    description:
      '卓悦汇与周边社区餐饮相邻，从商场聚餐到街边小馆都有得选。连接福田和龙华，适合南北两侧的朋友碰头。',
    tags: ['社区烟火', '南北相聚', '家常小馆'],
    highlights: ['卓悦汇', '梅林街区', '社区小馆'],
    walkMinutes: 5,
  },
  {
    id: 'huaqiangbei',
    name: '华强北',
    area: '福田区',
    location: nearStation('华强北', -0.001, 0.0015),
    stationName: '华强北',
    description:
      '九方、茂业与华强北步行街聚集了多样餐饮，既能认真聚餐，也能边逛边吃。适合希望选择灵活的一群人。',
    tags: ['边逛边吃', '多元口味', '选择丰富'],
    highlights: ['中航城九方', '华强北步行街', '茂业天地'],
    walkMinutes: 6,
  },
  {
    id: 'houhai',
    name: '后海 · 深圳湾',
    area: '南山区',
    location: nearStation('后海', 0.0026, 0.0013),
    stationName: '后海',
    description:
      '深圳湾万象城与人才公园一带适合稍有仪式感的聚会。餐后可向公园散步，周末也适合把吃饭安排成半日活动。',
    tags: ['品质聚餐', '公园散步', '周末相聚'],
    highlights: ['深圳湾万象城', '人才公园', '后海街区'],
    walkMinutes: 8,
  },
  {
    id: 'coastal-city',
    name: '海岸城',
    area: '南山区',
    location: nearStation('后海', -0.0044, -0.0018),
    stationName: '后海',
    description:
      '海岸城与周边商业街的餐饮密度高，聚餐、甜品、咖啡可以一次安排。后海站出来再步行一段，适合南山朋友常聚。',
    tags: ['餐饮密集', '甜品咖啡', '南山热门'],
    highlights: ['海岸城购物中心', '海德广场', '文心广场'],
    walkMinutes: 10,
  },
  {
    id: 'baoan',
    name: '宝安中心',
    area: '宝安区',
    location: nearStation('宝安中心', 0.0011, 0.0012),
    stationName: '宝安中心',
    description:
      '壹方城周边的商场餐饮集中，适合人数较多、口味不同的朋友一起选店。宝安中心站连接 1 号线与 5 号线。',
    tags: ['多人聚餐', '大型商场', '西部相聚'],
    highlights: ['壹方城', '宝安中心区', '商场餐饮'],
    walkMinutes: 5,
  },
  {
    id: 'hongshan',
    name: '红山',
    area: '龙华区',
    location: nearStation('红山', 0.002, 0.0009),
    stationName: '红山',
    description:
      '红山 6979 与周边街区融合餐饮、文化空间和步行街。靠近深圳北站片区，适合龙华与市区朋友约着吃饭逛一逛。',
    tags: ['街区漫步', '文化空间', '北站周边'],
    highlights: ['红山 6979', '红山街区', '餐后咖啡'],
    walkMinutes: 7,
  },
  {
    id: 'longhua',
    name: '龙华 · 壹方天地',
    area: '龙华区',
    location: nearStation('龙华', 0.0051, -0.0041),
    stationName: '龙华',
    description:
      '壹方天地由多个商业片区组成，适合选择多、愿意边走边逛的聚会。距地铁站有一段步行，约好具体入口会更方便。',
    tags: ['开放商区', '周末聚会', '口味多样'],
    highlights: ['壹方天地', '龙华街区', '开放步行空间'],
    walkMinutes: 13,
  },
  {
    id: 'dongmen',
    name: '东门 · 老街',
    area: '罗湖区',
    location: nearStation('老街', 0.0022, 0.0007),
    stationName: '老街',
    description:
      '老街和东门步行街适合小吃、随逛与轻松聚餐。餐饮以街区分布为主，喜欢热闹、想边走边决定吃什么时很合适。',
    tags: ['街头小吃', '老深圳', '热闹好逛'],
    highlights: ['东门步行街', '老街', '街头小吃'],
    walkMinutes: 6,
  },
  {
    id: 'luohu-mixc',
    name: '罗湖 · 万象城',
    area: '罗湖区',
    location: nearStation('大剧院', 0.0015, -0.0021),
    stationName: '大剧院',
    description:
      '深圳万象城与蔡屋围商圈集中了商场餐饮和休闲去处。适合想把聚会安排得从容些，也方便接上罗湖片区的朋友。',
    tags: ['品质聚餐', '商场餐饮', '市区相聚'],
    highlights: ['深圳万象城', '蔡屋围', '地王商圈'],
    walkMinutes: 7,
  },
  {
    id: 'buji',
    name: '布吉 · 万象汇',
    area: '龙岗区',
    location: nearStation('布吉', 0.0031, -0.0019),
    stationName: '布吉',
    description:
      '布吉万象汇与周边社区餐饮适合轻松碰头，地铁枢纽让龙岗、龙华和罗湖的来向都有选择。适合把聚会重心稍向东移。',
    tags: ['东部相聚', '交通枢纽', '轻松聚餐'],
    highlights: ['布吉万象汇', '布吉街区', '社区餐饮'],
    walkMinutes: 9,
  },
];

export const defaultFriends: Friend[] = [
  {
    id: 'friend-1',
    enabled: true,
    name: '阿杰',
    address: '宝安中心站附近',
    travelMode: 'transit',
    location: nearStation('宝安中心', -0.0017, 0.0008),
    weight: 1,
    color: '#f07850',
  },
  {
    id: 'friend-2',
    enabled: true,
    name: '小林',
    address: '深圳北站附近',
    travelMode: 'transit',
    location: nearStation('深圳北站', 0.002, 0.0011),
    weight: 1,
    color: '#7186db',
  },
  {
    id: 'friend-3',
    enabled: true,
    name: '小周',
    address: '大运站附近',
    travelMode: 'transit',
    location: nearStation('大运', -0.0017, 0.0006),
    weight: 1,
    color: '#4fa89a',
  },
];
