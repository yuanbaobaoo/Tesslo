// 作品导出器（web 装配层）：三种产物的统一出口。
// 输入是**目录工作区 bundle**（tesslo.json + project.json + assets），导出时才组装
// .tess / .sb3 单文件；模板经存量 AssetServer（20114 rawfile）取用。
// 装配层是 adapter 初始化处，允许感知宿主静态资源（规范 §10.2 仅约束 packages/**）。
import {buildExportedHtml, assetsToDataUriMap} from '@tesslo/app';
import {buildSb3, validateTessloMeta, writeTess} from '@tesslo/formats';
import type {PlatformAdapter, ProjectSummary} from '@tesslo/platform-adapter';
import {ASSET_ORIGIN} from './constants';

// 导出格式（菜单三选一，默认 .tess）
export type ExportFormat = 'tess' | 'sb3' | 'html';

// 文件名清洗（与列表页同规则，导出落盘最终防线）
// eslint-disable-next-line no-control-regex -- 清洗控制字符是该函数的职责
const FILENAME_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;
const sanitize = (name: string): string =>
    name.replace(FILENAME_FORBIDDEN, '').trim().slice(0, 60) || '未命名作品';

/**
 * 取播放端模板（构建产物入 rawfile，AssetServer 静态服务）。
 *
 * @returns 模板全文文本。
 */
const fetchPlayerTemplate = async (): Promise<string> => {
    const response: Response = await fetch(`${ASSET_ORIGIN}static/fetched/player-template.html`);
    if (!response.ok) {
        throw new Error(`player template fetch failed: ${response.status}`);
    }
    return response.text();
};

/**
 * 导出作品为指定格式并保存到用户下载位置。
 *
 * @param adapter - 平台适配器。
 * @param project - 目标作品。
 * @param format - 导出格式。
 */
export const exportProject = async (
    adapter: PlatformAdapter,
    project: ProjectSummary,
    format: ExportFormat
): Promise<void> => {
    const name: string = sanitize(project.name);
    // 执行文件优先走宿主侧组装：13MB 模板只存在于 rawfile，不经过页面内存；
    // 页面内组装的旧路径保留给没有该能力的实现（如浏览器适配器）
    if (format === 'html' && adapter.projects.exportHtmlProject !== undefined) {
        await adapter.projects.exportHtmlProject(project.id);
        return;
    }
    // 读取目录工作区（未保存的新工程会抛 E_DIR_MISSING）
    const bundle = await adapter.projects.readProject(project.id);
    const meta = validateTessloMeta(bundle.meta);
    const assets = new Map<string, Uint8Array>(
        bundle.assets.map(asset => [asset.md5ext, new Uint8Array(asset.bytes)]));
    if (format === 'tess') {
        // 工程文件：容器在导出时组装（项目目录是工作区，.tess 是导出物）
        const bytes: ArrayBuffer = await writeTess({
            meta,
            project: bundle.project,
            assets
        });
        await adapter.saveDownload(`${name}.tess`, bytes, 'application/zip');
        return;
    }
    if (format === 'sb3') {
        // 互通导出：纯净 sb3 + tesslo.json 静默成员
        const bytes: ArrayBuffer = await buildSb3({meta, project: bundle.project, assets});
        await adapter.saveDownload(`${name}.sb3`, bytes, 'application/zip');
        return;
    }
    // 执行文件：模板 + 内嵌数据（素材 dataURI 全量内联，零网络）
    const template: string = await fetchPlayerTemplate();
    const html: string = buildExportedHtml(template, {
        meta: {name: meta.name, projectId: meta.projectId},
        project: bundle.project,
        assets: assetsToDataUriMap(assets)
    });
    const bytes: ArrayBuffer = new TextEncoder().encode(html).buffer;
    await adapter.saveDownload(`${name}.html`, bytes, 'text/html');
};

// 重新导出便于装配层类型引用
export type {ProjectSummary};
