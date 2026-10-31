import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';

// 日志只定义文件名；目录由 AbilityStage 启动时注入 context.filesDir，不写死沙箱绝对路径
const LOG_FILE_NAME: string = 'tesslo-main.log';
// initLog 之前的日志直接丢弃（此时无法确定应用沙箱目录）
let logDir: string | null = null;

/**
 * 注入日志目录；须在 AbilityStage.onCreate 最先调用，晚于它的日志才会落盘。
 */
export function initLog(context: common.Context): void {
  logDir = context.filesDir;
}

/**
 * 追加一行日志（自动带 ISO 时间戳）；任何失败都静默，绝不影响业务流程。
 */
export function log(message: string): void {
  const dir: string | null = logDir;
  if (dir === null) return;
  try {
    const file: fs.File = fs.openSync(
      `${dir}/${LOG_FILE_NAME}`,
      fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.APPEND
    );
    try {
      fs.writeSync(file.fd, `${new Date().toISOString()} ${message}\n`);
    } finally {
      fs.closeSync(file);
    }
  } catch {
    // 日志失败绝不影响应用启动/运行行为
  }
}
