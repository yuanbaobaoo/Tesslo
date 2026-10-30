/**
 * This class provides a ScratchLinkSocket implementation using WebSockets,
 * attempting to connect with the locally installed Scratch-Link.
 *
 * To connect with ScratchLink without WebSockets, you must implement all of the
 * public methods in this class.
 * - open()
 * - close()
 * - setOn[Open|Close|Error]
 * - setHandleMessage
 * - sendMessage(msgObj)
 * - isOpen()
 */
class ScratchLinkWebSocket {
    constructor (type) {
        this._type = type;
        this._onOpen = null;
        this._onClose = null;
        this._onError = null;
        this._handleMessage = null;

        this._ws = null;
    }

    open () {
        if (!(this._onOpen && this._onClose && this._onError && this._handleMessage)) {
            throw new Error('Must set open, close, message and error handlers before calling open on the socket');
        }

        let pathname;
        switch (this._type) {
        case 'BLE':
            pathname = 'scratch/ble';
            break;
        case 'BT':
            pathname = 'scratch/bt';
            break;
        default:
            throw new Error(`Unknown ScratchLink socket Type: ${this._type}`);
        }

        // Tesslo 只连接设备内的 Scratch Link 桥（packages/scratch-link 的 C# 服务，
        // 由 EntryAbility 启动并监听 127.0.0.1:20111）。
        // 不再同时竞速连接官方云端 device-manager——离线无意义，联网时还会把
        // 外设流量意外路由到 Scratch 官方服务器。

        this._ws = new WebSocket(`ws://127.0.0.1:20111/${pathname}`);

        const connectTimeout = setTimeout(() => {
            this._ws.onopen = this._ws.onclose = this._ws.onerror = null;
            this._ws.close();
            this._onError(new Event('timeout'));
        }, 15 * 1000);

        this._ws.onopen = openEvent => {
            clearTimeout(connectTimeout);
            this._ws.onclose = this._onClose;
            this._ws.onerror = this._onError;
            this._ws.onmessage = this._onMessage.bind(this);
            this._onOpen(openEvent);
        };
        this._ws.onerror = errorEvent => {
            clearTimeout(connectTimeout);
            this._onError(errorEvent);
        };
    }

    close () {
        this._ws.close();
        this._ws = null;
    }

    sendMessage (message) {
        const messageText = JSON.stringify(message);
        this._ws.send(messageText);
    }

    setOnOpen (fn) {
        this._onOpen = fn;
    }

    setOnClose (fn) {
        this._onClose = fn;
    }

    setOnError (fn) {
        this._onError = fn;
    }

    setHandleMessage (fn) {
        this._handleMessage = fn;
    }

    isOpen () {
        return this._ws && this._ws.readyState === this._ws.OPEN;
    }

    _onMessage (e) {
        const json = JSON.parse(e.data);
        this._handleMessage(json);
    }
}

module.exports = ScratchLinkWebSocket;
