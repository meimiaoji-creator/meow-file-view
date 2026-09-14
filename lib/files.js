/**
 * meow-file-view 纯文件系统层 —— 目录树 + 文本读取 + 图片读取 + md 保存 + 类型判定 + 穿越防护。
 *
 * 零 dsh 依赖（仅 node:fs / node:path），独立可测：
 * - 树根一经解析（resolveRoot），任何请求都不可越过（resolveWithinRoot 越界抛 403）；
 * - 文本读取有大小上限（maxBytes），超限截断并返回 truncated（仍返回已读部分 + 真实 size 供前端提示）；
 * - 二进制判定 = 扩展名黑名单 + 首块空字节嗅探双重保障；图片白名单（IMAGE_MIME）单独 raw 直出；
 * - md 保存（saveText）= 仅已有 md 文件 + 拒 .git 路径 + 临时文件写入后 rename 原子替换（Windows rename 带覆盖语义）。
 */
import { promises as fs } from 'node:fs';
import { basename, isAbsolute, join, normalize, resolve as pathResolve, sep } from 'node:path';
/** 业务异常：携带 HTTP 状态码，供 web/api.ts 映射。 */
export class FileViewError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'FileViewError';
    }
}
/** 扩展名 → { 类型, 高亮语言 } 表（常见代码开发产物文件）。 */
const EXT_MAP = {
    md: { kind: 'md', lang: 'markdown' },
    markdown: { kind: 'md', lang: 'markdown' },
    mdx: { kind: 'md', lang: 'markdown' },
    java: { kind: 'code', lang: 'java' },
    yml: { kind: 'code', lang: 'yaml' },
    yaml: { kind: 'code', lang: 'yaml' },
    json: { kind: 'code', lang: 'json' },
    jsonc: { kind: 'code', lang: 'json' },
    ts: { kind: 'code', lang: 'typescript' },
    tsx: { kind: 'code', lang: 'tsx' },
    js: { kind: 'code', lang: 'javascript' },
    jsx: { kind: 'code', lang: 'jsx' },
    mjs: { kind: 'code', lang: 'javascript' },
    cjs: { kind: 'code', lang: 'javascript' },
    py: { kind: 'code', lang: 'python' },
    go: { kind: 'code', lang: 'go' },
    rs: { kind: 'code', lang: 'rust' },
    c: { kind: 'code', lang: 'c' },
    h: { kind: 'code', lang: 'c' },
    cpp: { kind: 'code', lang: 'cpp' },
    hpp: { kind: 'code', lang: 'cpp' },
    cs: { kind: 'code', lang: 'csharp' },
    php: { kind: 'code', lang: 'php' },
    rb: { kind: 'code', lang: 'ruby' },
    swift: { kind: 'code', lang: 'swift' },
    kt: { kind: 'code', lang: 'kotlin' },
    kts: { kind: 'code', lang: 'kotlin' },
    xml: { kind: 'code', lang: 'xml' },
    properties: { kind: 'code', lang: 'ini' },
    ini: { kind: 'code', lang: 'ini' },
    toml: { kind: 'code', lang: 'toml' },
    conf: { kind: 'code', lang: 'ini' },
    sql: { kind: 'code', lang: 'sql' },
    sh: { kind: 'code', lang: 'bash' },
    bash: { kind: 'code', lang: 'bash' },
    zsh: { kind: 'code', lang: 'bash' },
    bat: { kind: 'code', lang: 'dos' },
    cmd: { kind: 'code', lang: 'dos' },
    ps1: { kind: 'code', lang: 'powershell' },
    html: { kind: 'code', lang: 'xml' },
    htm: { kind: 'code', lang: 'xml' },
    css: { kind: 'code', lang: 'css' },
    scss: { kind: 'code', lang: 'scss' },
    less: { kind: 'code', lang: 'less' },
    vue: { kind: 'code', lang: 'xml' },
    gradle: { kind: 'code', lang: 'gradle' },
    tf: { kind: 'code', lang: 'terraform' },
    dockerfile: { kind: 'code', lang: 'dockerfile' },
    makefile: { kind: 'code', lang: 'makefile' },
    txt: { kind: 'text' },
    log: { kind: 'text' },
    md5: { kind: 'text' },
    gitignore: { kind: 'text' },
    gitattributes: { kind: 'text' },
};
/**
 * 图片扩展名 → MIME 白名单（raw 端点 + md 内嵌图片改写共用）。
 * svg 故意排除：svg 可内嵌脚本，img 上下文虽不执行，但被直接导航打开即同源执行，不进白名单。
 */
