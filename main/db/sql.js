/**
 * sql.js - 数据库操作模块（better-sqlite3 单连接）
 *
 * 数据表结构参考项目根目录 sql_cfg.json：
 *  - t_info：影视基础信息（vid 主键，含 media_type 类型字段）
 *  - t_poster：海报 URL（vid 关联）
 *  - t_playlist：播放链接（vid + site_name，url_list 为 base64 编码的格式化文本）
 *
 * 中文等文本字段入库前经过 URL-safe Base64 编码，出库统一解码。
 * 数据库连接在 main.js 中初始化（openDatabase），退出时关闭（closeDatabase）。
 */
const Database = require('better-sqlite3');
const log = require('../core/log.js');

/**
 * @type {Database|null} - 模块级数据库连接对象，保持单例连接
 */
let db = null;

/**
 * URL 安全的 Base64 解码函数
 * @param {string} str - 需要解码的 Base64 字符串
 * @returns {string} - 解码后的原始字符串，空值返回空字符串
 */
function base64Decode(str) {
    if (!str) return '';
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString('utf-8');
}

/**
 * 打开数据库连接（单例）
 * @param {string} dbFilePath - 数据库文件路径
 * @returns {Database} - 数据库连接对象
 * @throws {Error} - 打开数据库失败时抛出异常
 */
function openDatabase(dbFilePath) {
    if (db) {
        log.warn('db', '数据库连接已存在，跳过重复打开');
        return db;
    }
    try {
        db = new Database(dbFilePath);
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        log.info('db', `数据库连接已打开: ${dbFilePath}`);
        return db;
    } catch (e) {
        log.error('db', `打开数据库失败: ${e.message}`);
        throw e;
    }
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        log.info('db', '数据库连接已关闭');
    }
}

/**
 * 根据 vid 列表获取影视基础信息列表
 * @param {number[]} vids - 影视 ID 数组
 * @returns {Array<{
 *   vid: number, media_type: string, name: string, subname: string[],
 *   name_en: string, letter: string, tags: string[], actor: string,
 *   director: string, writer: string, pubdate: string, area: string,
 *   year: string, time: string, intro: string
 * }>} - 影视信息列表，空数组表示无匹配数据
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getInfosByVidList(vids) {
    if (!db) throw new Error('数据库连接未初始化');
    if (!vids || !Array.isArray(vids) || vids.length === 0) return [];

    const placeholders = vids.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT * FROM t_info WHERE vid IN (${placeholders})
    `).all(...vids);

    return rows.map(row => ({
        vid: row.vid,
        media_type: row.media_type || '',
        name: base64Decode(row.name),
        subname: row.subname ? row.subname.split(',').map(s => base64Decode(s)).filter(s => s) : [],
        name_en: base64Decode(row.name_en),
        letter: row.letter || '',
        tags: row.tags ? row.tags.split(',').filter(t => t) : [],
        actor: base64Decode(row.actor),
        director: base64Decode(row.director),
        writer: base64Decode(row.writer),
        pubdate: row.pubdate || '',
        area: row.area || '',
        year: row.year != null ? String(row.year) : '',
        time: row.time || '',
        intro: base64Decode(row.intro)
    }));
}

/**
 * 根据 vid 列表获取海报 URL 列表
 * @param {number[]} vids - 影视 ID 数组
 * @returns {Object<number, string[]>} - 以 vid 为键，海报 URL 数组为值的对象
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getPostersByVidList(vids) {
    if (!db) throw new Error('数据库连接未初始化');
    if (!vids || !Array.isArray(vids) || vids.length === 0) return {};

    const placeholders = vids.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT vid, url FROM t_poster WHERE vid IN (${placeholders})
    `).all(...vids);

    const result = {};
    for (const row of rows) {
        if (!result[row.vid]) result[row.vid] = [];
        result[row.vid].push(row.url);
    }
    return result;
}

/**
 * 根据 vid 列表获取播放链接列表
 * @param {number[]} vids - 影视 ID 数组
 * @returns {Object<number, Object<string, string>>} -
 *   以 vid 为键，site_name 为二级键，解码后的播放链接文本为值
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getPlaylistsByVidList(vids) {
    if (!db) throw new Error('数据库连接未初始化');
    if (!vids || !Array.isArray(vids) || vids.length === 0) return {};

    const placeholders = vids.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT vid, site_name, url_list FROM t_playlist WHERE vid IN (${placeholders})
    `).all(...vids);

    const result = {};
    for (const row of rows) {
        if (!result[row.vid]) result[row.vid] = {};
        result[row.vid][row.site_name] = base64Decode(row.url_list);
    }
    return result;
}

/**
 * 查询数据库中所有影视类型（media_type 去重，按数量降序）
 * @returns {string[]} - 类型名称数组
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getGroupNames() {
    if (!db) throw new Error('数据库连接未初始化');

    const rows = db.prepare(`
        SELECT media_type, COUNT(*) AS cnt FROM t_info
        WHERE media_type IS NOT NULL AND media_type != ''
        GROUP BY media_type ORDER BY cnt DESC
    `).all();

    return rows.map(row => row.media_type);
}

/**
 * 根据筛选条件筛选影视 ID 列表（分页）
 * @param {{
 *   group: string, year: string, tags: string[],
 *   area: string, letter: string, season: string
 * }} filter - 筛选条件对象，所有字段均可选；group 为影视类型（media_type），'all' 表示不筛选
 * @param {number} page - 页码（从 1 开始）
 * @param {number} pageSize - 每页数量，默认 30
 * @returns {number[]} - 符合筛选条件的 vid 数组，空数组表示无匹配数据
 * @throws {Error} - 数据库连接未初始化或筛选条件非法时抛出异常
 */
