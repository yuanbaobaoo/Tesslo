# 桥协议规格（三原生壳共同规格）

> 三壳（harmony/Android/iOS）各自原生实现本规格；产品层（Web 平面）
> 只依赖本协议，不感知壳的实现语言。改动本规格 = 三壳同步改 + PR 说明。

## 回环 HTTP 服务规格（MiniHttp 语义）

| 项 | 规格 |
| --- | --- |
| 监听 | 仅 `127.0.0.1`，端口见下表；不鉴权（回环内无敏感面） |
| 生命周期 | 随宿主启动/销毁成对启停；**重建幂等**（端口被旧实例 TIME_WAIT 占用时清理重试） |
| 请求解析 | 请求行 + 头 + Content-Length 定长 body；HTTP 头按 ASCII 计字节 |
| CORS | OPTIONS 预检回 204 + `Allow-Origin: *` / `Allow-Methods` / `Allow-Headers`（ArkWeb 的 JSON POST 必发预检） |
| 路径安全 | `..` 逃逸一律拒绝 |
| 响应信封 | `{ok:true,data} \| {ok:false,error:{code,message,retryable}}`，JSON + UTF-8 |
| 连接关闭 | 响应后等对端关闭（服务端不先发 FIN，避免监听口进 TIME_WAIT；带超时兜底） |

## 端口表（Ports）

| 端口 | 服务 | 实现 |
| --- | --- | --- |
| 20111 | C# Scratch Link（WebSocket） | libtesslolink.so（NAPI） |
| 20113 | BLE TCP 桥 | 各壳原生实现 |
| 20114 | 离线素材 HTTP（rawfile/静态目录） | 各壳原生实现 |
| 20117 | ProjectServer（作品库） | 各壳原生实现，规格见下 |

## ProjectServer 语义（端点行为）

- 注册表：库内 `library.json`（id/name/dirUri/location/updatedAt/favorite/**savedOnce**）
- 缺失态：目录不存在，或 **savedOnce=true 且 .tess 读不到**（新建未保存不判缺失）
- 原子写：同目录 tmp + rename；保存前旧版转存 `snapshots/`（保留最近 10 份）
- 回滚：先转存当前版，快照原子顶替（可再撤销）
- 外部目录：picker + 空目录校验 + 持久授权；relink 按目录内 .tess 认领
- 错误码：`E_NO_AUTH` / `E_DIR_MISSING` / `E_DIR_NOT_EMPTY` / `E_IO` / `E_TIMEOUT` / `E_UNSUPPORTED`（与 Web 侧 PlatformError 一一映射）

## harmony 壳参照实现

`apps/host/ohos/entry/src/main/ets/{common/MiniHttp.ets, works/ProjectServer.ets}`
（已真机验证：12 端点 API、原子写杀进程 ×6、缺失态/重联、CORS 预检、
Ability 重建幂等）——Android/iOS 壳照此语义实现。
