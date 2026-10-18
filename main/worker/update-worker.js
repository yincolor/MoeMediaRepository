/**
 * update-worker.js - 更新线程（worker_threads）
 *
 * 职责：定时检测更新、下载、解压、解析、写库。
 *  - 内部使用 isUpdating 互斥标志，防止上一轮更新未结束时下一轮定时触发导致重叠；
 *  - 更新成功后通知主进程并退出（由主进程 terminate 回收线程）；
 *  - 更新失败按固定间隔重试，直到成功或主进程停止线程。
 *
 * workerData 由 config.buildWorkerData 构造：
 *   dbFilePath / logsDir / updatePrefixFilePath /
 *   updateHours / retryIntervalMs / requestTimeoutMs / maxRetries / initialBackfillDays
 */
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const log = require('../core/log.js');
const config = require('../config.js');
const { decompressBufferSync } = require('../core/compress.js');
const { instance: httpClient } = require('../core/req.js');
const { nowDateTimeStr, buildDateList } = require('../core/schedule.js');
const { updateDatabaseWithConnection, countUpdateRecords } = require('../db/update.js');
const { openDatabase, closeDatabase, getLastUpdateTime } = require('../db/sql.js');

log.init(workerData.logsDir, config.LOG_PREFIX_UPDATE);

let db = null;
let isUpdating = false;
let retryTimer = null;
let stopped = false;
let finished = false;
let attemptCount = 0;

const retryIntervalMs = workerData.retryIntervalMs || config.UPDATE_INTERVAL_MS;
const requestTimeoutMs = workerData.requestTimeoutMs || config.UPDATE_REQUEST_TIMEOUT_MS;
const updateHours = workerData.updateHours || config.UPDATE_HOURS;
const maxRetries = workerData.maxRetries != null ? workerData.maxRetries : config.UPDATE_MAX_RETRIES;
const initialBackfillDays = workerData.initialBackfillDays != null ? workerData.initialBackfillDays : config.INITIAL_BACKFILL_DAYS;

function readUpdateUrlPrefix() {
    const file = workerData.updatePrefixFilePath;
    if (!fs.existsSync(file)) {
        log.warn('update', `更新前缀文件不存在: ${file}，本次更新跳过`);
        return null;
    }
    const prefix = fs.readFileSync(file, 'utf8').trim();
    if (!prefix) {
        log.warn('update', '更新前缀文件内容为空，本次更新跳过');
        return null;
    }
    return prefix;
}

/**
 * 执行一次完整的更新流程。
 * @returns {{success: boolean, reason?: string, summary?: object}}
 */
async function runUpdateOnce() {
    if (!db) {
        throw new Error('数据库连接未初始化');
    }

    const baseUrl = readUpdateUrlPrefix();
    if (!baseUrl) {
        return { success: false, reason: 'no-prefix' };
    }

    let lastUpdateTime = getLastUpdateTime();
    if (!lastUpdateTime) {
        lastUpdateTime = nowDateTimeStr(new Date(Date.now() - initialBackfillDays * 24 * 60 * 60 * 1000));
        log.info('update', `数据库中无有效更新时间，使用回填兜底 ${lastUpdateTime}（最近 ${initialBackfillDays} 天）`);
    }

    const dateList = buildDateList(lastUpdateTime, new Date(), updateHours);
    if (!dateList || dateList.length === 0) {
        log.info('update', '尚未到可更新时间，跳过本次更新');
        return { success: false, reason: 'not-due' };
    }

    const urlList = dateList.map(date => {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return {
            url: `${baseUrl}/${year}/${month}/${day}.json.gz`,
            date,
            dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        };
    });

    log.info('update', `准备请求 ${urlList.length} 个更新文件`);

    const downloadResults = [];
    for (let i = 0; i < urlList.length; i++) {
        const { url, date, dateStr } = urlList[i];
        const isToday = i === urlList.length - 1;

        try {
            log.info('update', `请求文件 ${i + 1}/${urlList.length}: ${url}`);
            const response = await httpClient.get(url, {
                responseType: 'arraybuffer',
                timeout: requestTimeoutMs
            });

            if (!response || !response.data) {
                throw new Error('响应为空');
            }

            const jsonStr = decompressBufferSync(response.data);
            const mergedData = JSON.parse(jsonStr);

            if (!mergedData || typeof mergedData !== 'object' || Array.isArray(mergedData)) {
                throw new Error('解压后的数据格式错误，期望对象（站点名 → 影视记录数组）');
            }

            const recordCount = countUpdateRecords(mergedData);
            downloadResults.push({ url, date, dateStr, mergedData, recordCount, success: true, isToday });
            log.info('update', `日期 ${dateStr} 请求成功: ${recordCount}条数据`);
        } catch (urlError) {
            log.error('update', `请求失败: ${url}, 错误: ${urlError.message}`);
            downloadResults.push({ url, date, dateStr, mergedData: null, recordCount: 0, success: false, isToday });
        }
    }

    const todayResult = downloadResults[downloadResults.length - 1];
    if (!todayResult || !todayResult.success) {
        log.info('update', '今天的更新文件请求失败，放弃本次更新，等待下次重试');
        return { success: false, reason: 'today-failed' };
    }

    const successfulResults = downloadResults.filter(r => r.success);
    log.info('update', `开始更新数据库，共 ${successfulResults.length} 个成功的文件`);

    let totalInserted = 0;
    let totalUpdated = 0;
    for (const result of successfulResults) {
        log.info('update', `更新数据库，日期: ${result.dateStr}，数据量: ${result.recordCount}条`);
        const { insertedCount, updatedCount } = updateDatabaseWithConnection(result.mergedData, db);
        totalInserted += insertedCount;
        totalUpdated += updatedCount;
        log.info('update', `日期 ${result.dateStr} 更新完成: 新增${insertedCount}条, 更新${updatedCount}条`);
    }

    log.info('update', `更新完成总计: 新增${totalInserted}条, 更新${totalUpdated}条, 总计${totalInserted + totalUpdated}条`);

    return {
        success: true,
        reason: 'ok',
        summary: { totalInserted, totalUpdated, files: successfulResults.length }
    };
}

