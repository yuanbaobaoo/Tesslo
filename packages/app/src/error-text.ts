// PlatformError.code → 用户文案 + 恢复动作（规范 §7.2：不允许裸 alert / 静默失败）。
// UI 层统一经 AlertDialog 呈现（title + text），不再使用页面内错误横幅。
import type {PlatformError} from '@tesslo/platform-adapter';

// 文案与恢复动作定义
export interface ErrorPresentation {
    readonly title: string;
    readonly text: string;
    readonly action: 'retry' | 'relink' | 'reauth' | 'none';
}

/**
 * 把平台错误映射为面向孩子的中文标题、文案与恢复动作。
 *
 * @param cause - 任意异常（非 PlatformError 时给通用文案）。
 * @returns 展示信息。
 */
export const presentError = (cause: unknown): ErrorPresentation => {
    const platformError = cause as PlatformError | null;
    if (!platformError || typeof platformError.code !== 'string') {
        return {title: '出了点问题', text: '请再试一次。', action: 'retry'};
    }
    switch (platformError.code) {
        case 'E_NO_AUTH':
            return {title: '没有访问权限', text: '没有访问该目录的权限，请重新授权。', action: 'reauth'};
        case 'E_DIR_MISSING':
            return {title: '找不到作品目录', text: '找不到作品目录，可能被移动或删除了。', action: 'relink'};
        case 'E_DIR_NOT_EMPTY':
            return {
                title: '这个文件夹不能使用',
                text: '自定义目录必须是空目录，请重新选择一个空文件夹。',
                action: 'none'
            };
        case 'E_CANCELLED':
            // 用户在系统选择器里取消：不展示错误
            return {title: '', text: '', action: 'none'};
        case 'E_LEGACY':
            // 产品层应自动迁移；万一暴露给用户，给出可重试文案
            return {title: '作品需要升级', text: '这个作品还是旧版格式，请重新打开一次完成升级。', action: 'retry'};
        case 'E_IO':
            return {title: '操作失败', text: '读写出了问题，请再试一次。', action: 'retry'};
        case 'E_TIMEOUT':
            return {title: '操作超时', text: '操作超时了，请再试一次。', action: 'retry'};
        case 'E_UNSUPPORTED':
            return {title: '暂不支持', text: '当前环境不支持这个操作。', action: 'none'};
        default:
            return {title: '出了点问题', text: '请再试一次。', action: 'retry'};
    }
};
