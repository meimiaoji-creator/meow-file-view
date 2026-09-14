/**
 * meow-file-view Web API —— 纯函数 HTTP 层（可脱离 ctx 测试）。
 *
 * 把文件系统层包装为 /api/meow-file-view/* API：
 *   - /tree      GET  → 单层目录列表（?workspace=&path=）
 *   - /content   GET  → 文本内容（?workspace=&path=；附 editAllowed 供前端显隐编辑按钮）
 *   - /root      GET  → 当前树根（?workspace=）
 *   - /raw       GET  → 图片字节直出（?workspace=&path=；IMAGE_MIME 白名单 + maxImageBytes 上限）
 *   - /save      POST → 保存 md（?workspace=&path=，JSON body {content}；config.edit 开关）
 *   - /git/probe POST → 产物 git 探测（JSON body {workspace?, paths[]} → {results:{path:state}}；
 *                       两段式探测见 src/git.ts，失败态前端隐藏 Diff 按钮）
 *   - /git/diff  GET  → 产物 vs HEAD 差异（?workspace=&path=；untracked 回 state 由前端渲染全文新增）
 *   - /git/config GET/POST → git 配置读写（gitExePath / repoRoots 覆盖，设置页用；写插件根 git-config.json）
 * 错误映射：FileViewError → 其 status（403 穿越/禁用 / 404 不存在 / 400 参数 / 413 超限 /
 * 415 二进制/类型不符）；其余 → 500。workspace 缺省时 resolveRoot 回落 process.cwd()。
 */
import type { FileViewConfig } from '../schema.js';
import type { GitService } from '../git.js';
/** URL 查询参数（GET）。键 → 字符串值（searchParams 单值；重复取最后一个）。 */
export interface ApiQuery {
    [key: string]: string | undefined;
}
/** API 统一返回形态：HTTP 状态码 + JSON 可序列化数据；raw 端点改走 buf/mime 字节直出。 */
export interface ApiResult {
    status: number;
    json: unknown;
    /** 字节响应体（raw 图片端点）；存在时忽略 json，由 routes 以 mime 直出。 */
    buf?: Buffer;
    /** 字节响应 content-type（配合 buf）。 */
    mime?: string;
}
/**
 * 主入口（纯函数，可脱离 ctx 直接测试）。
 * @param method HTTP 方法（按端点校验：只读端点 GET；save/probe/config 写仅 POST）
 * @param path   URL pathname（含 /api/meow-file-view 前缀）
 * @param query  URL 查询参数（已解析为对象）
 * @param config 归一化后的插件配置
 * @param body   POST 请求体原文（routes 收集后传入；只读端点忽略）
 * @param git    git 服务（可注入；缺省时 git/* 端点回答 501 —— 便于单测文件层）
 */
export declare function handleApiRequest(method: string, path: string, query: ApiQuery, config: FileViewConfig, body?: string, git?: GitService): Promise<ApiResult>;
