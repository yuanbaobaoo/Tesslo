// gui dist（主出口）内嵌 webpack runtime 的 publicPath 为 'auto'，
// 依赖 document.currentScript 推导——在本 bundle 的 CJS require 场景为 null，
// runtime 初始化即抛 "Automatic publicPath is not supported in this browser"。
// 这里用带 src 的形状对象覆盖只读 getter（页面自身 URL），publicPath 推导为
// 当前目录；播放端全部资源已内联，publicPath 不会被真正用于网络请求。
const fake = document.createElement('script');
fake.setAttribute('src', location.href);
Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: (): Element => fake
});
