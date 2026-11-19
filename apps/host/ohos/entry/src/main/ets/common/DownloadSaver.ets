import { webview } from '@kit.ArkWeb';
import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { UIContext } from '@kit.ArkUI';
import fs from '@ohos.file.fs';

import { log } from './AppLog';
import { sanitizeFileName } from './FileName';

// 下载先落到 cache 临时目录，Picker 返回用户目录 URI 后再复制过去
const TEMP_DIR_NAME: string = 'web-download';

/**
 * 单个下载任务在“下载完成”和“用户选好保存位置”两个异步事件之间的状态。
 */
class PendingDownload {
  // 下载任务唯一标识，对应 WebDownloadItem guid
  readonly guid: string;
  // ArkWeb 下载项，用于取消任务或读取错误码
  readonly item: webview.WebDownloadItem;
  // cache 临时文件路径
  readonly cachePath: string;
  // 清洗后的保存文件名
  readonly fileName: string;
  // 用户选定的目标 URI；Picker 返回前为 null
  uri: string | null = null;
  // 下载是否已经完成
  isFinished: boolean = false;
  // 是否已取消保存
  isCanceled: boolean = false;

  constructor(guid: string, item: webview.WebDownloadItem, cachePath: string, fileName: string) {
    this.guid = guid;
    this.item = item;
    this.cachePath = cachePath;
    this.fileName = fileName;
  }
}

/**
 * 接管 ArkWeb 下载：先写 cache，再弹系统保存选择器，最后复制到用户选择的 URI。
 * 这样 sb3 不再落在用户不可见的应用沙箱，也不需要文件读写权限。
 */
export class DownloadSaver {
  // 页面宿主 context：cacheDir 与 Picker 都从这里取
  private context: common.Context;
  // 用于展示保存结果轻提示的 UI 上下文
  private uiContext: UIContext;
  // 进行中的下载任务，key 为 WebDownloadItem guid
  private pending: Map<string, PendingDownload> = new Map();
  // 页面销毁后不再接受新下载，避免旧控制器回调继续创建任务
  private isDisposed: boolean = false;

  /**
   * @param context 页面宿主 context
   * @param uiContext 用于展示保存结果提示的 UI 上下文
   */
  constructor(context: common.Context, uiContext: UIContext) {
    this.context = context;
    this.uiContext = uiContext;
  }

  /**
   * 注册下载委托；须在 Web 控制器 attached 后调用。
   */
  register(controller: webview.WebviewController): void {
    const delegate: webview.WebDownloadDelegate = new webview.WebDownloadDelegate();
    delegate.onBeforeDownload((item: webview.WebDownloadItem) => this.handleBeforeDownload(item));
    delegate.onDownloadFinish((item: webview.WebDownloadItem) => this.handleDownloadFinish(item));
    delegate.onDownloadFailed((item: webview.WebDownloadItem) => this.handleDownloadFailed(item));
    try {
      controller.setDownloadDelegate(delegate);
    } catch (error) {
      log(`set download delegate failed: ${(error as BusinessError).message}`);
    }
  }

  /**
   * 页面销毁前调用：拒绝新下载，取消进行中的任务并删除 cache 临时文件。
   */
  dispose(): void {
    this.isDisposed = true;
    const tasks: Array<PendingDownload> = [];
    this.pending.forEach((task: PendingDownload) => tasks.push(task));
    this.pending.clear();
    for (const task of tasks) {
      if (!task.isFinished) {
        try {
          task.item.cancel();
        } catch (error) {
          log(`download cancel failed: ${(error as BusinessError).message}`);
        }
      }
      this.cleanup(task);
    }
  }

  /**
   * 下载开始：先启动到 cache，再异步请求用户选择保存位置。
   */
  private handleBeforeDownload(item: webview.WebDownloadItem): void {
    if (this.isDisposed) {
      try {
        item.cancel();
      } catch (error) {
        log(`download cancel failed: ${(error as BusinessError).message}`);
      }
      return;
    }
    const guid: string = item.getGuid();
    const fileName: string = sanitizeFileName(item.getSuggestedFileName());
    const cacheDir: string = `${this.context.cacheDir}/${TEMP_DIR_NAME}/${guid}`;
    const cachePath: string = `${cacheDir}/${fileName}`;
    // 先登记任务再 start：小文件可能在 start 后立刻触发 onDownloadFinish
    const task: PendingDownload = new PendingDownload(guid, item, cachePath, fileName);
    this.pending.set(guid, task);
    try {
      fs.mkdirSync(cacheDir, true);
      item.start(cachePath);
    } catch (error) {
      this.pending.delete(guid);
      log(`download start failed: ${(error as BusinessError).message}`);
      item.cancel();
      return;
    }
    void this.askSaveLocation(task).catch((error: Error) => {
      log(`save picker failed: ${error.message}`);
    });
  }

