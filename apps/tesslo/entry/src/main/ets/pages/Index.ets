// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WebWindow } from 'web_engine';
import CustomChildProcess from '../process/CustomChildProcess';
import { KeyCode } from '@kit.InputKit';
import LogUtil from 'web_engine/src/main/ets/utils/LogUtil';
import { uiObserver } from '@kit.ArkUI';
import { NativeContext } from 'web_engine/src/main/ets/interface/CommonInterface';
import JsBindingUtils from 'web_engine/src/main/ets/utils/JsBindingUtils';
import { ContextType } from 'web_engine/src/main/ets/common/Constants';
 
const TAG: string = 'Index';

CustomChildProcess.toString();
let storage = LocalStorage.getShared();
@Entry(storage)
@Component
struct Index {
  @LocalStorageLink('xcomponentId') xComponentId: string = '';
  @LocalStorageProp('statusBarHeight') statusBarHeight: number = 0;
  @State density: number = 0;
  private nativeContext: NativeContext =
    JsBindingUtils.getNativeContext(ContextType.kMainProcess);
 
  aboutToAppear(): void {
    uiObserver.on('densityUpdate', this.getUIContext(), (info: uiObserver.DensityInfo) => {
      this.density = info.density;
    });
  }
 
  aboutToDisappear(): void {
    uiObserver.off('densityUpdate', this.getUIContext());
  }

  onBackPress(): boolean {
    this.nativeContext.OnBackToLastPage(this.xComponentId);
    return true;
  }
  
  build() {
    Row() {
      WebWindow()
    }.onKeyEvent((event?: KeyEvent) => {
      if (event) {
        if (event.type == KeyType.Down && event.keyCode == KeyCode.KEYCODE_ESCAPE) {
          event.stopPropagation();
        }
      }
    })
    .width('100%')
    .height('100%')
    .padding({
      top: this.getStatusBarHeight(),
    })
  }
  getStatusBarHeight(): number {
    LogUtil.info(TAG, 'Avoidance function, statusBarHeight:' + this.statusBarHeight + ',density:' + this.density);
    return this.getUIContext().px2vp(this.statusBarHeight);
  }
}
