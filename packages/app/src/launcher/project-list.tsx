// Launcher 首屏：我的作品列表（P1 核心 UI）。
// 打开见作品：列表 / 新建（名称+存储位置单弹窗）/ 重命名 / 复制 / 删除 /
// 收藏 / 导入（.tess/.sb3）/ 历史快照 / 目录缺失重新关联。
// 错误一律走 AlertDialog（不用页面内横幅），表单类操作失败不销毁用户输入。
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {PlatformAdapter, ProjectSummary} from '@tesslo/platform-adapter';
import {detectFormat, fingerprintProject, readTess, sb3ToTess} from '@tesslo/formats';
import {presentError} from '../error-text.ts';
import {AlertDialog, PromptDialog} from '../ui/dialog.tsx';
import type {AlertDialogProps, PromptDialogOptions} from '../ui/dialog.tsx';
import {Toast} from '../ui/toast.tsx';
import {ChevronRightIcon, DownloadIcon, HistoryIcon, MoreIcon, StarIcon} from '../ui/icons.tsx';
import {SnapshotsDialog} from './snapshots-dialog.tsx';
import {ExportDialog} from './export-dialog.tsx';
import {NewProjectDialog} from './new-project-dialog.tsx';
import {ProjectCardMenu} from './project-card-menu.tsx';
import {sanitizeName} from './name.ts';
import type {ExportFormatChoice} from './export-dialog.tsx';
import './launcher.css';

// 列表操作意图（PromptDialog 上下文）
interface PendingAction {
    readonly kind: 'rename' | 'duplicate' | 'delete';
    readonly project?: ProjectSummary;
}

// 相对时间（孩子友好：刚刚 / N 分钟前 / 昨天 / 日期）
const friendlyTime = (iso: string): string => {
    const deltaMs = Date.now() - Date.parse(iso);
    if (Number.isNaN(deltaMs)) {
        return '';
    }
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
};

// Launcher 参数
export interface ProjectListProps {
    readonly adapter: PlatformAdapter;
    readonly logo?: string;
    readonly version?: string;
    readonly onOpenAbout?: () => void;
    readonly onOpenProject: (project: ProjectSummary) => void;
    // 导出钩子：装配层注入（导出器需要 AssetServer 模板通道，属装配层职责）；
    // true = 已导出，false = 取消/失败（失败时装配层已弹提示）
    readonly onExportProject?: (
        project: ProjectSummary,
        format: ExportFormatChoice
    ) => Promise<boolean> | void;
}

/**
 * 作品列表首屏。
 *
 * @param props - 适配器、logo/版本、关于回调与打开项目回调。
 * @returns Launcher JSX。
 */
