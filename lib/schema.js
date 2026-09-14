/**
 * meow-file-view 插件配置 —— 类型与归一化。
 *
 * 配置来自 cordis.patch.yml 的 `config:` 字段（web profile 下由 dsh 注入）。
 * 这里只做纯类型声明 + 缺省归一化，不引 schemastery（配置简单，防御性读取即可）。
 */
/** 单文件读取上限缺省：1MB。 */
export const DEFAULT_MAX_BYTES = 1024 * 1024;
/** 单图片读取上限缺省：20MB。 */
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** 目录树隐藏名缺省。 */
export const DEFAULT_EXCLUDE = ['node_modules', '.git'];
/** 归一化配置：null/undefined → 空对象；非法字段回落缺省。 */
export function normalizeConfig(config) {
    const c = config ?? {};
    return {
        root: typeof c.root === 'string' && c.root.trim() !== '' ? c.root.trim() : undefined,
        maxBytes: typeof c.maxBytes === 'number' && Number.isFinite(c.maxBytes) && c.maxBytes > 0
            ? Math.floor(c.maxBytes)
            : DEFAULT_MAX_BYTES,
        exclude: Array.isArray(c.exclude) && c.exclude.length > 0
            ? c.exclude.map((x) => String(x).trim()).filter((x) => x !== '')
            : DEFAULT_EXCLUDE,
        edit: c.edit !== false,
        maxImageBytes: typeof c.maxImageBytes === 'number' && Number.isFinite(c.maxImageBytes) && c.maxImageBytes > 0
            ? Math.floor(c.maxImageBytes)
            : DEFAULT_MAX_IMAGE_BYTES,
    };
}
