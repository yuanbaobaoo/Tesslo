import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { deviceInfo, BusinessError } from '@kit.BasicServicesKit';
import * as tesslolink from 'libtesslolink.so';

import { log } from '../common/AppLog';
import { AudioRecovery } from '../common/AudioRecovery';
import { ASSET_SERVER_PORT, BLE_BRIDGE_PORT, LINK_PORT } from '../common/Ports';
import { startTessloBleBridge, stopTessloBleBridge } from '../ble/BleTcpBridge';
import { startAssetServer, stopAssetServer } from '../assets/AssetServer';
import { ProjectServer } from '../works/ProjectServer';

export default class EntryAbility extends UIAbility {
  // 作品库服务实例（startLocalServices 懒创建，context 就绪后才可用）
  private projectServer: ProjectServer | null = null;

  /**
   * Ability 首次创建时触发：拉起本地服务与 C# Link；蓝牙权限由桥按需再申请。
   */
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    log('boot arkweb');
    // dev 构建（包名 .dev 后缀）开启 ArkWeb CDP 调试：
    // 供远程 UI 验证与问题排查（锁屏下也可对页面做 DOM/截图级检查）；
    // 发布包不带后缀，开关不生效
    if (this.context.abilityInfo.bundleName.endsWith('.dev')) {
      webview.WebviewController.setWebDebuggingAccess(true);
      log('arkweb debugging access enabled (dev build)');
    }
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
   * 回到前台时触发：若系统未静音则强制恢复一次 WebView 音频，
   * 覆盖“后台被打断/系统静音切换后回前台”这一路（详见 common/AudioRecovery.ets）。
   */
  onForeground(): void {
    AudioRecovery.kick();
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
    // 与 onCreate 成对释放：关闭 BLE 桥、素材服务与作品库服务的监听和连接
    stopTessloBleBridge().catch((error: Error) => {
      log(`ble bridge stop failed: ${error.message}`);
    });
    stopAssetServer().catch((error: Error) => {
      log(`asset server stop failed: ${error.message}`);
    });
    const projectServer: ProjectServer | null = this.projectServer;
    if (projectServer !== null) {
      projectServer.stop().catch((error: Error) => {
        log(`project server stop failed: ${error.message}`);
      });
    }
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
    this.startProjectServer().catch((error: Error) => {
      log(`project server failed: ${error.message}`);
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

  /**
   * 拉起作品库服务（P1）；失败由 startLocalServices 的 catch 记录。
   */
  private async startProjectServer(): Promise<void> {
    const server: ProjectServer = new ProjectServer(this.context);
    await server.start();
    this.projectServer = server;
    log('project server listening');
  }
}
