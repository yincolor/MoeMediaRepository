/**
 * update.js - 每日增量更新模块
 *
 * 处理 .json.gz 解压后得到的更新数据，格式为 { 站点名: [影视记录, ...] }，
 * 按规则清洗、合并并写入数据库：
 *  1. 字段归一（MacCMS 风格 vod_name/vod_pic/vod_play_url/... 字段）；
 *  2. 数据清洗（去空白、合并标签、日期解析、年份补全、简介去 HTML）；
 *  3. 按 vid 查重：存在则更新，不存在则新增；
 *  4. 单次调用在 db.transaction 内执行，失败自动回滚。
 *
 * 数据库表结构参考项目根目录 sql_cfg.json（t_info / t_poster / t_playlist）。
 */
const Database = require('better-sqlite3');
const log = require('../core/log.js');

/**
 * URL 安全的 Base64 编码函数
 * @param {string} str - 需要编码的字符串
 * @returns {string} - URL 安全的 Base64 编码结果（无填充）
 */
function base64Encode(str) {
    if (!str) return '';
    return Buffer.from(String(str), 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * 从多个候选键中取第一个非空值
 */
function pick(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

/**
 * 解析日期字符串为 yyyy-MM-dd 格式
 * @param {string} dateStr - 日期字符串
 * @returns {string} - 格式化后的日期字符串，解析失败返回空字符串
 */
function parseDate(dateStr) {
    if (!dateStr || dateStr === undefined || dateStr === '' || dateStr === null) return '';

    dateStr = String(dateStr).trim();
    if (!dateStr) return '';

    const dateObj = new Date(dateStr);
    if (!isNaN(dateObj.getTime())) {
        const year = dateObj.getFullYear();
        if (year >= 1900 && year <= 2100) {
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    }

    let parsed;
    const isoMatch = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
        const day = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
        parsed = `${year}-${month}-${day}`;
    } else {
        const anyDateMatch = dateStr.match(/(\d{4})(?:[^\d]*)(\d{1,2})(?:[^\d]*)(\d{1,2})/);
        if (anyDateMatch) {
            const year = parseInt(anyDateMatch[1], 10);
            const month = String(parseInt(anyDateMatch[2], 10)).padStart(2, '0');
            const day = String(parseInt(anyDateMatch[3], 10)).padStart(2, '0');
            parsed = `${year}-${month}-${day}`;
        }
    }

    return parsed || '';
}

/**
 * 将可能是数组或逗号分隔字符串的值转换为去重后的字符串数组
 */
function toList(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map(v => String(v).trim()).filter(v => v))];
    }
    if (value && typeof value === 'string') {
        return [...new Set(value.split(',').map(v => v.trim()).filter(v => v))];
    }
    return [];
}

/**
 * 清洗单条记录，输出与数据库字段一一对应的对象
 * @param {object} record - 原始记录
 * @returns {object} - 清洗后的对象
 */
function cleanRecord(record) {
    const vid = String(pick(record, 'vid') || '').trim();
    const name = String(pick(record, 'name', 'vod_name') || '').trim();
    const groupName = String(pick(record, 'group_name', 'group', 'type_name') || '').trim();
    const sourceSite = String(record._source_site || '').trim();

    const subname = toList(pick(record, 'subname', 'vod_sub'));
    const tags = toList(pick(record, 'tags', 'vod_tags', 'vod_tag'));

    let posters = [];
    const posterRaw = pick(record, 'posters', 'poster', 'vod_pic', 'pic');
    if (Array.isArray(posterRaw)) {
        posters = [...new Set(posterRaw.map(u => String(u).trim()).filter(u => u))];
    } else if (posterRaw && typeof posterRaw === 'string') {
        posters = [...new Set(posterRaw.split(',').map(u => u.trim()).filter(u => u))];
    }

    const pubdate = parseDate(pick(record, 'pubdate', 'vod_pubdate'));
    const time = parseDate(pick(record, 'time', 'vod_time'));

    let year = '';
    const yearRaw = pick(record, 'year', 'vod_year');
    if (yearRaw && /^\d{4}$/.test(String(yearRaw))) {
        year = String(yearRaw);
    } else if (pubdate) {
        const yearMatch = pubdate.match(/^(\d{4})/);
        if (yearMatch) year = yearMatch[1];
    }

    const stripHtml = (str) => String(str || '').replace(/<[^>]*>/g, '').trim();
    // 优先取完整简介（vod_content），其次取摘要（vod_blurb）
    const intro = stripHtml(pick(record, 'intro', 'vod_intro', 'vod_content', 'vod_blurb'));

    // 播放列表：
    // 1) 新格式：MacCMS 风格 vod_play_url（$ 分隔集名与URL，# 分隔剧集，$$$ 分隔播放来源组），
    //    站点名使用更新数据顶层站点名（record._source_site）；
    // 2) 兼容旧格式：playlist 对象 { siteName: "集名$url" } 或 { siteName: { vod_play_url: "..." } }。
    const playlist = {};
    const playlistRaw = pick(record, 'playlist');
    if (playlistRaw && typeof playlistRaw === 'object') {
        for (const [siteName, item] of Object.entries(playlistRaw)) {
            if (!item) continue;
            let urlList = '';
            if (typeof item === 'string') {
                urlList = item;
            } else if (typeof item === 'object') {
                urlList = String(item.vod_play_url || item.url_list || '');
            }
            if (urlList.trim()) {
                playlist[siteName] = urlList.trim();
            }
        }
    }
    const playUrlRaw = pick(record, 'vod_play_url');
    if (playUrlRaw && typeof playUrlRaw === 'string') {
        const urlList = playUrlRaw.trim();
        if (urlList) {
            const siteName = sourceSite || 'default';
            playlist[siteName] = urlList;
        }
    }

    return {
        vid,
        media_type: groupName,
        name,
        subname,
        name_en: String(pick(record, 'name_en', 'vod_name_en', 'vod_en') || '').trim(),
        letter: String(pick(record, 'letter', 'vod_letter') || '').trim(),
        tags,
        actor: String(pick(record, 'actor', 'vod_actor') || '').trim(),
        director: String(pick(record, 'director', 'vod_director') || '').trim(),
        writer: String(pick(record, 'writer', 'vod_writer') || '').trim(),
        pubdate,
        area: String(pick(record, 'area', 'vod_area') || '').trim(),
        year,
        time,
        intro,
        posters,
        playlist
    };
}

