import {WebSocketServer} from 'ws';

import {BleSession} from './ble-session.js';
import {BtSession} from './bt-session.js';
import {OhosBleAdapter, hasOhosBle} from './ohos-ble.js';
import {RpcError, RpcErrorCode, parseRpcMessage, rpcError, rpcResult} from './jsonrpc.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 20111;

const createSession = type => {
    if (type === 'ble') {
        return new BleSession(hasOhosBle() ? new OhosBleAdapter() : undefined);
    }
    return new BtSession();
};

export const createScratchLinkServer = ({
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    logger = console
} = {}) => {
    const wss = new WebSocketServer({host, port});

    wss.on('connection', (socket, request) => {
        const pathname = new URL(request.url, `ws://${host}`).pathname;
        let type;
        if (pathname === '/scratch/ble') type = 'ble';
        else if (pathname === '/scratch/bt') type = 'bt';
        else {
            socket.close(1008, `unsupported path: ${pathname}`);
            return;
        }

        const session = createSession(type);
        session.on('notification', (method, params) => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({jsonrpc: '2.0', method, params}));
            }
        });

        socket.on('message', async raw => {
            let message;
            try {
                message = parseRpcMessage(raw.toString());
            } catch (error) {
                const id = null;
                const code = error instanceof RpcError ? error.code : RpcErrorCode.PARSE_ERROR;
                socket.send(JSON.stringify(rpcError(id, code, error.message)));
                return;
            }

            // Notifications from the client have no id; Scratch Link does not need to answer them.
            if (message.id === undefined) return;

            try {
                const result = await session.handle(message.method, message.params);
                socket.send(JSON.stringify(rpcResult(message.id, result)));
            } catch (error) {
                const code = error instanceof RpcError ? error.code : RpcErrorCode.SERVER_ERROR;
                const data = error instanceof RpcError ? error.data : undefined;
                socket.send(JSON.stringify(rpcError(message.id, code, error.message, data)));
            }
        });

        socket.on('close', () => session.dispose());
        socket.on('error', error => logger.warn?.(`[scratch-link] socket error: ${error.message}`));
    });

    wss.on('error', error => logger.error?.(`[scratch-link] server error: ${error.message}`));

    return {
        wss,
        start: () => new Promise((resolve, reject) => {
            if (wss.address()) return resolve(wss.address());
            wss.once('listening', () => resolve(wss.address()));
            wss.once('error', reject);
        }),
        stop: () => new Promise(resolve => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => resolve());
        }),
        address: () => wss.address()
    };
};

export const startScratchLinkServer = async options => {
    const server = createScratchLinkServer(options);
    await server.start();
    return server;
};
