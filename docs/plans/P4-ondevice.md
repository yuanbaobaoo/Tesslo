# P4：端侧能力（传感器积木 + 端侧 AI）

> 优先级 4 · 规模 L（4–8 周） · 前置：无 · 内部顺序：先传感器（独立可交付）后 AI（共用桥骨架）
> · 差异关键词：零外设体感、离线、中文、低延迟

## 目标

1. **传感器积木**：平板本机传感器（加速度 / 陀螺仪 / 方向）成为
   积木输入源——倾斜控制角色、晃动触发事件，零外设零网络；
2. **端侧 AI**：把依赖云端代理或桌面浏览器 API 的语音 / 视觉扩展
   替换为系统端侧能力，飞行模式全功能可用（Scratch 4.0 官方走
   云端 AI，端侧是 Tesslo 的差异位）。

两部分共用同一套"平台能力桥"骨架与真机摸底流程，故合为一个迭代。

## 现状与锚点

- 平台桥统一为回环 TCP（`Ports.ets` 登记 20111–20114，本迭代新增
  20115/20116），WS 连 127.0.0.1 已有先例（编辑器 → Scratch Link）。
- 扩展机制现成：`scratch-vm/src/extensions/` + gui 扩展库入口
  （`libraries/extensions/index.jsx`，faceSensing / text2speech /
  translate / videoSensing 已启用）。
- 加速度 / 陀螺仪 / 方向 / 旋转矢量免权限；CAMERA / MICROPHONE
  已声明，授权流程现成（`WebPermissionHandler`）。

## 技术设计

### 统一桥骨架

- 回环 WS / HTTP 混合服务，`Ports.ets` 登记：
  `SENSOR_SERVER_PORT = 20115`（传感器推送）、
  `AI_SERVER_PORT = 20116`（TTS / ASR 请求-响应 + 流式）
- 推理 / 采集在 ArkTS 独立线程，结果异步回灌，不阻塞 VM 主循环

### 传感器部分

- `entry/ets/sensors/SensorServer.ets`：`@ohos.sensor` 订阅，
  原始 50Hz 聚合为 20Hz 事件流；连接即订阅、断连即退订
  （无连接不耗电，hilog 留痕）；消息格式：

```json
{"source": "local", "type": "sensor",
 "sensor": "accel|gyro|orientation",
 "x": 0.1, "y": -0.2, "z": 0.98, "ts": 1763000000000}
```

- `scratch3_tesslo_sensors` 扩展：hat（当平板被倾斜 / 被晃动 /
  翻转时）+ reporter（倾斜角前后 / 左右、旋转角、加速度峰值）；
  手势去抖参考 microbit gesture 实现；reporter 读最新缓存按
  VM 帧取数，不轮询
- gui 扩展库入口 + zh-CN / en-US 词条 + 图标；传感器缺失 /
  连接失败时积木灰化 + 提示
- 协议预留 `source: local|remote` 字段，供 P6 超级终端复用

### AI 部分

- 第 0 步真机摸底，产出《AI 扩展现状表》：

| 扩展 | 预期 | 结论 |
| --- | --- | --- |
| text2speech | 云代理 / speechSynthesis，离线不可用 | 待测 |
| speech2text | webkitSpeechRecognition，ArkWeb 无 | 待测 |
| faceSensing | 浏览器端模型已随包，帧率待测 | 待测 |
| videoSensing | getUserMedia 本地分析，预期可用 | 待测 |

- AiServer 能力接口：`tts.synthesize`（Core Speech Kit
  `textToSpeech`，文本 + 音色 → 音频）、`asr.start/event/stop`
  （`AsrController` 端侧识别，中文优势）
- 扩展改造只换实现后端、积木形状不变（项目与官方互通不受影响）：
  text2speech 走 AiServer，音色映射系统音色 / 语速；speech2text
  本地化为 AsrController 实现
- faceSensing：帧率 ≥ 15fps 则保留，不达标换 Vision Kit /
  MindSpore Lite，关键点走 AiServer 通道；translate 一期仅标注
  "离线不可用"，端侧翻译 Kit 可用性确认后再排
- 麦克风并发：ASR 与声音录制面板先到先得 + 明确提示，不死锁抢麦
- 系统 Kit 自带模型不入包；自备模型放 rawfile 并记录体积

## 任务拆解

传感器（先做，独立可交付）：

- [ ] SensorServer 骨架：端口登记、WS 服务、订阅与退订
- [ ] 20Hz 聚合与消息协议联调（Web 端临时页验证数据流）
- [ ] scratch-vm 扩展：hat / reporter 积木 + 去抖
- [ ] gui 扩展库入口 + 词条 + 图标 + 灰化提示
- [ ] 样例工程：倾斜走迷宫
- [ ] 真机验证：360° 读数单调连续；卸载扩展后订阅确已取消

AI（后接）：

- [ ] Kit 对 API 26 支持矩阵核查（不支持的能力直接降级，不带病开发）
- [ ] 现状摸底表（四扩展真机离线测试）
- [ ] AiServer 骨架：tts.synthesize / asr 会话接口
- [ ] text2speech 后端替换 + 音色映射
- [ ] speech2text 端侧实现
- [ ] 麦克风并发互斥策略
- [ ] faceSensing 帧率摸底与决策（保留 / 换端侧）
- [ ] 飞行模式全链路验证 + 延迟实测

## 验收标准

传感器：

- [ ] 倾斜迷宫全程零外设、零网络可玩
- [ ] reporter 读数平滑无跳变；无连接时不订阅（hilog 证据 + 耗电无感知差异）

AI：

- [ ] 飞行模式下角色朗读中文、语音识别驱动积木全功能可用
- [ ] TTS 首响 < 500ms、ASR 端到端 < 1.5s（真机中位数）
- [ ] 与声音录制面板同时使用不死锁、不抢麦

## 风险与备注

- 机型差异：传感器种类 / 精度不同，连接时探测逐项灰化
- Kit 支持矩阵先查再开工；结论不过关的能力降级排期
- 可选不承诺：本机生成素材（文生图 / 音效），成熟后再评估