/**
 * 结束更新线程：清理定时器与数据库连接，通知主进程后等待主进程 terminate。
 */
function finish(summary) {
    if (finished) return;
    finished = true;

    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    try {
        closeDatabase();
    } catch (e) {
        log.warn('update', `关闭数据库失败: ${e.message}`);
    }

    if (parentPort) {
        try {
            parentPort.postMessage({ type: 'done', ...summary });
        } catch (e) {
            log.warn('update', `发送完成消息失败: ${e.message}`);
        }
    }
}

function scheduleNextTick() {
    if (stopped || finished) return;
    retryTimer = setTimeout(tick, retryIntervalMs);
}

/**
 * 定时检测入口，使用 isUpdating 互斥，防止任务重叠。
 */
async function tick() {
    if (stopped || finished) return;
    if (isUpdating) {
        log.warn('update', '上一轮更新尚未结束，跳过本次触发');
        return;
    }

    isUpdating = true;
    attemptCount++;
    try {
        const result = await runUpdateOnce();
        if (result.success) {
            log.info('update', '更新成功，更新线程即将退出');
            finish({ success: true, summary: result.summary });
            return;
        }

        if (attemptCount > maxRetries) {
            log.warn('update', `连续 ${attemptCount} 次更新失败，超过上限（首次 + ${maxRetries} 次重试），放弃本次更新`);
            finish({ success: false, reason: 'max-retries-reached', attempts: attemptCount, lastReason: result.reason });
            return;
        }

        log.info('update', `本次未完成更新（${result.reason}），${Math.round(retryIntervalMs / 60000)} 分钟后重试`);
        scheduleNextTick();
    } catch (error) {
        log.error('update', `更新线程发生错误: ${error.message}`);

        if (attemptCount > maxRetries) {
            log.warn('update', `连续 ${attemptCount} 次更新失败，超过上限（首次 + ${maxRetries} 次重试），放弃本次更新`);
            finish({ success: false, reason: 'max-retries-reached', attempts: attemptCount, lastError: error.message });
            return;
        }

        scheduleNextTick();
    } finally {
        isUpdating = false;
    }
}

function start() {
    log.info('update', `更新线程启动，检测/重试间隔 ${Math.round(retryIntervalMs / 60000)} 分钟`);

    try {
        db = openDatabase(workerData.dbFilePath);
    } catch (e) {
        log.error('update', `更新线程打开数据库失败: ${e.message}`);
        finish({ success: false, reason: 'db-open-failed', message: e.message });
        return;
    }

    // 立即执行一次检测
    tick();
}

if (parentPort) {
    parentPort.on('message', (msg) => {
        if (!msg) return;
        if (msg.type === 'stop') {
            log.info('update', '收到主进程停止指令，更新线程清理并退出');
            stopped = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            try {
                closeDatabase();
            } catch (e) {
                log.warn('update', `关闭数据库失败: ${e.message}`);
            }
            parentPort.close();
        }
    });
}

start();