/**
 * 将 { 站点名: [记录, ...] } 格式的更新数据扁平化为记录数组，
 * 并在每条记录上附加 _source_site 字段，供 cleanRecord 作为播放来源站点名使用。
 * @param {object} updateData - 以站点名为键、影视记录数组为值的更新数据
 * @returns {object[]} - 附加了 _source_site 的记录数组
 */
function flattenUpdateData(updateData) {
    const records = [];
    for (const [siteName, list] of Object.entries(updateData)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (item && typeof item === 'object') {
                records.push({ ...item, _source_site: siteName });
            }
        }
    }
    return records;
}

/**
 * 统计更新数据中的影视记录条数（数组或 { 站点名: [记录, ...] } 两种格式）
 * @param {object|object[]} updateData - 更新数据
 * @returns {number} - 记录条数
 */
function countUpdateRecords(updateData) {
    if (Array.isArray(updateData)) return updateData.length;
    if (!updateData || typeof updateData !== 'object') return 0;
    return Object.values(updateData).reduce(
        (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
        0
    );
}

/**
 * 更新数据库（使用传入的数据库连接），单次调用包裹在一个事务中
 * @param {object|object[]} records - 清洗前的更新数据：
 *   - 新格式：{ 站点名: [影视记录, ...] }
 *   - 兼容旧格式：[影视记录, ...]
 * @param {Database} database - 数据库连接对象
 * @returns {{insertedCount:number, updatedCount:number}} - 更新统计信息
 */
function updateDatabaseWithConnection(records, database) {
    if (!database || (database instanceof Database) === false) {
        throw new Error('database 参数必须是数据库连接对象');
    }
    if (!records || typeof records !== 'object') {
        throw new Error('records 参数必须是数组或对象');
    }

    // 新格式：{ 站点名: [记录, ...] } → 扁平化并附带站点名
    const recordList = Array.isArray(records) ? records : flattenUpdateData(records);

    let updatedCount = 0;
    let insertedCount = 0;

    const upsert = database.transaction((cleanedList) => {
        for (const item of cleanedList) {
            const nameEncoded = base64Encode(item.name);

            const existing = database.prepare(`
                SELECT * FROM t_info WHERE vid = ?
            `).get(item.vid);

            if (existing) {
                const updates = [];
                const params = [];

                // media_type：仅当原值为空且新值非空时补全
                if ((!existing.media_type) && item.media_type) {
                    updates.push('media_type = ?');
                    params.push(item.media_type);
                }

                // subname：合并且去重
                const newSubnames = item.subname.map(s => base64Encode(s));
                const existingSubnames = existing.subname ? existing.subname.split(',').filter(s => s) : [];
                const mergedSubnames = [...new Set([...existingSubnames, ...newSubnames])];
                if (mergedSubnames.join(',') !== (existing.subname || '')) {
                    updates.push('subname = ?');
                    params.push(mergedSubnames.join(','));
                }

                // tags：合并且去重
                const existingTags = existing.tags ? existing.tags.split(',').filter(t => t) : [];
                const mergedTags = [...new Set([...existingTags, ...item.tags])];
                if (mergedTags.join(',') !== (existing.tags || '')) {
                    updates.push('tags = ?');
                    params.push(mergedTags.join(','));
                }

                // 仅在原值为空时补全的字段
                const fillableFields = ['actor', 'director', 'writer', 'pubdate', 'area', 'year'];
                for (const field of fillableFields) {
                    const newValue = item[field];
                    const existingValue = existing[field];
                    if ((!existingValue || existingValue === '') && newValue) {
                        updates.push(`${field} = ?`);
                        params.push(['actor', 'director', 'writer'].includes(field) ? base64Encode(newValue) : newValue);
                    }
                }

                // time：新值为合法日期时覆盖
                if (item.time && parseDate(item.time)) {
                    updates.push('time = ?');
                    params.push(parseDate(item.time));
                }

                // name_en：取更长者
                if (item.name_en) {
                    const newEncoded = base64Encode(item.name_en);
                    if (!existing.name_en || newEncoded.length > existing.name_en.length) {
                        updates.push('name_en = ?');
                        params.push(newEncoded);
                    }
                }

                // letter：取更长者
                if (item.letter && (!existing.letter || item.letter.length > existing.letter.length)) {
                    updates.push('letter = ?');
                    params.push(item.letter);
                }

                // intro：取更长者
                if (item.intro) {
                    const newEncoded = base64Encode(item.intro);
                    if (!existing.intro || newEncoded.length > existing.intro.length) {
                        updates.push('intro = ?');
                        params.push(newEncoded);
                    }
                }

                if (updates.length > 0) {
                    params.push(existing.vid);
                    database.prepare(`UPDATE t_info SET ${updates.join(', ')} WHERE vid = ?`).run(...params);
                    updatedCount++;
                }

                // 海报：新增缺失的 URL
                if (item.posters.length > 0) {
                    const existingUrls = database.prepare(`
                        SELECT url FROM t_poster WHERE vid = ?
                    `).all(existing.vid).map(r => r.url);
                    for (const url of item.posters) {
                        if (!existingUrls.includes(url)) {
                            database.prepare(`INSERT INTO t_poster (vid, url) VALUES (?, ?)`).run(existing.vid, url);
                        }
                    }
                }

                // 播放链接：按站点新增或更新
                for (const [siteName, urlList] of Object.entries(item.playlist)) {
                    const urlListEncoded = base64Encode(urlList);
                    const existingPlaylist = database.prepare(`
                        SELECT id FROM t_playlist WHERE vid = ? AND site_name = ?
                    `).get(existing.vid, siteName);

                    if (existingPlaylist) {
                        database.prepare(`
                            UPDATE t_playlist SET url_list = ? WHERE id = ?
                        `).run(urlListEncoded, existingPlaylist.id);
                    } else {
                        database.prepare(`
                            INSERT INTO t_playlist (vid, site_name, url_list) VALUES (?, ?, ?)
                        `).run(existing.vid, siteName, urlListEncoded);
                    }
                }
            } else {
                const subnameEncoded = item.subname.map(s => base64Encode(s)).join(',');

                database.prepare(`
                    INSERT INTO t_info (
                        vid, media_type, name, subname, name_en, letter,
                        tags, actor, director, writer,
                        pubdate, area, year, time, intro
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    item.vid,
                    item.media_type || '',
                    nameEncoded,
                    subnameEncoded,
                    base64Encode(item.name_en),
                    item.letter || '',
                    item.tags.join(','),
                    base64Encode(item.actor),
                    base64Encode(item.director),
                    base64Encode(item.writer),
                    item.pubdate || '',
                    item.area || '',
                    item.year || '',
                    item.time || '',
                    base64Encode(item.intro)
                );

                for (const url of item.posters) {
                    database.prepare(`INSERT INTO t_poster (vid, url) VALUES (?, ?)`).run(item.vid, url);
                }

                for (const [siteName, urlList] of Object.entries(item.playlist)) {
                    database.prepare(`
                        INSERT INTO t_playlist (vid, site_name, url_list) VALUES (?, ?, ?)
                    `).run(item.vid, siteName, base64Encode(urlList));
                }

                insertedCount++;
            }
        }
    });

    try {
        const cleanedList = recordList.map(cleanRecord).filter(r => r.vid && r.name);
        log.info('update', `已清洗更新数据，需更新的数据对象：${cleanedList.length}个`); 
        upsert(cleanedList);
    } catch (e) {
        log.error('update', `更新数据库失败: ${e.message}`);
        throw e;
    }

    log.info('update', `更新完成 传入 ${recordList.length} 条记录 新增 ${insertedCount} 条 更新 ${updatedCount} 条`);
    return { insertedCount, updatedCount };
}

module.exports = {
    base64Encode,
    parseDate,
    cleanRecord,
    flattenUpdateData,
    countUpdateRecords,
    updateDatabaseWithConnection
};