export const IMAGE_MIME = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
};
/** 二进制扩展名黑名单（第一道防线；第二道 = 空字节嗅探）。 */
const BINARY_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
    'pdf', 'psd', 'ai',
    'zip', 'gz', 'xz', 'bz2', '7z', 'rar', 'tar', 'jar', 'war', 'ear', 'nupkg', 'whl', 'tgz',
    'exe', 'dll', 'so', 'dylib', 'o', 'a', 'obj', 'lib', 'pyc', 'pyo',
    'class', 'dex', 'apk', 'aab', 'ipa', 'dmg', 'msi',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a',
    'mp4', 'webm', 'avi', 'mkv', 'mov', 'wmv', 'flv',
    'db', 'sqlite', 'sqlite3', 'mdb', 'bin', 'dat', 'iso', 'vhd',
]);
/** 取文件名的扩展名（小写，无点）；无扩展名返回 ''。 */
function extOf(name) {
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1)
        return '';
    return name.slice(i + 1).toLowerCase();
}
/**
 * 判定文件查看类型：
 * - 扩展名在图片白名单 → image（raw 端点直出）；
 * - 扩展名在黑名单 → binary；
 * - 扩展名在 EXT_MAP → md / code / text（md/code 附带高亮语言）；
 * - 未知扩展名 → text（宽进，交给空字节嗅探兜底）。
 */
export function detectType(name) {
    const ext = extOf(name);
    if (IMAGE_MIME[ext])
        return 'image';
    if (BINARY_EXTS.has(ext))
        return 'binary';
    const mapped = EXT_MAP[ext];
    return mapped ? mapped.kind : 'text';
}
/** 文件名对应的高亮语言（md/code 用；其余 undefined）。 */
export function langFor(name) {
    const mapped = EXT_MAP[extOf(name)];
    return mapped?.lang;
}
/** 树根解析：配置 override > 会话工作区 > process.cwd()。override 相对路径按工作区解析。 */
export function resolveRoot(workspace, override) {
    const base = workspace && workspace.trim() !== '' ? workspace.trim() : process.cwd();
    if (override && override.trim() !== '') {
        return pathResolve(base, override.trim());
    }
    return pathResolve(base);
}
/**
 * 穿越防护：把相对路径解析到树根之下。
 * normalize + resolve 后校验前缀（root 本身或 root+sep），不满足抛 403。
 * 尾部分隔符归一化（兼容 root 为盘符根如 E:\ 的场景），`+ sep` 后缀防前缀碰撞。
 * 绝对路径（盘符/POSIX 根；md 内嵌图片可能写绝对路径）直接解析后同样校验在树根内——
 * 安全边界不变（仍在 root 前缀内才放行），只是放宽「必须是相对路径」的形态限制。
 */
export function resolveWithinRoot(root, relPath) {
    const rootNorm = pathResolve(root).replace(/[\\/]+$/, '');
    const target = isAbsolute(relPath)
        ? pathResolve(normalize(relPath))
        : pathResolve(normalize(join(rootNorm, relPath)));
    const prefix = rootNorm + sep;
    if (target !== rootNorm && !target.startsWith(prefix)) {
        throw new FileViewError(403, '路径越界（禁止访问工作区外文件）');
    }
    return target;
}
/**
 * 单层目录列表（懒加载）。排除隐藏名（exclude）；单个条目 stat 失败跳过（权限/损坏）。
 * 目录在前、名称排序。
 */
