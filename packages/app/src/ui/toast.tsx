// 轻量成功提示（导出完成等）：固定底部居中的胶囊，自动消失。
// 错误仍用 AlertDialog；这里只承载"做成了"的正向反馈。
import React, {useEffect, useRef} from 'react';
import './toast.css';

// 提示参数
export interface ToastProps {
    readonly message: string;
    readonly onDone: () => void;
}

// 展示时长
const TOAST_MS = 2400;

/**
 * 自动消失的成功提示。
 *
 * @param props - 文案与消失回调。
 * @returns 提示 JSX。
 */
export const Toast = ({message, onDone}: ToastProps): React.JSX.Element => {
    // 回调用 ref 保最新，避免父组件重渲染重置倒计时
    const doneRef = useRef(onDone);
    doneRef.current = onDone;
    useEffect(() => {
        const timer = window.setTimeout(() => doneRef.current(), TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [message]);
    return (
        <div className="tesslo-toast" role="status" aria-live="polite">
            <span className="tesslo-toast-check" aria-hidden="true">✓</span>
            {message}
        </div>
    );
};
