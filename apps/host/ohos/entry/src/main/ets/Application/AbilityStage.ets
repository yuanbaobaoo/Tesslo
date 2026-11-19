import { AbilityStage } from '@kit.AbilityKit';

import { initLog } from '../common/AppLog';

export default class TessloAbilityStage extends AbilityStage {
  /**
   * AbilityStage 先于 UIAbility 执行：最先初始化日志目录，保证后续日志落盘。
   */
  onCreate(): void {
    initLog(this.context);
  }
}
