// 播放端素材 Helper：导出 HTML 内的零网络数据源。
// 项目 JSON 与全部素材均来自内嵌 dataURI 映射，全程无网络请求。
// 注意从 'scratch-storage' 包取基类（与播放端 ScratchStorage 实例同源；
// gui standalone 出口内嵌的是另一份实现，跨实例原型链不通）。
import {Asset, Helper} from 'scratch-storage';
import type {AssetId, AssetType, DataFormat, ScratchStorage} from 'scratch-storage';
import type {EmbeddedProjectData} from '../export/exported-html.ts';

// dataURI 前缀解析缓存（避免每个素材重复 split）
interface DecodedDataUri {
    readonly mime: string;
    readonly bytes: Uint8Array;
}

const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.*)$/s;
const cached: Map<string, DecodedDataUri> = new Map();

/**
 * dataURI → 字节（结果缓存；导出作品素材反复加载无需重复解码）。
 *
 * @param dataUri - data:image/png;base64,xxxx 形态字符串。
 * @returns MIME 与字节；非法格式返回 null。
 */
const decodeDataUri = (dataUri: string): DecodedDataUri | null => {
    const hit: DecodedDataUri | undefined = cached.get(dataUri);
    if (hit !== undefined) {
        return hit;
    }
    const match: RegExpMatchArray | null = dataUri.match(DATA_URI_PATTERN);
    if (match === null) {
        return null;
    }
    const binary: string = atob(match[2] ?? '');
    const bytes: Uint8Array = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    const decoded: DecodedDataUri = {mime: match[1] ?? '', bytes};
    cached.set(dataUri, decoded);
    return decoded;
};

/**
 * 导出播放 storage Helper：Project 与素材全部由内嵌数据供给。
 */
export class ExportedAssetHelper extends Helper {
    private readonly data: EmbeddedProjectData;

    constructor (parent: ScratchStorage, data: EmbeddedProjectData) {
        super(parent);
        this.data = data;
    }

    /**
     * Helper.load 契约。
     *
     * @param assetType - 素材类型。
     * @param assetId - 项目 ID（任意值，内嵌只有一份）或素材 md5。
     * @param dataFormat - 数据格式。
     * @returns 内嵌数据包装的 Asset。
     */
    override load (assetType: AssetType, assetId: AssetId, dataFormat: DataFormat): Promise<Asset> {
        if (assetType === this.parent.AssetType.Project) {
            return Promise.resolve(
                new Asset(assetType, assetId, dataFormat, JSON.stringify(this.data.project)));
        }
        const key: string = `${assetId}.${dataFormat}`;
        const dataUri: string | undefined = this.data.assets[key];
        if (dataUri === undefined) {
            return Promise.reject(new Error(`embedded asset missing: ${key}`));
        }
        const decoded: DecodedDataUri | null = decodeDataUri(dataUri);
        if (decoded === null) {
            return Promise.reject(new Error(`embedded asset malformed: ${key}`));
        }
        return Promise.resolve(new Asset(assetType, assetId, dataFormat, decoded.bytes));
    }
}
