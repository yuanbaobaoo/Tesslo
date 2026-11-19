// “关于 Tesslo” 弹窗（产品层共享：列表页与工作台导航条“关于”共用）。
import React from 'react';

import './about-modal.css';

// Tesslo 应用版本（webpack DefinePlugin 注入）
declare const __TESSLO_VERSION__: string;

// 关于弹窗参数
export interface AboutModalProps {
    readonly logo?: string;
    readonly onRequestClose: () => void;
}

/**
 * “关于 Tesslo” 弹窗：点击遮罩或关闭按钮时回调 onRequestClose。
 *
 * @param props - logo 与关闭回调。
 * @returns 弹窗 JSX。
 */
const AboutModal = ({logo, onRequestClose}: AboutModalProps): React.JSX.Element => (
  <div
    className="tesslo-about-overlay"
    onClick={onRequestClose}
    role="presentation"
  >
    <div
      className="tesslo-about-modal"
      onClick={event => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="About Tesslo"
    >
      <div className="tesslo-about-header">
        <span>关于 Tesslo</span>
        <button
          className="tesslo-about-close"
          type="button"
          aria-label="关闭"
          onClick={onRequestClose}
        >
          ×
        </button>
      </div>
      <div className="tesslo-about-body">
        {logo ? (
          <img
            src={logo}
            alt="Tesslo"
            className="tesslo-about-logo"
            draggable={false}
          />
        ) : null}
        <h1 className="tesslo-about-title">Tesslo</h1>
        <p className="tesslo-about-version">版本 {__TESSLO_VERSION__}</p>
        <p className="tesslo-about-link-row">
          {'GitHub：'}
          <a
            href="https://github.com/yuanbaobaoo/Tesslo"
            target="_blank"
            rel="noreferrer"
            className="tesslo-about-link"
          >
            https://github.com/yuanbaobaoo/Tesslo
          </a>
        </p>
        <p className="tesslo-about-link-row">开源协议：AGPL-3.0</p>
      </div>
      <div className="tesslo-about-footer">
        <a
          href="https://github.com/scratchfoundation"
          target="_blank"
          rel="noreferrer"
          className="tesslo-about-link"
        >
          Powered by Scratch
        </a>
      </div>
    </div>
  </div>
);

export default AboutModal;
