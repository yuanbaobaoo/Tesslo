import {ASSET_ORIGIN} from './constants';

// 素材 ID / 格式仅允许安全文件名字符：拼进 URL 前挡住路径注入
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * 只保留安全文件名字符；不合法返回空串，调用方据此拒绝请求。
 */
const cleanName = value => {
  const name = String(value ?? '');
  return SAFE_NAME.test(name) ? name : '';
};

/**
 * scratch-storage Helper：全部素材改从设备内 AssetServer（rawfile）读取。
 */
export default class WebStorageHelper {
  constructor (storageInstance) {
    // scratch-storage 实例：借用其 Asset 构造器包装拉取结果
    this.parent = storageInstance;
  }

  /**
   * 从设备内 AssetServer 拉取素材并包装成 storage.Asset。
   * @param {string} assetType - 素材类型（如 ImageBitmap）。
   * @param {string} assetId - 素材 ID，会先做安全名校验。
   * @param {string} dataFormat - 数据格式（如 png）。
   * @returns {Promise<Asset>} 包装后的 Asset；ID/格式非法或请求失败时 reject。
   */
  async load (assetType, assetId, dataFormat) {
    const id = cleanName(assetId);
    const format = cleanName(dataFormat);
    if (!id || !format) {
      throw new Error(`invalid asset: ${assetId}.${dataFormat}`);
    }
    const url = new URL(`static/fetched/${id}.${format}`, ASSET_ORIGIN).href;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`asset ${id}.${format} returned ${response.status}`);
    }
    const data = await response.arrayBuffer();
    // Asset.data 期望 Uint8Array（encodeDataURI 按数组索引读取）；
    // 直接传 ArrayBuffer 会被静默编码成空 data URI，导致库缩略图空白
    return new this.parent.Asset(assetType, assetId, dataFormat, new Uint8Array(data));
  }
}
