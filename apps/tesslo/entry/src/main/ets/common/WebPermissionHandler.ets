import { abilityAccessCtrl, Permissions, common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

import { log } from './AppLog';

// Web 音频采集（录音、响度侦测）对应的系统权限
const AUDIO_PERMISSION: Permissions = 'ohos.permission.MICROPHONE';
// Web 视频采集（视频侦测）对应的系统权限
const VIDEO_PERMISSION: Permissions = 'ohos.permission.CAMERA';

/**
 * 把 ArkWeb 的页面权限请求转成应用侧系统授权。
 * 仅放行音视频采集，其余资源（传感器、MIDI 等）一律拒绝。
 */
export class WebPermissionHandler {
  // 页面宿主 context（UIAbilityContext），用于申请 user_grant 权限
  private context: common.Context;

  /**
   * @param context 页面宿主 context
   */
  constructor(context: common.Context) {
    this.context = context;
  }

  /**
   * 处理一次页面权限请求：先申请对应系统权限，全部授予后才放行。
   * @param request ArkWeb 通过 onPermissionRequest 上报的权限请求
   */
  async handle(request: PermissionRequest): Promise<void> {
    try {
      const resources: Array<string> = request.getAccessibleResource();
      const permissions: Array<Permissions> = [];
      for (const resource of resources) {
        if (resource === ProtectedResourceType.AUDIO_CAPTURE) {
          permissions.push(AUDIO_PERMISSION);
        } else if (resource === ProtectedResourceType.VIDEO_CAPTURE) {
          permissions.push(VIDEO_PERMISSION);
        } else {
          log(`web permission denied: unsupported ${resource}`);
          request.deny();
          return;
        }
      }
      if (permissions.length === 0) {
        request.deny();
        return;
      }
      const result = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, permissions);
      const granted: boolean = result.authResults.every(status => status === 0);
      if (granted) {
        request.grant(resources);
      } else {
        log(`web permission denied by user: ${resources.join(',')}`);
        request.deny();
      }
    } catch (error) {
      log(`web permission request failed: ${(error as BusinessError).message ?? error}`);
      try {
        request.deny();
      } catch (denyError) {
        log(`web permission deny failed: ${(denyError as BusinessError).message ?? denyError}`);
      }
    }
  }
}
