// 新建作品弹窗：名称 + 存储位置在同一表单内完成。
// 自定义目录走系统目录选择器（FOLDER + 持久授权）；目录不合法（非空/无权限）
// 用提示弹窗反馈，且**保持本表单不关闭**，用户可直接重选目录后重试。
import React, {useEffect, useRef, useState} from 'react';
import {presentError} from '../error-text.ts';
import {AlertDialog} from '../ui/dialog.tsx';
import type {AlertDialogProps} from '../ui/dialog.tsx';
import {sanitizeName} from './name.ts';

// 新建弹窗参数
export interface NewProjectDialogProps {
    readonly busy: boolean;
    readonly onCancel: () => void;
    // 打开系统目录选择器；取消时 reject E_CANCELLED（内部静默处理）
    readonly onPickDir: () => Promise<string>;
    // 创建项目；失败时 reject，本弹窗负责提示并保留表单
    readonly onCreate: (name: string, customDirUri?: string) => Promise<void>;
}

// 位置模式
type LocationMode = 'default' | 'custom';

// 目录 URI → 末段名称（展示用；解码失败回退原文）
const folderLabel = (uri: string): string => {
    const trimmed = uri.replace(/\/+$/u, '');
    const segment = trimmed.substring(trimmed.lastIndexOf('/') + 1);
    try {
        return decodeURIComponent(segment) || '所选目录';
    } catch {
        return segment || '所选目录';
    }
};

/**
 * 新建作品对话框（名称 + 默认位置/自定义空目录）。
 *
 * @param props - 忙态、选择目录与创建回调。
 * @returns 对话框 JSX。
 */
export const NewProjectDialog = ({busy, onCancel, onPickDir,
    onCreate}: NewProjectDialogProps): React.JSX.Element => {
    const [name, setName] = useState('我的作品');
    const [mode, setMode] = useState<LocationMode>('default');
    const [dirUri, setDirUri] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [alert, setAlert] = useState<AlertDialogProps | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const working = busy || picking || submitting;

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // 目录选择：取消（E_CANCELLED）静默；其他错误弹提示
    const pickDir = async (): Promise<void> => {
        setPicking(true);
        try {
            const uri = await onPickDir();
            setDirUri(uri);
            setMode('custom');
        } catch (cause) {
            const presented = presentError(cause);
            if (presented.text.length > 0) {
                setAlert({title: presented.title, message: presented.text, onClose: () => setAlert(null)});
            }
        } finally {
            setPicking(false);
        }
    };

    const submit = async (): Promise<void> => {
        const clean = sanitizeName(name);
        if (clean.length === 0) {
            setAlert({
                title: '作品名称不能为空',
                message: '请输入一个作品名称（不能只包含特殊字符）。',
                onClose: () => setAlert(null)
            });
            inputRef.current?.focus();
            return;
        }
        if (mode === 'custom' && dirUri === null) {
            setAlert({
                title: '请选择文件夹',
                message: '自定义目录需要先选择一个空文件夹。',
                onClose: () => setAlert(null)
            });
            return;
        }
        setSubmitting(true);
        try {
            await onCreate(clean, mode === 'custom' ? dirUri ?? undefined : undefined);
            // 成功由父组件关闭本弹窗；失败进入 catch
        } catch (cause) {
            const presented = presentError(cause);
            if (presented.text.length > 0) {
                setAlert({title: presented.title, message: presented.text, onClose: () => setAlert(null)});
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="tesslo-dialog-overlay"
            onClick={event => {
                if (event.target === event.currentTarget && !working) {
                    onCancel();
                }
            }}
        >
            <div className="tesslo-dialog" role="dialog" aria-modal="true">
                <h2 className="tesslo-dialog-title">新建作品</h2>

                <label className="tesslo-new-project-field">
                    <span className="tesslo-field-label">作品名称</span>
                    <input
                        ref={inputRef}
                        className="tesslo-dialog-input"
                        type="text"
                        value={name}
                        placeholder="给作品起个名字"
                        disabled={working}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !working) {
                                void submit();
                            }
                        }}
                    />
                </label>

                <span className="tesslo-field-label">存储位置</span>
                <div className="tesslo-location-options">
                    <button
                        type="button"
                        className={`tesslo-location-option${mode === 'default' ? ' is-selected' : ''}`}
                        disabled={working}
                        onClick={() => setMode('default')}
                    >
                        默认位置（Tesslo 作品库）
                    </button>
                    <button
                        type="button"
                        className={`tesslo-location-option${mode === 'custom' ? ' is-selected' : ''}`}
                        disabled={working}
                        onClick={() => {
                            setMode('custom');
                            if (dirUri === null) {
                                void pickDir();
                            }
                        }}
                    >
                        自定义目录（空文件夹）
                    </button>
                </div>

                {mode === 'custom' ? (
                    <div>
                        <div className="tesslo-dir-row">
                            <button
                                type="button"
                                className="tesslo-dialog-button"
                                disabled={working}
                                onClick={() => void pickDir()}
                            >
                                {picking ? '正在打开选择器…' : dirUri === null ? '选择空文件夹…' : '重新选择…'}
                            </button>
                            <span className="tesslo-dir-picked" title={dirUri ?? undefined}>
                                {dirUri === null ? '尚未选择文件夹' : `已选择：${folderLabel(dirUri)}`}
                            </span>
                        </div>
                        <p className="tesslo-dir-hint">
                            作品文件（.tess）与历史版本会保存在这个文件夹里；文件夹必须为空。
                        </p>
                    </div>
                ) : null}

                <div className="tesslo-dialog-actions">
                    <button
                        type="button"
                        className="tesslo-dialog-button"
                        disabled={working}
                        onClick={onCancel}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        className="tesslo-dialog-button tesslo-dialog-button-primary"
                        disabled={working}
                        onClick={() => void submit()}
                    >
                        {submitting ? '创建中…' : '创建'}
                    </button>
                </div>
            </div>

            {alert ? <AlertDialog title={alert.title} message={alert.message} onClose={alert.onClose} /> : null}
        </div>
    );
};
