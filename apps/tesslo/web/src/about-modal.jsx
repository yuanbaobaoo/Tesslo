import PropTypes from 'prop-types';
import React from 'react';

import './about-modal.css';

/**
 * “关于 Tesslo” 弹窗：点击遮罩或关闭按钮时回调 onRequestClose。
 */
const AboutModal = ({logo, onRequestClose}) => (
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
        <p className="tesslo-about-version">版本 0.1.0</p>
        <p className="tesslo-about-link-row">
          {'GitHub：'}
          <a
            href="https://github.com/yuanbaobaoo/Tesslo"
            target="_blank"
            rel="noreferrer"
            className="tesslo-about-link"
          >
            github.com/yuanbaobaoo/Tesslo
          </a>
        </p>
        <p className="tesslo-about-link-row">开源协议：AGPL-3.0</p>
      </div>
      <div className="tesslo-about-footer">Powered by Scratch</div>
    </div>
  </div>
);

AboutModal.propTypes = {
  logo: PropTypes.string,
  onRequestClose: PropTypes.func.isRequired
};

AboutModal.defaultProps = {
  logo: null
};

export default AboutModal;
