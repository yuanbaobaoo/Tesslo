import PropTypes from 'prop-types';
import React from 'react';

const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)'
};

const modalStyle = {
    width: 420,
    maxWidth: '86vw',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#fff',
    boxShadow: '0 8px 40px rgba(0, 0, 0, 0.35)',
    fontFamily:
        '"Helvetica Neue", "Helvetica", "Arial", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
};

const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    backgroundColor: '#4c97ff',
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold'
};

const closeButtonStyle = {
    width: 24,
    height: 24,
    lineHeight: '22px',
    textAlign: 'center',
    borderRadius: 12,
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer'
};

const bodyStyle = {
    padding: '28px 24px 20px',
    textAlign: 'center'
};

const logoStyle = {
    maxWidth: 240,
    width: '60%',
    marginBottom: 18
};

const titleStyle = {
    margin: '0 0 6px',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#575e75'
};

const versionStyle = {
    margin: '0 0 20px',
    fontSize: 13,
    color: '#9aa0b4'
};

const linkRowStyle = {
    margin: '0 0 8px',
    fontSize: 13,
    color: '#575e75',
    wordBreak: 'break-all'
};

const linkStyle = {
    color: '#4c97ff',
    textDecoration: 'none'
};

const footerStyle = {
    padding: '10px 20px',
    borderTop: '1px solid #eceff4',
    backgroundColor: '#fafbfc',
    fontSize: 12,
    color: '#9aa0b4'
};

const AboutModal = ({logo, onRequestClose}) => (
    <div
        style={overlayStyle}
        onClick={onRequestClose}
        role="presentation"
    >
        <div
            style={modalStyle}
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="About Tesslo"
        >
            <div style={headerStyle}>
                <span>关于 Tesslo</span>
                <button
                    style={closeButtonStyle}
                    type="button"
                    aria-label="关闭"
                    onClick={onRequestClose}
                >
                    ×
                </button>
            </div>
            <div style={bodyStyle}>
                {logo ? (
                    <img
                        src={logo}
                        alt="Tesslo"
                        style={logoStyle}
                        draggable={false}
                    />
                ) : null}
                <h1 style={titleStyle}>Tesslo</h1>
                <p style={versionStyle}>版本 0.1.0</p>
                <p style={linkRowStyle}>
                    {'GitHub：'}
                    <a
                        href="https://github.com/yuanbaobaoo/Tesslo"
                        target="_blank"
                        rel="noreferrer"
                        style={linkStyle}
                    >
                        github.com/yuanbaobaoo/Tesslo
                    </a>
                </p>
                <p style={linkRowStyle}>开源协议：AGPL-3.0</p>
            </div>
            <div style={footerStyle}>Powered by Scratch</div>
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
