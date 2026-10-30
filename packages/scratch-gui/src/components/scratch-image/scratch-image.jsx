import PropTypes from 'prop-types';
import React from 'react';

import {legacyConfig} from '../../legacy-config';

class ScratchImage extends React.PureComponent {
    static init () {
        this._maxParallelism = 6;
        this._currentJobs = 0;
        this._pendingImages = new Set();
    }

    static loadPendingImages () {
        if (this._currentJobs >= this._maxParallelism) {
            // already busy
            return;
        }

        // Find the first visible image. If there aren't any, find the first non-visible image.
        let nextImage;
        for (const image of this._pendingImages) {
            if (image.isVisible) {
                nextImage = image;
                break;
            } else {
                // TODO: Why was this commented out on native branch?
                nextImage = nextImage || image;
            }
        }

        // If we found an image to load:
        // 1) Remove it from the queue
        // 2) Load the image
        // 3) Pump the queue again
        if (nextImage) {
            this._pendingImages.delete(nextImage);
            const imageSource = nextImage.props.imageSource;
            ++this._currentJobs;
            const finishJob = () => {
                --this._currentJobs;
                this.loadPendingImages();
            };
            legacyConfig.storage.scratchStorage
                .load(imageSource.assetType, imageSource.assetId)
                .then(asset => {
                    if (!nextImage.wasUnmounted && asset) {
                        const dataURI = asset.encodeDataURI();

                        nextImage.setState({
                            imageURI: dataURI
                        });
                    }
                    finishJob();
                })
                .catch(error => {
                    // 加载失败也必须释放并发槽位，否则队列会被卡死，
                    // 后续缩略图全部无法显示
                    if (nextImage.wasUnmounted !== undefined && !nextImage.wasUnmounted) {
                        // eslint-disable-next-line no-console
                        console.warn('library image failed to load', error);
                    }
                    finishJob();
                });
        }
    }

    constructor (props) {
        super(props);
        this.state = {};
        Object.assign(this.state, this._loadImageSource(props.imageSource));
    }
    componentDidMount () {
        // 部分嵌入端 WebView（如 HarmonyOS ArkWeb）上 VisibilitySensor 不会回调
        // children 函数，导致加载队列无人驱动；挂载后主动泵一次队列兜底。
        // loadPendingImages 幂等，与 sensor 触发互不冲突。
        ScratchImage.loadPendingImages();
    }
    componentWillReceiveProps (nextProps) {
        const newState = this._loadImageSource(nextProps.imageSource);
        this.setState(newState);
    }
    componentWillUnmount () {
        this.wasUnmounted = true;
        ScratchImage._pendingImages.delete(this);
    }
    /**
     * Calculate the state changes necessary to load the image specified in the provided source info. If the component
     * is mounted, call setState() with the return value of this function. If the component has not yet mounted, use
     * the return value of this function as initial state for the component.
     * @param {object} imageSource - the new source for the image, including either assetId or URI
     * @returns {object} - the new state values, if any.
     */
    _loadImageSource (imageSource) {
        if (imageSource) {
            if (imageSource.uri) {
                ScratchImage._pendingImages.delete(this);
                return {
                    imageURI: imageSource.uri,
                    lastRequestedAsset: null
                };
            }
            if (this.state.lastRequestedAsset !== imageSource.assetId) {
                ScratchImage._pendingImages.add(this);
                return {
                    lastRequestedAsset: imageSource.assetId
                };
            }
        }
        // Nothing to do - don't change any state.
        return {};
    }
    render () {
        const {
            // TODO: Does this cause issues for desktop?
            src: _src, // eslint-disable-line react/prop-types
            imageSource: _imageSource,

            ...imgProps
        } = this.props;
        // 注意：不要把 <img> 放进 VisibilitySensor 的 render-props children 里。
        // 部分嵌入端 WebView（如 HarmonyOS ArkWeb）不会调用 sensor 的 children
        // 函数，导致图片元素永远不渲染；加载队列由 componentDidMount 与每个
        // 任务完成时的泵驱动，不依赖 sensor 回调。
        ScratchImage.loadPendingImages();
        return (
            <img
                src={this.state.imageURI}
                style={{
                    minWidth: '1px',
                    minHeight: '1px'
                }}
                {...imgProps}
            />
        );
    }
}

ScratchImage.ImageSourcePropType = PropTypes.oneOfType([
    PropTypes.shape({
        assetId: PropTypes.string.isRequired,
        assetType: PropTypes.oneOf(
            Object.values(
                legacyConfig.storage.scratchStorage.AssetType
            )
        ).isRequired,
        assetServiceUri: PropTypes.string.isRequired
    }),
    PropTypes.shape({
        uri: PropTypes.string.isRequired
    })
]);

ScratchImage.propTypes = {
    imageSource: ScratchImage.ImageSourcePropType.isRequired
};

ScratchImage.init();

export default ScratchImage;
