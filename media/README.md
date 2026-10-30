# Media Library

素材库（角色、造型、背景、声音）的本地缓存，供离线构建使用。

## 来源

`media/manifest.json` 记录来源、文件数与总字节数；素材本身不提交到 git。

## 获取

```sh
pnpm fetch:media
```

从 Scratch 公开 CDN（`cdn.assets.scratch.mit.edu`）拉取素材库 JSON 引用的
1328 个资产，写入 `media/fetched/`。资产按内容寻址，脚本会用文件名的 MD5
校验下载结果；已存在且校验通过的文件直接跳过。CI 使用同一脚本，并以素材库
JSON 与脚本内容的哈希作为 GitHub Actions 缓存键。

## 目录

```text
media/
├── manifest.json     # 来源与统计
└── fetched/          # 离线素材（gitignored）
```

`pnpm build:hap` 把 `media/fetched` 复制到 HAP 应用负载的 `static/fetched`，
设备端 `AssetServer` 在运行时从该目录加载素材。

## 许可

素材版权归 Scratch Foundation，其再分发条件独立于代码许可。公开发布包含这些
素材的 HAP 前需要确认授权。
