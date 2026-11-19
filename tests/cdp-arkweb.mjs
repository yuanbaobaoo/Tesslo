// ArkWeb CDP 远程验证工具（dev 构建 setWebDebuggingAccess）：
// 用法 node tests/cdp-arkweb.mjs <cdp-base> <js-expression>
// 输出 evaluate 结果 JSON；截图模式：node tests/cdp-arkweb.mjs <base> --screenshot <out.png>
import {writeFileSync} from 'node:fs';

const [base, expr, out, widthArg] = process.argv.slice(2);
if (!base || !expr) {
    console.error('usage: node cdp-arkweb.mjs <cdp-base> <expr|--screenshot> [out.png]');
    process.exit(2);
}

const list = await fetch(`${base}/json`).then(r => r.json());
const page = list.find(t => t.type === 'page');
if (!page) {
    console.error('no page target; targets:', JSON.stringify(list).slice(0, 300));
    process.exit(3);
}
console.error('target:', page.title, page.url.slice(0, 80));

const ws = new WebSocket(page.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, {resolve, reject});
    ws.send(JSON.stringify({id, method, params}));
});
const consoleLogs = [];
ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
        consoleLogs.push(`[${msg.params.type}] ` + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleLogs.push('[exception] ' + (d.text ?? '') + ' ' + (d.exception?.description ?? '').split('\n').slice(0, 5).join(' | '));
    }
    if (msg.id && pending.has(msg.id)) {
        const {resolve, reject} = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
            reject(new Error(JSON.stringify(msg.error)));
        } else {
            resolve(msg.result);
        }
    }
};
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("ws error"));
});

if (expr === '--screenshot') {
    await send('Page.enable');
    if (widthArg) {
        // 响应式验证：限定视口宽度（高度按 16:10 估算）
        const width = Number(widthArg);
        await send('Emulation.setDeviceMetricsOverride', {
            width,
            height: Math.round(width * 0.625),
            deviceScaleFactor: 1,
            mobile: false
        });
        console.error('emulated viewport width:', width);
    }
    const result = await send('Page.captureScreenshot', {format: 'png'});
    writeFileSync(out ?? 'cdp-shot.png', Buffer.from(result.data, 'base64'));
    console.error('screenshot saved:', out ?? 'cdp-shot.png');
} else {
    await send('Runtime.enable');
    const result = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
    });
    console.log(JSON.stringify(result.result?.value ?? result, null, 2).slice(0, 2000));
    console.error('--- console 捕获 ---');
    for (const line of consoleLogs.slice(-40)) console.error(line);
}
ws.close();
process.exit(0);
