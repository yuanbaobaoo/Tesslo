// 历史快照对话框：列表 + 差异摘要 + 一键回滚（回滚前先保存当前版为快照，可再撤销）。
import React, {useEffect, useRef, useState} from 'react';
import type {PlatformAdapter, ProjectAsset, ProjectMeta, ProjectSnapshot,
    ProjectSummary, SnapshotContent} from '@tesslo/platform-adapter';
import {readTess} from '@tesslo/formats';
import {compareDetails, detailStats, diffStatText, statsFromProject, statsFromTess,
    type CompareLine, type ProjectDetailStats, type ProjectSummaryStats} from './snapshot-diff.ts';
import {presentError} from '../error-text.ts';
import {AlertDialog} from '../ui/dialog.tsx';
import type {AlertDialogProps} from '../ui/dialog.tsx';
import '../ui/dialog.css';

// 快照条目的展示态（差异文案异步装载）
interface SnapshotRow extends ProjectSnapshot {
    diffLines: string[] | null; // null = 加载中/不可用
}

// 版本对比弹层内容
interface CompareView {
    readonly savedAt: string;
    readonly lines: CompareLine[];
    readonly current: ProjectDetailStats;
    readonly snapshot: ProjectDetailStats;
}

// 快照对话框参数
export interface SnapshotsDialogProps {
    readonly project: ProjectSummary;
    readonly adapter: PlatformAdapter;
    readonly onClose: () => void;
}

// 相对时间（与列表页一致的口径）
const friendlyTime = (iso: string): string => {
    const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return new Date(iso).toLocaleString('zh-CN');
};

/**
 * 快照列表面态框。
 *
 * @param props - 项目、适配器与关闭回调。
 * @returns 对话框 JSX。
 */
