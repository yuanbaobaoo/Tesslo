import {buildInitialState} from './reducers/gui';
import {legacyConfig} from './legacy-config';

export {default} from './containers/gui.jsx';
export {default as GUIComponent} from './components/gui/gui.jsx';
export {default as AppStateHOC} from './lib/app-state-hoc.jsx';
// Tesslo：编辑器自持 store（工作台自绘导航条需要 Provider 内可 dispatch 设置）
export {EditorState} from './lib/editor-state';
export {setAppElement} from 'react-modal';

export {legacyConfig};
export const guiInitialState = buildInitialState(legacyConfig);

export * from './exported-reducers';
// Tesslo：默认项目工厂（LegacyStorage 同款机制，供产品层 TessloStorage 预填 builtinHelper）
export {default as buildDefaultProject} from './lib/default-project';