function getVidsByFilter(filter, page = 1, pageSize = 30) {
    if (!db) throw new Error('数据库连接未初始化');
    if (!filter || typeof filter !== 'object') throw new Error('筛选条件对象不能为空');

    const whereParts = [];
    const params = [];

    // 类型筛选：media_type
    if (filter.group && filter.group !== 'all') {
        whereParts.push('media_type = ?');
        params.push(filter.group);
    }

    // 年份筛选
    if (filter.year && filter.year !== 'all') {
        if (filter.year === '2000及以前') { 
            whereParts.push('CAST(year AS INTEGER) < ?');
            params.push(2001);
        } else {
            whereParts.push('year = ?');
            params.push(filter.year);
        }
    }

    // 标签筛选
    // 1) 排除关键词（「其他」）：tags NOT LIKE 每一个关键词（AND）
    if (filter.tagsExcludeKeywords && filter.tagsExcludeKeywords.length > 0) {
        const excludeConditions = filter.tagsExcludeKeywords.map(() => 'tags NOT LIKE ?');
        whereParts.push('(' + excludeConditions.join(' AND ') + ')');
        filter.tagsExcludeKeywords.forEach(tag => {
            params.push(`%${tag}%`);
        });
    } else if (filter.tags && filter.tags.length > 0 && !filter.tags.includes('all')) {
        // 2) 关键词列表中的每一项对 tags 字段模糊匹配（组内 OR）
        const tagConditions = filter.tags.map(() => 'tags LIKE ?');
        whereParts.push('(' + tagConditions.join(' OR ') + ')');
        filter.tags.forEach(tag => {
            params.push(`%${tag}%`);
        });
    }

    // 地区筛选
    if (filter.area && filter.area !== 'all') {
        const areaConditions = [];
        const areaParams = [];

        // 1) 排除关键词（「其他」）：area NOT LIKE 每一个关键词（AND）
        if (filter.areaExcludeKeywords && filter.areaExcludeKeywords.length > 0) {
            filter.areaExcludeKeywords.forEach(keyword => {
                areaConditions.push('area NOT LIKE ?');
                areaParams.push('%' + keyword + '%');
            });
            whereParts.push('(' + areaConditions.join(' AND ') + ')');
            params.push(...areaParams);
        } else if (filter.areaKeywords && filter.areaKeywords.length > 0) {
            // 2) 关键词列表（data-keyword 解析而来），逐项模糊匹配 area 字段（OR）
            filter.areaKeywords.forEach(keyword => {
                areaConditions.push('area LIKE ?');
                areaParams.push('%' + keyword + '%');
            });
            whereParts.push('(' + areaConditions.join(' OR ') + ')');
            params.push(...areaParams);
        } 
    }

    // 首字母筛选
    if (filter.letter && filter.letter !== 'all') {
        whereParts.push('letter = ?');
        params.push(filter.letter);
    }

    // 季度筛选：优先用 pubdate，为空时用 time
    // if (filter.season && filter.season !== 'all') {
    //     const seasonMonths = {
    //         '1月': ['01', '02', '03'],
    //         '4月': ['04', '05', '06'],
    //         '7月': ['07', '08', '09'],
    //         '10月': ['10', '11', '12']
    //     };
    //     const months = seasonMonths[filter.season];
    //     if (months) {
    //         const placeholders = months.map(() => '?').join(',');
    //         whereParts.push(`(CASE WHEN pubdate IS NOT NULL AND pubdate != '' THEN substr(pubdate, 6, 2) WHEN time IS NOT NULL AND time != '' THEN substr(time, 6, 2) ELSE '01' END) IN (${placeholders})`);
    //         params.push(...months);
    //     }
    // }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const rows = db.prepare(`
        SELECT vid FROM t_info ${whereClause}
        ORDER BY time DESC
        LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);

    return rows.map(row => row.vid);
}