  /**
   * 拉起系统保存选择器；取消或失败时终止下载并清理临时文件。
   */
  private async askSaveLocation(task: PendingDownload): Promise<void> {
    const options: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
    options.newFileNames = [task.fileName];
    const documentPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context);
    try {
      const uris: Array<string> = await documentPicker.save(options);
      // 页面销毁或任务已被失败回调清理时，不再处理迟到的 Picker 结果
      if (this.isDisposed || !this.pending.has(task.guid)) return;
      if (uris.length === 0) {
        this.cancelTask(task, 'save picker returned no uri');
        return;
      }
      task.uri = uris[0];
      if (task.isFinished) {
        await this.copyToUserFile(task);
      }
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      this.cancelTask(task, `save picker rejected code=${businessError.code} ${businessError.message}`);
    }
  }

  /**
   * 下载完成：用户已选好位置就立即复制，否则等待 Picker 返回。
   */
  private handleDownloadFinish(item: webview.WebDownloadItem): void {
    const task: PendingDownload | undefined = this.pending.get(item.getGuid());
    if (task === undefined) return;
    task.isFinished = true;
    if (task.isCanceled) {
      this.finishTask(task);
      return;
    }
    if (task.uri !== null) {
      void this.copyToUserFile(task).catch((error: Error) => {
        log(`download copy failed: ${error.message}`);
      });
    }
  }

  /**
   * 下载失败：清理临时文件；若是用户取消导致的失败，同样走清理。
   */
  private handleDownloadFailed(item: webview.WebDownloadItem): void {
    const task: PendingDownload | undefined = this.pending.get(item.getGuid());
    if (task === undefined) return;
    this.finishTask(task);
    log(`download failed ${item.getGuid()} code=${item.getLastErrorCode()}`);
  }

  /**
   * 把 cache 中的文件异步复制到 Picker 返回的用户 URI，并删除临时文件。
   */
  private async copyToUserFile(task: PendingDownload): Promise<void> {
    this.pending.delete(task.guid);
    const uri: string | null = task.uri;
    if (uri === null) {
      this.cleanup(task);
      return;
    }
    let source: fs.File | null = null;
    let target: fs.File | null = null;
    let targetOpened: boolean = false;
    let isSaved: boolean = false;
    try {
      source = await fs.open(task.cachePath, fs.OpenMode.READ_ONLY);
      target = await fs.open(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      targetOpened = true;
      await fs.copyFile(source.fd, target.fd);
      try {
        await fs.fsync(target.fd);
      } catch (error) {
        // 部分文件提供方不支持 fsync；数据已写入时不应误报保存失败
        log(`fsync failed: ${(error as BusinessError).message}`);
      }
      isSaved = true;
      this.showToast(`已保存 ${task.fileName}`);
      log(`download saved ${uri}`);
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      this.showToast('保存文件失败');
      log(`download copy failed code=${businessError.code} ${businessError.message}`);
    } finally {
      if (target !== null) await this.closeQuietly(target);
      if (source !== null) await this.closeQuietly(source);
      // 只在已经打开（并已 TRUNC）目标文件时清理，避免误删用户原有文件
      if (!isSaved && targetOpened) await this.removeQuietly(uri);
      this.cleanup(task);
    }
  }

  /**
   * 用户取消或 Picker 失败：取消仍在进行的下载，已完成的任务直接清理。
   */
  private cancelTask(task: PendingDownload, reason: string): void {
    task.isCanceled = true;
    if (task.isFinished) {
      this.finishTask(task);
    } else {
      try {
        task.item.cancel();
      } catch (error) {
        log(`download cancel failed: ${(error as BusinessError).message}`);
      }
    }
    this.showToast('已取消保存');
    log(`download canceled: ${reason}`);
  }

  /**
   * 从 pending 表移除任务并删除临时文件。
   */
  private finishTask(task: PendingDownload): void {
    this.pending.delete(task.guid);
    this.cleanup(task);
  }

  /**
   * 删除本次下载的 cache 文件和 guid 目录；删除失败不影响用户文件。
   */
  private cleanup(task: PendingDownload): void {
    try {
      fs.unlinkSync(task.cachePath);
    } catch (error) {
      // 下载未落盘或已被系统清理时文件可能不存在，记录后继续清理目录
      log(`remove temp file failed: ${(error as BusinessError).message}`);
    }
    try {
      fs.rmdirSync(`${this.context.cacheDir}/${TEMP_DIR_NAME}/${task.guid}`);
    } catch (error) {
      log(`remove temp dir failed: ${(error as BusinessError).message}`);
    }
  }

  /**
   * 关闭文件句柄；失败只记录，不覆盖主流程结果。
   */
  private async closeQuietly(file: fs.File): Promise<void> {
    try {
      await fs.close(file);
    } catch (error) {
      log(`close file failed: ${(error as BusinessError).message}`);
    }
  }

  /**
   * 删除复制失败的目标文件；失败只记录，不影响临时文件清理。
   */
  private async removeQuietly(uri: string): Promise<void> {
    try {
      await fs.unlink(uri);
    } catch (error) {
      log(`remove target failed: ${(error as BusinessError).message}`);
    }
  }

  /**
   * 保存结果的轻提示；提示失败不能影响文件保存流程。
   */
  private showToast(message: string): void {
    try {
      this.uiContext.getPromptAction().showToast({ message: message });
    } catch (error) {
      log(`toast failed: ${(error as BusinessError).message}`);
    }
  }
}
