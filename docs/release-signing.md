# 发布（Release）签名详解

本文解释 Tesslo 上架签名的完整原理与流程：签名材料各自是什么、构建时发生什么、
密码存在哪、出问题怎么排查。操作层面的速查见 [构建与打包](build.md) 的「签名」一节。

## 为什么应用必须签名

HarmonyOS 不允许安装未签名应用，商店（AGC）也只接受**发布签名**的 App 包。签名同时解决三件事：

| 问题 | 靠什么解决 |
| --- | --- |
| 你是谁（发布者身份） | 私钥签名 + 华为签发的证书证明"这把私钥属于你" |
| 包有没有被改 | 签名覆盖包内容，改动后签名失效 |
| 谁允许你发布这个应用 | 华为签发的发布 Profile（授权文件，绑定证书与 bundleName） |

签名工具是 CLT 自带的 `hap-sign-tool.jar`（Java 实现），由 hvigor 在构建时自动调用，
用户不需要直接接触它。

## 签名材料的七个角色

申请/配置签名时会出现这些概念，一一对应关系如下：

| 材料 | 文件/字段 | 是什么 | 备注 |
| --- | --- | --- | --- |
| 密钥对 | —— | EC P-256 公私钥对，发布者身份的根本 | 私钥绝不离开密钥库 |
| 密钥库 | `storeFile`（.p12） | PKCS#12 容器，装着私钥（可装多把） | **最高机密**，泄露=别人能冒充你签名 |
| 密钥库密码 | `storePassword` | 打开 p12 文件的密码 | 必须填 **DevEco 密文格式**（`pnpm signing:encrypt` 生成，明文不可用）；keyPassword 与其相同 |
| 密钥别名 | `keyAlias` | 指明用库里哪把私钥 | 即 `signing:keygen` 的证书名称；也可用 `keytool -list` 查询 |
| 证书签名请求 | `.csr` | 申请证书时上传给 AGC 的中间产物 | 公开信息；**构建不用它**，只是申请流程的"门票" |
| 发布证书 | `certpath`（.cer） | 与私钥配对的公钥证书，华为 CBG 签发 | 公开材料；内容是三级链：Huawei CBG Root CA G2 → Developer Relations CA G2 → 你的证书 |
| 发布 Profile | `profile`（.p7b） | 华为签名的授权文件，声明"某证书可发布某 bundleName 的应用" | 内容含 developer-id、bundle-name、app-identifier、内嵌发布证书、APL；**签名时嵌入包内**，有效期受华为控制（证书 3 年） |
| 签名算法 | `signAlg` | `SHA256withECDSA`，与 EC P-256 密钥配套 | 固定值 |

签名时的取用关系：

```
storeFile + storePassword        打开密钥库
keyAlias + keyPassword           取出私钥
私钥 + signAlg                   对包内容签名
certpath                         证书随签名一并校验/关联
profile                          嵌入包内（授权凭证）
```

验证链（设备安装 / AGC 收包时）：包内签名 → 用证书公钥验签 → 证书链上溯到华为根 CA
→ 证书与 Profile 内嵌证书一致 → Profile 的 bundle-name 与应用一致。任何一环不符都会被拒。

## 叶子证书（-leaf.cer）是什么

`hap-sign-tool` 的 `certpath` 只接受**单证书文件**，且解析时取文件里的第一张证书。
AGC 直接下载的 `.cer` 天然只含一张证书，直接可用；但手工拼接/某些导出方式得到的
`.cer` 是整条证书链、且华为根 CA 排在最前面——直接用会取到根 CA，报"证书与密钥不匹配"。

AGC 直接下载的 `.cer` 若只含一张证书，`certpath` 直接填它；若是证书链，把其中
**你的证书**（非 CA 那张）单独存成一个文件（如 `<名称>-leaf.cer`），`certpath`
填这个单证书文件。

关于 `-leaf.cer` 的定性：

- **派生缓存，不是临时文件，构建完不删**。它被 `build-profile.json5` 的签名
  配置引用着，删了也无害（重跑上面的命令即可重建），但没有必要；
