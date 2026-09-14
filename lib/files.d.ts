/**
 * meow-file-view 纯文件系统层 —— 目录树 + 文本读取 + 图片读取 + md 保存 + 类型判定 + 穿越防护。
 *
 * 零 dsh 依赖（仅 node:fs / node:path），独立可测：
 * - 树根一经解析（resolveRoot），任何请求都不可越过（resolveWithinRoot 越界抛 403）；
 * - 文本读取有大小上限（maxBytes），超限截断并返回 truncated（仍返回已读部分 + 真实 size 供前端提示）；
 * - 二进制判定 = 扩展名黑名单 + 首块空字节嗅探双重保障；图片白名单（IMAGE_MIME）单独 raw 直出；
 * - md 保存（saveText）= 仅已有 md 文件 + 拒 .git 路径 + 临时文件写入后 rename 原子替换（Windows rename 带覆盖语义）。
 */
/** 目录条目（单层列表）。 */
export interface DirEntry {
    name: string;
    type: 'dir' | 'file';
    /** 文件字节数；目录不填。 */
    size?: number;
}
/** 文件内容判定类型。 */
export type FileKind = 'md' | 'code' | 'text' | 'image' | 'binary';
/** 文本读取结果。 */
export interface ReadResult {
    content: string;
    type: 'md' | 'code' | 'text';
    /** highlight.js 语言（code/md 用；text 缺省）。 */
    lang?: string;
    /** 是否因超过 maxBytes 被截断。 */
    truncated: boolean;
    /** 文件总字节数（即使截断也返回真实大小，前端提示用）。 */
    size: number;
}
/** 业务异常：携带 HTTP 状态码，供 web/api.ts 映射。 */
export declare class FileViewError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/**
 * 图片扩展名 → MIME 白名单（raw 端点 + md 内嵌图片改写共用）。
 * svg 故意排除：svg 可内嵌脚本，img 上下文虽不执行，但被直接导航打开即同源执行，不进白名单。
 */
export declare const IMAGE_MIME: Record<string, string>;
/**
 * 判定文件查看类型：
 * - 扩展名在图片白名单 → image（raw 端点直出）；
 * - 扩展名在黑名单 → binary；
 * - 扩展名在 EXT_MAP → md / code / text（md/code 附带高亮语言）；
 * - 未知扩展名 → text（宽进，交给空字节嗅探兜底）。
 */
export declare function detectType(name: string): FileKind;
/** 文件名对应的高亮语言（md/code 用；其余 undefined）。 */
export declare function langFor(name: string): string | undefined;
/** 树根解析：配置 override > 会话工作区 > process.cwd()。override 相对路径按工作区解析。 */
export declare function resolveRoot(workspace?: string, override?: string): string;
/**
 * 穿越防护：把相对路径解析到树根之下。
 * normalize + resolve 后校验前缀（root 本身或 root+sep），不满足抛 403。
 * 尾部分隔符归一化（兼容 root 为盘符根如 E:\ 的场景），`+ sep` 后缀防前缀碰撞。
 * 绝对路径（盘符/POSIX 根；md 内嵌图片可能写绝对路径）直接解析后同样校验在树根内——
 * 安全边界不变（仍在 root 前缀内才放行），只是放宽「必须是相对路径」的形态限制。
 */
export declare function resolveWithinRoot(root: string, relPath: string): string;
/**
 * 单层目录列表（懒加载）。排除隐藏名（exclude）；单个条目 stat 失败跳过（权限/损坏）。
 * 目录在前、名称排序。
 */
export declare function listDir(root: string, relPath: string, exclude: string[]): Promise<DirEntry[]>;
/**
 * 读取文本文件内容（带大小上限与二进制嗅探）：
 * - 扩展名判定 binary → 415 拒绝（不读盘）；
 * - 读取 min(size, maxBytes) 字节，首块含空字节（\0）→ 415 拒绝；
 * - 超过 maxBytes → 截断并置 truncated（返回已读部分 + 真实 size 供前端提示）。
 */
export declare function readText(root: string, relPath: string, maxBytes: number): Promise<ReadResult>;
/** 图片读取结果（raw 端点直出用）。 */
export interface ImageResult {
    buf: Buffer;
    mime: string;
    size: number;
}
/**
 * 读取图片（raw 端点）：扩展名必须在 IMAGE_MIME 白名单（svg 不在内），超上限抛 413。
 * 与文本的 maxBytes 互相独立（图片按 maxImageBytes 控制）。
 */
export declare function readImage(root: string, relPath: string, maxBytes: number): Promise<ImageResult>;
/** md 保存结果。 */
export interface SaveResult {
    absPath: string;
    size: number;
}
/**
 * 保存 md 文件（编辑回写）：
 * - 拒绝 .git 路径段（防写入版本库内部）与 .. 段（resolveWithinRoot 也会拦，双保险）；
 * - 目标必须已存在且是 md（编辑只更新已有文件，不提供"另存为/新建"）；
 * - 临时文件写入 + rename 原子替换（Node 在 Windows 用 MoveFileEx 覆盖语义），
 *   避免写一半崩溃留下残缺文件；临时文件失败时尽力清理。
 */
export declare function saveText(root: string, relPath: string, content: string): Promise<SaveResult>;
