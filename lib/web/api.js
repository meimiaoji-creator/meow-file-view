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
import { FileViewError, listDir, readImage, readText, resolveRoot, resolveWithinRoot, saveText } from '../files.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_IMAGE_BYTES, DEFAULT_EXCLUDE } from '../schema.js';
const PREFIX = '/api/meow-file-view';
function ok(json) {
    return { status: 200, json };
}
function fail(status, message) {
    return { status, json: { error: message } };
}
/** 读取可选查询参数（空字符串视为缺省）。 */
function qs(query, key) {
    const v = query[key];
    return v !== undefined && v !== '' ? v : undefined;
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
export async function handleApiRequest(method, path, query, config, body, git) {
    try {
        return await dispatch(method, path, query, config, body, git);
    }
    catch (err) {
        if (err instanceof FileViewError)
            return fail(err.status, err.message);
        console.error('[meow-file-view/api] 内部错误:', err);
        return fail(500, err instanceof Error ? err.message : String(err));
    }
}
/** probe 单请求路径数上限（一回合产物数量级远小于此）。 */
const PROBE_PATH_CAP = 50;
/** 路由分发：按 path 段匹配端点，分派到文件系统层调用。 */
async function dispatch(method, path, query, config, body, git) {
    if (!path.startsWith(PREFIX))
        return fail(404, `未知路径: ${path}`);
    const rest = path.slice(PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '');
    const segs = rest === '' ? [] : rest.split('/');
    const head = segs[0];
    const isGet = method === 'GET';
    // ---- 目录树（单层懒加载） ----
    if (head === 'tree' && segs.length === 1) {
        if (!isGet)
            return fail(405, '方法不允许（仅支持 GET）');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        const rel = qs(query, 'path') ?? '';
        const entries = await listDir(root, rel, config.exclude ?? DEFAULT_EXCLUDE);
        return ok({ root, entries });
    }
    // ---- 文本内容 ----
    if (head === 'content' && segs.length === 1) {
        if (!isGet)
            return fail(405, '方法不允许（仅支持 GET）');
        const rel = qs(query, 'path');
        if (!rel)
            return fail(400, '缺少 path 参数');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        const result = await readText(root, rel, config.maxBytes ?? DEFAULT_MAX_BYTES);
        // absPath：服务端算绝对路径（OS 感知分隔符），供前端「复制路径」按钮直接使用
        // editAllowed：config.edit 开关透传，前端据此显隐「编辑」按钮
        const absPath = resolveWithinRoot(root, rel);
        return ok({ root, absPath, editAllowed: config.edit !== false, ...result });
    }
    // ---- 图片直出（字节响应，routes 侧按 buf/mime 写响应） ----
    if (head === 'raw' && segs.length === 1) {
        if (!isGet)
            return fail(405, '方法不允许（仅支持 GET）');
        const rel = qs(query, 'path');
        if (!rel)
            return fail(400, '缺少 path 参数');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        const img = await readImage(root, rel, config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES);
        return { status: 200, json: null, buf: img.buf, mime: img.mime };
    }
    // ---- md 保存（编辑回写） ----
    if (head === 'save' && segs.length === 1) {
        if (method !== 'POST')
            return fail(405, '方法不允许（保存仅支持 POST）');
        if (config.edit === false)
            return fail(403, '编辑已禁用（config.edit = false）');
        const rel = qs(query, 'path');
        if (!rel)
            return fail(400, '缺少 path 参数');
        if (body === undefined || body === '')
            return fail(400, '缺少请求体');
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return fail(400, '请求体不是合法 JSON');
        }
        if (typeof parsed.content !== 'string')
            return fail(400, '缺少 content 字符串字段');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        const saved = await saveText(root, rel, parsed.content);
        return ok({ root, absPath: saved.absPath, size: saved.size });
    }
    // ---- 当前树根（展示用） ----
    if (head === 'root' && segs.length === 1) {
        if (!isGet)
            return fail(405, '方法不允许（仅支持 GET）');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        return ok({ root });
    }
    // ---- git 探测（产物 Diff 按钮显隐）：POST JSON {workspace?, paths[]} ----
    if (head === 'git' && segs[1] === 'probe' && segs.length === 2) {
        if (method !== 'POST')
            return fail(405, '方法不允许（仅支持 POST）');
        if (git === undefined)
            return fail(501, 'git 服务未启用');
        if (body === undefined || body === '')
            return fail(400, '缺少请求体');
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return fail(400, '请求体不是合法 JSON');
        }
        const workspace = typeof parsed.workspace === 'string' && parsed.workspace !== '' ? parsed.workspace : undefined;
        const paths = Array.isArray(parsed.paths) ? parsed.paths.filter((p) => typeof p === 'string') : [];
        if (paths.length === 0)
            return ok({ results: {} });
        if (paths.length > PROBE_PATH_CAP)
            return fail(413, `路径数超限（上限 ${PROBE_PATH_CAP}）`);
        const root = resolveRoot(workspace, config.root);
        // 绝对产物路径按树根校验（越界 = 403 整批拒绝；正常产物都在树根内）
        const results = {};
        for (const p of [...new Set(paths)]) {
            let abs;
            try {
                abs = resolveWithinRoot(root, p);
            }
            catch {
                results[p] = 'outside';
                continue;
            }
            results[p] = await git.probe(abs, root);
        }
        return ok({ results });
    }
    // ---- git 差异（产物 vs HEAD）：GET ?workspace=&path= ----
    if (head === 'git' && segs[1] === 'diff' && segs.length === 2) {
        if (!isGet)
            return fail(405, '方法不允许（仅支持 GET）');
        if (git === undefined)
            return fail(501, 'git 服务未启用');
        const p = qs(query, 'path');
        if (!p)
            return fail(400, '缺少 path 参数');
        const root = resolveRoot(qs(query, 'workspace'), config.root);
        const abs = resolveWithinRoot(root, p); // 越界 → 403
        const result = await git.diff(abs, root, config.maxBytes ?? DEFAULT_MAX_BYTES);
        return ok(result);
    }
    // ---- git 配置读写（设置页）：GET 当前值 / POST 保存 ----
    if (head === 'git' && segs[1] === 'config' && segs.length === 2) {
        if (git === undefined)
            return fail(501, 'git 服务未启用');
        if (isGet)
            return ok(await git.readConfig());
        if (method !== 'POST')
            return fail(405, '方法不允许（仅支持 POST）');
        if (body === undefined || body === '')
            return fail(400, '缺少请求体');
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return fail(400, '请求体不是合法 JSON');
        }
        return ok(await git.writeConfig(parsed));
    }
    return fail(404, `未知路径: /api/meow-file-view${rest ? '/' + rest : ''}`);
}
