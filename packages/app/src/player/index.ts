// @tesslo/app/player 出口：播放端专用（不触碰 launcher/editor 依赖链）。
// player 构建必须从这里 import——从主 barrel 会连带编辑器（含完整 gui）进包，
// 实测使播放端模板从 10MB 级膨胀到 36MB。
export {ExportedAssetHelper} from './exported-asset-helper.ts';
export {assetsToDataUriMap, buildExportedHtml, PLAYER_DATA_ELEMENT_ID,
    PLAYER_PLACEHOLDER_DATA, PLAYER_PLACEHOLDER_TITLE} from '../export/exported-html.ts';
export type {EmbeddedProjectData} from '../export/exported-html.ts';
