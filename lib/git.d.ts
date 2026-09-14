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
/** 插件 git 配置（设置页持久化；文件 = 插件根 git-config.json）。 */
export interface GitFileConfig {
    /** git 可执行文件路径；缺省 'git'（走 PATH）。 */
    gitExePath?: string;
    /** 仓库根覆盖：键 = 工作区树根（归一化后），值 = repo 根。探测失误时手动兜底。 */
    repoRoots?: Record<string, string>;
}
/** 产物路径的 git 探测结论（前端按此显隐 Diff 按钮）。 */
export type ProbeState = 'changed' | 'untracked' | 'unchanged' | 'nogit' | 'unavailable' | 'outside' | 'error';
/** 可注入的 git 命令执行结果。 */
export interface GitRunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** 可注入依赖（生产 = node fs/child_process；测试 = 假实现）。 */
export interface GitDeps {
    /** 向上探测某路径是否存在（目录或文件均可，worktree 的 .git 是文件）。 */
    exists(target: string): Promise<boolean>;
    /** 执行 git 命令。 */
    run(gitExe: string, args: string[], cwd: string): Promise<GitRunResult>;
    readText(file: string): Promise<string>;
    writeText(file: string, text: string): Promise<void>;
}
/** 生产依赖。 */
export declare const nodeGitDeps: GitDeps;
/** 归一化配置（纯函数）：剔除非法键值，repoRoots 键/值非空字符串才保留。 */
export declare function normalizeGitConfig(raw: unknown): GitFileConfig;
/** 配置 map 的键归一（正斜杠 + 去尾斜杠 + 小写，吸收 Windows 盘符/分隔符差异；纯函数）。 */
export declare function gitRootKey(root: string): string;
/** `git status --porcelain -- <rel>` 的输出分类（纯函数，可测）。 */
export declare function classifyPorcelain(output: string): 'untracked' | 'changed' | 'unchanged';
/** 仓库根 → 文件的 POSIX 相对路径；不在根内返回 null（纯函数，盘符/分隔符归一）。 */
export declare function gitRelPosix(repoRoot: string, absFile: string): string | null;
/** 生产单例的工厂（pluginRoot = 插件根目录，git-config.json 落在这里）。 */
export declare function createGitService(pluginRoot: string, deps?: GitDeps): {
    readConfig: () => Promise<GitFileConfig>;
    writeConfig: (raw: unknown) => Promise<GitFileConfig>;
    probe: (absFile: string, workspaceRoot: string | undefined) => Promise<ProbeState>;
    diff: (absFile: string, workspaceRoot: string | undefined, maxBytes: number) => Promise<{
        state: ProbeState;
        root?: string;
        diff?: string;
        truncated?: boolean;
    }>;
    configFile: string;
};
export type GitService = ReturnType<typeof createGitService>;
