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
/** ui-deliverables 发布的 produced 条目形状（鸭子类型，不 import 其类型）。 */
export interface ProducedPath {
    readonly seq: number;
    readonly path: string;
}
/** 取路径最后一段（`/` 或 `\` 分隔；无分隔符原样返回）。 */
export declare function basenameOf(path: string): string;
/** 取扩展名（小写、无点；无扩展名返回 ''）。 */
export declare function extOf(path: string): string;
/**
 * 是否可由本插件查看器打开：图片白名单 ∪（非二进制黑名单）。
 * 未知扩展名 → 视为可查看（与 node 半 detectType 的「text 宽进 + 空字节嗅探兜底」一致）。
 */
export declare function isViewableFile(path: string): boolean;
/**
 * 测试类产物判定（**占位启发式**，仅按文件名）：
 * 真实的测试类产物应由未来测试报告插件以「自有工具调用 + 自有 turn 数据」判定
 * （见 docs/09 §案例）。本插件只对文件名形如 test-report / 测试报告 的产物
 * 演示路由占位 —— 点击给出提示而非打开查看器。
 */
export declare function looksLikeTestReport(path: string): boolean;
/**
 * 绝对产物路径 → 相对树根的 rel 路径（查看器 /api 只收树根内 rel）。
 * Windows 反斜杠与盘符大小写差异都归一；不在树根内返回 null（调用方回落原始路径，
 * 查看器会显示明确的加载失败 —— 比静默忽略更可诊断）。
 */
export declare function relWithinRoot(root: string | null | undefined, path: string): string | null;
/**
 * 从 'deliverables' turn 数据提取本回合产物路径（首见顺序去重）。
 * @param data - 鸭子类型的 turn 数据（`owner.turn.data.get('deliverables')` 原样）。
 * @param closingSeq - 回合 closing seq；其后才 settled 的调用不计入。
 */
export declare function producedPathsOf(data: unknown, closingSeq: number): string[];
/**
 * turnTail 链槽 selector（鸭子类型 owner，纯函数）：
 * 接受 = 返回本回合产物路径（作为组件 matched）；拒绝 = null（回落官方产物行）。
 * 任何异常都拒绝 —— selector 抛错只会让本条目行渲染异常，拒绝则整行交给官方，
 * 与本插件「失败降级」惯例一致。
 */
export declare function selectTurnArtifacts(owner: unknown): readonly string[] | null;