export const ProjectList = ({adapter, logo, version, onOpenAbout, onOpenProject,
    onExportProject}: ProjectListProps): React.JSX.Element => {
    const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
    // 统一错误提示（AlertDialog）；不用页面内横幅
    const [alert, setAlert] = useState<AlertDialogProps | null>(null);
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [snapshotsFor, setSnapshotsFor] = useState<ProjectSummary | null>(null);
    const [exportFor, setExportFor] = useState<ProjectSummary | null>(null);
    // 导出进行中（宿主组装 HTML/等待保存选择器时保持反馈，避免"点了没反应"）
    const [exportBusy, setExportBusy] = useState(false);
    // 成功提示（导出完成）
    const [toast, setToast] = useState<string | null>(null);
    // 新建弹窗（名称 + 存储位置同一表单；失败不关闭）
    const [creating, setCreating] = useState(false);
    // 卡片"更多"菜单（锚点用于 PC 下拉定位）
    const [cardMenu, setCardMenu] = useState<{project: ProjectSummary; anchor: HTMLButtonElement} | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    // 错误展示统一出口（空文案 = 用户取消，不弹）
    const showError = useCallback((cause: unknown) => {
        const presented = presentError(cause);
        if (presented.text.length > 0) {
            setAlert({title: presented.title, message: presented.text, onClose: () => setAlert(null)});
        }
    }, []);

    // 列表刷新（错误不得拖垮首屏）
    const refresh = useCallback(async () => {
        try {
            setProjects(await adapter.projects.listProjects());
        } catch (cause) {
            showError(cause);
        }
    }, [adapter, showError]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // 单一出口执行带 busy 的异步操作
    const runAction = useCallback(async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch (cause) {
            showError(cause);
        } finally {
            setBusy(false);
        }
    }, [showError]);

    // —— 新建：名称 + 位置（名称与目录在同一弹窗；失败保持表单）——
    const startCreate = () => {
        setCreating(true);
    };
    const createProject = async (name: string, customDirUri?: string): Promise<void> => {
        const created = await adapter.projects.createProject(name, {customDirUri});
        setCreating(false);
        await refresh();
        onOpenProject(created); // 新建即进编辑器
    };

    // —— 重命名 / 复制 / 删除 ——
    const finishRename = async (project: ProjectSummary, name: string) => {
        const clean = sanitizeName(name);
        if (clean.length === 0 || clean === project.name) {
            return;
        }
        await runAction(async () => {
            await adapter.projects.renameProject(project.id, clean);
            await refresh();
        });
    };
    const finishDuplicate = async (project: ProjectSummary, name: string) => {
        const clean = sanitizeName(name);
        if (clean.length === 0) {
            return;
        }
        await runAction(async () => {
            await adapter.projects.duplicateProject(project.id, clean);
            await refresh();
        });
    };
    const finishDelete = async (project: ProjectSummary, deleteDir: boolean) => {
        await runAction(async () => {
            await adapter.projects.deleteProject(project.id, {deleteDir});
            await refresh();
        });
    };

    // —— 收藏 / 重新关联 ——
    const toggleFavorite = (project: ProjectSummary) => {
        void runAction(async () => {
            await adapter.projects.setFavorite(project.id, !project.favorite);
            await refresh();
        });
    };
    const relink = (project: ProjectSummary) => {
        void runAction(async () => {
            const dirUri = await adapter.pickProjectDir();
            await adapter.projects.relinkProject(project.id, dirUri);
            await refresh();
        });
    };

    // —— 导入：.tess 直读；.sb3 转换后入库（createProject + saveProject 组合）——
    const onImportFile = (file: File) => {
        void runAction(async () => {
            const bytes = await file.arrayBuffer();
            const format = detectFormat(file.name);
            // .tess 有完整元数据；官方 .sb3 按文件名派生（sb3ToTess 内处理静默成员）
            const staged = format === 'tess'
                ? await readTess(bytes)
                : await sb3ToTess(bytes, sanitizeName(file.name.replace(/\.(sb3|tess)$/i, '')), 'pending');
            // 导入去重：带真实项目 ID 的文件（.tess / Tesslo 导出的 sb3）按 ID 判定
            // ——ID 是权威身份，避免"两个空白项目内容相同"被误判重复；
            // 无元数据的官方 sb3 退回内容指纹判定
            const fingerprint: string = fingerprintProject(staged.project);
            const sourceId: string = staged.meta.projectId;
            const query = sourceId.length > 0 && sourceId !== 'pending'
                ? {projectId: sourceId}
                : {fingerprint};
            const existing = await adapter.projects.findExistingProject(query);
            if (existing !== null) {
                setAlert({
                    title: '这个作品已经存在',
                    message: `作品「${existing.name}」已经在作品库中，不能重复导入。`,
                    onClose: () => setAlert(null)
                });
                return;
            }
            const created = await adapter.projects.createProject(staged.meta.name);
            // 身份重绑到注册表 ID 后写工作区（tesslo.json/project.json/assets）
            const assets = Array.from(staged.assets.entries()).map(([md5ext, assetBytes]) => ({
                md5ext,
                bytes: assetBytes.slice().buffer as ArrayBuffer
            }));
            await adapter.projects.saveProject(created.id, {
                meta: {
                    ...staged.meta,
                    projectId: created.id,
                    name: created.name,
                    fingerprint
                },
                project: staged.project as Record<string, unknown>,
                assets
            });
            await refresh();
        });
    };

    // 对话框配置
    const dialogOptions = (action: PendingAction): PromptDialogOptions | null => {
        switch (action.kind) {
            case 'rename':
                return {
                    title: '重命名',
                    initialInput: action.project?.name,
                    confirmLabel: '重命名'
                };
            case 'duplicate':
                return {
                    title: '复制作品',
                    initialInput: `${action.project?.name ?? ''} 副本`,
                    confirmLabel: '复制'
                };
            case 'delete':
                return {
                    title: '删除作品',
                    message: `确定删除「${action.project?.name ?? ''}」吗？`,
                    // 外部目录：授权只覆盖目录本身，子项可删但父目录不可删 → 清空后保留空文件夹
                    extraCheckLabel: action.project?.location === 'external'
                        ? '同时清空作品文件（文件夹保留）'
                        : '同时删除作品文件夹',
                    confirmLabel: '删除',
                    danger: true
                };
            default:
                return null;
        }
    };

    const pendingOptions = pending ? dialogOptions(pending) : null;

    return (
        <div className="tesslo-launcher">
            <header className="tesslo-launcher-header">
                <div className="tesslo-launcher-brand">
                    {logo ? <img src={logo} alt="Tesslo" className="tesslo-launcher-logo" /> : null}
                    <h1>我的作品</h1>
                </div>
                <div className="tesslo-launcher-actions">
                    <button
                        type="button"
                        className="tesslo-launcher-button"
                        onClick={() => importInputRef.current?.click()}
                    >
                        导入
                    </button>
                    {onOpenAbout ? (
                        <button
                            type="button"
                            className="tesslo-launcher-button"
                            onClick={onOpenAbout}
                        >
                            关于
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="tesslo-launcher-button tesslo-launcher-button-primary"
                        onClick={startCreate}
                        disabled={busy}
                    >
                        ＋ 新建
                    </button>
                </div>
            </header>

            <main className="tesslo-launcher-grid">
                {projects === null ? (
                    <p className="tesslo-launcher-empty">正在加载作品…</p>
                ) : projects.length === 0 ? (
                    <div className="tesslo-launcher-empty">
                        <p>还没有作品</p>
                        <p>点右上角「新建」开始创作吧！</p>
                    </div>
                ) : (
                    projects.map(project => (
                        <article
                            key={project.id}
                            className={`tesslo-launcher-card${project.missing ? ' is-missing' : ''}`}
                        >
                            <button
                                type="button"
                                className="tesslo-launcher-card-open"
                                onClick={() => {
                                    if (project.missing) {
                                        relink(project);
                                    } else {
                                        onOpenProject(project);
                                    }
                                }}
                                disabled={busy}
                                aria-label={`${project.missing ? '重新关联' : '打开'}作品「${project.name}」`}
                            >
                                <span className="tesslo-launcher-card-thumb" aria-hidden="true">
                                    {project.thumbnail ? (
                                        <img
                                            className="tesslo-launcher-card-thumb-img"
                                            src={project.thumbnail}
                                            alt=""
                                            draggable={false}
                                            loading="lazy"
                                        />
                                    ) : (
                                        <span className="tesslo-launcher-card-cover">
                                            {Array.from(project.name.trim())[0] ?? 'T'}
                                        </span>
                                    )}
                                    {project.favorite ? (
                                        <span className="tesslo-launcher-card-fav">
                                            <StarIcon size={12} filled /> 已收藏
                                        </span>
                                    ) : null}
                                    <span className="tesslo-launcher-card-open-hint" aria-hidden="true">
                                        打开作品
                                    </span>
                                </span>
                                <span className="tesslo-launcher-card-name-row">
                                    <span className="tesslo-launcher-card-name">{project.name}</span>
                                    <span className="tesslo-launcher-card-chevron" aria-hidden="true">
                                        <ChevronRightIcon size={16} />
                                    </span>
                                </span>
                                <span className="tesslo-launcher-card-meta">
                                    {project.missing ? '目录缺失，点击重新关联' : friendlyTime(project.updatedAt)}
                                    {project.location === 'external' ? ' · 自定义目录' : ''}
                                </span>
                            </button>
                            {/* 工具栏：卡片本身即"打开"，这里只放轻量操作 */}
                            <div className="tesslo-launcher-card-actions">
                                {project.missing ? null : (
                                    <>
                                        <button
                                            type="button"
                                            className="tesslo-card-link"
                                            onClick={() => setExportFor(project)}
                                            disabled={busy}
                                            title="导出为 .tess / .sb3 / .html"
                                        >
                                            <DownloadIcon /> 导出
                                        </button>
                                        <button
                                            type="button"
                                            className="tesslo-card-link"
                                            onClick={() => setSnapshotsFor(project)}
                                            disabled={busy}
                                            title="历史版本：查看、对比、回滚"
                                        >
                                            <HistoryIcon /> 历史
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    className={`tesslo-card-link${project.missing ? ' is-single' : ''}`}
                                    onClick={event => setCardMenu({project, anchor: event.currentTarget})}
                                    disabled={busy}
                                    aria-haspopup="menu"
                                    aria-expanded={cardMenu?.project.id === project.id}
                                    title="更多操作：收藏与重命名等"
                                >
                                    <MoreIcon /> 更多
                                </button>
                            </div>
                        </article>
                    ))
                )}
            </main>

            <footer className="tesslo-launcher-footer">
                {version ? <span>Tesslo {version}</span> : null}
            </footer>

            {/* 隐藏导入通道：接受 .tess / .sb3 */}
            <input
                ref={importInputRef}
                type="file"
                accept=".tess,.sb3"
                className="tesslo-hidden-input"
                onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = ''; // 允许连续导入同名文件
                    if (file) {
                        onImportFile(file);
                    }
                }}
            />

            {pending && pendingOptions ? (
                <PromptDialog
                    options={pendingOptions}
                    onDone={result => {
                        const action = pending;
                        setPending(null);
                        if (!result.confirmed || !action) {
                            return;
                        }
                        if (action.kind === 'rename' && action.project) {
                            void finishRename(action.project, result.inputValue ?? '');
                        } else if (action.kind === 'duplicate' && action.project) {
                            void finishDuplicate(action.project, result.inputValue ?? '');
                        } else if (action.kind === 'delete' && action.project) {
                            void finishDelete(action.project, result.extraChecked === true);
                        }
                    }}
                />
            ) : null}

            {snapshotsFor ? (
                <SnapshotsDialog
                    project={snapshotsFor}
                    adapter={adapter}
                    onClose={() => {
                        setSnapshotsFor(null);
                        void refresh();
                    }}
                />
            ) : null}

            {creating ? (
                <NewProjectDialog
                    busy={busy}
                    onCancel={() => setCreating(false)}
                    onPickDir={() => adapter.pickProjectDir()}
                    onCreate={createProject}
                />
            ) : null}

            {exportFor ? (
                <ExportDialog
                    project={exportFor}
                    busy={exportBusy}
                    onClose={() => {
                        if (!exportBusy) {
                            setExportFor(null);
                        }
                    }}
                    onChoose={format => {
                        const target: ProjectSummary | null = exportFor;
                        if (target === null || onExportProject === undefined) {
                            setExportFor(null);
                            return;
                        }
                        setExportBusy(true);
                        void (async () => {
                            try {
                                const done = await Promise.resolve(onExportProject(target, format));
                                if (done === true) {
                                    const extension = format === 'html' ? '.html' : `.${format}`;
                                    setToast(`已导出「${target.name}」${extension}`);
                                }
                            } catch {
                                // 装配层已弹出错误提示；这里只负责收尾
                            } finally {
                                setExportBusy(false);
                                setExportFor(null);
                            }
                        })();
                    }}
                />
            ) : null}

            {/* 卡片"更多"菜单：PC 下拉 / 触屏底部动作面板 */}
            {cardMenu ? (
                <ProjectCardMenu
                    project={cardMenu.project}
                    anchor={cardMenu.anchor}
                    onClose={() => setCardMenu(null)}
                    onToggleFavorite={() => toggleFavorite(cardMenu.project)}
                    onRename={() => setPending({kind: 'rename', project: cardMenu.project})}
                    onDuplicate={() => setPending({kind: 'duplicate', project: cardMenu.project})}
                    onDelete={() => setPending({kind: 'delete', project: cardMenu.project})}
                />
            ) : null}

            {/* 统一错误提示弹窗（页面内不再显示横幅） */}
            {alert ? (
                <AlertDialog title={alert.title} message={alert.message} onClose={alert.onClose} />
            ) : null}

            {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
        </div>
    );
};
