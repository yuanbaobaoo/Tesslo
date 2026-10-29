import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import fs from '@ohos.file.fs';

import { log } from '../common/AppLog';

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
  private controller: webview.WebviewController = new webview.WebviewController();

  private registerDownloadDelegate(): void {
    const delegate: webview.WebDownloadDelegate = new webview.WebDownloadDelegate();
    delegate.onBeforeDownload((item: webview.WebDownloadItem) => {
      const suggested: string = item.getSuggestedFileName() || 'tesslo.sb3';
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
          if (message.toLowerCase().includes('error')) {
            log(`console ${message}`);
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
  }
}
