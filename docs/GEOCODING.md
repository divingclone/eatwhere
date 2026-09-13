# 详细地址搜索

本地地点列表可直接使用。只有用户触发详细地址搜索时，客户端才请求同源的 `GET /api/geocode?q=…`。API 使用高德 Web 服务 Key 查询深圳地点，Key 不进入前端代码或响应。

## 配置

本地复制 `.env.example` 到 `.env.local`，填写 `AMAP_WEB_SERVICE_KEY` 并重启 Vite。Vite 开发中间件调用 `api/geocode.ts` 的 `geocodeRequest`，与生产 Function 复用处理逻辑。

Vercel 在项目环境变量中配置同名变量后重新部署。必须是 Web 服务类型 Key；浏览器 JavaScript API 的 Key 无法替代。`bun run preview` 和仅上传 `dist/` 的纯静态托管不会运行这个 API。

## 接口契约

关键词去掉首尾空白后须为 2–100 个字符，不接受控制字符。Vercel handler 仅支持 GET，查询参数 `q` 必须恰好出现一次。

成功响应 HTTP 200，最多六个结果，找不到时返回空数组：

```json
{
  "results": [
    {
      "id": "amap:provider-id",
      "name": "地点名称",
      "address": "深圳市南山区详细地址",
      "location": { "lng": 113.94, "lat": 22.54 }
    }
  ]
}
```

以上坐标仅为响应格式示例。响应中的经纬度统一为 WGS84，与应用底图和路由图一致。服务端将高德 GCJ-02 坐标通过迭代反算转换为 WGS84；存在地图源和测量本身的定位误差。

错误响应格式：

```json
{
  "error": {
    "code": "GEOCODING_NOT_CONFIGURED",
    "message": "面向用户的中文错误说明"
  }
}
```

| HTTP | 错误码                          | 含义                             |
| ---- | ------------------------------- | -------------------------------- |
| 400  | `INVALID_QUERY`                 | 关键词长度或内容不合要求         |
| 405  | `METHOD_NOT_ALLOWED`            | 请求方法不是 GET                 |
| 503  | `GEOCODING_NOT_CONFIGURED`      | 服务端尚未配置 Key               |
| 503  | `GEOCODING_CONFIGURATION_ERROR` | Key、接口权限或服务有效期异常    |
| 429  | `GEOCODING_RATE_LIMITED`        | 高德限流或额度不足               |
| 504  | `GEOCODING_TIMEOUT`             | 上游请求超过八秒                 |
| 502  | `GEOCODING_UNAVAILABLE`         | 网络异常、数据异常或其他上游错误 |

`src/lib/geocode.ts` 导出 `searchAddresses(query, signal?)` 和 `AddressSearchError`。前端可读取错误的 `code`，也可直接展示 `message`；主动取消抛出 `AbortError`，客户端总超时为十秒。服务端不回传上游原始错误、URL 或 Key。

## 搜索步骤

1. 请求固定的 `https://restapi.amap.com/v3/place/text`，参数固定 `city=440300`、`citylimit=true`、`offset=6`、`extensions=base`，用户输入只作为 `keywords`。
2. 保留行政区编码匹配 `4403xx` 且经纬度有效的深圳结果；屏蔽异常坐标并按地点 ID 去重。
3. POI 结果为空时，请求固定的 `/v3/geocode/geo`，同样指定深圳市。过滤国家、省、市、区县级的模糊中心点，避免把未识别地址误当成具体起点。
4. 转换坐标并输出精简字段。两个上游请求共用八秒超时；每次搜索最多两个上游请求。

深圳市本体以外的地点，包括不属于 `4403xx` 的行政区，不会进入结果。地理编码是否能找到某个门牌，取决于高德数据；用户应从结果中确认实际出发地点。

参数和字段参考高德官方的 [POI 搜索说明](https://developer.amap.com/api/webservice/guide/api-advanced/search)与 [地理编码说明](https://developer.amap.com/api/webservice/guide/api/georegeo)。错误映射参考 [高德错误码说明](https://developer.amap.com/api/webservice/guide/tools/info)。

## 数据处理与部署边界

- API 是固定上游的地址查询端点，不接受任意 URL、上游路径或 Key 参数，也不支持其他高德接口代理。
- 仅返回地点名称、地址、ID 和坐标，响应使用 `Cache-Control: no-store`。应用没有地址数据库或服务端查询缓存，也没有打印地址或 Key 的日志代码。
- 查询文字存在 GET 请求 URL 中，托管平台访问日志与高德仍可能处理这些数据；不要将应用的“不写日志”理解为第三方完全不留存。
- 本机方案保存在 `localStorage`。重置可以恢复示例方案；不会删除托管方或高德按其政策产生的数据。
- 当前没有跨实例的应用层限流或账户系统，429 主要转译高德配额限制。面向大量公开访问部署时，应在 Vercel 配置与业务相适应的流量限制，并查看高德账户的接口权限和用量。
- 这个 API 仅负责地点解析，通勤优化继续由浏览器中的离线图算法完成，不查询实时地铁路线。
