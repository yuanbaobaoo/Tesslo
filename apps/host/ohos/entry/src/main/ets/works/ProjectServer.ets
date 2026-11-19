// ProjectServer：作品库回环 HTTP 服务（P1，Ports.ets 20117）。
// 职责：库注册表（library.json）+ **目录即工程**的工作区 IO + 快照 + 目录选择。
// 工作区结构（v5）：<项目目录>/{tesslo.json, project.json, assets/<md5ext>, snapshots/}
// .tess / .sb3 仅是导出产物，由 web 侧 @tesslo/formats 组装；本服务不感知 zip。
// 旧版单 .tess 工作文件：读取时返回 E_LEGACY，web 侧转换后按 bundle 重新保存（自动迁移）。
import fs from '@ohos.file.fs';
import util from '@ohos.util';
import { fileShare, fileUri, picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

import { log } from '../common/AppLog';
import { PROJECT_SERVER_PORT } from '../common/Ports';
import { fail, ok, startMiniHttp, stopMiniHttp } from '../common/MiniHttp';
import type { HttpHandler, HttpRequest, HttpResult } from '../common/MiniHttp';
import { sanitizeFileName } from '../common/FileName';

// 服务名（MiniHttp 具名启停）
const SERVICE_NAME: string = 'project-server';
// 库根目录（沙箱内；注册表与默认项目目录都在其下）
const LIBRARY_DIR: string = 'Tesslo';
// 注册表文件名（库根目录下）
const REGISTRY_FILE: string = 'library.json';
// 工作区固定成员
const META_FILE: string = 'tesslo.json';
const PROJECT_FILE: string = 'project.json';
const ASSETS_DIR: string = 'assets';
const SNAPSHOTS_DIR: string = 'snapshots';
// 旧版工作文件后缀（仅迁移读取）
const LEGACY_TESS_EXT: string = '.tess';
// 自动保留的最近快照数（新目录快照；旧 .tess 快照不参与裁剪）
const SNAPSHOT_KEEP: number = 10;
// 原子写临时文件后缀
const TMP_EXT: string = '.tesslo-tmp';
// 旧 .tess 快照 id 前缀（区分新目录快照）
const LEGACY_SNAPSHOT_PREFIX: string = 'legacy-';
// 单文件 HTML 导出：播放器模板在 rawfile（构建时内联 player bundle）
const PLAYER_TEMPLATE_PATH: string = 'static/fetched/player-template.html';
// 模板占位符（与 packages/app/src/export/exported-html.ts 对齐）
const PLAYER_DATA_PLACEHOLDER: string = '/*__TESSLO_PLAYER_DATA__*/';
const PLAYER_TITLE_PLACEHOLDER: string = '__TESSLO_PLAYER_TITLE__';
// 素材扩展名 → MIME（内联 dataURI 用，与 web 侧协议一致）
const ASSET_MIME: Map<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['wav', 'audio/wav'],
  ['mp3', 'audio/mpeg'],
  ['json', 'application/json']
]);

// 注册表单条记录：
// - sandbox：dirUri = 沙箱内作品目录
// - external：dirUri = 用户选定的目录 URI（picker + 持久授权）；
//   实际 IO 前经 fileUri.FileUri(dirUri).path 转真实路径
interface ProjectRecord {
  id: string;
  name: string;
  dirUri: string;
  location: string;
  updatedAt: string;
  favorite: boolean;
  // 是否保存过（区分"新建未保存"与"工作区被手动删除"两种缺文件状态）
  savedOnce: boolean;
  // 旧版工作文件名（不含 .tess；仅 legacy 记录使用）
  fileName?: string;
  // 存储形态：directory（v5 目录工作区）/ legacy（旧 .tess，待迁移）
  storage?: string;
  // 项目内容指纹（导入去重）
  fingerprint?: string;
  // 项目封面（舞台截图 dataURI；保存时由产品层生成）
  thumbnail?: string;
  createdAt?: string;
}

// 注册表形状（library.json 反序列化目标）
interface Registry {
  projects: ProjectRecord[];
}

// web 侧摘要（ProjectSummary 对齐；missing 运行时探测）
interface ProjectSummaryBody {
  id: string;
  name: string;
  updatedAt: string;
  location: string;
  favorite: boolean;
  missing: boolean;
  thumbnail?: string;
}

// 工作区响应体（meta/project 为解析后的 JSON 对象）
interface BundleBody {
  meta: Record<string, Object>;
  project: Record<string, Object>;
  assets: Array<AssetBody>;
}

// 单个素材的传输体
interface AssetBody {
  md5ext: string;
  bytesBase64: string;
}

// 快照内容响应体（kind: bundle | tess）
interface SnapshotBundleBody {
  kind: string;
  meta: Record<string, Object>;
  project: Record<string, Object>;
}

interface SnapshotTessBody {
  kind: string;
  tessBase64: string;
}

// GET /projects/:id/snapshots 响应项
interface SnapshotBody {
  id: string;
  savedAt: string;
}

// POST /pick-dir 响应体
interface PickDirBody {
  dirUri: string;
  persisted: boolean;
}

// POST /projects/find 响应体（避免 null payload）
interface FindBody {
  found: boolean;
  project?: ProjectSummaryBody;
}

// 旧 .tess 文件响应体
interface TessBase64Body {
  tessBase64: string;
}

// 单文件 HTML 的内嵌数据（与 web 侧 EmbeddedProjectData 同形）
interface HtmlExportMeta {
  name: string;
  projectId: string;
}

interface HtmlExportData {
  meta: HtmlExportMeta;
  project: Record<string, Object>;
  assets: Record<string, string>;
}

// 持久授权结果（code=0 成功；否则携带底层 BusinessError 码与信息）
interface PersistError {
  code: number;
  message: string;
}

// 落盘元数据（tesslo.json 的完整投影）
interface StoredMeta {
  formatVersion: number;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string | null;
  author?: string;
  settings?: Record<string, Object>;
  fingerprint?: string;
}

// 宿主上下文（构造注入，避免全局单例取 context）
export class ProjectServer {
  private readonly context: common.UIAbilityContext;
  private readonly base64: util.Base64Helper = new util.Base64Helper();
  private libraryRoot: string = '';

  /**
   * @param context UIAbility 上下文（filesDir / picker）
   */
  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  /**
   * 启动服务：确保库目录与注册表存在，随后监听回环端口。
   *
   * @returns 监听就绪后 resolve。
   */
  async start(): Promise<void> {
    this.libraryRoot = `${this.context.filesDir}/${LIBRARY_DIR}`;
    this.ensureLibraryRoot();
    await startMiniHttp(SERVICE_NAME, PROJECT_SERVER_PORT,
      (request: HttpRequest): Promise<HttpResult> => this.route(request));
  }

  /**
   * 停止服务（与 start 成对；可重复调用）。
   */
  async stop(): Promise<void> {
    await stopMiniHttp(SERVICE_NAME);
  }

  // —— 路由 ——

