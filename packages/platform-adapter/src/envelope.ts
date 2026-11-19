// 回环 HTTP 客户端内务：统一信封解析 + 超时（harmony 实现专用）。
// 信封契约与宿主 MiniHttp.ets 对齐：{ok:true,data} | {ok:false,error:{code,message,retryable}}
import {platformError, type PlatformErrorCode} from './errors.ts';

// 常规请求超时 10s；save/load 大对象 30s（规范 §10.2 约定）
export const TIMEOUT_MS_DEFAULT = 10_000;
export const TIMEOUT_MS_SLOW = 30_000;
// 系统 picker（目录/保存选择器）由用户操作决定时长：真机实测 >30s 会被
// 客户端 AbortController 掐断（服务端随后写响应报 Network is down），给足 5 分钟
export const TIMEOUT_MS_PICKER = 300_000;

// 宿主侧错误信封负载
interface ErrorEnvelope {
    readonly code: PlatformErrorCode;
    readonly message: string;
    readonly retryable?: boolean;
}

// 统一响应信封
interface Envelope<T> {
    readonly ok: boolean;
    readonly data?: T;
    readonly error?: ErrorEnvelope;
}

/**
 * 带超时的 JSON 请求；失败统一 reject PlatformError。
 *
 * @param input - 完整请求 URL（仅 127.0.0.1，由调用方保证）。
 * @param init - fetch init；method/headers/body。
 * @param timeoutMs - 超时毫秒数。
 * @returns 信封内的 data 字段。
 */
export const requestJson = async <T>(
    input: string,
    init: RequestInit,
    timeoutMs: number = TIMEOUT_MS_DEFAULT
): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(input, {...init, signal: controller.signal});
        if (!response.ok) {
            // 非 2xx：正文仍是信封（MiniHttp 统一错误出口）
            const body = await response.json().catch(() => null) as Envelope<T> | null;
            throw envelopeToError(body, `HTTP ${response.status}`);
        }
        const body = await response.json() as Envelope<T>;
        if (!body.ok) {
            throw envelopeToError(body, 'malformed envelope');
        }
        // 成功信封允许没有 data：void 端点（删除/恢复快照/下载）返回 {ok:true}；
        // 此前把 data===undefined 当失败，导致删除成功却报 E_IO、列表不刷新
        return body.data as T;
    } catch (cause) {
        throw normalize(cause);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * 把异常收窄为 PlatformError（网络失败 / 中止 / 解析失败 → E_IO 或 E_TIMEOUT）。
 *
 * @param cause - 捕获的任意异常。
 * @returns 结构化 PlatformError。
 */
export const normalize = (cause: unknown): Error => {
    if (cause instanceof Error && cause.name === 'AbortError') {
        return platformError('E_TIMEOUT', 'request timed out', true);
    }
    if (cause instanceof SyntaxError) {
        return platformError('E_IO', `bad response JSON: ${cause.message}`);
    }
    if (cause instanceof TypeError) {
        // fetch 网络层失败（服务未启动 / 连接拒绝）
        return platformError('E_IO', 'loopback service unreachable', true);
    }
    return cause instanceof Error ? cause : platformError('E_IO', String(cause));
};

/**
 * 信封错误体转 PlatformError。
 *
 * @param body - 响应信封（可能为 null）。
 * @param fallback - 信封缺失时的诊断前缀。
 * @returns 永远抛出的 PlatformError（不返回）。
 */
const envelopeToError = (body: Envelope<unknown> | null, fallback: string): Error => {
    if (body && body.error && typeof body.error.code === 'string') {
        return platformError(body.error.code, body.error.message, body.error.retryable === true);
    }
    return platformError('E_IO', fallback);
};