export async function listDir(root, relPath, exclude) {
    const full = resolveWithinRoot(root, relPath);
    const st = await fs.stat(full).catch(() => undefined);
    if (!st)
        throw new FileViewError(404, `路径不存在: ${relPath || '/'}`);
    if (!st.isDirectory())
        throw new FileViewError(400, '不是目录: ' + (relPath || '/'));
    const names = await fs.readdir(full);
    const entries = [];
    for (const name of names) {
        if (exclude.includes(name))
            continue;
        try {
            const s = await fs.stat(join(full, name));
            if (s.isDirectory()) {
                entries.push({ name, type: 'dir' });
            }
            else if (s.isFile()) {
                entries.push({ name, type: 'file', size: s.size });
            }
            // 其他（符号链接/socket 等）忽略
        }
        catch {
            /* 权限不足/读取失败 → 跳过该条目 */
        }
    }
    entries.sort((a, b) => {
        if (a.type !== b.type)
            return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return entries;
}
/**
 * 读取文本文件内容（带大小上限与二进制嗅探）：
 * - 扩展名判定 binary → 415 拒绝（不读盘）；
 * - 读取 min(size, maxBytes) 字节，首块含空字节（\0）→ 415 拒绝；
 * - 超过 maxBytes → 截断并置 truncated（返回已读部分 + 真实 size 供前端提示）。
 */
export async function readText(root, relPath, maxBytes) {
    const full = resolveWithinRoot(root, relPath);
    const st = await fs.stat(full).catch(() => undefined);
    if (!st)
        throw new FileViewError(404, `路径不存在: ${relPath}`);
    if (!st.isFile())
        throw new FileViewError(400, '不是文件: ' + relPath);
    const kind = detectType(basename(full));
    if (kind === 'binary' || kind === 'image') {
        throw new FileViewError(415, '二进制文件不支持文本查看: ' + relPath);
    }
    const cap = Math.max(1, maxBytes);
    const readLen = Math.min(st.size, cap);
    const buf = Buffer.allocUnsafe(Math.max(1, readLen));
    const fh = await fs.open(full, 'r');
    try {
        const { bytesRead } = await fh.read(buf, 0, readLen, 0);
        const slice = buf.subarray(0, bytesRead);
        // 空字节嗅探（第二道二进制防线）
        if (slice.includes(0)) {
            throw new FileViewError(415, '二进制文件不支持查看: ' + relPath);
        }
        return {
            content: slice.toString('utf8'),
            type: kind,
            lang: langFor(basename(full)),
            truncated: st.size > cap,
            size: st.size,
        };
    }
    finally {
        await fh.close();
    }
}
/**
 * 读取图片（raw 端点）：扩展名必须在 IMAGE_MIME 白名单（svg 不在内），超上限抛 413。
 * 与文本的 maxBytes 互相独立（图片按 maxImageBytes 控制）。
 */
export async function readImage(root, relPath, maxBytes) {
    const full = resolveWithinRoot(root, relPath);
    const st = await fs.stat(full).catch(() => undefined);
    if (!st)
        throw new FileViewError(404, `路径不存在: ${relPath}`);
    if (!st.isFile())
        throw new FileViewError(400, '不是文件: ' + relPath);
    const mime = IMAGE_MIME[extOf(basename(full))];
    if (!mime)
        throw new FileViewError(415, '非预览支持的图片类型: ' + relPath);
    if (st.size > maxBytes) {
        throw new FileViewError(413, `图片过大（${st.size} 字节，上限 ${maxBytes}）: ${relPath}`);
    }
    const buf = await fs.readFile(full);
    return { buf, mime, size: st.size };
}
/**
 * 保存 md 文件（编辑回写）：
 * - 拒绝 .git 路径段（防写入版本库内部）与 .. 段（resolveWithinRoot 也会拦，双保险）；
 * - 目标必须已存在且是 md（编辑只更新已有文件，不提供"另存为/新建"）；
 * - 临时文件写入 + rename 原子替换（Node 在 Windows 用 MoveFileEx 覆盖语义），
 *   避免写一半崩溃留下残缺文件；临时文件失败时尽力清理。
 */
export async function saveText(root, relPath, content) {
    const segs = relPath.split(/[\\/]+/);
    if (segs.some((s) => s === '.git' || s === '..')) {
        throw new FileViewError(403, '路径不允许保存: ' + relPath);
    }
    const full = resolveWithinRoot(root, relPath);
    const st = await fs.stat(full).catch(() => undefined);
    if (!st)
        throw new FileViewError(404, '目标文件不存在（编辑仅更新已有文件）: ' + relPath);
    if (!st.isFile())
        throw new FileViewError(400, '不是文件: ' + relPath);
    if (detectType(basename(full)) !== 'md') {
        throw new FileViewError(415, '仅支持保存 md 文件: ' + relPath);
    }
    const tmp = `${full}.meow-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.writeFile(tmp, content, 'utf8');
    try {
        await fs.rename(tmp, full);
    }
    catch (err) {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
    }
    return { absPath: full, size: Buffer.byteLength(content, 'utf8') };
}