- **不含任何密钥**，只是公开证书的副本，无保密需求；
- 生成一次长期复用；AGC 换发新证书后重跑该命令覆盖刷新即可。

## 两套签名配置：default（调试）与 release（上架）

`apps/tesslo/build-profile.json5`（本机文件，不入 git）里并存两组 signingConfig：

| | `default` | `release` |
| --- | --- | --- |
| 用途 | 真机开发调试 | 商店上架 |
| 材料 | devecocli 自动生成的调试证书/Profile（华为账号登录，绑定设备） | AGC 申请的发布三件套（`.env` 提供） |
| 谁在用 | `pnpm build:hap --signed`、`pnpm dev:ohos` | `pnpm build:app` |
| 产出 | debug 模式 signed HAP | release 模式 signed App |

hvigor 的签名选择挂在 **product**（`products[].signingConfig` 引用名字）而不是
buildMode 上——`buildModeSet` 只管编译行为（混淆、调试信息），签名是另一条正交的
轴；且签名配置没有对应的命令行参数，只能随 product 声明。因此用**双 product**：
`default`（调试签名，`dev:ohos` / `build:hap --signed` 用）与 `release`（上架签名，
`build:app` 用 `-p product=release` 选择），构建全程不改写 build-profile.json5。

## 端到端流程

### 首次从零开始

```text
① pnpm signing:keygen 生成本地材料
     交互式输入：证书名称（文件名、密钥别名与证书 CN——CN 只是本地自签证书
     的占位主题，AGC 签发时会按账号重新生成，与应用包名无关）、密码
     （不回显，输两遍）
     产物：当前目录 .certs/<名称>.p12（0600）与 <名称>.csr（申请证书用的
     中间产物，构建不用）；.certs/ 含私钥，已入 .gitignore
     同名重跑需 --force 并确认（会作废用旧密钥签发的证书）

② AGC 签发（发布证书/Profile 只能由 AGC 签发；devecocli 的 signature
   generate 仅覆盖调试签名，日常开发用它即可）
     「证书管理」上传 CSR → 申请【发布证书】→ 下载 .cer
     「Profile 管理」申请【发布】Profile（选该证书 + 本应用）→ 下载 .p7b

③ 手工维护 build-profile.json5（本机文件，不入 git；模板已内置 release
   product 与 applyToProducts）
     signingConfigs 加 release 条目：certpath / storeFile / profile 填三个材料
     路径（certpath 必须是单证书文件，证书链需自行拆出叶子，见下节）；keyAlias
     即第①步的证书名称；keyPassword / storePassword 填密码密文（hvigor 只认
     DevEco 密文格式，`pnpm signing:encrypt` 生成——第①步 keygen 也会直接
     输出——两处同一串）；给 release product 加 signingConfig: 'release' 一行
     换材料、换密码：直接编辑这个文件

④ pnpm build:app
     开头校验 release product 已声明（缺失立刻报错并指向本文档，不进长构建）
     → 工具链自检 → 编辑器 → Web → C# Link 全链
     → hvigor -p product=release -p buildMode=release（不改写任何文件）
     → 产物 apps/tesslo/build/outputs/release/*-signed.app

⑤ AGC 网站 → 我的项目 → 版本管理 → 上传软件包（.app）
```

### 日常构建

`pnpm build:app` 一条命令：不询问、不改写配置，只校验 release product 已声明，
hvigor 用 `-p product=release` 选择。换材料、换密码直接编辑 `build-profile.json5`。

### 命令矩阵

| 命令 | buildMode | 签名 | 产物与用途 |
| --- | --- | --- | --- |
| `pnpm build:hap` | debug | 未签名 | unsigned.hap（CI / 本地检查） |
| `pnpm build:hap --signed` | debug | default 调试 | signed.hap 真机安装调试 |
| `pnpm dev:ohos` | debug | default 调试 | 签名→装机→启动→收集日志 |
| `pnpm build:app` | release | **release 上架** | signed.app，传 AGC |

