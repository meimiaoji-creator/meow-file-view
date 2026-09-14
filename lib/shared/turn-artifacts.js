/**
 * 回合产物（turnTail chips）纯逻辑层 —— client 半与 node 测试共用。
 *
 * 数据源：dsh 官方 ui-deliverables 插件（web-app bundle 必装）按回合发布的
 * `'deliverables'` turn 数据（本回合成功的 write / edit / str_replace_editor
 * 调用产物路径）。本插件**不重复注册** turn 数据定义，只鸭子类型读取 ——
 * ui-deliverables 缺位时读到 undefined，selector 拒绝，行自然不渲染。
 *
 * 全文件零依赖（无 node 内置 / 无 dsh / 无 react），主 tsconfig 会把它编到
 * lib/shared/ 供 node --test 使用；client 半经 tsdown 内联（纯度门禁安全）。
 */
/**
 * 图片扩展名白名单 —— 镜像 node 半 `src/files.ts` 的 IMAGE_MIME 键。
 * ⚠️ 两边故意复制（client 不能引 node 模块）：改表需同步两处 + 测试。
 * svg 同样故意排除（防同源脚本执行面），与 node 半口径一致。
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
/**
 * 二进制扩展名黑名单 —— 镜像 node 半 `src/files.ts` 的 BINARY_EXTS。
 * 命中 = 查看器 /content 端点必 415，客户端就不该路由给查看器（走 Host 打开）。
 */
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
/** 取路径最后一段（`/` 或 `\` 分隔；无分隔符原样返回）。 */
export function basenameOf(path) {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i >= 0 ? path.slice(i + 1) : path;
}
/** 取扩展名（小写、无点；无扩展名返回 ''）。 */
export function extOf(path) {
    const name = basenameOf(path);
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1)
        return '';
    return name.slice(i + 1).toLowerCase();
}
/**
 * 是否可由本插件查看器打开：图片白名单 ∪（非二进制黑名单）。
 * 未知扩展名 → 视为可查看（与 node 半 detectType 的「text 宽进 + 空字节嗅探兜底」一致）。
 */
export function isViewableFile(path) {
    const ext = extOf(path);
    if (IMAGE_EXTS.has(ext))
        return true;
    return !BINARY_EXTS.has(ext);
}
/**
 * 测试类产物判定（**占位启发式**，仅按文件名）：
 * 真实的测试类产物应由未来测试报告插件以「自有工具调用 + 自有 turn 数据」判定
 * （见 docs/09 §案例）。本插件只对文件名形如 test-report / 测试报告 的产物
 * 演示路由占位 —— 点击给出提示而非打开查看器。
 */
export function looksLikeTestReport(path) {
    return /(?:test|spec)[-_]?(?:report|result)|(?:report|result)[-_]?(?:test|spec)|测试(?:报告|结果)/i
        .test(basenameOf(path));
}
/**
 * 绝对产物路径 → 相对树根的 rel 路径（查看器 /api 只收树根内 rel）。
 * Windows 反斜杠与盘符大小写差异都归一；不在树根内返回 null（调用方回落原始路径，
 * 查看器会显示明确的加载失败 —— 比静默忽略更可诊断）。
 */
export function relWithinRoot(root, path) {
    if (!root || !path)
        return null;
    const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '');
    const r = norm(root);
    const p = norm(path);
    if (!r || !p)
        return null;
    if (r.toLowerCase() === p.toLowerCase())
        return '';
    const prefix = `${r.toLowerCase()}/`;
    if (!p.toLowerCase().startsWith(prefix))
        return null;
    return p.slice(r.length + 1);
}
/**
 * 从 'deliverables' turn 数据提取本回合产物路径（首见顺序去重）。
 * @param data - 鸭子类型的 turn 数据（`owner.turn.data.get('deliverables')` 原样）。
 * @param closingSeq - 回合 closing seq；其后才 settled 的调用不计入。
 */
export function producedPathsOf(data, closingSeq) {
    if (typeof data !== 'object' || data === null)
        return [];
    const produced = data.produced;
    if (!Array.isArray(produced))
        return [];
    const paths = [];
    const seen = new Set();
    for (const entry of produced) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const { seq, path } = entry;
        if (typeof path !== 'string' || path.length === 0)
            continue;
        if (typeof seq !== 'number' || seq > closingSeq)
            continue;
        if (seen.has(path))
            continue;
        seen.add(path);
        paths.push(path);
    }
    return paths;
}
/**
 * turnTail 链槽 selector（鸭子类型 owner，纯函数）：
 * 接受 = 返回本回合产物路径（作为组件 matched）；拒绝 = null（回落官方产物行）。
 * 任何异常都拒绝 —— selector 抛错只会让本条目行渲染异常，拒绝则整行交给官方，
 * 与本插件「失败降级」惯例一致。
 */
export function selectTurnArtifacts(owner) {
    try {
        const o = owner;
        const data = o?.turn?.data?.get?.('deliverables');
        const closingSeq = typeof o?.seq === 'number' ? o.seq : Number.POSITIVE_INFINITY;
        const paths = producedPathsOf(data, closingSeq);
        return paths.length > 0 ? paths : null;
    }
    catch {
        return null;
    }
}
