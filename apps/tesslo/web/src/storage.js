const ASSET_ORIGIN = 'http://127.0.0.1:20114/';
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const cleanName = value => {
    const name = String(value ?? '');
    return SAFE_NAME.test(name) ? name : '';
};

export default class WebStorageHelper {
    constructor (storageInstance) {
        this.parent = storageInstance;
    }

    load (assetType, assetId, dataFormat) {
        const id = cleanName(assetId);
        const format = cleanName(dataFormat);
        if (!id || !format) {
            return Promise.reject(new Error(`invalid asset: ${assetId}.${dataFormat}`));
        }
        const url = new URL(`static/fetched/${id}.${format}`, ASSET_ORIGIN).href;
        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`asset ${id}.${format} returned ${response.status}`);
                }
                return response.arrayBuffer();
            })
            // Asset.data 期望 Uint8Array（encodeDataURI 按数组索引读取）；
            // 直接传 ArrayBuffer 会被静默编码成空 data URI，导致库缩略图空白
            .then(data => new this.parent.Asset(assetType, assetId, dataFormat, new Uint8Array(data)));
    }
}
