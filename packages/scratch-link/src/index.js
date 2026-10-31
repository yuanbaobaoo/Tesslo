// 包导出入口：server 工厂、BLE/BT 会话与模拟适配器、OHOS 桥适配器、JSON-RPC 工具
export {createScratchLinkServer, startScratchLinkServer} from './server.js';
export {BleSession} from './ble-session.js';
export {BtSession, FakeBtAdapter} from './bt-session.js';
export {FakeBleAdapter, MICROBIT_SERVICE, MICROBIT_WRITE_CHARACTERISTIC, MICROBIT_NOTIFY_CHARACTERISTIC} from './fake-ble.js';
export {RpcError, RpcErrorCode} from './jsonrpc.js';
export {OhosBleAdapter, hasOhosBle} from './ohos-ble.js';
