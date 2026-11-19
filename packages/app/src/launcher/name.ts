// 作品名清洗（Windows/macOS/HarmonyOS 通用非法字符 + 控制字符）。
// 新建弹窗与列表操作共用；空名由调用方按"用户可纠正"处理。
// eslint-disable-next-line no-control-regex -- 清洗控制字符是该函数的职责
const FILENAME_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 清洗作品名：去掉路径分隔符与系统非法字符，压缩长度。
 *
 * @param name - 用户输入。
 * @returns 可用于文件名/注册表的名称（可能为空串）。
 */
export const sanitizeName = (name: string): string =>
    name.replace(FILENAME_FORBIDDEN, '').trim().slice(0, 60);
