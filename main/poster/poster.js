/**
 * poster.js - 海报图片文件管理模块
 *
 * 海报图片统一保存在 <用户缓存目录>/MoeMediaRepository/poster/ 目录下，
 * 文件名为 <vid>.<jpg|png|webp|gif|bmp>（vid 为数据库中的字符串主键，可安全用作文件名）。
 *
 * 对外主要接口：
 *   - ensurePosterDir(posterDir)
 *   - getPosterFilePath(posterDir, vid)
 *   - getCachedPosterFilePathListByVids(posterDir, vids)   // 仅返回本地已缓存的文件路径
 *   - processMissingPosterFiles(missingVids, {             // 异步下载缺失海报，成功一个回调一次
 *         posterDir,          // 海报文件保存目录
 *         getPosterUrlsByVids,// 根据 vid 列表查询海报 URL 的函数，返回 { [vid]: [url, ...] }
 *         controller,         // 可选，AbortController，用于取消在途下载
 *         onPosterSaved       // (vid, filePath) => void，下载保存成功后回调
 *     })
 */
const fs = require('node:fs');
const path = require('node:path');
const log = require('../core/log.js');
const { getAxiosArrayBuffer } = require('../core/req.js');

/** 支持的海报图片扩展名（本地查找时按此顺序匹配） */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

/** URL 无法识别扩展名时使用的默认扩展名 */
const DEFAULT_EXTENSION = '.jpg';

/** 同时下载海报的并发数 */
const DOWNLOAD_CONCURRENCY = 6;

/**
 * 确保海报目录存在
 * @param {string} posterDir - 海报文件保存目录
 * @returns {string} - 传入的目录路径
 */
function ensurePosterDir(posterDir) {
    if (!posterDir) {
        throw new Error('posterDir 不能为空');
    }
    if (!fs.existsSync(posterDir)) {
        fs.mkdirSync(posterDir, { recursive: true });
        log.info('poster', `海报目录已创建: ${posterDir}`);
    }
    return posterDir;
}

/**
 * 在本地海报目录中查找指定 vid 的海报文件
 * @param {string} posterDir - 海报文件保存目录
 * @param {string|number} vid - 影视 ID
 * @returns {string|null} - 存在的海报文件完整路径；不存在返回 null
 */
function getPosterFilePath(posterDir, vid) {
    for (const ext of IMAGE_EXTENSIONS) {
        const filePath = path.join(posterDir, `${vid}${ext}`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

/**
 * 从 URL 路径中提取图片扩展名
 * @param {string} url - 海报 URL
 * @returns {string} - 形如 .jpg 的扩展名
 */
function getExtensionFromUrl(url) {
    try {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
        if (match) {
            const ext = match[1].toLowerCase();
            if (IMAGE_EXTENSIONS.includes(`.${ext}`)) {
                return `.${ext}`;
            }
        }
    } catch (e) {
        // URL 非法时走默认扩展名
    }
    return DEFAULT_EXTENSION;
}

/**
 * 依次尝试下载指定 vid 的海报并保存到本地，成功一个即返回
 * @param {string} posterDir - 海报文件保存目录
 * @param {string|number} vid - 影视 ID
 * @param {string[]} urls - 海报 URL 列表（按优先级顺序）
 * @param {AbortController} [controller] - 取消控制器
 * @returns {Promise<string|null>} - 保存成功的文件路径；全部失败或取消返回 null
 */
async function downloadAndSavePoster(posterDir, vid, urls, controller) {
    if (!urls || urls.length === 0) {
        log.info('poster', `vid=${vid} 没有海报 URL，跳过下载`);
        return null;
    }

    for (const url of urls) {
        if (controller && controller.signal && controller.signal.aborted) {
            log.info('poster', `海报下载已取消: vid=${vid}`);
            return null;
        }

        try {
            log.info('poster', `开始下载海报: vid=${vid}, url=${url}`);
            const arrayBuffer = await getAxiosArrayBuffer(url, controller);
            if (!arrayBuffer) {
                log.warn('poster', `海报响应为空: vid=${vid}, url=${url}`);
                continue;
            }

            const ext = getExtensionFromUrl(url);
            const filePath = path.join(posterDir, `${vid}${ext}`);
            fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
            log.info('poster', `海报已保存: ${filePath}`);
            return filePath;
        } catch (error) {
            if (controller && controller.signal && controller.signal.aborted) {
                log.info('poster', `海报下载已取消: vid=${vid}`);
                return null;
            }
            log.warn('poster', `海报下载失败，尝试下一个 URL: vid=${vid}, url=${url}, 错误: ${error.message}`);
        }
    }

    return null;
}

/**
 * 仅从本地海报目录查找一批 vid 的海报文件路径（不做任何网络请求）。
 * @param {string} posterDir - 海报文件保存目录
 * @param {Array<string|number>} vids - 影视 ID 列表
 * @returns {Object<string|number, string>} - 以 vid 为键、已存在的本地海报文件路径为值的对象
 */
function getCachedPosterFilePathListByVids(posterDir, vids) {
    const result = {};
    if (!vids || !Array.isArray(vids) || vids.length === 0) {
        return result;
    }

    ensurePosterDir(posterDir);
    for (const vid of vids) {
        const localPath = getPosterFilePath(posterDir, vid);
        if (localPath) {
            result[vid] = localPath;
        }
    }
    return result;
}

/**
 * 异步处理缺失的海报：查询海报 URL、网络下载并保存到本地。
 * 每保存成功一个，立即通过 onPosterSaved(vid, filePath) 回调（用于推送渲染进程）。
 * @param {Array<string|number>} missingVids - 本地缺失海报的 vid 列表
 * @param {{
 *   posterDir: string,
 *   getPosterUrlsByVids: (vids: Array<string|number>) => Promise<Object<string|number, string[]>>,
 *   controller?: AbortController,
 *   onPosterSaved?: (vid: string|number, filePath: string) => void
 * }} options - 依赖注入项
 * @returns {Promise<void>}
 */
async function processMissingPosterFiles(missingVids, options = {}) {
    const { posterDir, getPosterUrlsByVids, controller, onPosterSaved } = options;

    if (!missingVids || !Array.isArray(missingVids) || missingVids.length === 0) {
        return;
    }
    if (typeof getPosterUrlsByVids !== 'function') {
        throw new Error('getPosterUrlsByVids 必须为函数');
    }

    ensurePosterDir(posterDir);

    // 1. 查询缺失 vid 的海报 URL 列表
    let urlMap = {};
    try {
        urlMap = (await getPosterUrlsByVids(missingVids)) || {};
    } catch (error) {
        log.warn('poster', `查询海报 URL 失败: ${error.message}`);
    }

    // 2. 并发下载缺失的海报并保存到本地，成功一个回调一个
    let cursor = 0;
    const workerCount = Math.min(DOWNLOAD_CONCURRENCY, missingVids.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push((async () => {
            while (cursor < missingVids.length) {
                if (controller && controller.signal && controller.signal.aborted) {
                    return;
                }
                const vid = missingVids[cursor++];
                const filePath = await downloadAndSavePoster(posterDir, vid, urlMap[vid], controller);
                if (filePath && typeof onPosterSaved === 'function') {
                    onPosterSaved(vid, filePath);
                }
            }
        })());
    }
    await Promise.all(workers);
}

module.exports = {
    ensurePosterDir,
    getPosterFilePath,
    getCachedPosterFilePathListByVids,
    processMissingPosterFiles
};
