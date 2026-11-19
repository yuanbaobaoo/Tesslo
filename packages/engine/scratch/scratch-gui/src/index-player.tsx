// 播放端引擎入口（导出执行文件专用，Tesslo 扩展）：只挂舞台（含绿旗/停止/全屏）
// 与监视器，不引入积木编辑器 / 画板 / 素材库等编辑器模块。
// 与主出口（index.ts，完整 GUI）并存：编辑器用主出口，player 用本出口。
// 复用 gui 的 HOC 链子集（本地化 / 错误边界 / 项目拉取 / vm 监听 / vm 管理），
// 组件树只剩 Stage（内部含 StageHeader + MonitorList + 舞台渲染）。
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import {compose} from 'redux';
import VM from '@scratch/scratch-vm';
import Renderer from '@scratch/scratch-render';

import StageWrapper from './containers/stage-wrapper.jsx';
import Alerts from './containers/alerts.jsx';
import ErrorBoundaryHOC from './lib/error-boundary-hoc.jsx';
import LocalizationHOC from './lib/localization-hoc.jsx';
import ProjectFetcherHOC from './lib/project-fetcher-hoc.jsx';
import vmListenerHOC from './lib/vm-listener-hoc.jsx';
import vmManagerHOC from './lib/vm-manager-hoc.jsx';
import {STAGE_SIZE_MODES} from './lib/layout-constants';
import {getIsLoading} from './reducers/project-state';

// 播放器组件：GUI 的 isPlayerOnly 分支等价（StageWrapper + Alerts）
const PlayerComponent = ({vm, loading}) => (
    <StageWrapper
        isFullScreen
        isRendererSupported={Renderer.isSupported()}
        isRtl={false}
        loading={loading}
        stageSize={STAGE_SIZE_MODES.large}
        vm={vm}
    >
        <Alerts />
    </StageWrapper>
);

PlayerComponent.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired,
    loading: PropTypes.bool
};

PlayerComponent.defaultProps = {
    loading: false
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm,
    loading: getIsLoading(state.scratchGui.projectState.loadingState)
});

// HOC 链与完整 GUI 一致但只取播放必需子集：
// Localization（IntlProvider）→ ErrorBoundary → ProjectFetcher（storage 拉项目）
// → vmListener（vm 事件 → redux）→ vmManager（vm 初始化 / 项目装载）
// 播放端专用 store 工厂：等价 EditorState 的播放子集——
// 不引入 scratch-paint 的 reducer（编辑器专属，~3.8MB），
// 只用 locales + scratchGui 两域（AppStateHOC 会把 paint 带进播放端包）。
import {combineReducers, createStore} from 'redux';
import localesReducer, {initLocale, localesInitialState} from './reducers/locales';
import GuiReducer, {buildInitialState, guiMiddleware, initPlayer} from './reducers/gui';

export const createPlayerStore = (config, locale) => {
    let localesState = localesInitialState;
    if (locale && localesState.messagesByLocale[locale]) {
        localesState = initLocale(localesState, locale);
    }
    const store = createStore(
        combineReducers({
            locales: localesReducer,
            scratchGui: GuiReducer
        }),
        {
            locales: localesState,
            scratchGui: initPlayer(buildInitialState(config))
        },
        // guiMiddleware 是 store enhancer（与 EditorState 的用法一致），非中间件
        guiMiddleware
    );
    return store;
};

const Player = compose(
    LocalizationHOC,
    ErrorBoundaryHOC('Player'),
    ProjectFetcherHOC,
    vmListenerHOC,
    vmManagerHOC
)(connect(mapStateToProps)(PlayerComponent));

export default Player;
