// 项目内容指纹：用于导入去重（同一作品重复导入必须拦截）。
// 口径：对 project.json 做键排序后的规范化 JSON，再取两路 FNV-1a 32 位拼接
// （64 位强度足够做本地去重；不用于安全场景，避免依赖 crypto.subtle 的上下文限制）。

/**
 * 规范化 JSON：对象键递归排序、数组保持顺序，得到稳定文本。
 *
 * @param value - 任意 JSON 值。
 * @returns 稳定序列化文本。
 */
export const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => stableStringify(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const members = keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${members.join(',')}}`;
};

// FNV-1a 32 位（seed 区分两路）
const fnv1a = (text: string, seed: number): string => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
};

/**
 * 计算项目内容指纹（64 位十六进制）。
 *
 * @param project - 纯净 Scratch 项目 JSON（对象或已序列化字符串）。
 * @returns 16 位十六进制指纹。
 */
export const fingerprintProject = (project: unknown): string => {
    const text = typeof project === 'string' ? project : stableStringify(project);
    return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x9e3779b9)}`;
};
