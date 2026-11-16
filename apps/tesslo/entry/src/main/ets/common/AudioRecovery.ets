import { audio } from '@kit.AudioKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';

import { log } from './AppLog';

// 兜底轮询间隔：PC 上静音切换不保证触发音量事件，轮询是最后一道保险
const POLL_INTERVAL_MS: number = 2000;

// WebView 媒体播放可能落在这些流上；任一流“静音 -> 取消静音”都视为系统取消静音
const WATCHED_USAGES: audio.StreamUsage[] = [
  audio.StreamUsage.STREAM_USAGE_MUSIC,
  audio.StreamUsage.STREAM_USAGE_MOVIE,
  audio.StreamUsage.STREAM_USAGE_GAME
];

// 页面自愈桥由 index.html 内联脚本注册；force=true 会对 running 的 AudioContext
// 做 suspend -> resume，连同 setAudioMuted(false) 一起清掉渲染器卡死的静音状态
const RECOVERY_JS: string = "typeof __tessloResumeAudio === 'function' && __tessloResumeAudio(true)";

/**
 * 系统静音恢复：修复华为审核反馈的“静音后应用声音无法恢复”。
 *
 * 壳层监听系统流静音状态（事件 + 2s 轮询兜底），检测到“静音 -> 取消静音”翻转后：
 *   1. controller.setAudioMuted(false) 清掉 WebView 卡死的静音位；
 *   2. runJavaScript 调页面自愈桥强制恢复挂起的 AudioContext。
 * 系统仍处于静音时绝不动作，避免顶掉系统静音。
 */
class AudioRecoveryImpl {
  // 页面加载完成（onPageEnd）后的 Web 控制器；未启动时为 null
  private controller: webview.WebviewController | null = null;
  // 音量管理器：事件注册与静音查询都经它；获取失败时仅剩前台 kick 兜底
  private volumeManager: audio.AudioVolumeManager | null = null;
  // 上一周期的系统静音状态，用于检测翻转
  private wasMuted: boolean = false;
  // 兜底轮询定时器；未启动时为 -1
  private pollTimer: number = -1;

  /**
   * 页面加载完成后启动监听；重复调用被忽略。
   */
  start(controller: webview.WebviewController): void {
    if (this.controller !== null) return;
    this.controller = controller;
    this.wasMuted = this.readSystemMuted();
    try {
      this.volumeManager = audio.getAudioManager().getVolumeManager();
    } catch (error) {
      log(`audio recovery: volume manager unavailable: ${(error as BusinessError).message}`);
    }
    // 音量事件只当触发器，静音真值始终重新查询；各注册互不影响
    const manager: audio.AudioVolumeManager | null = this.volumeManager;
    if (manager !== null) {
      for (const usage of WATCHED_USAGES) {
        try {
          manager.on('streamVolumeChange', usage, (event: audio.StreamVolumeEvent) => this.checkKick());
        } catch (error) {
          log(`audio recovery: subscribe ${usage} failed: ${(error as BusinessError).message}`);
        }
      }
      // 旧版事件兜底（API 20 起废弃，但部分版本静音切换只走它）
      try {
        manager.on('volumeChange', (event: audio.VolumeEvent) => this.checkKick());
      } catch (error) {
        log(`audio recovery: subscribe volumeChange failed: ${(error as BusinessError).message}`);
      }
    }
    this.pollTimer = setInterval(() => this.checkKick(), POLL_INTERVAL_MS);
    log(`audio recovery: start wasMuted=${this.wasMuted}`);
  }

  /**
   * 页面销毁前调用：解除事件订阅并停掉轮询。
   */
  stop(): void {
    if (this.pollTimer !== -1) {
      clearInterval(this.pollTimer);
      this.pollTimer = -1;
    }
    const manager: audio.AudioVolumeManager | null = this.volumeManager;
    if (manager !== null) {
      try {
        manager.off('streamVolumeChange');
      } catch (error) {
        log(`audio recovery: unsubscribe streamVolumeChange failed: ${(error as BusinessError).message}`);
      }
      try {
        manager.off('volumeChange');
      } catch (error) {
        log(`audio recovery: unsubscribe volumeChange failed: ${(error as BusinessError).message}`);
      }
      this.volumeManager = null;
    }
    this.controller = null;
  }

  /**
   * 前台恢复入口（UIAbility.onForeground 调用）：回到前台时若系统未静音则强制恢复一次，
   * 覆盖后台打断这一路；未启动时静默跳过。
   */
  kick(): void {
    if (this.controller === null) return;
    this.wasMuted = this.readSystemMuted();
    if (!this.wasMuted) {
      this.doKick();
    }
  }

  /**
   * 事件/轮询统一入口：仅在“静音 -> 非静音”翻转时动作，并刷新基准状态。
   */
  private checkKick(): void {
    const nowMuted: boolean = this.readSystemMuted();
    if (this.wasMuted && !nowMuted) {
      log('audio recovery: system unmuted, kicking web audio');
      this.doKick();
    }
    this.wasMuted = nowMuted;
  }

  /**
   * 任一关注流处于系统静音即视为静音；查询失败按未静音处理（宁可多恢复、不顶掉系统静音）。
   */
  private readSystemMuted(): boolean {
    const manager: audio.AudioVolumeManager | null = this.volumeManager;
    if (manager === null) return false;
    for (const usage of WATCHED_USAGES) {
      try {
        if (manager.isSystemMutedForStream(usage)) return true;
      } catch (error) {
        log(`audio recovery: read mute ${usage} failed: ${(error as BusinessError).message}`);
      }
    }
    return false;
  }

  /**
   * 执行恢复：清 WebView 静音位 + 注入 JS 恢复页面里的 AudioContext。
   */
  private doKick(): void {
    const controller: webview.WebviewController | null = this.controller;
    if (controller === null) return;
    log('audio recovery: kicked web audio');
    try {
      controller.setAudioMuted(false);
    } catch (error) {
      log(`audio recovery: setAudioMuted failed: ${(error as BusinessError).message}`);
    }
    try {
      controller.runJavaScript(RECOVERY_JS, (error: BusinessError, result: string) => {
        if (error) {
          log(`audio recovery: runJavaScript failed: ${error.message}`);
        } else {
          // 返回被触碰的 context 数；false 说明页面桥未注册
          log(`audio recovery: script result=${result}`);
        }
      });
    } catch (error) {
      log(`audio recovery: inject script failed: ${(error as BusinessError).message}`);
    }
  }
}

// 模块级单例：Index 页负责 start/stop，EntryAbility 仅调用 kick
export const AudioRecovery: AudioRecoveryImpl = new AudioRecoveryImpl();
