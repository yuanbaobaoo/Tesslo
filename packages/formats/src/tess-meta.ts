// tesslo.json（.tess 容器元数据成员）的类型与校验。
// 身份在文件里不在路径上：projectId 是重新关联（relink）的匹配依据。
export const TESS_FORMAT_VERSION = 1;

// md5ext 素材成员名（zip 根级）：<32位小写md5>.<扩展名>
const MD5EXT_PATTERN = /^[0-9a-f]{32}\.[A-Za-z0-9]+$/;

/**
 * 判断 zip 成员名是否为素材（md5ext）。
 *
 * @param memberName - zip 内成员名。
 * @returns 是素材成员时 true。
 */
export const isAssetMemberName = (memberName: string): boolean => MD5EXT_PATTERN.test(memberName);

// tesslo.json 形状（settings 为 Tesslo 项目级设置的扩展位，P4+ 填充）
export interface TessloMeta {
    formatVersion: number;
    projectId: string;
    name: string;
    createdAt: string; // ISO 8601
    updatedAt: string; // ISO 8601
    thumbnail?: string | null; // dataURI（png）；无缩略图为 null
    author?: string;
    settings?: Record<string, unknown>;
    // 项目内容指纹（导入去重用；旧文件可缺省）
    fingerprint?: string;
}

// 容器错误：格式层唯一的错误出口（调用方映射为 PlatformError 或 UI 文案）
export class TessFormatError extends Error {
    constructor (message: string) {
        super(`[tess-format] ${message}`);
        this.name = 'TessFormatError';
    }
}

const isIsoString = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));

/**
 * 逐字段校验并收窄 tesslo.json（跨边界 JSON 不裸用，规范 §6）。
 *
 * @param raw - zip 内解析出的任意 JSON 值。
 * @returns 合法的 TessloMeta。
 * @throws TessFormatError 任一字段缺失 / 类型不符 / 版本不支持。
 */
export const validateTessloMeta = (raw: unknown): TessloMeta => {
    if (typeof raw !== 'object' || raw === null) {
        throw new TessFormatError('tesslo.json is not an object');
    }
    const candidate = raw as Record<string, unknown>;
    if (candidate.formatVersion !== TESS_FORMAT_VERSION) {
        throw new TessFormatError(
            `unsupported formatVersion ${String(candidate.formatVersion)} (expected ${TESS_FORMAT_VERSION})`
        );
    }
    if (typeof candidate.projectId !== 'string' || candidate.projectId.length === 0) {
        throw new TessFormatError('tesslo.json projectId must be a non-empty string');
    }
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
        throw new TessFormatError('tesslo.json name must be a non-empty string');
    }
    if (!isIsoString(candidate.createdAt) || !isIsoString(candidate.updatedAt)) {
        throw new TessFormatError('tesslo.json createdAt/updatedAt must be ISO 8601');
    }
    if (candidate.thumbnail !== undefined &&
        candidate.thumbnail !== null && typeof candidate.thumbnail !== 'string') {
        throw new TessFormatError('tesslo.json thumbnail must be a dataURI string or null');
    }
    if (candidate.settings !== undefined && typeof candidate.settings !== 'object') {
        throw new TessFormatError('tesslo.json settings must be an object');
    }
    if (candidate.fingerprint !== undefined && typeof candidate.fingerprint !== 'string') {
        throw new TessFormatError('tesslo.json fingerprint must be a string');
    }
    return {
        formatVersion: candidate.formatVersion,
        projectId: candidate.projectId,
        name: candidate.name,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        thumbnail: (candidate.thumbnail as string | null | undefined) ?? null,
        author: typeof candidate.author === 'string' ? candidate.author : undefined,
        settings: candidate.settings as Record<string, unknown> | undefined,
        fingerprint: typeof candidate.fingerprint === 'string' ? candidate.fingerprint : undefined
    };
};

/**
 * 生成新的项目元数据（新建 / sb3 导入时用）。
 *
 * @param name - 项目名（用户输入，已清洗）。
 * @param projectId - 项目 ID（调用方生成，保证与注册表一致）。
 * @returns 就绪的 TessloMeta。
 */
export const createTessloMeta = (name: string, projectId: string): TessloMeta => {
    const now = new Date().toISOString();
    return {
        formatVersion: TESS_FORMAT_VERSION,
        projectId,
        name,
        createdAt: now,
        updatedAt: now,
        thumbnail: null,
        settings: {}
    };
};