/**
 * 获取最近更新的影视列表
 * 筛选条件：pubdate（发布日期）在最近四分之一年 OR time（更新时间）在最近 7 天
 * @returns {Array<{vid: number, pubdate: string, time: string}>} - 去重后的影视信息数组
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getRecentVids() {
    if (!db) throw new Error('数据库连接未初始化');

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // 最近四分之一年
    const quarterStart = new Date(now);
    quarterStart.setMonth(now.getMonth() - 3);
    const quarterStartStr = fmt(quarterStart);
    const nowStr = fmt(now);

    // 最近 7 天
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekStartStr = fmt(weekStart);

    const rows = db.prepare(`
        SELECT vid, pubdate, time FROM t_info
        WHERE (pubdate IS NOT NULL AND pubdate != '' AND pubdate >= ? AND pubdate <= ?)
           OR (time IS NOT NULL AND time != '' AND time >= ? AND time <= ?)
        ORDER BY vid
    `).all(quarterStartStr, nowStr, weekStartStr, nowStr);

    // 按 vid 去重
    const seen = new Set();
    const result = [];
    for (const row of rows) {
        if (!seen.has(row.vid)) {
            seen.add(row.vid);
            result.push({
                vid: row.vid,
                pubdate: row.pubdate || '',
                time: row.time || ''
            });
        }
    }

    return result;
}

/**
 * 获取数据库中最新的记录更新时间（t_info.time 最大值），并补上当前本地时间。
 * 等价于：MAX(time) || strftime(' %H:%M:%S','now','localtime')
 * 空表（MAX 为 NULL）或 time 全为空串时返回 null，由调用方决定兜底策略。
 * @returns {string|null} - yyyy-MM-dd HH:mm:ss 或 null
 * @throws {Error} - 数据库连接未初始化时抛出异常
 */
function getLastUpdateTime() {
    if (!db) throw new Error('数据库连接未初始化');

    const row = db.prepare(`
        SELECT MAX(time) || strftime(' %H:%M:%S', 'now', 'localtime') AS lastUpdateTime
        FROM t_info
    `).get();

    const value = row && row.lastUpdateTime ? String(row.lastUpdateTime).trim() : '';
    // 空表时 MAX 为 NULL；time 全为空串时拼接结果为纯时间串，均视为无有效更新时间
    if (!value || value.length < 11 || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return null;
    }
    return value;
}

module.exports = {
    openDatabase,
    closeDatabase,
    base64Decode,
    getInfosByVidList,
    getPostersByVidList,
    getPlaylistsByVidList,
    getVidsByFilter,
    getGroupNames,
    getRecentVids,
    getLastUpdateTime
};
