import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { BusinessError } from '@kit.BasicServicesKit';
import * as tesslolink from 'libtesslolink.so';

import { log } from '../common/AppLog';
import { startTessloBleBridge } from '../ble/BleTcpBridge';
import { startAssetServer } from '../assets/AssetServer';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    log('boot arkweb');
    const wantSim = want.parameters?.['tessloBleSim'];
    const simulate = deviceInfo.productModel === 'emulator' || wantSim === 'true' || wantSim === true;
    // 蓝牙权限不在此处申请：由 BLE 桥在真正收到 scan/connect 请求时再向用户申请
    startTessloBleBridge(20113, simulate, this.context)
      .then(() => log(`BLE bridge listening simulate=${simulate}`))
      .catch((error: BusinessError) => log(`BLE bridge failed: ${error.message}`));
    startAssetServer(this.context, 20114)
      .catch((error: BusinessError) => log(`asset server failed: ${error.message}`));
    try {
      const status: number = tesslolink.start(20111);
      log(`C# Scratch Link status=${status}`);
    } catch (error) {
      log(`C# Scratch Link failed: ${error.message}`);
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    try {
      // 全屏沉浸布局：内容铺满整屏（底部不让出导航区、无白条），
      // 顶部由 Index 页面用安全区内边距避让状态栏；
      // 状态栏纯黑底 + 白色图标，与菜单栏形成强对比
      windowStage.getMainWindowSync().setWindowLayoutFullScreen(true);
      windowStage.getMainWindowSync().setWindowSystemBarProperties({
        statusBarColor: '#000000',
        statusBarContentColor: '#FFFFFF',
        navigationBarColor: '#000000',
        navigationBarContentColor: '#FFFFFF'
      });
    } catch (error) {
      log(`window layout failed: ${error.message}`);
    }
    windowStage.loadContent('pages/Index', (error: BusinessError) => {
      if (error.code) {
        log(`loadContent failed: ${error.code} ${error.message}`);
      }
    });
  }

  onDestroy(): void {
    try {
      tesslolink.stop();
    } catch (error) {
      log(`C# Scratch Link stop failed: ${error.message}`);
    }
  }
}
