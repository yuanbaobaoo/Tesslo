// 作品卡片"更多"菜单：PC（鼠标）锚定在下拉，触屏（无 hover）变成底部动作面板。
// 所有条目都是"图标 + 文字"，不依赖 hover 才能理解；触屏条目 ≥48px。
import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ProjectSummary} from '@tesslo/platform-adapter';
import {CopyIcon, PencilIcon, StarIcon, TrashIcon} from '../ui/icons.tsx';

// 菜单参数
export interface ProjectCardMenuProps {
    readonly project: ProjectSummary;
    // "更多"按钮（下拉定位用）
    readonly anchor: HTMLButtonElement;
    readonly onClose: () => void;
    readonly onToggleFavorite: () => void;
    readonly onRename: () => void;
    readonly onDuplicate: () => void;
    readonly onDelete: () => void;
}

// 菜单条目
interface MenuItem {
    readonly icon: React.ReactNode;
    readonly label: string;
    readonly danger?: boolean;
    readonly run: () => void;
}

// 精细指针（有鼠标/触控板）：用锚定下拉；否则用底部动作面板
const hasFinePointer = (): boolean =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// 下拉尺寸估算（用于上下翻转；条目 4 个 × 48 + padding）
const DROPDOWN_WIDTH = 200;
const DROPDOWN_HEIGHT = 224;

/**
 * 卡片更多操作菜单（Portal 到 body，避免被卡片裁剪）。
 *
 * @param props - 项目、锚点与各动作回调。
 * @returns 菜单 JSX。
 */
export const ProjectCardMenu = ({project, anchor, onClose, onToggleFavorite,
    onRename, onDuplicate, onDelete}: ProjectCardMenuProps): React.JSX.Element => {
    const finePointer = hasFinePointer();
    const [position] = useState<{left: number; top: number} | null>(() => {
        if (!finePointer) {
            return null;
        }
        const rect = anchor.getBoundingClientRect();
        const left = Math.min(
            Math.max(8, rect.right - DROPDOWN_WIDTH),
            window.innerWidth - DROPDOWN_WIDTH - 8
        );
        const fitsBelow = rect.bottom + DROPDOWN_HEIGHT + 8 <= window.innerHeight;
        const top = fitsBelow
            ? rect.bottom + 6
            : Math.max(8, rect.top - DROPDOWN_HEIGHT - 6);
        return {left, top};
    });
    const firstItemRef = useRef<HTMLButtonElement | null>(null);

    // Esc 关闭 + 下拉时滚动/缩放关闭（避免锚点错位）
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        if (finePointer) {
            const close = (): void => onClose();
            window.addEventListener('resize', close);
            window.addEventListener('scroll', close, true);
            return () => {
                window.removeEventListener('keydown', onKeyDown);
                window.removeEventListener('resize', close);
                window.removeEventListener('scroll', close, true);
            };
        }
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [finePointer, onClose]);

    // 打开时聚焦第一项（键盘可达）
    useEffect(() => {
        firstItemRef.current?.focus();
    }, []);

    const select = (run: () => void): void => {
        onClose();
        run();
    };

    const items: MenuItem[] = [
        {
            icon: <StarIcon filled={project.favorite} />,
            label: project.favorite ? '取消收藏' : '收藏',
            run: onToggleFavorite
        },
        {icon: <PencilIcon />, label: '重命名', run: onRename},
        {icon: <CopyIcon />, label: '复制', run: onDuplicate},
        {icon: <TrashIcon />, label: '删除', danger: true, run: onDelete}
    ];

    return createPortal(
        <div className="tesslo-card-menu-layer">
            <div
                className={`tesslo-card-menu-backdrop${finePointer ? '' : ' is-sheet'}`}
                onClick={onClose}
            />
            <div
                className={`tesslo-card-menu${finePointer ? ' is-dropdown' : ' is-sheet'}`}
                style={finePointer && position !== null
                    ? {left: `${position.left}px`, top: `${position.top}px`}
                    : undefined}
                role="menu"
                aria-label={`${project.name} 的操作`}
            >
                {finePointer ? null : (
                    <>
                        <span className="tesslo-card-menu-handle" aria-hidden="true" />
                        <div className="tesslo-card-menu-title">{project.name}</div>
                    </>
                )}
                <div className="tesslo-card-menu-items">
                    {items.map((item, index) => (
                        <button
                            key={item.label}
                            ref={index === 0 ? firstItemRef : undefined}
                            type="button"
                            className={`tesslo-card-menu-item${item.danger ? ' is-danger' : ''}`}
                            role="menuitem"
                            onClick={() => select(item.run)}
                        >
                            <span className="tesslo-card-menu-icon" aria-hidden="true">{item.icon}</span>
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
};