export const SnapshotsDialog = ({project, adapter, onClose}: SnapshotsDialogProps): React.JSX.Element => {
    const [rows, setRows] = useState<SnapshotRow[] | null>(null);
    // 错误统一用提示弹窗，不用对话框内正文
    const [alert, setAlert] = useState<AlertDialogProps | null>(null);
    const [busy, setBusy] = useState(false);
    // 版本对比弹层
    const [compare, setCompare] = useState<CompareView | null>(null);
    // 当前版项目 JSON（对比基准；未保存时 null）
    const currentProjectRef = useRef<unknown>(null);

    const showError = (cause: unknown): void => {
        const presented = presentError(cause);
        if (presented.text.length > 0) {
            setAlert({title: presented.title, message: presented.text, onClose: () => setAlert(null)});
        }
    };

    // 列表 + 当前版统计 + 每个快照的差异摘要（尽力而为，单个失败不拖垮列表）
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const snapshots = await adapter.projects.listSnapshots(project.id);
                if (cancelled) return;
                setRows(snapshots.map(item => ({...item, diffLines: null})));
                let currentStats: ProjectSummaryStats | null = null;
                try {
                    const currentBundle = await adapter.projects.readProject(project.id);
                    currentProjectRef.current = currentBundle.project;
                    currentStats = statsFromProject(currentBundle.project);
                } catch {
                    currentProjectRef.current = null;
                    currentStats = null; // 新建未保存：无当前版可比
                }
                if (cancelled || currentStats === null) return;
                for (const snapshot of snapshots) {
                    try {
                        const content: SnapshotContent = await adapter.projects.readSnapshot(
                            project.id, snapshot.id);
                        const snapshotStats: ProjectSummaryStats = content.kind === 'tess'
                            ? await statsFromTess(content.bytes)
                            : statsFromProject(content.project);
                        if (cancelled) return;
                        setRows(prev => prev?.map(row => row.id === snapshot.id
                            ? {...row, diffLines: diffStatText(currentStats as ProjectSummaryStats,
                                snapshotStats)}
                            : row) ?? null);
                    } catch {
                        // 单个快照损坏：保持"不可比"
                    }
                }
            } catch (cause) {
                if (!cancelled) showError(cause);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [adapter, project.id]);

    // 查看该版本与当前版的差异（积木/角色/类别逐项）
    const openCompare = async (snapshot: ProjectSnapshot): Promise<void> => {
        setBusy(true);
        try {
            const content: SnapshotContent = await adapter.projects.readSnapshot(project.id, snapshot.id);
            const snapshotProject = content.kind === 'tess'
                ? (await readTess(content.bytes)).project
                : content.project;
            const snapshotDetail = detailStats(snapshotProject);
            const currentProject = currentProjectRef.current;
            const currentDetail = currentProject === null || currentProject === undefined
                ? null
                : detailStats(currentProject);
            setCompare({
                savedAt: snapshot.savedAt,
                lines: currentDetail === null
                    ? [{tone: 'info', text: '当前版本还没有保存，暂时无法对比。'}]
                    : compareDetails(currentDetail, snapshotDetail),
                current: currentDetail ?? snapshotDetail,
                snapshot: snapshotDetail
            });
        } catch (cause) {
            showError(cause);
        } finally {
            setBusy(false);
        }
    };

    const restore = async (snapshot: ProjectSnapshot) => {
        setBusy(true);
        try {
            const content: SnapshotContent = await adapter.projects.readSnapshot(project.id, snapshot.id);
            let meta: ProjectMeta;
            let snapshotProject: Record<string, unknown>;
            let assets: ProjectAsset[];
            if (content.kind === 'tess') {
                // 旧版 .tess 快照：容器自带素材
                const container = await readTess(content.bytes);
                meta = container.meta;
                snapshotProject = container.project as Record<string, unknown>;
                assets = Array.from(container.assets.entries()).map(([md5ext, bytes]) => ({
                    md5ext,
                    bytes: bytes.slice().buffer as ArrayBuffer
                }));
            } else {
                // 新目录快照：复用当前工作区素材（素材只增不减，快照引用均可用）
                meta = content.meta;
                snapshotProject = content.project;
                try {
                    assets = (await adapter.projects.readProject(project.id)).assets;
                } catch {
                    assets = [];
                }
            }
            // 回滚 = 用快照内容保存当前工作区；服务端会先把当前版转存为快照
            await adapter.projects.saveProject(project.id, {
                meta: {
                    ...meta,
                    projectId: project.id,
                    name: project.name,
                    updatedAt: new Date().toISOString()
                },
                project: snapshotProject,
                assets
            });
            onClose();
        } catch (cause) {
            showError(cause);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="tesslo-dialog-overlay" onClick={onClose}>
            <div className="tesslo-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h2 className="tesslo-dialog-title">历史版本</h2>
                <p className="tesslo-dialog-message">
                    「{project.name}」的保存历史，回滚后当前版本也会存入历史。
                </p>
                <ul className="tesslo-snapshot-list">
                    {rows === null ? (
                        <li className="tesslo-snapshot-item">正在加载…</li>
                    ) : rows.length === 0 ? (
                        <li className="tesslo-snapshot-item">还没有历史版本，编辑保存后自动产生。</li>
                    ) : (
                        rows.map(row => (
                            <li key={row.id} className="tesslo-snapshot-item">
                                <div className="tesslo-snapshot-info">
                                    <span>{friendlyTime(row.savedAt)}</span>
                                    {row.diffLines !== null && row.diffLines.length > 0 ? (
                                        <span className="tesslo-snapshot-diff">
                                            {row.diffLines.join(' · ')}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="tesslo-snapshot-actions">
                                    <button
                                        type="button"
                                        className="tesslo-dialog-button"
                                        onClick={() => void openCompare(row)}
                                        disabled={busy}
                                    >
                                        对比
                                    </button>
                                    <button
                                        type="button"
                                        className="tesslo-dialog-button"
                                        onClick={() => void restore(row)}
                                        disabled={busy}
                                    >
                                        回滚
                                    </button>
                                </div>
                            </li>
                        ))
                    )}
                </ul>
                <div className="tesslo-dialog-actions">
                    <button type="button" className="tesslo-dialog-button" onClick={onClose}>
                        关闭
                    </button>
                </div>
            </div>
            {alert ? (
                <AlertDialog title={alert.title} message={alert.message} onClose={alert.onClose} />
            ) : null}
            {compare ? (
                <div
                    className="tesslo-dialog-overlay tesslo-alert-overlay"
                    onClick={event => {
                        event.stopPropagation();
                        setCompare(null);
                    }}
                >
                    <div
                        className="tesslo-dialog tesslo-compare-dialog"
                        role="dialog"
                        aria-modal="true"
                        onClick={event => event.stopPropagation()}
                    >
                        <h2 className="tesslo-dialog-title">版本对比</h2>
                        <p className="tesslo-dialog-message">
                            基准：该版本（{friendlyTime(compare.savedAt)}）→ 当前版本
                        </p>
                        <div className="tesslo-compare-summary">
                            <span>角色 {compare.snapshot.spriteCount} → {compare.current.spriteCount}</span>
                            <span>积木 {compare.snapshot.blockCount} → {compare.current.blockCount}</span>
                        </div>
                        <ul className="tesslo-compare-lines">
                            {compare.lines.map((line, index) => (
                                <li key={`${line.tone}-${index}`} className={`is-${line.tone}`}>
                                    {line.text}
                                </li>
                            ))}
                        </ul>
                        <div className="tesslo-dialog-actions">
                            <button
                                type="button"
                                className="tesslo-dialog-button"
                                onClick={() => setCompare(null)}
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
