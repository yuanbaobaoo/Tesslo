import { common, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

import { log } from './AppLog';
import { ASSET_SERVER_PORT } from './Ports';

// 拉起系统默认浏览器使用的隐式 Want action
const VIEW_DATA_ACTION: string = 'ohos.want.action.viewData';
// 浏览器类应用声明的实体；与 action 一起交给系统匹配设备默认浏览器
const BROWSABLE_ENTITY: string = 'entity.system.browsable';
// 应用自身页面可能用到的 scheme（rawfile 页面、内联/下载的 blob、data 等），
// 这些导航必须留在 ArkWeb 内，不能交给系统浏览器
const INTERNAL_SCHEME_PREFIXES: string[] = [
  'resource:',
  'about:',
  'blob:',
  'data:',
  'javascript:'
];
// 离线素材服务只绑定在回环地址；同端口之外的 http(s) 一律视为外部网页
const LOOPBACK_HOSTS: string[] = ['127.0.0.1', 'localhost'];
// 同一次点击可能同时触发 onLoadIntercept 与 onWindowNew；
// 该窗口内的重复 URL 只打开一次，避免弹出两个浏览器标签页
const DEDUPE_WINDOW_MS: number = 1500;

/**
 * 判断 URL 是否属于离线素材服务（回环地址 + ASSET_SERVER_PORT）。
 *
 * @param lowerUrl 已转小写的 URL
 * @returns 素材服务地址返回 true
 */
function isAssetServerUrl(lowerUrl: string): boolean {
  for (const host of LOOPBACK_HOSTS) {
    const origin: string = `http://${host}:${ASSET_SERVER_PORT}`;
    if (lowerUrl === origin || lowerUrl.startsWith(`${origin}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * 判断 URL 是否指向应用内页面（rawfile 页面、内联资源或离线素材服务）。
 * 应用内导航必须放行给 ArkWeb；返回 true 的地址绝不能被外部浏览器接管。
 *
 * @param link 待判断的 URL
 * @returns 应用内地址返回 true
 */
function isInternalUrl(link: string): boolean {
  const lower: string = link.trim().toLowerCase();
  if (lower.length === 0) return true;
  for (const prefix of INTERNAL_SCHEME_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }
  return isAssetServerUrl(lower);
}

/**
 * 判断 URL 是否应由系统默认浏览器打开（http/https 且不是应用内地址）。
 * 主 frame 导航与新窗口请求都先经过本判断。
 *
 * @param link 待判断的 URL
 * @returns 需要外部打开返回 true
 */
export function isExternalWebUrl(link: string): boolean {
  const lower: string = link.trim().toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }
  return !isInternalUrl(lower);
}

/**
 * 把网页中的外部链接交给系统默认浏览器打开。
 *
 * 背景：ArkWeb 默认会把链接导航留在应用内（或由 Web 组件承载新窗口），
 * 编辑器页面因此被替换成网页且无法返回；外链统一改用系统浏览器。
 */
export class ExternalLink {
  // 页面宿主 context，供 openLink / startAbility 拉起浏览器
  private context: common.UIAbilityContext;
  // 上一次触发外部打开的 URL，用于识别同一 URL 的重复回调
  private lastUrl: string = '';
  // 上一次触发外部打开的时间戳（毫秒），与 lastUrl 一起构成去重窗口
  private lastOpenAt: number = 0;

  /**
   * @param context 页面宿主 context（UIAbilityContext）
   */
  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  /**
   * 用系统默认浏览器打开外部链接；同一 URL 的重复回调会被忽略。
   * 失败只记录日志，不影响编辑器继续使用。
   *
   * @param link 外部 http(s) 链接
   */
  open(link: string): void {
    if (!isExternalWebUrl(link)) {
      log(`skip non-external link: ${link}`);
      return;
    }
    if (this.isDuplicate(link)) return;
    void this.openInBrowser(link).catch((error: Error) => {
      log(`open external link failed: ${error.message}`);
    });
  }

  /**
   * 判断是否为短时间内的重复打开请求，并记录本次请求时间。
   *
   * @param link 待打开的 URL
   * @returns 应忽略的重复请求返回 true
   */
  private isDuplicate(link: string): boolean {
    const now: number = Date.now();
    const duplicate: boolean = link === this.lastUrl && now - this.lastOpenAt < DEDUPE_WINDOW_MS;
    if (!duplicate) {
      this.lastUrl = link;
      this.lastOpenAt = now;
    }
    return duplicate;
  }

  /**
   * 优先用 openLink（按应用链接/深度链接规则匹配默认浏览器）；
   * 匹配失败时退回 viewData Want，兼容未注册 App Linking 的系统浏览器。
   *
   * @param link 外部 http(s) 链接
   */
  private async openInBrowser(link: string): Promise<void> {
    try {
      await this.context.openLink(link, { appLinkingOnly: false });
      log(`external link opened in browser: ${link}`);
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      log(`openLink failed code=${businessError.code} ${businessError.message}; fallback to viewData`);
      await this.startBrowser(link);
    }
  }

  /**
   * 以隐式 Want 拉起系统默认浏览器（与官方“拉起浏览器应用”示例一致）。
   *
   * @param link 外部 http(s) 链接
   */
  private async startBrowser(link: string): Promise<void> {
    const want: Want = {
      action: VIEW_DATA_ACTION,
      entities: [BROWSABLE_ENTITY],
      uri: link
    };
    try {
      await this.context.startAbility(want);
      log(`external link opened in browser: ${link}`);
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      log(`start browser failed code=${businessError.code} ${businessError.message}`);
    }
  }
}
