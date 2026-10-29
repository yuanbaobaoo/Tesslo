import fs from '@ohos.file.fs';

const LOG_PATH: string = '/data/storage/el2/base/files/tesslo-main.log';

export function log(message: string): void {
  try {
    const file: fs.File = fs.openSync(
      LOG_PATH,
      fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.APPEND
    );
    try {
      fs.writeSync(file.fd, `${new Date().toISOString()} ${message}\n`);
    } finally {
      fs.closeSync(file);
    }
  } catch {
    // logging must never change startup behavior
  }
}
