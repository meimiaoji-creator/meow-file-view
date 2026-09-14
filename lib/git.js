/**
 * meow-file-view Git 差异层 —— 产物 diff 的探测与查询（deps 注入，可脱离 ctx 测试）。
 *
 * 两段式探测（失败模式各自清晰）：
 *   1. 有没有仓库：从文件目录向上找 `.git`（纯 fs，零 git.exe 依赖）；
 *      或命中用户在设置页配置的 repoRoots 覆盖（键 = 工作区树根）。
 *   2. git 命令可用：`git --version`（gitExePath 可配置，默认 PATH 上的 git）。
 *   两段都过才回答 changed / untracked / unchanged；其余一律降级
 *   （nogit / unavailable / outside / error），前端据此隐藏 Diff 按钮。
 *
 * diff 基准（2026-09 需求确认）：工作区+暂存区 vs HEAD（`git diff HEAD -- <rel>`）。
 * untracked 文件 `git diff HEAD` 无输出（未入 index）→ 回答 'untracked'，
 * 由前端把文件内容整体渲染为新增行（不调 --no-index，规避 Windows /dev/null 差异，
 * 也不动用户暂存区）。
 */
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
/** 生产依赖。 */
export const nodeGitDeps = {
    exists: async (target) => {
        try {
            await fs.access(target);
            return true;
        }
        catch {
            return false;
        }
    },
    run: (gitExe, args, cwd) => new Promise((resolve, reject) => {
        execFile(gitExe, args, { cwd, timeout: 8000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err !== undefined && err !== null && err.code === undefined) {
                reject(err); // 进程都没起来（ENOENT 等）
                return;
            }
            // exit 1 在 status/diff 的普通失败分支；ENOENT 类（无 code）已在上分支 reject
            resolve({ code: typeof err?.code === 'number' ? err.code : 0, stdout: String(stdout), stderr: String(stderr) });
        });
    }),
    readText: (file) => fs.readFile(file, 'utf8'),
    writeText: (file, text) => fs.writeFile(file, text, 'utf8'),
};
/** 归一化配置（纯函数）：剔除非法键值，repoRoots 键/值非空字符串才保留。 */
export function normalizeGitConfig(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null)
        return out;
    const obj = raw;
    if (typeof obj.gitExePath === 'string' && obj.gitExePath.trim() !== '') {
        out.gitExePath = obj.gitExePath.trim();
    }
    if (typeof obj.repoRoots === 'object' && obj.repoRoots !== null) {
        const map = {};
        for (const [key, value] of Object.entries(obj.repoRoots)) {
            if (key.trim() !== '' && typeof value === 'string' && value.trim() !== '') {
                map[key.trim()] = value.trim();
            }
        }
        if (Object.keys(map).length > 0)
            out.repoRoots = map;
    }
    return out;
}
/** 配置 map 的键归一（正斜杠 + 去尾斜杠 + 小写，吸收 Windows 盘符/分隔符差异；纯函数）。 */
export function gitRootKey(root) {
    return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
/** `git status --porcelain -- <rel>` 的输出分类（纯函数，可测）。 */
export function classifyPorcelain(output) {
    const lines = output.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '');
    if (lines.length === 0)
        return 'unchanged';
    // porcelain v1：'?? path' = 未跟踪；其余 XY（M/A/D/R/C…）= 已跟踪有变化
    return lines.some((line) => line.startsWith('??')) ? 'untracked' : 'changed';
}
/** 仓库根 → 文件的 POSIX 相对路径；不在根内返回 null（纯函数，盘符/分隔符归一）。 */
export function gitRelPosix(repoRoot, absFile) {
    const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '');
    const r = norm(repoRoot);
    const p = norm(absFile);
    if (!r || !p)
        return null;
    if (r.toLowerCase() === p.toLowerCase())
        return '';
    const prefix = `${r.toLowerCase()}/`;
    if (!p.toLowerCase().startsWith(prefix))
        return null;
    return p.slice(r.length + 1);
}
/** 生产单例的工厂（pluginRoot = 插件根目录，git-config.json 落在这里）。 */
export function createGitService(pluginRoot, deps = nodeGitDeps) {
    const configFile = `${pluginRoot}/git-config.json`;
    /** git 可用性缓存（按 exe 路径；进程内一次）。 */
    const availabilityCache = new Map();
    async function readConfig() {
        try {
            return normalizeGitConfig(JSON.parse(await deps.readText(configFile)));
        }
        catch {
            return {};
        }
    }
    async function writeConfig(raw) {
        const config = normalizeGitConfig(raw);
        await deps.writeText(configFile, `${JSON.stringify(config, null, 2)}\n`);
        return config;
    }
    function gitExe(config) {
        return config.gitExePath ?? 'git';
    }
    /** git 命令可用性（按 exe 缓存）。 */
    function available(config) {
        const exe = gitExe(config);
        let cached = availabilityCache.get(exe);
        if (cached === undefined) {
            cached = deps.run(exe, ['--version'], pluginRoot)
                .then((r) => r.code === 0 && r.stdout.trim().startsWith('git version'))
                .catch(() => false);
            availabilityCache.set(exe, cached);
        }
        return cached;
    }
    /** 从 startDir 向上找 .git（目录或文件）；到文件系统根为止。 */
    async function findGitRoot(startDir) {
        let dir = startDir;
        for (;;) {
            if (await deps.exists(`${dir}/.git`))
                return dir;
            const parent = dirname(dir);
            if (parent === dir)
                return null;
            dir = parent;
        }
    }
    /**
     * 解析一个产物文件的 git 仓库根：优先 repoRoots 覆盖（键 = 工作区树根），
     * 否则从文件目录上溯。返回 null = 无仓库（nogit）。
     */
    async function resolveRepoRoot(absFile, workspaceRoot, config) {
        if (workspaceRoot !== undefined && config.repoRoots !== undefined) {
            const override = config.repoRoots[gitRootKey(workspaceRoot)];
            if (override !== undefined)
                return override;
        }
        return findGitRoot(dirname(absFile));
    }
    /** 探测一个产物文件（abs 路径；workspaceRoot 仅用于 repoRoots 覆盖查找）。 */
    async function probe(absFile, workspaceRoot) {
        const config = await readConfig();
        const repoRoot = await resolveRepoRoot(absFile, workspaceRoot, config);
        if (repoRoot === null)
            return 'nogit';
        if (!(await available(config)))
            return 'unavailable';
        const rel = gitRelPosix(repoRoot, absFile);
        if (rel === null)
            return 'outside';
        const run = await deps
            .run(gitExe(config), ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', rel], repoRoot)
            .catch(() => null);
        if (run === null || run.code !== 0)
            return 'error';
        return classifyPorcelain(run.stdout);
    }
    /**
     * 取一个产物文件 vs HEAD 的差异。
     * 先跑 status 分类：untracked → { state }（前端用已加载的文件内容渲染全量新增；
     * `git diff HEAD` 对未跟踪文件输出为空，直接跑会把新文件误判成「无差异」）；
     * 已跟踪 → unified diff 文本（空输出 = unchanged）。
     */
    async function diff(absFile, workspaceRoot, maxBytes) {
        const config = await readConfig();
        const repoRoot = await resolveRepoRoot(absFile, workspaceRoot, config);
        if (repoRoot === null)
            return { state: 'nogit' };
        if (!(await available(config)))
            return { state: 'unavailable' };
        const rel = gitRelPosix(repoRoot, absFile);
        if (rel === null)
            return { state: 'outside' };
        const statusRun = await deps
            .run(gitExe(config), ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', rel], repoRoot)
            .catch(() => null);
        if (statusRun === null || statusRun.code !== 0)
            return { state: 'error' };
        if (classifyPorcelain(statusRun.stdout) === 'untracked')
            return { state: 'untracked', root: repoRoot };
        const run = await deps
            .run(gitExe(config), ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], repoRoot)
            .catch(() => null);
        if (run === null || run.code !== 0)
            return { state: 'error' };
        if (run.stdout === '')
            return { state: 'unchanged' };
        if (run.stdout.length > maxBytes) {
            return { state: 'changed', root: repoRoot, diff: run.stdout.slice(0, maxBytes), truncated: true };
        }
        return { state: 'changed', root: repoRoot, diff: run.stdout };
    }
    return { readConfig, writeConfig, probe, diff, configFile };
}
