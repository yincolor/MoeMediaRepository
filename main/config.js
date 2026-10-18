/**
 * config.js - 共享配置模块（纯 Node，不依赖 Electron）
 *
 * 集中管理常量与路径计算，供主进程与更新线程复用，避免两处配置不一致。
 */
const path = require('node:path');

const APP_NAME = 'MoeMediaRepository';

const DB_FILE_NAME = 'media.db';
const DB_GZ_FILE_NAME = 'media.db.gz';
const UPDATE_PREFIX_FILE = 'update_url_prefix';

/** 更新线程内的检测/重试间隔（毫秒） */
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
/** 距上次成功更新多久后可再次更新（小时） */
const UPDATE_HOURS = 23;
/** 更新请求超时时间（毫秒） */
const UPDATE_REQUEST_TIMEOUT_MS = 30000;
/** 更新失败后的最大重试次数（首次尝试不计入，共最多 1 + 10 次尝试） */
const UPDATE_MAX_RETRIES = 10;
/** 空库或 time 全为空时，回填最近多少天的增量数据（兜底） */
const INITIAL_BACKFILL_DAYS = 32;

/** 日志文件名前缀：主进程与更新线程分文件写日志，避免并发写同一文件 */
const LOG_PREFIX_MAIN = 'main';
const LOG_PREFIX_UPDATE = 'update';

function dbDir(userDataDir) {
    return path.join(userDataDir, 'db');
}

function dbFilePath(userDataDir) {
    return path.join(dbDir(userDataDir), DB_FILE_NAME);
}

function logsDir(userDataDir) {
    return path.join(userDataDir, 'logs');
}

function tmpDir(userDataDir) {
    return path.join(userDataDir, 'tmp');
}

function updatePrefixFilePath(userDataDir) {
    return path.join(userDataDir, UPDATE_PREFIX_FILE);
}

function posterDir(userCacheDir) {
    return path.join(userCacheDir, APP_NAME, 'poster');
}

/**
 * 构造更新线程的 workerData
 * @param {object} opts - { dbFilePath, logsDir, updatePrefixFilePath }
 */
function buildWorkerData({ dbFilePath: workerDbFilePath, logsDir: workerLogsDir, updatePrefixFilePath: workerPrefixFilePath }) {
    return {
        dbFilePath: workerDbFilePath,
        logsDir: workerLogsDir,
        updatePrefixFilePath: workerPrefixFilePath,
        updateHours: UPDATE_HOURS,
        retryIntervalMs: UPDATE_INTERVAL_MS,
        requestTimeoutMs: UPDATE_REQUEST_TIMEOUT_MS,
        maxRetries: UPDATE_MAX_RETRIES,
        initialBackfillDays: INITIAL_BACKFILL_DAYS
    };
}

module.exports = {
    APP_NAME,
    DB_FILE_NAME,
    DB_GZ_FILE_NAME,
    UPDATE_PREFIX_FILE,
    UPDATE_INTERVAL_MS,
    UPDATE_HOURS,
    UPDATE_REQUEST_TIMEOUT_MS,
    UPDATE_MAX_RETRIES,
    INITIAL_BACKFILL_DAYS,
    LOG_PREFIX_MAIN,
    LOG_PREFIX_UPDATE,
    dbDir,
    dbFilePath,
    logsDir,
    tmpDir,
    updatePrefixFilePath,
    posterDir,
    buildWorkerData
};
