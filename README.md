# 去哪吃饭？深圳

给住在深圳不同地方的朋友，找到大家都方便的约饭商圈。使用 **Bun + Svelte 5 + TypeScript + Vite + Leaflet**，可直接导入 Vercel。

- 深圳地图、地铁线网与商圈范围，地图和推荐列表联动。
- 添加 2–8 位朋友，选择地铁站、商圈或在地图上选点作为起点；可选开通深圳详细地址搜索。
- 根据步行、候车、地铁与换乘估计每个人的通勤时间，并比较商圈。
- 调整每位朋友的通勤权重，愿意多走一段的朋友可降低权重，推荐随之重算。
- 在“综合最优”“总耗时少”“照顾最远”三种策略间切换。
- 点击商圈查看介绍、每位朋友的线路与时间构成。
- 当前方案保存在本机浏览器，可重置；无需登录。

## 本地运行

安装 [Bun](https://bun.sh/)，在仓库根目录执行：

```sh
bun install
bun run dev
```

打开终端显示的本地地址。内置地铁站、商圈及通勤计算无需 API Key；底图瓦片需要联网。开发服务器仅监听本机。

```sh
bun run check    # Svelte 和 TypeScript 检查
bun run test     # 路由、推荐算法和地址搜索测试
bun run build    # 输出 dist/
bun run preview  # 预览静态构建
```

`bun run preview` 仅预览前端，不启动地址搜索 API；完整本地搜索使用 `bun run dev`。仓库内的 GitHub Actions 会执行锁定安装、检查、测试和构建。

## 开通详细地址搜索（可选）

1. 在 [高德开放平台](https://console.amap.com/) 创建应用，申请 **Web 服务** 类型 Key，并确保可调用 POI 搜索及地理编码接口。
2. 复制 `.env.example` 为 `.env.local`，填写：

   ```dotenv
   AMAP_WEB_SERVICE_KEY=你的Web服务Key
   ```

3. 重新运行 `bun run dev`。在朋友的地址输入框搜索并选择准确地点。

该 Key 只由服务端读取，变量名不要加 `VITE_` 前缀。`.env.local` 已被 Git 忽略。没有 Key、额度用尽或服务异常时，界面会说明原因，仍可使用内置地点。

详细地址搜索会将关键词发给本站 API，再转发给高德；本地地铁站搜索和通勤计算在浏览器内完成。方案保存在当前浏览器的 `localStorage`，不会同步给其他朋友。应用代码不记录查询地址或 Key；托管平台和高德仍可能按各自政策处理网络请求日志。接口与数据流详见 [地址搜索说明](docs/GEOCODING.md)。

## GitHub 与 Vercel

将仓库推送到自己的 GitHub，再在 Vercel 选择 **Add New → Project → Import Git Repository**。确认以下设置：

| 设置             | 值                                         |
| ---------------- | ------------------------------------------ |
| Framework Preset | Vite                                       |
| Root Directory   | 仓库根目录                                 |
| Install Command  | `bunx bun@1.4.2 install --frozen-lockfile` |
| Build Command    | `bunx bun@1.4.2 run build`                 |
| Output Directory | `dist`                                     |

这些构建设置已经写在 `vercel.json`；提交 `bun.lock` 保证依赖安装可复现。需要详细地址搜索时，在 Vercel 项目环境变量中添加 `AMAP_WEB_SERVICE_KEY`，勾选所需的 Production / Preview 环境，再部署。`api/geocode.ts` 会作为 Vercel Node.js Function 提供 `/api/geocode`，Bun 用于依赖管理、开发、测试与构建。环境变量变更后需要重新部署。[Vercel 的 Vite 文档](https://vercel.com/docs/frameworks/frontend/vite)与 [Node.js Function 文档](https://vercel.com/docs/functions/runtimes/node-js)说明了对应的托管方式。

生产分支为 `main`。在 Vercel 关联 GitHub 仓库后，后续推送会触发自动构建与部署。

云端使用 `bunx bun@1.4.2` 固定 Bun 版本，避免 Vercel 默认旧版本无法读取锁文件。此配置依据 [Vercel 的 Bun 版本固定说明](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds)。

## 项目结构

```text
src/
  App.svelte           约饭规划界面与交互
  lib/                 类型、地点数据、路由计算、地址搜索客户端
    components/        地图、地址输入与路线详情组件
    data/metro.json    可追溯来源与抓取时间的地铁快照
api/geocode.ts         服务端高德地址搜索代理
tests/api/             接口测试（与部署函数目录分开）
scripts/               地铁数据更新工具
docs/                  算法与地址搜索说明
.github/workflows/     检查、测试、构建 CI
.env.example           可提交的环境变量模板
vercel.json            Vercel 构建和响应头配置
```

## 数据与估算边界

地铁拓扑是仓库内的离线快照，新增线路和延伸段需要更新数据；商圈介绍与范围是人工整理的约饭候选区域。地图显示的商圈范围用于比较聚餐位置，并非行政边界，也不是已验证的步行等时圈。底图使用 OpenStreetMap，保留地图署名，加载依赖网络。

通勤结果是模型估计：考虑到站步行、候车、地铁及换乘，但没有实时班次、运营时间、出入口、拥挤、商场营业和道路障碍信息；步行按地理距离近似。线路显示连接站点，不能代替地面步行导航。出发前请在交通地图中核实运营与实际路线。算法公式、参数、权重含义和数据来源见 [算法说明](docs/ALGORITHM.md)。
