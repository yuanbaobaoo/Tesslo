import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { deviceInfo, BusinessError } from '@kit.BasicServicesKit';
import * as tesslolink from 'libtesslolink.so';

import { log } from '../common/AppLog';
import { ASSET_SERVER_PORT, BLE_BRIDGE_PORT, LINK_PORT } from '../common/Ports';
import { startTessloBleBridge, stopTessloBleBridge } from '../ble/BleTcpBridge';
import { startAssetServer, stopAssetServer } from '../assets/AssetServer';

export default class EntryAbility extends UIAbility {
  /**
   * Ability 首次创建时触发：拉起本地服务与 C# Link；蓝牙权限由桥按需再申请。
   */
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    log('boot arkweb');
    const wantSim = want.parameters?.['tessloBleSim'];
    const simulate = deviceInfo.productModel === 'emulator' || wantSim === 'true' || wantSim === true;
    // 蓝牙权限不在此处申请：由 BLE 桥在真正收到 scan/connect 请求时再向用户申请
    this.startLocalServices(simulate);
    try {
      const status: number = tesslolink.start(LINK_PORT);
      log(`C# Scratch Link status=${status}`);
    } catch (error) {
      log(`C# Scratch Link failed: ${error.message}`);
    }
  }

  /**
   * 主窗口就绪时触发：设置沉浸式布局与系统栏配色，随后加载编辑器页面。
   */
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

  /**
   * Ability 销毁时触发：停 C# Link 并成对关闭两个本地服务。
   */
  onDestroy(): void {
    try {
      tesslolink.stop();
    } catch (error) {
      log(`C# Scratch Link stop failed: ${error.message}`);
    }
    // 与 onCreate 成对释放：关闭 BLE 桥与素材服务的监听和连接
    stopTessloBleBridge().catch((error: Error) => {
      log(`ble bridge stop failed: ${error.message}`);
    });
    stopAssetServer().catch((error: Error) => {
      log(`asset server stop failed: ${error.message}`);
    });
  }

  // onCreate 不能声明为 async：失败仅记录日志、不阻断启动；
  // 内层各 start* 不再自行 catch，由这里的 .catch 统一兜底，避免 floating promise（§5）
  private startLocalServices(simulate: boolean): void {
    this.startBleBridge(simulate).catch((error: Error) => {
      log(`BLE bridge failed: ${error.message}`);
    });
    this.startAssetServer().catch((error: Error) => {
      log(`asset server failed: ${error.message}`);
    });
  }

  /**
   * 拉起 BLE 桥；失败由 startLocalServices 的 catch 记录。
   */
  private async startBleBridge(simulate: boolean): Promise<void> {
    await startTessloBleBridge(BLE_BRIDGE_PORT, simulate, this.context);
    log(`BLE bridge listening simulate=${simulate}`);
  }

  /**
   * 拉起离线素材服务；失败由 startLocalServices 的 catch 记录。
   */
  private async startAssetServer(): Promise<void> {
    await startAssetServer(this.context, ASSET_SERVER_PORT);
    log('asset server listening');
  }
}