  /**
   * 请求分发：路径白名单 + `..` 拦截后按方法与段路由。
   *
   * @param request - 解析后的请求。
   * @returns 信封结果。
   */
  private async route(request: HttpRequest): Promise<HttpResult> {
    if (request.path.includes('..')) {
      return fail(400, 'E_IO', 'path traversal rejected');
    }
    const segments: Array<string> = request.path.split('/').filter((item: string) => item.length > 0);
    // /projects/find 必须先于 /projects/:id 匹配
    if (segments.length === 2 && segments[0] === 'projects' && segments[1] === 'find' &&
      request.method === 'POST') {
      return this.handleFind(request.body);
    }
    // /projects 及子资源；/pick-dir；/download
    if (segments.length === 1 && segments[0] === 'projects') {
      if (request.method === 'GET') {
        return this.handleList();
      }
      if (request.method === 'POST') {
        return this.handleCreate(request.body);
      }
      return fail(405, 'E_UNSUPPORTED', `method ${request.method} not allowed`);
    }
    if (segments.length >= 2 && segments[0] === 'projects') {
      const id: string = segments[1];
      if (segments.length === 2) {
        if (request.method === 'GET') {
          return this.handleRead(id);
        }
        if (request.method === 'PUT') {
          return this.handleSave(id, request.body);
        }
        if (request.method === 'DELETE') {
          return this.handleDelete(id, request.query.get('deleteDir') === '1');
        }
      } else if (segments.length === 3 && segments[2] === 'meta' && request.method === 'PUT') {
        return this.handleUpdateMeta(id, request.body);
      } else if (segments.length === 3 && segments[2] === 'legacy' && request.method === 'GET') {
        return this.handleReadLegacy(id);
      } else if (segments.length === 3 && segments[2] === 'duplicate' && request.method === 'POST') {
        return this.handleDuplicate(id, request.body);
      } else if (segments.length === 3 && segments[2] === 'snapshots' && request.method === 'GET') {
        return this.handleListSnapshots(id);
      } else if (segments.length === 4 && segments[2] === 'snapshots' && request.method === 'GET') {
        return this.handleReadSnapshot(id, segments[3]);
      } else if (segments.length === 3 && segments[2] === 'relink' && request.method === 'POST') {
        return this.handleRelink(id, request.body);
      } else if (segments.length === 3 && segments[2] === 'export-html' &&
        request.method === 'POST') {
        return this.handleExportHtml(id);
      }
    }
    if (segments.length === 1 && segments[0] === 'pick-dir' && request.method === 'POST') {
      return this.handlePickDir();
    }
    if (segments.length === 1 && segments[0] === 'download' && request.method === 'POST') {
      return this.handleDownload(request.body);
    }
    return fail(404, 'E_UNSUPPORTED', `no route: ${request.method} ${request.path}`);
  }

  // —— 各端点实现 ——

  /**
   * GET /projects：注册表全量 + 缺失态探测。
   */
  private async handleList(): Promise<HttpResult> {
    const registry: Registry = this.readRegistry();
    const items: Array<ProjectSummaryBody> = [];
    for (const record of registry.projects) {
      // 外部目录：跨重启需先激活持久授权，否则 stat/read 会误判缺失
      if (record.location === 'external') {
        await this.ensureProjectAccess(record);
      }
      items.push(this.toSummary(record, this.isMissing(record)));
    }
    // 最近更新优先
    items.sort((left: ProjectSummaryBody, right: ProjectSummaryBody): number =>
      right.updatedAt.localeCompare(left.updatedAt));
    return ok(items);
  }

  /**
   * POST /projects {name, customDirUri?}：新建（外部目录必须为空 + 持久授权）。
   */
  private async handleCreate(bodyText: string): Promise<HttpResult> {
    const body: Record<string, Object> = this.parseBody(bodyText);
    const name: string = this.fieldString(body, 'name');
    if (name.length === 0) {
      return fail(400, 'E_IO', 'project name required');
    }
    // 字段存在但类型不对：明确报错，绝不静默回落到默认库
    const rawDirUri: Object | undefined = body['customDirUri'];
    let customDirUri: string = '';
    if (rawDirUri !== undefined) {
      if (typeof rawDirUri === 'string') {
        customDirUri = rawDirUri as string;
      } else {
        return fail(400, 'E_IO', 'customDirUri must be a string');
      }
    }
    const cleanName: string = sanitizeFileName(name);
    let dirUri: string = '';
    let location: string = 'sandbox';
    if (customDirUri.length > 0) {
      if (!this.isUri(customDirUri)) {
        return fail(400, 'E_IO', 'customDirUri must be a file:// uri');
      }
      const persistError: PersistError = await this.ensurePersisted(customDirUri);
      if (persistError.code !== 0) {
        return fail(400, persistError.code === 801 ? 'E_UNSUPPORTED' : 'E_NO_AUTH',
          `persistPermission failed (${persistError.code}): ${persistError.message}`);
      }
      const dirPath: string = this.safeUriToPath(customDirUri);
      let entries: Array<string> = [];
      try {
        if (dirPath.length === 0) {
          throw new Error(`cannot resolve dir uri: ${customDirUri}`);
        }
        entries = fs.listFileSync(dirPath);
      } catch (error) {
        const code: number = (error as BusinessError).code;
        log(`project create: list custom dir failed: code=${code} message=${(error as BusinessError).message}`);
        const mapped: string = code === 13900012 ? 'E_NO_AUTH' : 'E_IO';
        return fail(400, mapped, `cannot read custom dir (${code}): ${(error as BusinessError).message}`);
      }
      if (entries.length > 0) {
        return fail(400, 'E_DIR_NOT_EMPTY', `custom dir must be empty (${entries.length} entries)`);
      }
      location = 'external';
      dirUri = customDirUri;
    } else {
      const id: string = util.generateRandomUUID();
      dirUri = `${this.libraryRoot}/projects/${id}`;
      try {
        this.ensureDir(dirUri);
      } catch (error) {
        return fail(500, 'E_IO', `mkdir failed: ${(error as BusinessError).message}`);
      }
    }
    const now: string = new Date().toISOString();
    const record: ProjectRecord = {
      id: util.generateRandomUUID(),
      name: cleanName,
      dirUri: dirUri,
      location: location,
      updatedAt: now,
      favorite: false,
      savedOnce: false,
      storage: 'directory',
      createdAt: now
    };
    const registry: Registry = this.readRegistry();
    registry.projects.push(record);
    this.writeRegistry(registry);
    return ok(this.toSummary(record, false));
  }

  /**
   * POST /projects/find {projectId?, fingerprint?}：导入去重查询。
   */
  private handleFind(bodyText: string): HttpResult {
    const body: Record<string, Object> = this.parseBody(bodyText);
    const projectId: string = this.fieldString(body, 'projectId');
    const fingerprint: string = this.fieldString(body, 'fingerprint');
    if (projectId.length === 0 && fingerprint.length === 0) {
      return fail(400, 'E_IO', 'projectId or fingerprint required');
    }
    const registry: Registry = this.readRegistry();
    for (const record of registry.projects) {
      const idMatch: boolean = projectId.length > 0 && record.id === projectId;
      const fingerprintMatch: boolean = fingerprint.length > 0 &&
        record.fingerprint !== undefined && record.fingerprint === fingerprint;
      if (idMatch || fingerprintMatch) {
        const result: FindBody = {found: true, project: this.toSummary(record, false)};
        return ok(result);
      }
    }
    const result: FindBody = {found: false};
    return ok(result);
  }

