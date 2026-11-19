// 平台错误模型：adapter 全部方法 reject 本类型（规范 §10.2）。
// 桥层不自动重试；retryable 仅供 UI 层决定重试引导。
export type PlatformErrorCode =
    | 'E_NO_AUTH' // 外部目录授权失效 / 被拒（重新授权可恢复）
    | 'E_DIR_MISSING' // 项目目录缺失（被删 / 移动 / 存储拔出 → relink 流程）
    | 'E_DIR_NOT_EMPTY' // 自定义目录必须为空目录
    | 'E_LEGACY' // 旧版 .tess 工作文件，需产品层迁移为目录工作区
    | 'E_CANCELLED' // 用户在系统选择器里取消（不是错误，不提示）
    | 'E_IO' // 读写失败（含磁盘满 / 只读）
    | 'E_TIMEOUT' // 请求超时（常规 10s，save/load 30s）
    | 'E_UNSUPPORTED'; // 当前实现不支持该能力

export interface PlatformError extends Error {
    readonly code: PlatformErrorCode;
    readonly retryable: boolean;
}

// PlatformError 构造器：readonly 字段只能在构造期赋值
class PlatformErrorImpl extends Error implements PlatformError {
    readonly code: PlatformErrorCode;
    readonly retryable: boolean;

    constructor (code: PlatformErrorCode, message: string, retryable: boolean) {
        super(`[${code}] ${message}`);
        this.code = code;
        this.retryable = retryable;
    }
}

/**
 * 构造平台错误；code 决定 UI 层的文案与恢复动作映射。
 *
 * @param code - 稳定错误码（协议字段，不得随意改名）。
 * @param message - 面向日志的诊断信息。
 * @param retryable - UI 是否可引导重试。
 * @returns 结构化的 PlatformError。
 */
export const platformError = (
    code: PlatformErrorCode,
    message: string,
    retryable: boolean = false
): PlatformError => new PlatformErrorImpl(code, message, retryable);

/**
 * 判断未知异常是否为平台错误（跨边界收窄用）。
 *
 * @param cause - 任意捕获到的异常。
 * @returns 是 PlatformError 时返回窄化后的对象，否则 null。
 */
export const asPlatformError = (cause: unknown): PlatformError | null => {
    if (cause instanceof Error && 'code' in cause && 'retryable' in cause) {
        const candidate = cause as PlatformError;
        if (typeof candidate.code === 'string' && typeof candidate.retryable === 'boolean') {
            return candidate;
        }
    }
    return null;
};
