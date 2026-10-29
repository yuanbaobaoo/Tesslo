import { AbilityConstant, Permissions, UIAbility, Want, abilityAccessCtrl } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { BusinessError } from '@kit.BasicServicesKit';
import * as tesslolink from 'libtesslolink.so';

import { log } from '../common/AppLog';
import { startTessloBleBridge } from '../ble/BleTcpBridge';
import { startAssetServer } from '../assets/AssetServer';

const BLUETOOTH_PERMISSIONS: Array<Permissions> = ['ohos.permission.ACCESS_BLUETOOTH'];

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    log('boot arkweb');
    const wantSim = want.parameters?.['tessloBleSim'];
    const simulate = deviceInfo.productModel === 'emulator' || wantSim === 'true' || wantSim === true;
    if (!simulate) {
      abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, BLUETOOTH_PERMISSIONS)
        .catch((error: BusinessError) => log(`bluetooth permission failed: ${error.message}`));
    }
    startTessloBleBridge(20113, simulate)
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
      windowStage.getMainWindowSync().setWindowLayoutFullScreen(true);
    } catch (error) {
      log(`full screen failed: ${error.message}`);
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
