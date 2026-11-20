// Tesslo 品牌覆盖：把引擎内用户可见的 Scratch 立场文案统一替换为 Tesslo。
// 覆盖点仅限"面向用户的弹窗/提示"（崩溃页、浏览器不支持、WebGL、连接断开等）；
// 积木库教程等深层内容不在本模块范围。所有语言：zh-cn 用中文，其余语言用英文兜底。
// 调用点：reducers/locales.js 初始化 messagesByLocale 时应用。
type MessagesByLocale = Record<string, Record<string, string>>;

// 中文覆盖文案（Tesslo 立场）
const ZH_OVERRIDES: Record<string, string> = {
    'gui.crashMessage.description': '很抱歉，Tesslo 遇到了一点问题，请重新载入页面再试试。',
    'gui.unsupportedBrowser.label': '当前浏览器不受支持',
    'gui.unsupportedBrowser.notRecommended': '很抱歉，当前浏览器版本不受支持。建议更新到最新版本后重试。',
    'gui.unsupportedBrowser.description': '很抱歉，Tesslo 不支持当前浏览器。建议更新到最新版本的浏览器后重试。',
    'gui.webglModal.label': 'Tesslo 需要 WebGL',
    'gui.webglModal.description': '当前浏览器未启用 WebGL，Tesslo 无法绘制舞台。请换用支持 WebGL 的浏览器，或在支持 WebGL 的设备上打开。',
    'gui.alerts.lostPeripheralConnection': 'Tesslo 与 {extensionName} 的连接已断开。',
    'gui.connection.unavailable.installscratchlink': '请确认硬件连接服务已安装并正在运行',
    'gui.gui.defaultProjectTitle': '未命名作品',
    // 引擎删除确认提示（interface 文案在 zh-cn 里仍是英文，且按钮是 yes/no）
    'gui.gui.shouldDeleteSprite': '确定要删除这个角色吗？',
    'gui.gui.shouldDeleteCostume': '确定要删除这个造型吗？',
    'gui.gui.shouldDeleteSound': '确定要删除这个声音吗？',
    'gui.gui.deleteAssetHeading': '确认删除',
    'gui.confirmationPrompt.confirm': '确定',
    'gui.confirmationPrompt.cancel': '取消'
};

// 英文覆盖文案（其他语言兜底）
const EN_OVERRIDES: Record<string, string> = {
    'gui.crashMessage.description': 'We are so sorry, but it looks like Tesslo has run into a problem. ' +
        'Please reload the page to try again.',
    'gui.unsupportedBrowser.label': 'Browser not supported',
    'gui.unsupportedBrowser.notRecommended': 'We are very sorry, but it looks like you are using a browser ' +
        'version that Tesslo does not support. We recommend updating to the latest version.',
    'gui.unsupportedBrowser.description': 'We are very sorry, but Tesslo does not support this browser. ' +
        'We recommend updating to the latest version of a supported browser.',
    'gui.webglModal.label': 'Tesslo needs WebGL',
    'gui.webglModal.description': 'WebGL is not available in this browser, so Tesslo cannot draw the stage. ' +
        'Please use a browser or device that supports WebGL.',
    'gui.alerts.lostPeripheralConnection': 'Tesslo lost connection to {extensionName}.',
    'gui.connection.unavailable.installscratchlink': 'Make sure the hardware connection service is installed and running',
    'gui.gui.defaultProjectTitle': 'Untitled Project',
    'gui.gui.shouldDeleteSprite': 'Are you sure you want to delete this sprite?',
    'gui.gui.shouldDeleteCostume': 'Are you sure you want to delete this costume?',
    'gui.gui.shouldDeleteSound': 'Are you sure you want to delete this sound?',
    'gui.gui.deleteAssetHeading': 'Confirm deletion',
    'gui.confirmationPrompt.confirm': 'Yes',
    'gui.confirmationPrompt.cancel': 'No'
};

/**
 * 对全部语言的编辑器文案应用 Tesslo 品牌覆盖（不修改入参，返回新对象）。
 *
 * @param messagesByLocale - scratch-l10n 的 editor-msgs（locale → id → 文本）。
 * @returns 覆盖后的文案表。
 */
export const brandEditorMessages = (messagesByLocale: MessagesByLocale): MessagesByLocale => {
    const branded: MessagesByLocale = {};
    for (const locale of Object.keys(messagesByLocale)) {
        const base = messagesByLocale[locale] ?? {};
        const overrides = locale === 'zh-cn' ? ZH_OVERRIDES : EN_OVERRIDES;
        branded[locale] = {...base, ...overrides};
    }
    return branded;
};
