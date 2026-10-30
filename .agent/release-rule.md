# Tesslo 发版规则（Release Rule）

> 面向后续 AI 会话/维护者的发版操作规范，
> 按 Tesslo 的仓库结构、CI 和 HarmonyOS-only 产物改写。
>
> 原则：**发版是 CI 的事，本地只负责门禁 + commit + tag**；发布产物只从 CI 出。

## 触发机制（唯一通道）

| 事件 | 行为 |
| --- | --- |
| push tag `v*` | `.github/workflows/ohos-hap.yml` 构建未签名 HAP，并发布为该 tag 的 GitHub Release |
| push master | 构建并上传 Actions Artifact，**不发 Release**（dev 构建） |
| `workflow_dispatch` | 构建并上传 Actions Artifact，**不发 Release**（流程验证） |

CI 侧使用 `permissions: contents: write` + `softprops/action-gh-release`，
发布不需要本地凭证参与。

## Tag 命名规则

格式：`vMAJOR.MINOR.PATCH`（SemVer），例如 `v0.1.0`。

- tag 必须与版本源一致：`v${package.json version}`。
- 预发布使用 `vX.Y.Z-rc.N`；只用于验证，Release 标记 prerelease，**不更新 latest 别名**。
- 使用附注标签：`git tag -a v0.1.0 -m "Tesslo v0.1.0"`。
- 禁止复用/移动已推送的 tag；发坏了就 bump patch 重新发。
- 不使用 `-ohos-*` 后缀：Tesslo 是独立应用，没有上游基础版本需要区分。

## 版本源（三处必须一致）

| 文件 | 字段 | 说明 |
| --- | --- | --- |
| `package.json` | `version` | 唯一版本源 |
| `apps/tesslo/package.json` | `version` | workspace 元数据，跟随根版本 |
| `apps/tesslo/AppScope/app.json5` | `versionName` | HAP 内部版本，必须等于 `package.json.version`（tag 去掉 `v`） |
| `apps/tesslo/AppScope/app.json5` | `versionCode` | 正整数，必须严格大于上一版；当前 `0.1.0` = `1000001` |

## 产物命名（强制）

Tag Release：

```text
Tesslo-vX.Y.Z-unsigned.hap          # 版本化 HAP
Tesslo-latest-unsigned.hap          # latest 别名，每次稳定版覆盖
sha256.txt                          # 上述文件的校验和
```

示例：

```text
Tesslo-v0.1.0-unsigned.hap
Tesslo-v0.1.1-unsigned.hap
```

非 Release 构建（master / `workflow_dispatch`）：

```text
Tesslo-vX.Y.Z-dev.<GITHUB_RUN_NUMBER>-unsigned.hap
```

规则：

- 版本号来自 `package.json`，**不是** `GITHUB_REF_NAME` 原样拼接；CI 必须校验 tag 与版本一致。
- **禁止**出现 `Tesslo-master-...`、`Tesslo-...-ohos-arm64-...` 这类名字。
- HAP 本身只有 arm64，不在文件名里重复 `ohos-arm64`。
- Actions Artifact 名称与 HAP 基名一致（去掉 `.hap`）：
  `Tesslo-vX.Y.Z-unsigned`；非 Release 为 `Tesslo-vX.Y.Z-dev.<run>-unsigned`。
- `Tesslo-latest-unsigned.hap` 只由稳定版 tag 更新；`-rc.N` 不更新。

## 发版流程（按序执行）

1. **门禁**：`pnpm test` 通过，工作树干净。
2. **改版本**：同步 `package.json`、`apps/tesslo/package.json`、
   `AppScope/app.json5` 的 `versionName`，并递增 `versionCode`。
3. **提交并推送**：
   ```sh
   git commit -m "release: vX.Y.Z"
   git push origin master
   ```
4. **打附注 tag 并推送**：
   ```sh
   git tag -a vX.Y.Z -m "Tesslo vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. **盯 CI**：<https://github.com/yuanbaobaoo/Tesslo/actions>；
   tag 触发的 run 必须 `success`。
6. **验收 Release**（三项都过才算发完）：
   - run `conclusion: success`；
   - Release 资产齐全：`Tesslo-vX.Y.Z-unsigned.hap`、
     `Tesslo-latest-unsigned.hap`、`sha256.txt`；
   - 版本无关直链可达（README 依赖它）：
     `https://github.com/yuanbaobaoo/Tesslo/releases/latest/download/Tesslo-latest-unsigned.hap`
     返回 200/206。

## 产物事实

- HAP 是**未签名**包；用户需自行签名（debug Profile 绑定设备）或从源码构建。
  Release body 必须写明，这是常态不是遗漏。
- `sha256.txt` 覆盖版本化 HAP 和 latest 别名；发版后可用 `sha256sum -c` 校验。
- Release body 由 CI 动态生成：上一个 `v*` tag 以来的真实提交列表 + 固定的
  安装/校验说明；不手写、不写死，发版时无需人工整理。
- latest 别名每次稳定版发布由 CI 覆盖，README 直链因此长期有效。

## 边界与易混点

- `tools` Release 是构建依赖（CLT 分卷、ohos-net runtime pack），与 app 版本无关；
  **不要**把依赖资产塞进 `v*` app Release。
- 离线素材在 `apps/tesslo/assets/fetched`，随仓库提交，不是 Release 资产；
  构建不访问 CDN。
- 本仓库只发 HarmonyOS HAP；macOS/Windows/Linux 官方构建不在 CI 范围内。
- master push 只产出 dev Artifact，不是 Release；不要把
  `Tesslo-vX.Y.Z-dev.*` 当正式版分发。
- 真机已装 dev 构建时，与 Release 版签名不同属预期；`install -r` 保留应用数据。

## 坑

- **不要**用 `GITHUB_REF_NAME` 直接拼 HAP 文件名；master 会得到
  `Tesslo-master-...`，这是错误命名。必须走版本号变量。
- tag 与 `package.json` / `AppScope` 版本不一致时，CI 必须失败；
  不要靠人工检查。
- `versionCode` 回退会导致设备拒绝升级；每次发版至少 +1。
- 已推送 tag 不可复用/移动；发坏了 bump patch 再发。
- 不要本地构建 Release 产物；本地只做门禁和冒烟验证，发布以 CI 为准。
- 不要手动编辑 Release body 或 latest 别名；CI 负责覆盖。
- 不要删除/移动 `tools` Release 的 CLT 或 runtime pack 资产；
  CI 的 SHA-256 校验会直接失败。

## CI 配套修改清单（待实现）

- [ ] `Collect artifact & checksums`：tag 用
  `Tesslo-${GITHUB_REF_NAME}-unsigned.hap`；非 tag 用
  `Tesslo-v${VERSION}-dev.${GITHUB_RUN_NUMBER}-unsigned.hap`。
- [ ] `Upload artifact`：name 使用同一基名（去掉 `.hap`）。
- [ ] `Prepare latest alias artifact`：仅稳定 tag 生成
  `Tesslo-latest-unsigned.hap`；`-rc` 跳过。
- [ ] `Publish Release`：files glob 改为 `Tesslo-*-unsigned.hap`、
  `Tesslo-latest-unsigned.hap`、`sha256.txt`。
- [ ] `Compose release body`：latest 直链改为
  `Tesslo-latest-unsigned.hap`；标题用 tag。
- [ ] 新增 `Verify release version`：tag 时校验
  `GITHUB_REF_NAME == v$(node -p "require('./package.json').version")`，
  并校验 `AppScope/app.json5` 的 `versionName`。
- [ ] README：latest 直链改名为 `Tesslo-latest-unsigned.hap`。
