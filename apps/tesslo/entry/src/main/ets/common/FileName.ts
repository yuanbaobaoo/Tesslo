// 建议文件名为空或只剩路径占位符时的兜底名，保证 Picker 始终有可用的文件名
const FALLBACK_FILE_NAME: string = 'tesslo.sb3';

/**
 * 清洗 Web 下载建议的文件名：去掉路径分隔符与系统非法字符，空名回退。
 * 返回结果可直接用于应用 cache 路径和 Picker 的 newFileNames。
 * @param suggested Web 侧提供的建议文件名
 * @returns 清洗后的安全文件名
 */
export function sanitizeFileName(suggested: string): string {
  const name: string = suggested.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (name.length === 0 || name === '.' || name === '..') {
    return FALLBACK_FILE_NAME;
  }
  return name;
}
