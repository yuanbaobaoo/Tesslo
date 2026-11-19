// @tesslo/platform-adapter 出口：接口 v1 + 双实现 + 选择器。
// 产品层从这里 import；禁止在产品层其他位置出现端口 / 127.0.0.1（规范 §10.2，
// 由根 eslint boundaries 规则强制）。
import {harmonyAdapter} from './harmony.ts';
import {browserAdapter} from './browser.ts';

export {ADAPTER_PROTOCOL} from './types.ts';
export type {AssetStore, CreateProjectOptions, DeleteProjectOptions, PlatformAdapter,
    ProjectAsset, ProjectBundle, ProjectIdentityQuery, ProjectMeta, ProjectSnapshot,
    ProjectStore, ProjectSummary, SnapshotContent} from './types.ts';
export {asPlatformError, platformError} from './errors.ts';
export type {PlatformError, PlatformErrorCode} from './errors.ts';
export {harmonyAdapter};
export {browserAdapter};

// 宿主目标类型：由装配层（apps/tesslo/web）经 __TESSLO_HOST__ 注入
export type AdapterHost = 'harmony' | 'browser';

declare const __TESSLO_HOST__: AdapterHost;

/**
 * 按目标平台返回 adapter；web 装配层启动时调用一次并注入产品层。
 *
 * @param host - 宿主目标（默认读取构建期常量 __TESSLO_HOST__）。
 * @returns 对应平台的 PlatformAdapter。
 */
export const selectAdapter = (host: AdapterHost = __TESSLO_HOST__) => {
    return host === 'harmony' ? harmonyAdapter : browserAdapter;
};
