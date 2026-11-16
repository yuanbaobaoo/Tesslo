# dev:ohos 首次运行体验（零干预方案）

目标：一台全新机器上，用户只做三件事就能把项目装进模拟器或测试真机。

```sh
git clone <repo> && cd tesslo
pnpm install
pnpm dev:ohos
```

中间所有步骤（生成 `build-profile.json5`、注入 dev 身份、登录华为账号、创建/启动模拟器、
生成调试签名、构建、安装、启动、收集日志）都由 `dev:ohos` 自动完成。只有两类事情保留
人工：CLT/JDK 的环境配置（`pnpm install` 的 y/N 提示，保持现状）、release 上架证书维护。

## 已确认的交互决策

| # | 决策 | 落地方式 |
| --- | --- | --- |
| 1 | 登录时"先等回车"可以接受 | 提示用户按回车，浏览器由 devecocli 打开 |
| 2 | 无设备时默认启动一个模拟器 | `hdc list targets` 为空才处理 |
| 3 | 没有现成实例时自动创建 | 交互选择设备类型 / 系统版本，缺镜像则先下载；**内存等规格不进工具链** |
| 4 | `pnpm install` 流程不改 | 缺环境仍提示用户选择 |
| 5 | 登录与模拟器判断只在 `dev:ohos` 做 | `build:hap` / `build:app` 不触发自动登录或自动创建模拟器 |
| 6 | 不考虑 CI | CI 只做无签名 HAP 打包，与模拟器/登录无关；方案不为 CI 增加分支 |

## 现状盘点：已经自动的部分

| 环节 | 实现位置 | 状态 |
| --- | --- | --- |
| `build-profile.json5` 首次生成（从模板复制） | `ensureProfile()` | ✅ |
| dev product / dev target 注入 | `ensureDevProduct()` | ✅ |
| dev 调试签名生成并回写 signingConfig | `ensureDevSigning()` | ✅ |
| 生成签名时临时切换 `app.json5` 包名并还原 | `withAppBundleName()` | ✅ |
| 构建 → 安装 → 启动 → 拉日志 → 截图 | `dev-ohos.ts` | ✅ |

缺的是三块：**未登录时引导登录**、**无设备时启动现有模拟器**、**无实例时交互创建模拟器**。

## 命令依据（devecocli 实测）

### 登录

```text
devecocli auth status   # 已登录: Current user: <名称>；未登录: Not logged in
devecocli auth login    # 先打印 "Press Enter to open browser for login..."，回车后拉起浏览器
devecocli auth logout
```

实测要点：

- `auth status` 两种情况**退出码都是 0**，只能解析 stdout；
- `auth login` 需要按一次回车才打开浏览器，随后本地起回调服务并等待（默认 10 分钟）；
- 已登录时 `auth login` 打印 `Already logged in, User Name:<名称>` 后直接返回；
- token 位于 `~/.config/deveco-cli/token.enc`；`DEVECO_CLI_DATA_DIR` 可覆盖，
  **用空目录即可安全模拟"全新环境"**。

### 模拟器

```text
devecocli emulator list --format json          # 实例：name/status/serial/deviceType/osVersion
devecocli emulator image list --all --format json  # 镜像：deviceType/osVersion/downloaded/...
devecocli emulator image download --device-type <t> --os-version "<v>"
devecocli emulator create <name> --device-type <t> --os-version "<v>"
devecocli emulator start <name>
devecocli emulator license [view|accept]
devecocli device list --format json
```

实测要点：

- `emulator start` 内部轮询 `hdc list targets` 最多 60 秒，**超时只警告、退出码仍为 0**；
  脚本要自己再确认；
- `emulator create` 只接受 `--device-type` 与 `--os-version`；**内存、CPU 等规格不在
  本工具链内**，由用户自行在 DevEco Studio 或实例配置中维护；
- 未接受协议会报 `EmulatorLicenseBlockedError`，需用户先执行
  `devecocli emulator license`（交互阅读）或 `devecocli emulator license accept`；
- 创建要求镜像已下载（`image list` 的 `downloaded=true`），否则先 `image download`；
- 模拟器能力依赖 DevEco 模拟器（macOS/Windows）；Linux 上没有该能力，需按
  "无设备" 路径给出指引（容器测试会覆盖这一点）。

## 设计

### 1. 触发时机：只在 `dev:ohos`

`dev:ohos` 的执行顺序：

```text
resolveToolchain()
→ 设备判断（仅当 hdc list targets 为空）：启动已有模拟器 / 交互创建
→ buildHap()（签名需要生成时：登录判断 → 引导登录 → devecocli 生成签名）
→ 逐设备安装 / 启动 / 拉日志 / 截图
```

`build:hap`、`build:app` 保持现状：不自动登录、不自动创建/启动模拟器。

登录判断挂在"确实要生成签名"之前（材料有效则跳过，保持离线），并通过
`buildPackage({allowLogin: true})` 从 `dev-ohos.ts` 传入，其它入口不开启。

### 2. 自动登录引导：`ensureAuth()`

```text
devecocli auth status
├─ 输出含 "Not logged in"：
│    打印：需要登录华为账号，按回车打开浏览器（Ctrl-C 取消）
│    → devecocli auth login（stdio 继承：用户按回车，浏览器自动打开，等待回调）
│    → 再次 status 确认 → 继续
└─ 无终端可交互：报错，提示在带浏览器的机器执行 devecocli auth login
```

