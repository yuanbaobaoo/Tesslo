# Media Library

素材库（角色、造型、背景、声音）的本地缓存，供离线构建使用。

## 来源与入库

`manifest.json` 记录来源、文件数与总字节数。`fetched/` 下的 1328 个素材
**全部提交到 git**，构建时不访问网络。

素材按内容寻址（文件名即内容 MD5），因此 `.gitattributes` 对
`apps/tesslo/assets/fetched/**` 设置了 `-text`，禁止 Git 做 EOL 转换，
保证 checkout 后字节不变。

## 目录

```text
apps/tesslo/assets/
├── manifest.json     # 来源与统计
└── fetched/          # 离线素材（已入库）
```

`pnpm build:hap` 把 `fetched/` 以硬链接铺到 HAP 的
`rawfile/static/fetched`（不支持硬链接的文件系统回退为复制）；设备端
`AssetServer` 在运行时从 rawfile 加载素材。`rawfile` 仍是纯构建产物，不提交。

## 许可

素材版权归 Scratch Foundation，其再分发条件独立于代码许可。公开发布包含这些
素材的 HAP 前需要确认授权。
