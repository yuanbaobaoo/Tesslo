// @tesslo/state 出口：TessloStorage 保存后端。
// EditorState 会话装配已废弃（standalone 出口内嵌 react 与主 bundle 双实例，
// 真机实测崩；编辑器挂载改由 @tesslo/app 的 EditorPane 用主出口 AppStateHOC）。
export {TessloStorage} from './tesslo-storage.ts';
export type {GUIStorageLike, TessloStorageParams, VmAsset, VmHandle} from './tesslo-storage.ts';