不再使用"脚本替按回车"的方案：按用户要求显式提示，由用户按回车，交互更透明。

### 3. 设备判断：`ensureDevices()`

仅在 `hdc list targets` 为空时执行：

```text
有 --emulator <name>  → 直接启动该实例
否则 emulator list --format json
├─ 有 status=stopped 且 deviceType ∈ {2in1, tablet} 的实例 → 取第一个启动
└─ 没有实例 → 进入交互创建（第 4 节）
启动后自行轮询 hdc list targets（2s 间隔，最长 180s）
```

`--device <serial>` 指定了具体设备时不启动任何模拟器。模拟器能力不可用（例如
Linux）时，按"无设备"给出真机接入指引，不尝试启动。

### 4. 交互创建：`ensureEmulator()`

用户依次选择（编号菜单，复用现有 `createPrompts()`）：

1. **设备类型**：来自 `module.json5` 的 `deviceTypes`，即 `2in1` / `tablet`；
2. **系统版本**：`emulator image list --all --format json` 里该设备类型的可选版本
   （标注 `downloaded` 是否已下载）。

内存、CPU 等规格不询问、不写入——由用户自行维护。

随后：

```text
镜像未下载 → devecocli emulator image download --device-type <t> --os-version "<v>"
           （数十分钟，进度直接透传；中途失败可重跑）
devecocli emulator create <name> --device-type <t> --os-version "<v>"
           （实例名默认 tesslo-<deviceType>-<version>，冲突时加序号）
devecocli emulator start <name>
轮询 hdc list targets（最长 180s）
```

协议未接受时：捕获 `EmulatorLicenseBlockedError`，提示用户执行
`devecocli emulator license` 后重跑；**不自作主张代替用户接受协议**。

无终端（无法交互）或需要脚本化时，用参数跳过菜单：

| 参数 | 作用 |
| --- | --- |
| `--emulator <name>` | 启动指定实例 |
| `--emulator-device-type <t>` | 创建时的设备类型 |
| `--emulator-os-version "<v>"` | 创建时的系统版本 |
| `--no-emulator` | 禁止自动启动/创建，无设备直接报错 |

### 5. 失败矩阵

| 场景 | 行为 |
| --- | --- |
| 未登录 + 可交互终端 | 提示按回车 → 打开浏览器 → 登录后续跑 |
| 未登录 + 无法交互 | 报错，给出 `devecocli auth login` 指引 |
| 无设备 + 有已停止实例 | 自动启动，等待 180s |
| 无设备 + 无实例 + 可交互 | 交互选设备类型/系统版本 → 下载镜像 → 创建 → 启动 |
| 无设备 + 无实例 + 无法交互 | 报错，给出创建命令/参数 指引 |
| 模拟器能力不可用（如 Linux） | 不尝试启动，按"无设备"给出真机接入指引 |
| 协议未接受 | 提示 `devecocli emulator license`，不代签 |
| 镜像下载失败/超时 | 报错并给出重试命令 |
| 模拟器启动超时 | 报错，给出 `emulator start` / DevEco Studio 指引 |
| 签名材料有效 | 不查登录；设备检查仅在无设备时发生 |

## 验证计划

### macOS（主链路）

1. **单测**：`auth status` 输出解析、实例/镜像筛选、参数校验（纯函数）。
2. **未登录路径**：`DEVECO_CLI_DATA_DIR=$(mktemp -d)` 模拟新环境，验证提示与登录引导。
3. **无设备路径**：断开真机，验证自动启动 `MateBook Pro`（2in1）并完成部署。
4. **创建路径**：在没有实例的环境验证交互菜单、镜像选择与创建（临时实例验证后删除）。
5. **回归**：有设备时行为不变；`--device` 指定不存在序列号仍报错；`--skip-build` 可用；
   `build:hap` / `build:app` 不触发新逻辑。

### Linux 容器（空环境）

用 Docker 起一个干净容器（`node:22-bookworm`，Node 22 ≥ 项目要求的 22.18），
从零验证整套体系在 Linux 上的行为：

1. `pnpm install`（corepack 启用 pnpm）→ 依赖与 `scripts/env.ts` 自愈链路正常；
2. `pnpm typecheck:scripts` + `pnpm test` 全绿；
3. `dev:ohos` 在无设备、无模拟器能力的 Linux 上：**不崩溃、不挂起**，
   给出明确的真机接入/登录指引，退出码非 0；
4. `dev:ohos --no-emulator` 与 `--emulator-*` 参数在 Linux 下的行为一致（不尝试模拟器）；
5. 能完整跑通 `pnpm build:hap`（未签名）则额外验证 CLT/JDK 工具链解析；
   镜像体积与耗时可接受时执行，并记录结论。

容器内不验证：真机安装、模拟器启动、浏览器登录（无 GUI/KVM），这些只在 macOS 覆盖。

## 涉及改动

| 文件 | 改动 |
| --- | --- |
| `scripts/ohos-common.ts` | 新增 `ensureAuth()`、模拟器启动/创建、镜像选择（不含内存配置） |
| `scripts/dev-ohos.ts` | 设备与登录判断前置；新增模拟器相关参数 |
| `tests/` | 解析与筛选的单测 |
| `docs/build.md`、`docs/device-testing.md` | 入口链接与首次运行说明 |