  /**
   * GET /projects/:id：工作区 bundle（tesslo.json + project.json + assets）。
   * 旧版工作文件存在时返回 E_LEGACY，由 web 侧迁移。
   */
  private async handleRead(id: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (!await this.ensureProjectAccess(record)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const dirPath: string = this.dirPath(record);
    if (!this.dirExists(dirPath)) {
      return fail(404, 'E_DIR_MISSING', 'project dir missing');
    }
    if (!this.isDirectoryStorage(record)) {
      if (this.fileReadable(this.legacyPath(record))) {
        return fail(409, 'E_LEGACY', 'legacy .tess project needs migration');
      }
      return fail(404, 'E_DIR_MISSING', 'project file missing (new project not saved yet)');
    }
    // 新建未保存：目录已建但 project.json 尚未写入 → 回落默认项目
    if (!this.fileReadable(`${dirPath}/${PROJECT_FILE}`)) {
      return fail(404, 'E_DIR_MISSING', 'project workspace not saved yet');
    }
    try {
      const bundle: BundleBody = this.readBundle(record);
      return ok(bundle);
    } catch (error) {
      return fail(500, 'E_IO', `read failed: ${(error as BusinessError).message}`, true);
    }
  }

  /**
   * GET /projects/:id/legacy：旧版 .tess 字节（仅迁移用）。
   */
  private async handleReadLegacy(id: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (!await this.ensureProjectAccess(record)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const legacyPath: string = this.legacyPath(record);
    if (!this.fileReadable(legacyPath)) {
      return fail(404, 'E_DIR_MISSING', 'legacy project file missing');
    }
    try {
      const content: Uint8Array = this.readFileBytes(legacyPath);
      const body: TessBase64Body = {tessBase64: this.base64.encodeToStringSync(content)};
      return ok(body);
    } catch (error) {
      return fail(500, 'E_IO', `read legacy failed: ${(error as BusinessError).message}`, true);
    }
  }

  /**
   * PUT /projects/:id：保存工作区 bundle（先转存旧版快照）。
   */
  private async handleSave(id: string, bodyText: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    const body: Record<string, Object> = this.parseBody(bodyText);
    const rawMeta: Object | undefined = body['meta'];
    const rawProject: Object | undefined = body['project'];
    if (rawMeta === undefined || typeof rawMeta !== 'object' || rawMeta === null ||
      rawProject === undefined || typeof rawProject !== 'object' || rawProject === null) {
      return fail(400, 'E_IO', 'meta/project required');
    }
    if (!await this.ensureProjectAccess(record)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const dirPath: string = this.dirPath(record);
    if (!this.dirExists(dirPath)) {
      return fail(404, 'E_DIR_MISSING', 'project dir missing');
    }
    const meta: StoredMeta = this.normalizeMeta(rawMeta as Record<string, Object>, record);
    const projectText: string = JSON.stringify(rawProject);
    if (projectText.length <= 2) {
      return fail(400, 'E_IO', 'project payload empty');
    }
    const assets: Array<AssetBody> = this.parseAssets(body['assets']);
    try {
      // 旧版直接迁移时先保留原 .tess 作为快照（避免迁移失败丢历史）
      const legacyPath: string = this.legacyPath(record);
      if (!this.isDirectoryStorage(record) && this.fileReadable(legacyPath)) {
        this.saveLegacySnapshot(record, legacyPath);
      }
      this.snapshotCurrent(record);
      this.ensureDir(`${dirPath}/${ASSETS_DIR}`);
      this.writeFileBytes(`${dirPath}/${PROJECT_FILE}`, new util.TextEncoder().encode(projectText));
      this.writeFileBytes(`${dirPath}/${META_FILE}`,
        new util.TextEncoder().encode(JSON.stringify(meta)));
      let assetCount: number = 0;
      for (const asset of assets) {
        if (!this.isValidAssetName(asset.md5ext)) {
          continue;
        }
        const assetPath: string = `${dirPath}/${ASSETS_DIR}/${asset.md5ext}`;
        if (this.fileReadable(assetPath) && this.fileSize(assetPath) > 0) {
          continue;
        }
        this.writeFileBytes(assetPath, new Uint8Array(this.base64.decodeSync(asset.bytesBase64)));
        assetCount += 1;
      }
      // 迁移成功后删除旧工作文件（内容已完整写入目录）
      if (this.fileReadable(legacyPath)) {
        try {
          fs.unlinkSync(legacyPath);
        } catch (unlinkError) {
          log(`project save: unlink legacy failed: ${(unlinkError as BusinessError).message}`);
        }
      }
      log(`project save: ${record.name} project=${projectText.length}B assets+${assetCount}`);
    } catch (error) {
      return fail(500, 'E_IO', `save failed: ${(error as BusinessError).message}`, true);
    }
    record.updatedAt = new Date().toISOString();
    record.savedOnce = true;
    record.storage = 'directory';
    if (meta.fingerprint !== undefined) {
      record.fingerprint = meta.fingerprint;
    }
    if (typeof meta.thumbnail === 'string' && (meta.thumbnail as string).length > 0) {
      record.thumbnail = meta.thumbnail as string;
    }
    this.touchRegistry(record);
    return ok(this.toSummary(record, false));
  }

  /**
   * DELETE /projects/:id?deleteDir=1：注销 + 可选清空/删除目录。
   */
  private async handleDelete(id: string, deleteDir: boolean): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (deleteDir) {
      if (!await this.ensureProjectAccess(record)) {
        return fail(403, 'E_NO_AUTH', 'project dir permission not active');
      }
      try {
        this.removeDirRecursive(this.dirPath(record));
      } catch (error) {
        // 外部目录的父目录未授权：内容已清空，根目录保留
        log(`project delete: remove dir failed: ${(error as BusinessError).message}`);
      }
    }
    const registry: Registry = this.readRegistry();
    registry.projects = registry.projects.filter((item: ProjectRecord): boolean => item.id !== id);
    this.writeRegistry(registry);
    return ok();
  }

  /**
   * PUT /projects/:id/meta {name?|favorite?}：注册表级更新（重命名/收藏）。
   * 目录工作区的文件名不随作品名变化（下次保存写入 tesslo.json）。
   */
  private handleUpdateMeta(id: string, bodyText: string): HttpResult {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    const body: Record<string, Object> = this.parseBody(bodyText);
    const name: string = this.fieldString(body, 'name');
    if (name.length > 0) {
      const cleanName: string = sanitizeFileName(name);
      if (cleanName.length > 0) {
        record.name = cleanName;
      }
    }
    const favorite: Object | undefined = body['favorite'];
    if (favorite !== undefined && typeof favorite === 'boolean') {
      record.favorite = favorite;
    }
    record.updatedAt = new Date().toISOString();
    this.touchRegistry(record);
    return ok(this.toSummary(record, this.isMissing(record)));
  }

  /**
   * POST /projects/:id/duplicate {newName}：复制工作区为新项目（默认库位置）。
   */
  private async handleDuplicate(id: string, bodyText: string): Promise<HttpResult> {
    const source: ProjectRecord | null = this.findRecord(id);
    if (source === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    const body: Record<string, Object> = this.parseBody(bodyText);
    const newName: string = sanitizeFileName(this.fieldString(body, 'newName'));
    if (newName.length === 0) {
      return fail(400, 'E_IO', 'newName required');
    }
    if (!source.savedOnce && !this.hasWorkingProject(source)) {
      return fail(400, 'E_DIR_MISSING', 'source project not saved yet');
    }
    if (!await this.ensureProjectAccess(source)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const now: string = new Date().toISOString();
    const copy: ProjectRecord = {
      id: util.generateRandomUUID(),
      name: newName,
      dirUri: `${this.libraryRoot}/projects/${util.generateRandomUUID()}`,
      location: 'sandbox',
      updatedAt: now,
      favorite: false,
      savedOnce: true,
      storage: 'directory',
      createdAt: now
    };
    try {
      this.ensureDir(copy.dirUri);
      if (this.isDirectoryStorage(source)) {
        const sourceDir: string = this.dirPath(source);
        // 只复制工作区（project/meta/assets），不复制 snapshots 历史
        this.copyFileBytes(`${sourceDir}/${PROJECT_FILE}`, `${copy.dirUri}/${PROJECT_FILE}`);
        this.copyFileBytes(`${sourceDir}/${META_FILE}`, `${copy.dirUri}/${META_FILE}`);
        const sourceAssets: string = `${sourceDir}/${ASSETS_DIR}`;
        if (this.dirExists(sourceAssets)) {
          this.copyDirectoryContents(sourceAssets, `${copy.dirUri}/${ASSETS_DIR}`);
        }
        // 重写副本身份（projectId/name），避免与源项目身份冲突
        this.rewriteMetaIdentity(copy.dirUri, copy.id, newName);
        // 副本沿用源项目封面
        const copyMeta: Record<string, Object> | null = this.readJson(`${copy.dirUri}/${META_FILE}`);
        if (copyMeta !== null && typeof copyMeta['thumbnail'] === 'string') {
          copy.thumbnail = copyMeta['thumbnail'] as string;
        }
      } else {
        const legacySource: string = this.legacyPath(source);
        if (!this.fileReadable(legacySource)) {
          return fail(400, 'E_DIR_MISSING', 'source project not saved yet');
        }
        fs.copyFileSync(legacySource, `${copy.dirUri}/${newName}${LEGACY_TESS_EXT}`);
        copy.storage = 'legacy';
        copy.fileName = newName;
      }
    } catch (error) {
      return fail(500, 'E_IO', `duplicate failed: ${(error as BusinessError).message}`, true);
    }
    const registry: Registry = this.readRegistry();
    registry.projects.push(copy);
    this.writeRegistry(registry);
    return ok(this.toSummary(copy, false));
  }

  /**
   * GET /projects/:id/snapshots：快照清单（新目录快照 + 旧 .tess 快照）。
   */
  private async handleListSnapshots(id: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (!await this.ensureProjectAccess(record)) {
      return ok([] as Array<SnapshotBody>);
    }
    const dir: string = this.snapshotsRoot(record);
    const items: Array<SnapshotBody> = [];
    let names: Array<string> = [];
    try {
      names = fs.listFileSync(dir);
    } catch (error) {
      return ok(items);
    }
    for (const name of names) {
      const full: string = `${dir}/${name}`;
      if (name.endsWith(LEGACY_TESS_EXT)) {
        const stem: string = name.substring(0, name.length - LEGACY_TESS_EXT.length);
        items.push({id: `${LEGACY_SNAPSHOT_PREFIX}${stem}`, savedAt: this.snapshotTimeIso(full, stem)});
        continue;
      }
      if (!this.dirExists(full) || !this.fileReadable(`${full}/${PROJECT_FILE}`)) {
        continue;
      }
      items.push({id: name, savedAt: this.snapshotTimeIso(full, name)});
    }
    items.sort((left: SnapshotBody, right: SnapshotBody): number =>
      right.savedAt.localeCompare(left.savedAt));
    return ok(items);
  }

  /**
   * GET /projects/:id/snapshots/:snap：快照内容（bundle 或旧 .tess 字节）。
   */
  private async handleReadSnapshot(id: string, snapshotId: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (!await this.ensureProjectAccess(record)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const dir: string = this.snapshotsRoot(record);
    if (snapshotId.startsWith(LEGACY_SNAPSHOT_PREFIX)) {
      const stem: string = snapshotId.substring(LEGACY_SNAPSHOT_PREFIX.length);
      const legacyPath: string = `${dir}/${stem}${LEGACY_TESS_EXT}`;
      if (!this.fileReadable(legacyPath)) {
        return fail(404, 'E_DIR_MISSING', `snapshot ${snapshotId} not found`);
      }
      try {
        const content: Uint8Array = this.readFileBytes(legacyPath);
        const body: SnapshotTessBody = {
          kind: 'tess',
          tessBase64: this.base64.encodeToStringSync(content)
        };
        return ok(body);
      } catch (error) {
        return fail(500, 'E_IO', `read snapshot failed: ${(error as BusinessError).message}`, true);
      }
    }
    const snapshotDir: string = `${dir}/${snapshotId}`;
    const meta: Record<string, Object> | null = this.readJson(`${snapshotDir}/${META_FILE}`);
    const project: Record<string, Object> | null = this.readJson(`${snapshotDir}/${PROJECT_FILE}`);
    if (meta === null || project === null) {
      return fail(404, 'E_DIR_MISSING', `snapshot ${snapshotId} not found`);
    }
    const body: SnapshotBundleBody = {kind: 'bundle', meta: meta, project: project};
    return ok(body);
  }

  /**
   * POST /projects/:id/relink {dirUri}：重新关联项目目录，身份不变。
   */
  private async handleRelink(id: string, bodyText: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    const body: Record<string, Object> = this.parseBody(bodyText);
    const dirUri: string = this.fieldString(body, 'dirUri');
    if (dirUri.length === 0) {
      return fail(400, 'E_IO', 'dirUri required');
    }
    if (!this.isUri(dirUri)) {
      return fail(400, 'E_IO', 'dirUri must be a file:// uri');
    }
    const persistError: PersistError = await this.ensurePersisted(dirUri);
    if (persistError.code !== 0) {
      return fail(400, persistError.code === 801 ? 'E_UNSUPPORTED' : 'E_NO_AUTH',
        `persistPermission failed (${persistError.code}): ${persistError.message}`);
    }
    const dirPath: string = this.safeUriToPath(dirUri);
    if (dirPath.length === 0) {
      return fail(400, 'E_NO_AUTH', 'cannot resolve dir uri');
    }
    if (this.fileReadable(`${dirPath}/${PROJECT_FILE}`)) {
      record.storage = 'directory';
      record.savedOnce = true;
      record.fileName = undefined;
    } else {
      let claimed: string = '';
      let names: Array<string> = [];
      try {
        names = fs.listFileSync(dirPath);
      } catch (error) {
        const code: number = (error as BusinessError).code;
        return fail(400, code === 13900012 ? 'E_NO_AUTH' : 'E_IO',
          `cannot read dir (${code}): ${(error as BusinessError).message}`);
      }
      const preferred: string = `${this.fileNameOf(record)}${LEGACY_TESS_EXT}`;
      for (const name of names) {
        if (name === preferred) {
          claimed = name;
          break;
        }
      }
      if (claimed.length === 0) {
        for (const name of names) {
          if (name.endsWith(LEGACY_TESS_EXT)) {
            claimed = name;
            break;
          }
        }
      }
      if (claimed.length === 0) {
        return fail(400, 'E_DIR_MISSING', 'no project workspace in chosen dir');
      }
      record.storage = 'legacy';
      record.fileName = claimed.substring(0, claimed.length - LEGACY_TESS_EXT.length);
      record.savedOnce = true;
    }
    record.dirUri = dirUri;
    record.location = 'external';
    record.updatedAt = new Date().toISOString();
    this.touchRegistry(record);
    return ok(this.toSummary(record, false));
  }

  /**
   * POST /pick-dir：目录选择器（系统弹窗）+ 持久授权。
   */
  private async handlePickDir(): Promise<HttpResult> {
    const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context);
    const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
    options.selectMode = picker.DocumentSelectMode.FOLDER;
    try {
      const uris: Array<string> = await docPicker.select(options);
      if (uris.length === 0) {
        return fail(400, 'E_CANCELLED', 'picker cancelled');
      }
      log(`pick-dir uri: ${uris[0]}`);
      const persistError: PersistError = await this.ensurePersisted(uris[0]);
      if (persistError.code !== 0) {
        log(`pick-dir: persistPermission failed: code=${persistError.code} message=${persistError.message}`);
      }
      const body: PickDirBody = {dirUri: uris[0], persisted: persistError.code === 0};
      return ok(body);
    } catch (error) {
      const code: number = (error as BusinessError).code;
      if (code === 801) {
        return fail(400, 'E_UNSUPPORTED', 'folder picker not supported on this device');
      }
      return fail(500, 'E_NO_AUTH', `picker failed (${code}): ${(error as BusinessError).message}`);
    }
  }

  /**
   * POST /download {fileName, bytesBase64}：页面组装的导出产物落用户目录。
   */
  private async handleDownload(bodyText: string): Promise<HttpResult> {
    const body: Record<string, Object> = this.parseBody(bodyText);
    const fileName: string = sanitizeFileName(this.fieldString(body, 'fileName'));
    const bytesBase64: string = this.fieldString(body, 'bytesBase64');
    if (fileName.length === 0 || bytesBase64.length === 0) {
      return fail(400, 'E_IO', 'fileName/bytesBase64 required');
    }
    return this.saveBytesToUser(fileName, this.base64.decodeSync(bytesBase64));
  }

  /**
   * POST /projects/:id/export-html：宿主侧组装单文件 HTML。
   * 模板（约 13MB）留在 rawfile，工作区数据和素材直接在宿主读取，
   * 避免页面组装/base64 传输造成长时间主线程冻结；组装完直接弹保存选择器。
   */
  private async handleExportHtml(id: string): Promise<HttpResult> {
    const record: ProjectRecord | null = this.findRecord(id);
    if (record === null) {
      return fail(404, 'E_DIR_MISSING', `project ${id} not registered`);
    }
    if (!await this.ensureProjectAccess(record)) {
      return fail(403, 'E_NO_AUTH', 'project dir permission not active');
    }
    const dirPath: string = this.dirPath(record);
    if (!this.dirExists(dirPath)) {
      return fail(404, 'E_DIR_MISSING', 'project dir missing');
    }
    if (!this.isDirectoryStorage(record)) {
      if (this.fileReadable(this.legacyPath(record))) {
        return fail(409, 'E_LEGACY', 'legacy .tess project needs migration');
      }
      return fail(404, 'E_DIR_MISSING', 'project workspace not saved yet');
    }
    const meta: Record<string, Object> | null = this.readJson(`${dirPath}/${META_FILE}`);
    const project: Record<string, Object> | null = this.readJson(`${dirPath}/${PROJECT_FILE}`);
    if (meta === null || project === null) {
      return fail(404, 'E_DIR_MISSING', 'project workspace incomplete');
    }
    try {
      const template: string = this.readPlayerTemplate();
      const dataText: string = this.buildHtmlData(meta, project, dirPath);
      const rawTitle: string = this.fieldString(meta, 'name').replace(/[<>&]/g, '');
      const safeTitle: string = rawTitle.length > 0 ? rawTitle : sanitizeFileName(record.name);
      const html: string = template.split(PLAYER_DATA_PLACEHOLDER).join(dataText)
        .split(PLAYER_TITLE_PLACEHOLDER).join(safeTitle);
      const bytes: Uint8Array = new util.TextEncoder().encode(html);
      log(`export html: ${record.name} (${bytes.byteLength} bytes)`);
      return await this.saveBytesToUser(`${sanitizeFileName(record.name)}.html`, bytes);
    } catch (error) {
      return fail(500, 'E_IO',
        `export html failed (${(error as BusinessError).code}): ${(error as BusinessError).message}`,
        true);
    }
  }

  /**
   * 组装导出 HTML 的内嵌数据 JSON：meta + 纯净 project + 素材 dataURI。
   * 素材缺失时跳过（与页面内导出保持一致的容错）。
   */
  private buildHtmlData(meta: Record<string, Object>, project: Record<string, Object>,
    dirPath: string): string {
    const assetsDir: string = `${dirPath}/${ASSETS_DIR}`;
    let names: Array<string> = [];
    try {
      names = fs.listFileSync(assetsDir);
    } catch (error) {
      names = [];
    }
    const assets: Record<string, string> = {};
    for (const name of names) {
      if (!this.isValidAssetName(name)) {
        continue;
      }
      try {
        const bytes: Uint8Array = this.readFileBytes(`${assetsDir}/${name}`);
        assets[name] = `data:${this.assetMime(name)};base64,` +
          this.base64.encodeToStringSync(bytes);
      } catch (error) {
        log(`export html: read asset failed: ${name}: ${(error as BusinessError).message}`);
      }
    }
    const data: HtmlExportData = {
      meta: {
        name: this.fieldString(meta, 'name'),
        projectId: this.fieldString(meta, 'projectId')
      },
      project: project,
      assets: assets
    };
    // `</script>` 会提前闭合内联 JSON 标签：转成 JSON 等价的 `<\/`
    return JSON.stringify(data).split('</').join('<\\/');
  }

  /**
   * 素材扩展名 → MIME（与 web 侧 exported-html.ts 的映射一致）。
   */
  private assetMime(name: string): string {
    const dot: number = name.lastIndexOf('.');
    const extension: string = dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
    return ASSET_MIME.get(extension) ?? 'application/octet-stream';
  }

  /**
   * 读取播放器模板（rawfile 内联 bundle，构建产物）。
   */
  private readPlayerTemplate(): string {
    const content: Uint8Array =
      this.context.resourceManager.getRawFileContentSync(PLAYER_TEMPLATE_PATH);
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    return decoder.decodeToString(content);
  }

  /**
   * 把字节写到缓存后交给系统保存选择器；所有错误转成信封结果。
   */
  private async saveBytesToUser(fileName: string, bytes: Uint8Array): Promise<HttpResult> {
    const cachePath: string = `${this.context.cacheDir}/${fileName}`;
    try {
      const cacheFile: fs.File = fs.openSync(cachePath, fs.OpenMode.READ_WRITE |
        fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(cacheFile.fd, bytes.buffer.slice(0, bytes.byteLength));
      fs.closeSync(cacheFile);
      const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context);
      const saveOptions: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      saveOptions.newFileNames = [fileName];
      const targetUris: Array<string> = await docPicker.save(saveOptions);
      if (targetUris.length === 0) {
        return fail(400, 'E_CANCELLED', 'save cancelled');
      }
      // 保存选择器返回 docs URI：copyFileSync 不接受 URI，改用 open+write（真机实证）
      log(`download target uri: ${targetUris[0]}`);
      this.writeFileDirect(targetUris[0], bytes);
    } catch (error) {
      return fail(500, 'E_IO',
        `download failed (${(error as BusinessError).code}): ${(error as BusinessError).message}`, true);
    } finally {
      try {
        fs.unlinkSync(cachePath);
      } catch (error) {
        // 临时文件清理失败不影响结果
      }
    }
    return ok();
  }

  // —— 工作区读写 ——

  /**
   * 读取工作区 bundle（meta/project JSON + assets 全量）。
   */
  private readBundle(record: ProjectRecord): BundleBody {
    const dirPath: string = this.dirPath(record);
    const meta: Record<string, Object> | null = this.readJson(`${dirPath}/${META_FILE}`);
    const project: Record<string, Object> | null = this.readJson(`${dirPath}/${PROJECT_FILE}`);
    if (meta === null || project === null) {
      throw new Error('workspace incomplete');
    }
    const assets: Array<AssetBody> = [];
    const assetsDir: string = `${dirPath}/${ASSETS_DIR}`;
    let names: Array<string> = [];
    try {
      names = fs.listFileSync(assetsDir);
    } catch (error) {
      names = [];
    }
    for (const name of names) {
      if (!this.isValidAssetName(name)) {
        continue;
      }
      const assetPath: string = `${assetsDir}/${name}`;
      try {
        const bytes: Uint8Array = this.readFileBytes(assetPath);
        assets.push({md5ext: name, bytesBase64: this.base64.encodeToStringSync(bytes)});
      } catch (error) {
        log(`read asset failed: ${name}: ${(error as BusinessError).message}`);
      }
    }
    return {meta: meta, project: project, assets: assets};
  }

  /**
   * 当前版本转存快照（snapshots/<timestamp>/{tesslo.json,project.json}）。
   */
  private snapshotCurrent(record: ProjectRecord): void {
    const dirPath: string = this.dirPath(record);
    const projectPath: string = `${dirPath}/${PROJECT_FILE}`;
    if (!this.fileReadable(projectPath)) {
      return;
    }
    const snapshotDir: string = `${this.snapshotsRoot(record)}/${Date.now()}`;
    this.ensureDir(snapshotDir);
    this.copyFileBytes(projectPath, `${snapshotDir}/${PROJECT_FILE}`);
    const metaPath: string = `${dirPath}/${META_FILE}`;
    if (this.fileReadable(metaPath)) {
      this.copyFileBytes(metaPath, `${snapshotDir}/${META_FILE}`);
    }
    this.pruneSnapshots(record);
  }

  /**
   * 旧版 .tess 转存为快照文件（迁移前保留历史）。
   */
  private saveLegacySnapshot(record: ProjectRecord, legacyPath: string): void {
    const dir: string = this.snapshotsRoot(record);
    this.ensureDir(dir);
    const target: string = `${dir}/${Date.now()}${LEGACY_TESS_EXT}`;
    this.copyFileBytes(legacyPath, target);
  }

  /**
   * 裁剪新目录快照到 SNAPSHOT_KEEP（旧 .tess 快照不参与）。
   */
  private pruneSnapshots(record: ProjectRecord): void {
    const dir: string = this.snapshotsRoot(record);
    let names: Array<string> = [];
    try {
      names = fs.listFileSync(dir)
        .filter((name: string): boolean =>
          !name.endsWith(LEGACY_TESS_EXT) && this.dirExists(`${dir}/${name}`))
        .sort();
    } catch (error) {
      return;
    }
    while (names.length > SNAPSHOT_KEEP) {
      const oldest: string | undefined = names.shift();
      if (oldest === undefined) {
        break;
      }
      try {
        this.removeDirRecursive(`${dir}/${oldest}`);
      } catch (error) {
        break;
      }
    }
  }

  /**
   * 复制目录内容（duplicate 用）。
   */
  private copyDirectoryContents(sourceDir: string, targetDir: string): void {
    this.ensureDir(targetDir);
    const names: Array<string> = fs.listFileSync(sourceDir);
    for (const name of names) {
      const source: string = `${sourceDir}/${name}`;
      const target: string = `${targetDir}/${name}`;
      if (fs.statSync(source).isDirectory()) {
        this.copyDirectoryContents(source, target);
      } else {
        this.copyFileBytes(source, target);
      }
    }
  }

  /**
   * 重写副本的 tesslo.json 身份（projectId 与 name）。
   */
  private rewriteMetaIdentity(dirPath: string, projectId: string, name: string): void {
    const metaPath: string = `${dirPath}/${META_FILE}`;
    const meta: Record<string, Object> | null = this.readJson(metaPath);
    if (meta === null) {
      return;
    }
    meta['projectId'] = projectId;
    meta['name'] = name;
    meta['updatedAt'] = new Date().toISOString();
    this.writeFileBytes(metaPath, new util.TextEncoder().encode(JSON.stringify(meta)));
  }

  // —— 注册表与文件工具 ——

  /**
   * 确保库根目录存在（OHOS mkdirSync 已存在仍抛 EEXIST，按"已存在即达成"容错）。
   */
  private ensureLibraryRoot(): void {
    const dir: string = `${this.libraryRoot}/projects`;
    if (this.dirExists(dir)) {
      return;
    }
    try {
      fs.mkdirSync(dir, true);
    } catch (error) {
      if (!this.dirExists(dir)) {
        throw error as Error;
      }
    }
  }

  /**
   * 读注册表（缺失/损坏时空表重建；旧记录补默认值）。
   */
  private readRegistry(): Registry {
    try {
      const content: string = fs.readTextSync(`${this.libraryRoot}/${REGISTRY_FILE}`);
      const registry: Registry = JSON.parse(content) as Registry;
      for (const record of registry.projects) {
        if (record.savedOnce === undefined) {
          record.savedOnce = true;
        }
      }
      return registry;
    } catch (error) {
      return {projects: []};
    }
  }

  /**
   * 写注册表（同目录 tmp + rename 原子替换）。
   */
  private writeRegistry(registry: Registry): void {
    const finalPath: string = `${this.libraryRoot}/${REGISTRY_FILE}`;
    this.writeFileBytes(finalPath, new util.TextEncoder().encode(JSON.stringify(registry)));
  }

  /**
   * 查注册表记录。
   */
  private findRecord(id: string): ProjectRecord | null {
    const registry: Registry = this.readRegistry();
    for (const record of registry.projects) {
      if (record.id === id) {
        return record;
      }
    }
    return null;
  }

  /**
   * 更新单条记录（读改写整表）。
   */
  private touchRegistry(target: ProjectRecord): void {
    const registry: Registry = this.readRegistry();
    for (let index: number = 0; index < registry.projects.length; index += 1) {
      if (registry.projects[index].id === target.id) {
        registry.projects[index] = target;
        break;
      }
    }
    this.writeRegistry(registry);
  }

  /**
   * 项目目录真实路径（外部目录 URI → FileUri.path）。
   */
  private dirPath(record: ProjectRecord): string {
    if (record.location !== 'external') {
      return record.dirUri;
    }
    return this.safeUriToPath(record.dirUri);
  }

  /**
   * URI → 真实路径（解析失败返回空串）。
   */
  private safeUriToPath(uri: string): string {
    try {
      return new fileUri.FileUri(uri).path;
    } catch (error) {
      log(`fileUri parse failed: ${(error as BusinessError).message}`);
      return '';
    }
  }

  /**
   * 是否为用户文件 URI（picker 返回的 file://docs/...）。
   */
  private isUri(path: string): boolean {
    return path.startsWith('file://');
  }

  /**
   * 实际文件名词干（legacy 工作文件 / 展示名回退）。
   */
  private fileNameOf(record: ProjectRecord): string {
    const stem: string = record.fileName !== undefined ? record.fileName : sanitizeFileName(record.name);
    return sanitizeFileName(stem);
  }

  /**
   * 旧版工作文件路径（仅迁移/兼容读取）。
   */
  private legacyPath(record: ProjectRecord): string {
    const dirPath: string = this.dirPath(record);
    return dirPath.length === 0 ? '' : `${dirPath}/${this.fileNameOf(record)}${LEGACY_TESS_EXT}`;
  }

  /**
   * 快照根目录（与工作区同目录，随作品走）。
   */
  private snapshotsRoot(record: ProjectRecord): string {
    const dirPath: string = this.dirPath(record);
    return dirPath.length === 0 ? '' : `${dirPath}/${SNAPSHOTS_DIR}`;
  }

  /**
   * 是否目录工作区：record.storage 优先；旧记录以 project.json 存在为准。
   */
  private isDirectoryStorage(record: ProjectRecord): boolean {
    if (record.storage === 'directory') {
      return true;
    }
    if (record.storage === 'legacy') {
      return false;
    }
    const dirPath: string = this.dirPath(record);
    return dirPath.length > 0 && this.fileReadable(`${dirPath}/${PROJECT_FILE}`);
  }

  /**
   * 是否存在可用工作区（新目录 project.json 或旧 .tess）。
   */
  private hasWorkingProject(record: ProjectRecord): boolean {
    if (this.fileReadable(`${this.dirPath(record)}/${PROJECT_FILE}`)) {
      return true;
    }
    const legacyPath: string = this.legacyPath(record);
    return legacyPath.length > 0 && this.fileReadable(legacyPath);
  }

  /**
   * 缺失态：目录没了，或保存过的项目工作区不可读。
   */
  private isMissing(record: ProjectRecord): boolean {
    return !this.dirExists(this.dirPath(record)) ||
      (record.savedOnce && !this.hasWorkingProject(record));
  }

  /**
   * 目录存在且可读。
   */
  private dirExists(dirPath: string): boolean {
    if (dirPath.length === 0) {
      return false;
    }
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * 文件可读。
   */
  private fileReadable(path: string): boolean {
    if (path.length === 0) {
      return false;
    }
    try {
      return fs.accessSync(path);
    } catch (error) {
      return false;
    }
  }

  /**
   * 文件大小（open 后按 fd 取）。
   */
  private fileSize(path: string): number {
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      return fs.statSync(file.fd).size;
    } finally {
      fs.closeSync(file);
    }
  }

  /**
   * 确保目录存在（已存在不视为错误）。
   */
  private ensureDir(dirUri: string): void {
    if (this.dirExists(dirUri)) {
      return;
    }
    try {
      fs.mkdirSync(dirUri, true);
    } catch (error) {
      if (!this.dirExists(dirUri)) {
        throw error as Error;
      }
    }
  }

  /**
   * 递归删除目录。
   */
  private removeDirRecursive(dirPath: string): void {
    const names: Array<string> = fs.listFileSync(dirPath);
    for (const name of names) {
      const child: string = `${dirPath}/${name}`;
      if (fs.statSync(child).isDirectory()) {
        this.removeDirRecursive(child);
      } else {
        fs.unlinkSync(child);
      }
    }
    fs.rmdirSync(dirPath);
  }

  /**
   * 全量读 JSON 对象（缺失/损坏返回 null）。
   */
  private readJson(path: string): Record<string, Object> | null {
    try {
      const content: string = fs.readTextSync(path);
      const parsed: Object = JSON.parse(content) as Object;
      if (parsed === null || typeof parsed !== 'object') {
        return null;
      }
      return parsed as Record<string, Object>;
    } catch (error) {
      return null;
    }
  }

  /**
   * 全量读文件字节（先 open 再按 fd 取大小）。
   */
  private readFileBytes(path: string): Uint8Array {
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      const stat: fs.Stat = fs.statSync(file.fd);
      const buffer: ArrayBuffer = new ArrayBuffer(stat.size);
      const readLength: number = fs.readSync(file.fd, buffer);
      return new Uint8Array(buffer.slice(0, readLength));
    } finally {
      fs.closeSync(file);
    }
  }

  /**
   * 写文件：tmp+rename 原子替换（真实路径，含外部目录的 FileUri.path）。
   */
  private writeFileBytes(path: string, bytes: Uint8Array): void {
    const tmpPath: string = `${path}${TMP_EXT}`;
    this.writeFileDirect(tmpPath, bytes);
    fs.renameSync(tmpPath, path);
  }

  /**
   * 直接写文件（CREATE|TRUNC）。
   */
  private writeFileDirect(path: string, bytes: Uint8Array): void {
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE |
      fs.OpenMode.TRUNC);
    try {
      const payload: ArrayBuffer = bytes.buffer.slice(0, bytes.byteLength);
      fs.writeSync(file.fd, payload);
    } finally {
      fs.closeSync(file);
    }
  }

  /**
   * 复制文件字节。
   */
  private copyFileBytes(source: string, target: string): void {
    this.writeFileBytes(target, this.readFileBytes(source));
  }

  /**
   * 快照保存时间：优先文件/目录 mtime，回退解析文件名时间戳。
   */
  private snapshotTimeIso(path: string, stem: string): string {
    try {
      // OHOS Stat.mtime 单位是秒（不是毫秒），Date 需要毫秒
      return new Date(fs.statSync(path).mtime * 1000).toISOString();
    } catch (error) {
      const stamp: number = Number(stem);
      return Number.isNaN(stamp) ? new Date().toISOString() : new Date(stamp).toISOString();
    }
  }

  /**
   * 素材成员名校验：<32位小写md5>.<扩展名>。
   */
  private isValidAssetName(name: string): boolean {
    const dot: number = name.lastIndexOf('.');
    if (dot !== 32 || name.length <= 33) {
      return false;
    }
    for (let index: number = 0; index < 32; index += 1) {
      const code: number = name.charCodeAt(index);
      const isDigit: boolean = code >= 48 && code <= 57;
      const isLowerHex: boolean = code >= 97 && code <= 102;
      if (!isDigit && !isLowerHex) {
        return false;
      }
    }
    for (let index: number = 33; index < name.length; index += 1) {
      const code: number = name.charCodeAt(index);
      const isDigit: boolean = code >= 48 && code <= 57;
      const isUpper: boolean = code >= 65 && code <= 90;
      const isLower: boolean = code >= 97 && code <= 122;
      if (!isDigit && !isUpper && !isLower) {
        return false;
      }
    }
    return true;
  }

  /**
   * 解析保存请求里的素材数组（忽略类型不符项）。
   */
  private parseAssets(raw: Object | undefined): Array<AssetBody> {
    const result: Array<AssetBody> = [];
    if (raw === undefined || !Array.isArray(raw)) {
      return result;
    }
    const items: Array<Object> = raw as Array<Object>;
    for (const item of items) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const record: Record<string, Object> = item as Record<string, Object>;
      const md5ext: string = this.fieldString(record, 'md5ext');
      const bytesBase64: string = this.fieldString(record, 'bytesBase64');
      if (md5ext.length > 0 && bytesBase64.length > 0) {
        result.push({md5ext: md5ext, bytesBase64: bytesBase64});
      }
    }
    return result;
  }

  /**
   * 规范化落盘元数据：projectId/name/updatedAt 以注册表为准。
   */
  private normalizeMeta(raw: Record<string, Object>, record: ProjectRecord): StoredMeta {
    const now: string = new Date().toISOString();
    const formatVersion: number = typeof raw['formatVersion'] === 'number'
      ? raw['formatVersion'] as number : 1;
    const rawThumb: Object | undefined = raw['thumbnail'];
    const created: string = typeof raw['createdAt'] === 'string'
      ? raw['createdAt'] as string : (record.createdAt !== undefined ? record.createdAt : now);
    const meta: StoredMeta = {
      formatVersion: formatVersion,
      projectId: record.id,
      name: record.name,
      createdAt: created,
      updatedAt: now,
      thumbnail: typeof rawThumb === 'string' ? rawThumb as string : null
    };
    if (typeof raw['author'] === 'string') {
      meta.author = raw['author'] as string;
    }
    const settings: Object | undefined = raw['settings'];
    if (settings !== undefined && typeof settings === 'object' && settings !== null) {
      meta.settings = settings as Record<string, Object>;
    }
    const fingerprint: Object | undefined = raw['fingerprint'];
    if (typeof fingerprint === 'string' && (fingerprint as string).length > 0) {
      meta.fingerprint = fingerprint as string;
    }
    return meta;
  }

  /**
   * 持久化目录授权：成功 code=0；失败携带底层错误码。
   */
  private async persistPermission(dirUri: string): Promise<PersistError> {
    try {
      await fileShare.persistPermission([this.policy(dirUri)]);
      return {code: 0, message: ''};
    } catch (error) {
      const failure: BusinessError = error as BusinessError;
      log(`persistPermission failed: code=${failure.code} message=${failure.message}`);
      return {code: failure.code, message: failure.message};
    }
  }

  /**
   * 确保授权已持久化：重复 persist 会返回 13900001（已持久化），
   * 此时用 checkPersistentPermission 复核，已持久化视为成功。
   */
  private async ensurePersisted(dirUri: string): Promise<PersistError> {
    const persistError: PersistError = await this.persistPermission(dirUri);
    if (persistError.code === 0) {
      return persistError;
    }
    try {
      const states: Array<boolean> = await fileShare.checkPersistentPermission([this.policy(dirUri)]);
      if (states.length > 0 && states[0]) {
        return {code: 0, message: ''};
      }
    } catch (error) {
      log(`checkPersistentPermission failed: ${(error as BusinessError).message}`);
    }
    return persistError;
  }

  /**
   * 目录授权策略（读写都要）。
   */
  private policy(dirUri: string): fileShare.PolicyInfo {
    return {
      uri: dirUri,
      operationMode: fileShare.OperationMode.READ_MODE | fileShare.OperationMode.WRITE_MODE
    };
  }

  /**
   * 外部目录跨重启恢复授权；沙箱项目恒为 true。
   */
  private async ensureProjectAccess(record: ProjectRecord): Promise<boolean> {
    if (record.location !== 'external') {
      return true;
    }
    return this.ensureUriAccess(record.dirUri);
  }

  /**
   * 激活已持久化的目录授权（失败 = 需要重新选择目录）。
   */
  private async ensureUriAccess(dirUri: string): Promise<boolean> {
    if (!this.isUri(dirUri)) {
      return true;
    }
    try {
      await fileShare.activatePermission([this.policy(dirUri)]);
      return true;
    } catch (error) {
      const failure: BusinessError = error as BusinessError;
      log(`activatePermission failed: code=${failure.code} message=${failure.message}`);
      return false;
    }
  }

  /**
   * 解析 JSON body 为 Record（非法 JSON 返回空表）。
   */
  private parseBody(bodyText: string): Record<string, Object> {
    if (bodyText.length === 0) {
      return {} as Record<string, Object>;
    }
    try {
      return JSON.parse(bodyText) as Record<string, Object>;
    } catch (error) {
      return {} as Record<string, Object>;
    }
  }

  /**
   * 取字符串字段（缺失/类型不符返回空串）。
   */
  private fieldString(body: Record<string, Object>, key: string): string {
    const value: Object | undefined = body[key];
    return typeof value === 'string' ? value : '';
  }

  /**
   * 注册表记录 → web 侧摘要。
   */
  private toSummary(record: ProjectRecord, missing: boolean): ProjectSummaryBody {
    const summary: ProjectSummaryBody = {
      id: record.id,
      name: record.name,
      updatedAt: record.updatedAt,
      location: record.location,
      favorite: record.favorite,
      missing: missing
    };
    if (record.thumbnail !== undefined && record.thumbnail.length > 0) {
      summary.thumbnail = record.thumbnail;
    }
    return summary;
  }
}
