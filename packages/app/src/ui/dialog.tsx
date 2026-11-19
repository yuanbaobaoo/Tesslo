// 通用对话框（触屏优先：目标 ≥48px；替代裸 alert/confirm，规范 §7.2/§9）。
import React, {useEffect, useRef, useState} from 'react';
import './dialog.css';

// 确认/输入对话框参数
export interface PromptDialogOptions {
    readonly title: string;
    readonly message?: string;
    // 提供时展示输入框（重命名/新建等命名场景）
    readonly initialInput?: string;
    readonly inputPlaceholder?: string;
    readonly confirmLabel: string;
    readonly cancelLabel?: string;
    // 提供时展示第二确认项（删除连目录场景）
    readonly extraCheckLabel?: string;
    readonly danger?: boolean;
}

// 对话框结果
export interface PromptDialogResult {
    readonly confirmed: boolean;
    readonly inputValue?: string;
    readonly extraChecked?: boolean;
}

/**
 * 模态对话框：确认 / 单输入 / 附加勾选三合一。
 * Esc 与遮罩点击 = 取消。
 *
 * @param options - 文案与交互配置。
 * @param onDone - 关闭时回调结果。
 * @returns 对话框 JSX。
 */
export const PromptDialog = ({options, onDone}: {
    options: PromptDialogOptions;
    onDone: (result: PromptDialogResult) => void;
}): React.JSX.Element => {
    const [value, setValue] = useState(options.initialInput ?? '');
    const [extra, setExtra] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (options.initialInput !== undefined) {
            inputRef.current?.focus();
        }
    }, [options.initialInput]);

    const close = (confirmed: boolean) => {
        onDone({
            confirmed,
            inputValue: options.initialInput === undefined ? undefined : value,
            extraChecked: options.extraCheckLabel ? extra : undefined
        });
    };

    return (
        <div
            className="tesslo-dialog-overlay"
            onClick={event => {
                if (event.target === event.currentTarget) close(false);
            }}
        >
            <div className="tesslo-dialog" role="dialog" aria-modal="true">
                <h2 className="tesslo-dialog-title">{options.title}</h2>
                {options.message ?
                    <p className="tesslo-dialog-message">{options.message}</p> : null}
                {options.initialInput !== undefined ? (
                    <input
                        ref={inputRef}
                        className="tesslo-dialog-input"
                        type="text"
                        value={value}
                        placeholder={options.inputPlaceholder}
                        onChange={event => setValue(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') close(true);
                            if (event.key === 'Escape') close(false);
                        }}
                    />
                ) : null}
                {options.extraCheckLabel ? (
                    <label className="tesslo-dialog-check">
                        <input
                            type="checkbox"
                            checked={extra}
                            onChange={event => setExtra(event.target.checked)}
                        />
                        <span>{options.extraCheckLabel}</span>
                    </label>
                ) : null}
                <div className="tesslo-dialog-actions">
                    <button
                        type="button"
                        className="tesslo-dialog-button"
                        onClick={() => close(false)}
                    >
                        {options.cancelLabel ?? '取消'}
                    </button>
                    <button
                        type="button"
                        className={`tesslo-dialog-button tesslo-dialog-button-primary${
                            options.danger ? ' tesslo-dialog-button-danger' : ''}`}
                        onClick={() => close(true)}
                    >
                        {options.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 提示弹窗参数（错误/校验提示统一出口；不再用页面内横幅）
export interface AlertDialogProps {
    readonly title: string;
    readonly message: string;
    readonly onClose: () => void;
}

/**
 * 提示弹窗：单按钮、role=alertdialog。
 * 点击遮罩或"知道了"关闭；stopPropagation 保证不误关下层弹窗。
 *
 * @param props - 标题、正文与关闭回调。
 * @returns 弹窗 JSX。
 */
export const AlertDialog = ({title, message, onClose}: AlertDialogProps): React.JSX.Element => (
    <div
        className="tesslo-dialog-overlay tesslo-alert-overlay"
        onClick={event => {
            event.stopPropagation();
            onClose();
        }}
    >
        <div
            className="tesslo-dialog tesslo-alert-dialog"
            role="alertdialog"
            aria-modal="true"
            onClick={event => event.stopPropagation()}
        >
            <h2 className="tesslo-dialog-title">{title}</h2>
            <p className="tesslo-dialog-message">{message}</p>
            <div className="tesslo-dialog-actions">
                <button
                    type="button"
                    className="tesslo-dialog-button tesslo-dialog-button-primary"
                    onClick={onClose}
                >
                    知道了
                </button>
            </div>
        </div>
    </div>
);
