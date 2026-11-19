// 导出格式选择对话框（三选一，默认 .tess，P1 文件模型）。
// 选择格式后保持"准备中/等待系统保存窗口"反馈；系统选择器打开后用户仍可关掉本框，
// 导出请求会继续完成（成功后由外层 Toast 提示）。
import React, {useEffect, useState} from 'react';
import type {ProjectSummary} from '@tesslo/platform-adapter';
import '../ui/dialog.css';

// 导出格式标识（与装配层 exporter 的 ExportFormat 对齐）
export type ExportFormatChoice = 'tess' | 'sb3' | 'html';

// 导出对话框参数
export interface ExportDialogProps {
    readonly project: ProjectSummary;
    readonly busy: boolean;
    readonly onChoose: (format: ExportFormatChoice) => void;
    readonly onClose: () => void;
}

// 忙态文案切换延时：先显示"准备"，稍后改为"请选择保存位置"
const WAITING_HINT_MS = 1200;

/**
 * 格式选择模态框：.tess（默认）/ .sb3（互通）/ .html（执行文件）。
 *
 * @param props - 作品、忙态、选择与关闭回调。
 * @returns 对话框 JSX。
 */
export const ExportDialog = ({project, busy, onChoose, onClose}: ExportDialogProps): React.JSX.Element => {
    const [waiting, setWaiting] = useState(false);

    // 忙态持续 1.2s 后提示用户去看系统保存窗口（picker 可能在不同窗口弹出）
    useEffect(() => {
        if (!busy) {
            setWaiting(false);
            return undefined;
        }
        const timer = window.setTimeout(() => setWaiting(true), WAITING_HINT_MS);
        return () => window.clearTimeout(timer);
    }, [busy]);

    return (
        <div className="tesslo-dialog-overlay" onClick={onClose}>
            <div className="tesslo-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h2 className="tesslo-dialog-title">导出「{project.name}」</h2>
                <div className="tesslo-export-options">
                    <button
                        type="button"
                        className="tesslo-dialog-button tesslo-export-option"
                        disabled={busy}
                        onClick={() => onChoose('tess')}
                    >
                        <span className="tesslo-export-option-name">工程文件（.tess）</span>
                        <span className="tesslo-export-option-desc">Tesslo 默认格式，完整数据</span>
                    </button>
                    <button
                        type="button"
                        className="tesslo-dialog-button tesslo-export-option"
                        disabled={busy}
                        onClick={() => onChoose('sb3')}
                    >
                        <span className="tesslo-export-option-name">互通文件（.sb3）</span>
                        <span className="tesslo-export-option-desc">可在官方 Scratch 打开</span>
                    </button>
                    <button
                        type="button"
                        className="tesslo-dialog-button tesslo-export-option"
                        disabled={busy}
                        onClick={() => onChoose('html')}
                    >
                        <span className="tesslo-export-option-name">执行文件（.html）</span>
                        <span className="tesslo-export-option-desc">双击即玩，无需安装</span>
                    </button>
                </div>
                {busy ? (
                    <div className="tesslo-export-busy" role="status" aria-live="polite">
                        <span className="tesslo-export-spinner" aria-hidden="true" />
                        {waiting ? '请在弹出的保存窗口中选择位置…' : '正在准备导出…'}
                    </div>
                ) : null}
                <div className="tesslo-dialog-actions">
                    <button
                        type="button"
                        className="tesslo-dialog-button"
                        onClick={onClose}
                    >
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
};
