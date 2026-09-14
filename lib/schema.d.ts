/**
 * meow-file-view 插件配置 —— 类型与归一化。
 *
 * 配置来自 cordis.patch.yml 的 `config:` 字段（web profile 下由 dsh 注入）。
 * 这里只做纯类型声明 + 缺省归一化，不引 schemastery（配置简单，防御性读取即可）。
 */
/** 插件配置。 */
export interface FileViewConfig {
    /** 树根覆盖（相对工作区解析；缺省 = 会话工作区）。 */
    root?: string;
    /** 单文件读取上限（字节，默认 1MB）。 */
    maxBytes?: number;
    /** 目录树隐藏名（默认隐藏 node_modules / .git，避免 dsh 工作区刷屏）。 */
    exclude?: string[];
    /** 允许浏览器端编辑并保存 md 文件（默认 true；dist 团队分发可置 false 关闭写入口）。 */
    edit?: boolean;
    /** 单图片读取上限（字节，默认 20MB；raw 端点 + md 内嵌图片共用）。 */
    maxImageBytes?: number;
}
/** 单文件读取上限缺省：1MB。 */
export declare const DEFAULT_MAX_BYTES: number;
/** 单图片读取上限缺省：20MB。 */
export declare const DEFAULT_MAX_IMAGE_BYTES: number;
/** 目录树隐藏名缺省。 */
export declare const DEFAULT_EXCLUDE: string[];
/** 归一化配置：null/undefined → 空对象；非法字段回落缺省。 */
export declare function normalizeConfig(config: Partial<FileViewConfig> | null | undefined): FileViewConfig;
