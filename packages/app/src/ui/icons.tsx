// Tesslo 线性图标（currentColor，避免系统 emoji 的彩色渲染破坏配色）。
// 统一 24×24 viewBox；默认 16–18px，用于卡片工具栏与更多菜单。
import React from 'react';

// 图标参数
export interface IconProps {
    readonly size?: number;
}

// 统一 SVG 外观参数（线宽 2，圆角端点，随文字颜色）
const lineProps = (size: number): Record<string, unknown> => ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false
});

/**
 * 导出（下载）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const DownloadIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <path d='M12 3v12' />
        <path d='m7 10 5 5 5-5' />
        <path d='M5 21h14' />
    </svg>
);

/**
 * 历史版本（时钟）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const HistoryIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <circle cx='12' cy='12' r='8.5' />
        <path d='M12 7.5V12l3 2' />
    </svg>
);

/**
 * 更多（三点）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const MoreIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <circle cx='5' cy='12' r='1.6' fill='currentColor' stroke='none' />
        <circle cx='12' cy='12' r='1.6' fill='currentColor' stroke='none' />
        <circle cx='19' cy='12' r='1.6' fill='currentColor' stroke='none' />
    </svg>
);

/**
 * 收藏（星）图标；filled 为实心。
 *
 * @param props - 尺寸与是否实心。
 * @returns SVG。
 */
export const StarIcon = ({size = 16, filled = false}: IconProps & {readonly filled?: boolean}): React.JSX.Element => (
    <svg {...lineProps(size)} fill={filled ? 'currentColor' : 'none'}>
        <path d='M12 3.6l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z' />
    </svg>
);

/**
 * 重命名（铅笔）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const PencilIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <path d='M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z' />
        <path d='M14.5 6.5l3 3' />
    </svg>
);

/**
 * 复制（双页）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const CopyIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <rect x='9' y='9' width='11' height='11' rx='2' />
        <path d='M15 6V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1' />
    </svg>
);

/**
 * 进入（右箭头）图标：卡片可点击的轻量指示。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const ChevronRightIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <path d='m9 5 7 7-7 7' />
    </svg>
);

/**
 * 删除（垃圾桶）图标。
 *
 * @param props - 尺寸。
 * @returns SVG。
 */
export const TrashIcon = ({size = 16}: IconProps): React.JSX.Element => (
    <svg {...lineProps(size)}>
        <path d='M4 7h16' />
        <path d='M10 4h4' />
        <path d='M6 7l1 13h10l1-13' />
        <path d='M10 11v6' />
        <path d='M14 11v6' />
    </svg>
);
