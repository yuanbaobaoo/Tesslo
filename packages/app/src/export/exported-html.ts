// 单文件 HTML 执行文件的组装协议（P1 导出线）。
// 结构：player 模板（含内联 bundle）+ <script type="application/json"> 内嵌项目数据。
// 模板由 webpack.player 构建产物内联生成，宿主 AssetServer 从 rawfile 服务；
// 组装在 web 装配层完成（apps/tesslo/web/src/exporter.ts），本模块只做纯字符串协议。

// 数据块成员名（player.html 内嵌数据）
export const PLAYER_DATA_ELEMENT_ID = 'tesslo-player-data';

// 模板占位符（构建时由 scripts/inline-player-template.mts 替换为占位注释，
// 导出时替换为真实数据；title 同理）
export const PLAYER_PLACEHOLDER_DATA = '/*__TESSLO_PLAYER_DATA__*/';
export const PLAYER_PLACEHOLDER_TITLE = '__TESSLO_PLAYER_TITLE__';

// 内嵌数据形状（player.tsx 解析目标）
export interface EmbeddedProjectData {
    readonly meta: {readonly name: string; readonly projectId: string};
    readonly project: unknown; // 纯净 Scratch 项目 JSON
    // md5ext → dataURI（data:<mime>;base64,xxxx）
    readonly assets: Record<string, string>;
}

// md5ext 扩展名 → MIME（素材内联用）
const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    json: 'application/json'
};

/**
 * 素材字节表 → dataURI 映射（播放端零网络的关键）。
 *
 * @param assets - md5ext → 字节。
 * @returns md5ext → dataURI 字符串表。
 */
export const assetsToDataUriMap = (
    assets: ReadonlyMap<string, Uint8Array>
): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const [memberName, bytes] of assets) {
        const dot: number = memberName.lastIndexOf('.');
        const extension: string = dot >= 0 ? memberName.substring(dot + 1).toLowerCase() : '';
        const mime: string = MIME_BY_EXT[extension] ?? 'application/octet-stream';
        let binary = '';
        const CHUNK = 0x8000; // 32KB 分段避免栈溢出
        for (let index = 0; index < bytes.length; index += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
        }
        map[memberName] = `data:${mime};base64,${btoa(binary)}`;
    }
    return map;
};

/**
 * 内联 <script> 安全转义：`</script>` 会提前闭合标签。
 * JSON 文本用 `<\/`（JSON 合法转义，parse 后与 `</` 等价）。
 *
 * @param text - 待内联文本。
 * @returns 转义后文本。
 */
const escapeClosingScript = (text: string): string => text.replace(/<\//g, '<\\/');

/**
 * 组装导出 HTML：模板占位符替换（split/join，避免 replace 的 $ 特殊语义）。
 *
 * @param template - player 模板全文（含内联 bundle 与占位符）。
 * @param data - 内嵌项目数据。
 * @returns 完整可执行 HTML 文本。
 */
export const buildExportedHtml = (template: string, data: EmbeddedProjectData): string => {
    // 模板骨架已带数据块标签外壳，这里只注入 JSON 文本（含 </ 转义）
    const dataText = escapeClosingScript(JSON.stringify(data));
    let html = template.split(PLAYER_PLACEHOLDER_DATA).join(dataText);
    // <title>：作品名（HTML 转义防注入）
    const safeTitle = data.meta.name.replace(/[<>&]/g, '');
    html = html.split(PLAYER_PLACEHOLDER_TITLE).join(safeTitle);
    return html;
};
