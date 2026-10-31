import { webview } from '@kit.ArkWeb';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import fs from '@ohos.file.fs';

import { log } from '../common/AppLog';

// 注入 WebView 的 WebGL 能力探测脚本：结果写入设备日志，用于真机排查 GPU 渲染问题
const WEBGL_PROBE = `(() => {
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  const gl = gl2 || canvas.getContext('webgl');
  return JSON.stringify({
    webgl: !!gl,
    webgl2: !!gl2,
    renderer: gl ? gl.getParameter(gl.RENDERER) : null,
    vendor: gl ? gl.getParameter(gl.VENDOR) : null
  });
})()`;

@Entry
@Component
struct Index {
  // 全屏沉浸布局下，编辑器需自行避让顶部系统状态栏；
  // 自由多窗等形态下窗口不再与状态栏重叠，避让高度需动态跟随
  @State private statusBarInsetVp: number = 0;
  private controller: webview.WebviewController = new webview.WebviewController();
  private mainWindow: window.Window | null = null;

  /**
   * 页面创建后触发：获取主窗口并监听避让区/尺寸变化；
   * 不宜 async，监听逻辑放到私有异步方法，失败仅记录。
   */
  aboutToAppear(): void {
    this.watchMainWindow().catch((error: Error) => {
      log(`watch main window failed: ${error.message}`);
    });
  }

  /**
   * 页面销毁前触发：解除窗口事件监听，避免回调悬挂。
   */
  aboutToDisappear(): void {
    if (this.mainWindow) {
      try {
        this.mainWindow.off('avoidAreaChange');
        this.mainWindow.off('windowSizeChange');
      } catch (error) {
        log(`unlisten window events failed: ${(error as BusinessError).message}`);
      }
    }
  }

  build() {
    Column() {
      Web({src: $rawfile('index.html'), controller: this.controller})
        .onControllerAttached(() => this.registerDownloadDelegate())
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .mixedMode(MixedMode.All)
        .darkMode(WebDarkMode.Auto)
        .onPageBegin(() => log('page begin'))
        .onPageEnd(() => {
          log('page end');
          this.controller.runJavaScript(WEBGL_PROBE, (error: BusinessError, result: string) => {
            if (error) {
              log(`webgl probe failed: ${error.message}`);
            } else {
              log(`webgl probe ${result}`);
            }
          });
        })
        .onConsole((event) => {
          const message: string = event?.message?.getMessage() ?? '';
          if (/error|failed|warn/i.test(message)) {
            log(`console ${message.substring(0, 200)}`);
          }
          return false;
        })
        .onErrorReceive((event) => {
          log(`web error ${event?.error?.getErrorInfo() ?? 'unknown'}`);
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .padding({top: this.statusBarInsetVp})
    .backgroundColor('#000000')
  }

  /**
   * 拿到主窗口后同步一次避让区，并注册窗口变化监听。
   */
  private async watchMainWindow(): Promise<void> {
    const win: window.Window = await window.getLastWindow(getContext(this));
    this.mainWindow = win;
    this.syncStatusBarInset();
    // 窗口形态切换（全屏 <-> 自由多窗）时避让区会变化，动态跟随
    win.on('avoidAreaChange', () => this.syncStatusBarInset());
    win.on('windowSizeChange', () => this.syncStatusBarInset());
  }

  /**
   * 读取系统避让区高度并刷新 @State，驱动顶部内边距避让。
   */
  private syncStatusBarInset(): void {
    if (!this.mainWindow) return;
    try {
      const area: window.AvoidArea =
        this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      // 系统避让区以 px 返回；仅此一处换算，如再增多应抽到 common 统一封装（§9）
      const insetVp: number = px2vp(area.topRect.height);
      if (insetVp !== this.statusBarInsetVp) {
        this.statusBarInsetVp = insetVp;
        log(`status bar inset -> ${insetVp}vp`);
      }
    } catch (error) {
      log(`sync status bar inset failed: ${(error as BusinessError).message}`);
    }
  }

  /**
   * 注册下载代理：sb3 导出等下载统一起到应用沙箱 Download 目录。
   */
  private registerDownloadDelegate(): void {
    const delegate: webview.WebDownloadDelegate = new webview.WebDownloadDelegate();
    delegate.onBeforeDownload((item: webview.WebDownloadItem) => {
      const suggested: string = item.getSuggestedFileName() || 'tesslo.sb3';
      // 下载文件名只落应用沙箱，仍过滤非法字符避免目录逃逸
      const name: string = suggested.replace(/[\\/:*?"<>|]/g, '_');
      const dir: string = `${getContext(this).filesDir}/Download`;
      const target: string = `${dir}/${name}`;
      try {
        fs.mkdirSync(dir, true);
        item.start(target);
        log(`download start ${target}`);
      } catch (error) {
        log(`download failed: ${error.message}`);
        item.cancel();
      }
    });
    delegate.onDownloadFinish((item: webview.WebDownloadItem) => {
      log(`download finish ${item.getUrl()}`);
    });
    delegate.onDownloadFailed((item: webview.WebDownloadItem) => {
      log(`download failed ${item.getUrl()} code=${item.getLastErrorCode()}`);
    });
    this.controller.setDownloadDelegate(delegate);
  }
}
