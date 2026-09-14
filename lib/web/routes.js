/**
 * meow-file-view Web 路由注册 —— ctx.webServer 三条命名路由。
 *
 *   - exact  /meow-file-view         → 查看器页面 HTML（壳；CSS/JS 在 static/viewer.*）
 *   - prefix /meow-file-view/static  → md-viewer lib + 页面 viewer.js/css（磁盘读，前缀校验防穿越）
 *   - prefix /api/meow-file-view     → API（GET tree/content/root/raw + POST save）
 *
 * 约束（与 meow-dsh-task 一致）：
 *   - 不抢 `registerFallback`（已被 frontend-static 占），只用 exact/prefix 命名路由。
 *   - 同源（http://127.0.0.1:3080），无 CORS。
 *   - 零 dsh 源码改动；`ctx.webServer` 类型经 `@deepseek-ai/dsh-host-webserver` 的
 *     module augmentation 提供（`import type {}` 仅为加载声明，运行时无此 import）。
 */
import { promises as fs } from 'node:fs';
import { extname, join, normalize, resolve as pathResolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitService } from '../git.js';
import { handleApiRequest } from './api.js';
import { INDEX_HTML } from './static.js';
const PAGE_PATH = '/meow-file-view';
const STATIC_PREFIX = '/meow-file-view/static';
const API_PREFIX = '/api/meow-file-view';
/**
 * 静态 lib 根：本文件编译到 lib/web/routes.js，上溯两级到插件根再进 static/。
 * dev（meow-file-view\lib\web + meow-file-view\static）与 dist（dist\plugins\meow-file-view\）布局一致。
 */
const STATIC_DIR = pathResolve(join(pathResolve(fileURLToPath(new URL('.', import.meta.url))), '..', '..', 'static'));
/** 插件根（static 的上级）：git-config.json（设置页持久化）落在这里。 */
const PLUGIN_ROOT = pathResolve(STATIC_DIR, '..');
/** 静态文件 content-type（按扩展名；未知回落 octet-stream）。 */
const MIME = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
};
function sendJson(res, status, json) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(json));
}
function sendText(res, status, text) {
    res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(text);
}
/** 从 STATIC_DIR 服务单个文件；路径穿越（.. 等）→ 403，文件缺失 → 404。 */
async function serveStatic(res, rel) {
    // 防路径穿越：path.resolve 规范化后校验前缀（静态根）。
    const target = pathResolve(normalize(join(STATIC_DIR, rel)));
    if (target !== STATIC_DIR && !target.startsWith(STATIC_DIR + sep)) {
        sendText(res, 403, 'Forbidden');
        return;
    }
    let buf;
    try {
        buf = await fs.readFile(target);
    }
    catch {
        sendText(res, 404, 'Not Found');
        return;
    }
    res.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
    });
    res.end(buf);
}
/** /meow-file-view/static/* —— 静态 lib（GET/HEAD；其余 405）。 */
async function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed');
        return;
    }
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    }
    catch {
        sendText(res, 400, 'Bad Request');
        return;
    }
    const rel = pathname.slice(STATIC_PREFIX.length).replace(/^\/+/, '');
    await serveStatic(res, rel);
}
/** /meow-file-view —— 查看器页面（GET/HEAD；其余 405）。 */
async function handlePage(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed');
        return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(INDEX_HTML);
}
/** POST 请求体上限（保存 md 的 JSON body；1MB 文本上限的 10 倍冗余）。 */
const SAVE_BODY_CAP = 10 * 1024 * 1024;
/** 收集 POST 请求体（UTF-8；超上限 reject，由调用方映射 413）。 */
function readBody(req, cap) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > cap) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
/** git 服务单例（懒建；可用性/version 探测在服务内按 exe 缓存）。 */
let gitServiceSingleton;
function gitService() {
    gitServiceSingleton ??= createGitService(PLUGIN_ROOT);
    return gitServiceSingleton;
}
/** /api/meow-file-view/* —— 解析 query/body → handleApiRequest → JSON 或字节（raw 图片）直出。 */
async function handleApi(req, res, config) {
    const url = new URL(req.url ?? '/', 'http://x');
    const query = {};
    for (const [key, value] of url.searchParams)
        query[key] = value;
    let body;
    if ((req.method ?? 'GET') === 'POST') {
        try {
            body = await readBody(req, SAVE_BODY_CAP);
        }
        catch {
            sendJson(res, 413, { error: `请求体过大（上限 ${SAVE_BODY_CAP} 字节）` });
            return;
        }
    }
    const result = await handleApiRequest(req.method ?? 'GET', url.pathname, query, config, body, gitService());
    // raw 图片端点：字节 + content-type 直出（错误仍走 JSON，img.onerror 兜底）
    if (result.buf !== undefined) {
        res.writeHead(result.status, {
            'content-type': result.mime ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        res.end(result.buf);
        return;
    }
    sendJson(res, result.status, result.json);
}
/**
 * 注册 Web 路由：查看器页 + 静态 lib + JSON API。
 * @param ctx    Cordis 上下文（webServer 服务由 web profile 提供）
 * @param config 归一化后的插件配置
 */
export function registerWebRoutes(ctx, config) {
    ctx.webServer.register({
        kind: 'exact',
        path: PAGE_PATH,
        handler: handlePage,
    });
    ctx.webServer.register({
        kind: 'prefix',
        path: STATIC_PREFIX,
        handler: handleStatic,
    });
    ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => handleApi(req, res, config),
    });
}
