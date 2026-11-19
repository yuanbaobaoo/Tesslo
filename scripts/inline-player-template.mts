// 播放端模板内联：web/dist/static/fetched/player.js → player-template.html。
// 模板结构 = 骨架 + 占位数据块 + 内联 bundle；导出器（web 装配层）替换占位符。
// 运行：node scripts/inline-player-template.mts（build:player 链自动调用）
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const webDir: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/host/ohos/web');
const bundlePath: string = path.join(webDir, 'dist/static/fetched/player.js');
const templatePath: string = path.join(webDir, 'dist/static/fetched/player-template.html');
// player.css 随 bundle 由 style-loader 内联，无需重复引入

const bundle: string = fs.readFileSync(bundlePath, 'utf8');
// </script> 截断防护（JS 字符串内 <\/script> 等价）
if (bundle.includes('</scr' + 'ipt>')) {
    throw new Error('player bundle contains raw </script>; escaping not implemented for bundle');
}
const safeBundle: string = bundle.replace(/<\/script>/g, '<\\/script>');
// 防御：若上面替换真的生效（理论上 bundle 内不该有明文闭合标签），说明依赖了转义等价性
if (safeBundle !== bundle) {
    console.warn('[inline-player] bundle contained </script> and was escaped');
}

const template: string = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<meta name="generator" content="Tesslo">
<title>__TESSLO_PLAYER_TITLE__</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#4d97ff}
#app{width:100vw;height:100vh}
</style>
</head>
<body>
<div id="app">正在加载作品…</div>
<script type="application/json" id="tesslo-player-data">/*__TESSLO_PLAYER_DATA__*/</script>
<script>${safeBundle}</script>
</body>
</html>
`;

fs.writeFileSync(templatePath, template);
const sizeMb: number = fs.statSync(templatePath).size / 1024 / 1024;
console.log(`[inline-player] template written: ${templatePath} (${sizeMb.toFixed(1)} MB)`);
