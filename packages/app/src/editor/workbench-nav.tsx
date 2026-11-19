// Tesslo 工作台导航条（自绘，不复用 Scratch menu-bar）：
// 左侧 logo（点击保存并返回作品列表）+ 作品名；右侧：设置 / 保存项目 / 导出项目；
// 最右：关于。只在工作区复用 Scratch（积木/舞台/画板），导航完全自有。
import React, {useEffect, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {selectLocale, setColorMode} from '@scratch/scratch-gui';
import {AlertDialog} from '../ui/dialog.tsx';
import type {ErrorPresentation} from '../error-text.ts';
import './workbench-nav.css';

// redux slices 的最小形状（引擎内部类型不外泄）
interface NavState {
    scratchGui: {settings: {colorMode: string}};
    locales: {locale: string};
}

// 颜色模式/语言的展示项（值对齐引擎 reducers/settings 与 locales）
const COLOR_MODES: ReadonlyArray<{value: string; label: string}> = [
    {value: 'default', label: '默认'},
    {value: 'high-contrast', label: '高对比'}
];
const LOCALES: ReadonlyArray<{value: string; label: string}> = [
    {value: 'zh-cn', label: '简体中文'},
    {value: 'en', label: 'English'}
];

// 保存按钮的状态（导航条内部管理，避免外层挂载闭包与内层 root 脱节）
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

// 保存状态反馈展示时长
const SAVE_FEEDBACK_MS = 1800;

// 导航条参数
export interface WorkbenchNavProps {
    readonly projectName: string;
    readonly logo?: string;
    readonly onBack: () => void;
    // 保存项目：成功返回 null，失败返回可展示的错误（导航条弹窗提示）
    readonly onSave: () => Promise<ErrorPresentation | null>;
    readonly onExport: () => void;
    readonly onAbout: () => void;
}

/**
 * Tesslo 工作台顶部导航条。
 *
 * @param props - 作品名、logo、保存状态与四个动作回调。
 * @returns 导航条 JSX。
 */
export const WorkbenchNav = ({projectName, logo, onBack, onSave, onExport,
    onAbout}: WorkbenchNavProps): React.JSX.Element => {
    const dispatch = useDispatch();
    const colorMode = useSelector((state: NavState) => state.scratchGui.settings.colorMode);
    const locale = useSelector((state: NavState) => state.locales.locale);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    // 保存失败/操作错误的弹窗（不用内联文案）
    const [alert, setAlert] = useState<{title: string; message: string} | null>(null);
    const feedbackTimer = useRef<number | null>(null);
    const settingsRef = useRef<HTMLDivElement | null>(null);

    // 卸载时清理保存反馈计时器
    useEffect(() => () => {
        if (feedbackTimer.current !== null) {
            window.clearTimeout(feedbackTimer.current);
        }
    }, []);

    // 点击外部关闭设置面板
    useEffect(() => {
        if (!settingsOpen) {
            return undefined;
        }
        const onPointerDown = (event: MouseEvent): void => {
            if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
                setSettingsOpen(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [settingsOpen]);

    const saveLabel: Record<SaveState, string> = {
        idle: '保存项目',
        saving: '保存中…',
        saved: '已保存',
        failed: '保存失败'
    };

    return (
        <header className="tesslo-nav">
            <div className="tesslo-nav-left">
                <button
                    type="button"
                    className="tesslo-nav-logo"
                    title="返回作品列表（自动保存）"
                    onClick={onBack}
                >
                    {logo !== undefined ? (
                        <img src={logo} alt="Tesslo" draggable={false} />
                    ) : (
                        <span className="tesslo-wordmark">TESSLO</span>
                    )}
                </button>
                <span className="tesslo-nav-title" title={projectName}>{projectName}</span>
            </div>

            <div className="tesslo-nav-actions">
                <div className="tesslo-nav-settings" ref={settingsRef}>
                    <button
                        type="button"
                        className={`tesslo-nav-btn${settingsOpen ? ' is-active' : ''}`}
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen(open => !open)}
                    >
                        设置
                    </button>
                    {settingsOpen ? (
                        <div className="tesslo-nav-panel" role="menu">
                            <div className="tesslo-nav-group">
                                <span className="tesslo-nav-group-title">颜色模式</span>
                                {COLOR_MODES.map(item => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={colorMode === item.value}
                                        className={`tesslo-nav-option${colorMode === item.value ? ' is-checked' : ''}`}
                                        onClick={() => dispatch(setColorMode(item.value))}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <div className="tesslo-nav-group">
                                <span className="tesslo-nav-group-title">语言</span>
                                {LOCALES.map(item => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={locale === item.value}
                                        className={`tesslo-nav-option${locale === item.value ? ' is-checked' : ''}`}
                                        onClick={() => {
                                            dispatch(selectLocale(item.value));
                                            setSettingsOpen(false);
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>

                <button
                    type="button"
                    className="tesslo-nav-btn tesslo-nav-btn-primary"
                    disabled={saveState === 'saving'}
                    onClick={() => {
                        void (async () => {
                            setSaveState('saving');
                            const failure = await onSave();
                            setSaveState(failure === null ? 'saved' : 'failed');
                            if (failure !== null && failure.text.length > 0) {
                                setAlert({title: failure.title, message: failure.text});
                            }
                            if (feedbackTimer.current !== null) {
                                window.clearTimeout(feedbackTimer.current);
                            }
                            feedbackTimer.current = window.setTimeout(() => {
                                setSaveState('idle');
                                feedbackTimer.current = null;
                            }, SAVE_FEEDBACK_MS);
                        })();
                    }}
                >
                    {saveLabel[saveState]}
                </button>

                <button type="button" className="tesslo-nav-btn" onClick={onExport}>
                    导出项目
                </button>
            </div>

            <button
                type="button"
                className="tesslo-nav-about"
                title="关于 Tesslo"
                onClick={onAbout}
            >
                关于
            </button>

            {alert ? (
                <AlertDialog
                    title={alert.title}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            ) : null}
        </header>
    );
};
