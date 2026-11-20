import PropTypes from 'prop-types';
import React from 'react';
import ReactModal from 'react-modal';
import Box from '../box/box.jsx';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';

import styles from './webgl-modal.css';

const messages = defineMessages({
    label: {
        id: 'gui.webglModal.label',
        defaultMessage: 'Your Browser Does Not Support WebGL',
        description: 'WebGL missing title'
    }
});

const WebGlModal = props => {
    const intl = useIntl();
    return (
        <ReactModal
            isOpen
            className={styles.modalContent}
            contentLabel={intl.formatMessage({...messages.label})}
            overlayClassName={styles.modalOverlay}
            onRequestClose={props.onBack}
        >
            <div dir={props.isRtl ? 'rtl' : 'ltr'}>
                <Box className={styles.illustration} />

                <Box className={styles.body}>
                    <h2>
                        <FormattedMessage {...messages.label} />
                    </h2>
                    <p className={styles.description}>
                        <FormattedMessage
                            defaultMessage="Tesslo needs WebGL to draw the stage. Please use a browser that supports WebGL."
                            description="Explanation shown when WebGL is unavailable"
                            id="gui.webglModal.description"
                        />
                    </p>
                    <Box className={styles.buttonRow}>
                        <button
                            className={styles.backButton}
                            onClick={props.onBack}
                        >
                            <FormattedMessage
                                defaultMessage="Back"
                                description="Label for button go back when browser is unsupported"
                                id="gui.webglModal.back"
                            />
                        </button>

                    </Box>
                </Box>
            </div>
        </ReactModal>
    );
};

WebGlModal.propTypes = {
    isRtl: PropTypes.bool,
    onBack: PropTypes.func.isRequired
};

export default WebGlModal;
