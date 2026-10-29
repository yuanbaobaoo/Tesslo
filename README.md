# Tesslo

Tesslo 是一个面向 **HarmonyOS 7** 的 Scratch 兼容编辑器，使用 **Electron 40**、Scratch 编辑器源码和 C# Scratch Link。

它是独立项目，不是 Scratch 官方产品，也不代表 Scratch Foundation。

## 构建

```bash
pnpm install
pnpm build                 # 从仓库内源码构建 GUI + desktop dist
pnpm build:link:csharp     # C# Link + NativeAOT + NAPI 桥
pnpm build:hap             # 未签名 HAP
pnpm test                  # Scratch Link 协议测试
```

真机：

```bash
pnpm dev:ohos -- --device <serial>
pnpm dev:ohos -- --ble-sim --device <serial>  # 模拟 micro:bit/WeDo
```


## 目录

```text
apps/desktop      scratch-desktop 源码
apps/ohos         最小 HarmonyOS HAP 宿主
packages/         Scratch 源码、link、protocol-tests
vendor/           上游锁定、C# 参考源码、NativeAOT 工具链
media/            离线素材缓存
docs/             架构、状态、真机测试、上游矩阵
scripts/          build-hap / dev-ohos / build-link-csharp / test-ble / vendor
```

## 状态

已完成：源码级构建、最小 HAP 宿主、C# Link（NAPI + 真机 20111）、真实 BLE 扫描、GATT 桥、micro:bit/WeDo 模拟设备验证。

待完成：micro:bit/WeDo 真机 GATT 回归、BT Classic、CI、离线 HAP 物料、上架合规。

详见 [docs/status.md](docs/status.md)。

## 许可证

- 代码：AGPL-3.0-only
- 上游版权归 Scratch Foundation 及其贡献者
- “Scratch”仅用于描述兼容性；Scratch 名称、Logo、Scratch Cat 等是 Scratch Foundation 的商标
- 非官方项目，不表示隶属或背书
