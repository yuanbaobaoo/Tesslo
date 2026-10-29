// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import window from '@ohos.window';
import Want from '@ohos.app.ability.Want';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { Configuration } from '@ohos.app.ability.Configuration';
import { deviceInfo } from '@kit.BasicServicesKit';

import { WebAbility, startTessloBleBridge } from 'web_engine';
import * as tesslolink from 'libtesslolink.so';

export default class EntryAbility extends WebAbility {
  onConfigurationUpdate(config: Configuration) {
    super.onConfigurationUpdate(config);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam) {
    super.onCreate(want, launchParam);
    const wantSim = want.parameters?.['tessloBleSim'];
    const simulate = deviceInfo.productModel === 'emulator' || wantSim === 'true' || wantSim === true;
    startTessloBleBridge(20113, simulate).catch((error: Error) => {
      console.error(`tesslo BLE bridge start failed: ${error.message}`);
    });
    try {
      const status: number = tesslolink.start(20111);
      console.info(`tesslo-link C# start status=${status}`);
    } catch (error) {
      console.error(`tesslo-link C# start failed: ${error}`);
    }
  }

  async onDestroy(): Promise<void> {
    await super.onDestroy();
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
  }

  onWindowStageDestroy() {
    super.onWindowStageDestroy();
  }

  onForeground() {
    super.onForeground();
  }

  onBackground() {
    super.onBackground();
  }
  protected isAppEntry(): boolean {
    return true;
  }

};