`.app` 不是"另一种应用"，而是上架容器：assembleApp 以 release 配置**从头构建**签名
HAP 后连同 `pack.info` 打包成 `.app`。所以 release HAP 就在 `.app` 里，不单独产出。

## 构建内部步骤（pnpm build:app 拆解）

```text
pnpm build:app（node scripts/build-hap.ts --app，全链在脚本内）
├─ assertProduct(name)：校验 build-profile.json5 的 products 里有用户声明的
│   指定 product（默认 release；缺失立刻报错并指向本文档，不进长构建；
│   不生成、不改写任何内容——product、签名配置与密码全部由用户手工维护）
├─ node scripts/env.ts ensure --for app（工具链自检）
├─ pnpm build:editor / build:web / build:link:csharp（全链前置，编辑器→Web→C# Link）
├─ 清理 .hvigor / entry/build / build（产物确定性）
├─ hvigor assembleApp --mode project -p product=release -p buildMode=release
│    （签名随 product 声明；hvigor 内部调 hap-sign-tool：p12 私钥签名 + 证书
│      + Profile 嵌入；密码/路径/材料配对错误会在此阶段暴露）
└─ 校验 build/outputs/release/*-signed.app 存在（缺失报错，绝不静默出未签名包）
```

## 安全模型：密码与私钥放在哪

| 东西 | 位置 | 保护 |
| --- | --- | --- |
| 私钥 | `.env` 指向的 `.p12` 内 | 建议 0600 权限；**p12 + 密码 = 你的发布身份** |
| 密码（keygen 输入） | 只在终端 | 不回显、不进 shell 历史、不上命令行参数（keytool 走 0600 临时文件） |
| 密码（落盘） | `build-profile.json5` | 以 DevEco 密文格式填入（本机 material 密钥加密，与 DevEco Studio 同一套，hvigor 只认此格式）；文件建议 chmod 600，已 gitignore |
| CSR / .cer / -leaf.cer / .p7b | `.env` 指向的路径 | 全部是公开材料，无保密需求 |

红线：**不要提交 p12 与 build-profile.json5，不要把 p12+密码发给任何人**。
泄露后唯一补救是上 AGC 吊销证书，重新生成密钥对并重新申请证书/Profile。

## 常见问题排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `product 'release' 未在 … products 里声明` | 缺上架 product 声明 | 按本文档端到端流程第③步：products 加条目 + applyToProducts 加名字 |
| hvigor 报 00303116（password length < 32） | 密码字段填了明文 | build-profile 只认 DevEco 密文格式；`pnpm signing:encrypt` 生成后替换 keyPassword/storePassword 两处 |
| hvigor 签名阶段报密码/密钥库错误 | build-profile.json5 里的密码与 p12 不符 | 核对 release 配置里两处密码字段 |
| hvigor 报证书与密钥不匹配 | p12 与 certpath 不是一对，或 certpath 用了证书链 | 确认三件套同属一次申请；certpath 用单证书（叶子）文件 |
| 签名/上传时报 Profile 与应用不匹配 | 拿错了 Profile（别的应用/调试型） | 去 AGC 重新申请本应用的**发布** Profile 并更新 profile 路径 |
| 上传 AGC 被拒：证书/Profile 类型不对 | 用调试材料签了包 | 确认走的是 `build:app`（release 配置），HAP 调试包不能上传 |
| 证书/Profile 过期 | 发布证书 3 年，Profile 有独立有效期 | AGC 重新申请（证书未换则密钥库不动），并更新 certpath/profile 路径 |
| 想换 p12 密码 | —— | 重新 keygen（`--force`）+ 重申证书/Profile，或直接改 build-profile.json5 里两处密码字段 |

## 真机验证上架包

上架前想验证"商店将收到的确切内容"，从 `.app` 解出 HAP 安装（即包内 release HAP）：

```sh
cd apps/tesslo/build/outputs/default
unzip -o entry-default-*-signed.app -d app-extract
hdc install app-extract/entry-default-*-signed.hap
```
