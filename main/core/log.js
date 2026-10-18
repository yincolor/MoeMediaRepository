/**
 * log.js - 主进程日志模块
 * 级别：Debug / Info / Warn / Error / Fatal
 * 格式：[时间戳] [级别] [模块] 消息
 * 输出：控制台 + 用户数据目录 logs/ 下按天滚动的文件，保留 1 年。
 */
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const RETAIN_DAYS = 365;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let logDir = null;
let logPrefix = 'moe';
let currentDate = '';

function pad(n) {
    return String(n).padStart(2, '0');
}

/**
 * 格式化时间戳：yyyy-MM-dd HH:mm:ss.SSS
 */
function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 初始化日志目录，并清理超过保留期的日志文件
 * @param {string} dir - 日志目录路径
 */
function init(dir, prefix = 'moe') {
    if (!dir) {
        throw new Error('日志目录不能为空');
    }
    logDir = dir;
    logPrefix = prefix || 'moe';
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    cleanupOldLogs();
    console.log(`[log.js] 日志目录已初始化: ${logDir}`);
}

/**
 * 清理超过保留期的日志文件
 */
function cleanupOldLogs() {
    if (!logDir || !fs.existsSync(logDir)) return;
    try {
        const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
        for (const name of fs.readdirSync(logDir)) {
            const file = path.join(logDir, name);
            const stat = fs.statSync(file);
            if (stat.isFile() && stat.mtimeMs < cutoff) {
                fs.unlinkSync(file);
                console.log(`[log.js] 清理过期日志: ${name}`);
            }
        }
    } catch (e) {
        console.error(`[log.js] 清理过期日志失败: ${e.message}`);
    }
}

/**
 * 返回当天日志文件路径；超过 10MB 则追加序号
 */
function currentLogFile() {
    const date = todayStr();
    let file = path.join(logDir, `${logPrefix}_${date}.log`);
    let seq = 1;
    while (fs.existsSync(file) && fs.statSync(file).size >= MAX_FILE_SIZE) {
        file = path.join(logDir, `${logPrefix}_${date}_${String(seq).padStart(2, '0')}.log`);
        seq++;
    }
    return file;
}

/**
 * 写入一条日志
 * @param {string} level - 级别
 * @param {string} moduleName - 模块名
 * @param {string} message - 消息
 */
function write(level, moduleName, message) {
    const line = `[${timestamp()}] [${level}] [${moduleName}] ${message}`;
    // 控制台输出
    if (level === 'ERROR' || level === 'FATAL') {
        console.error(line);
    } else if (level === 'WARN') {
        console.warn(line);
    } else {
        console.log(line);
    }
    // 文件输出
    if (!logDir) return;
    try {
        fs.appendFileSync(currentLogFile(), line + '\n', 'utf8');
    } catch (e) {
        console.error(`[log.js] 写入日志失败: ${e.message}`);
    }
}

function debug(moduleName, message) { write('DEBUG', moduleName, message); }
function info(moduleName, message) { write('INFO', moduleName, message); }
function warn(moduleName, message) { write('WARN', moduleName, message); }
function error(moduleName, message) { write('ERROR', moduleName, message); }
function fatal(moduleName, message) { write('FATAL', moduleName, message); }

module.exports = {
    LEVELS,
    init,
    debug,
    info,
    warn,
    error,
    fatal
};
