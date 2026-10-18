/**
 * main.js - 应用主进程入口
 * 职责：应用生命周期、窗口管理、IPC 注册、数据库初始化、更新线程调度。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const log = require('./core/log.js');
const { decompressGzipFile } = require('./core/compress.js');
const { getProjectRoot } = require('./core/rootpath.js');
const { nowDateTimeStr, computeUpdateSchedule } = require('./core/schedule.js');
const config = require('./config.js');
const {
    openDatabase,
    closeDatabase,
    getInfosByVidList,
    getPostersByVidList,
    getPlaylistsByVidList,
    getVidsByFilter,
    getGroupNames,
    getRecentVids,
    getLastUpdateTime
} = require('./db/sql.js');
const { getCachedPosterFilePathListByVids, processMissingPosterFiles } = require('./poster/poster.js');

app.setName(config.APP_NAME);

const PosterDownloadControllers = {};
let PosterDownloadTaskIndex = 0;
const pageHistory = [];

let mainWindow = null;
let db = null;
let updateWorker = null;
let updateStartTimer = null;

/**
 * 应用根目录：开发环境为项目根目录，打包后为 process.resourcesPath
 */
function getAppRoot() {
    return app.isPackaged ? process.resourcesPath : getProjectRoot();
}

/**
 * 用户数据目录
 */
function userDataPath() {
    return app.getPath('userData');
}

/**
 * 用户缓存目录（OS 级缓存目录，Electron 42 已移除 app.getPath('cache')）
 */
function userCacheDir() {
    if (process.platform === 'win32') {
        return process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
    }
    if (process.platform === 'darwin') {
        return path.join(app.getPath('home'), 'Library', 'Caches');
    }
    return process.env.XDG_CACHE_HOME || path.join(app.getPath('home'), '.cache');
}

/**
 * 确保用户数据目录结构存在
 */
function ensureUserDataDirs() {
    for (const dir of [
        config.dbDir(userDataPath()),
        config.logsDir(userDataPath()),
        config.tmpDir(userDataPath()),
        config.posterDir(userCacheDir())
    ]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

/**
 * 若目标文件不存在，则从源路径复制
 */
function copyIfMissing(sourcePath, destPath, label) {
    if (fs.existsSync(destPath)) {
        log.info('app', `使用已存在的${label}：${destPath}`);
        return;
    }
    if (!fs.existsSync(sourcePath)) {
        log.warn('app', `${label}源文件不存在：${sourcePath}`);
        return;
    }
    fs.copyFileSync(sourcePath, destPath);
    log.info('app', `${label}已从 ${sourcePath} 复制到 ${destPath}`);
}

/**
 * 处理数据库文件（首次启动将 media.db.gz 解压到用户数据目录），返回数据库文件路径
 */
async function getDatabasePath() {
    const sourcePath = path.join(getAppRoot(), config.DB_GZ_FILE_NAME);
    const destPath = config.dbFilePath(userDataPath());
    if (!fs.existsSync(destPath)) {
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`初始数据库压缩包不存在: ${sourcePath}`);
        }
        try {
            await decompressGzipFile(sourcePath, destPath);
        } catch (error) {
            fs.rmSync(destPath, { force: true });
            throw new Error(`数据库解压失败: ${sourcePath} -> ${destPath}, ${error.message}`);
        }
        log.info('app', `数据库已从 ${sourcePath} 解压到 ${destPath}`);
    } else {
        log.info('app', `使用已存在的数据库：${destPath}`);
    }
    return destPath;
}

/**
 * 启动更新线程
 */
function startUpdateWorker() {
    if (updateWorker) return;

    const workerData = config.buildWorkerData({
        dbFilePath: config.dbFilePath(userDataPath()),
        logsDir: config.logsDir(userDataPath()),
        updatePrefixFilePath: config.updatePrefixFilePath(userDataPath())
    });

    const worker = new Worker(path.join(__dirname, 'worker', 'update-worker.js'), { workerData });
    updateWorker = worker;

    worker.on('message', (msg) => {
        if (msg && msg.type === 'done') {
            if (msg.success) {
                log.info('update', `更新线程完成: ${JSON.stringify(msg.summary)}`);
            } else {
                log.warn('update', `更新线程结束但未成功: ${JSON.stringify(msg)}`);
            }
            stopUpdateWorker();
        }
    });

    worker.on('error', (err) => {
        log.error('update', `更新线程异常: ${err.message}`);
        updateWorker = null;
    });

    worker.on('exit', (code) => {
        log.info('update', `更新线程已退出，退出码: ${code}`);
        updateWorker = null;
    });
}

/**
 * 停止更新线程：先发送 stop 指令让其清理，超时后强制 terminate
 */
function stopUpdateWorker() {
    if (!updateWorker) return;
    const worker = updateWorker;
    updateWorker = null;

    try {
        worker.postMessage({ type: 'stop' });
    } catch (e) {
        // 忽略发送失败
    }

    const killTimer = setTimeout(() => {
        try {
            worker.terminate();
        } catch (e) {
            // 忽略终止失败
        }
    }, 1000);
    if (killTimer.unref) killTimer.unref();
}

/**
 * 从数据库 t_info.time 获取上次更新时间；
 * 空库或 time 全为空时，按 INITIAL_BACKFILL_DAYS 生成兜底时间。
 */
function getInitialLastUpdateTime() {
    const lastUpdateTime = getLastUpdateTime();
    if (lastUpdateTime) {
        return lastUpdateTime;
    }

    const fallbackTime = nowDateTimeStr(new Date(Date.now() - config.INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000));
    log.info('update', `数据库中无有效更新时间，使用回填兜底 ${fallbackTime}（最近 ${config.INITIAL_BACKFILL_DAYS} 天）`);
    return fallbackTime;
}

/**
 * 初始化更新调度：
 *  - 已到可更新时间 → 立即启动更新线程；
 *  - 否则定时到下次可更新时间再启动更新线程。
 */
function initUpdateScheduler() {
    const lastUpdateTime = getInitialLastUpdateTime();
    const now = new Date();
    const schedule = computeUpdateSchedule(lastUpdateTime, now, config.UPDATE_HOURS);

    if (schedule.due) {
        log.info('update', '已到可更新时间，立即启动更新线程');
        startUpdateWorker();
        return;
    }

    const delayMs = Math.max(0, schedule.nextRunAt - now.getTime());
    log.info('update', `距下次可更新时间约 ${(delayMs / 3600000).toFixed(1)} 小时（${Math.round(delayMs / 60000)} 分钟），届时启动更新线程`);
    updateStartTimer = setTimeout(() => {
        updateStartTimer = null;
        startUpdateWorker();
    }, delayMs);
}

/**
 * 取消所有在途的海报下载任务
 */
function abortAllPosterDownloads() {
    for (const key in PosterDownloadControllers) {
        if (PosterDownloadControllers[key]) {
            PosterDownloadControllers[key].abort();
        }
    }
}

/**
 * 退出前清理：清除更新定时器并停止更新线程
 */
function cleanup() {
    if (updateStartTimer) {
        clearTimeout(updateStartTimer);
        updateStartTimer = null;
    }
    stopUpdateWorker();
}

/**
 * 注册全部 IPC 通道
 */
function registerIpcHandlers() {

    ipcMain.on('quit-app', async () => {
        cleanup();
        for (const win of BrowserWindow.getAllWindows()) {
            win.close();
        }
        closeDatabase();
    });

    ipcMain.on('goto-page', (ev, oldPage, newPage) => {
        log.info('page', `跳转页面: ${oldPage} -> ${newPage}`);
        const htmlPath = path.join(__dirname, '../renderer/page', newPage);
        mainWindow.loadFile(htmlPath);
        pageHistory.push(oldPage);
        abortAllPosterDownloads();
    });

    ipcMain.on('back-page', () => {
        if (pageHistory.length > 0) {
            const backPage = pageHistory.pop();
            mainWindow.loadFile(path.join(__dirname, '../renderer/page', backPage));
            log.info('page', `返回上一页: ${backPage}`);
            abortAllPosterDownloads();
            return;
        }
        log.info('page', '返回上一页失败：页面历史为空');
    });

    ipcMain.handle('get-info-list-by-vids', async (ev, vids) => {
        log.info('db', `查询影视信息，vid 列表长度: ${Array.isArray(vids) ? vids.length : 0}`);
        return getInfosByVidList(vids);
    });

    ipcMain.handle('get-poster-file-path-list-by-vids', async (ev, vids) => {
        log.info('poster', `获取海报文件路径，vid 列表长度: ${Array.isArray(vids) ? vids.length : 0}`);

        const cachedMap = getCachedPosterFilePathListByVids(config.posterDir(userCacheDir()), vids);

        const vidList = Array.isArray(vids) ? vids : [];
        const missingVids = vidList.filter(vid => !cachedMap[vid]);
        if (missingVids.length > 0) {
            const taskId = PosterDownloadTaskIndex++;
            const controller = new AbortController();
            PosterDownloadControllers[taskId] = controller;

            processMissingPosterFiles(missingVids, {
                posterDir: config.posterDir(userCacheDir()),
                getPosterUrlsByVids: getPostersByVidList,
                controller,
                onPosterSaved: (vid, filePath) => {
                    log.info('poster', `海报已下载保存，推送渲染进程: vid=${vid}, filePath=${filePath}`);
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send('update-poster', { vid, filePath });
                    }
                }
            }).catch(error => {
                log.error('poster', `缺失海报下载任务失败: ${error.message}`);
            }).finally(() => {
                delete PosterDownloadControllers[taskId];
            });
        }

        return cachedMap;
    });

    ipcMain.handle('get-playlists-by-vids', async (ev, vids) => {
        log.info('db', `查询播放链接，vid 列表长度: ${Array.isArray(vids) ? vids.length : 0}`);
        return getPlaylistsByVidList(vids);
    });

    ipcMain.handle('get-vids-by-filter', async (ev, filter, pageIndex, pageSize) => {
        log.info('db', `条件筛选: ${JSON.stringify(filter)}, 页码: ${pageIndex}, 每页: ${pageSize}`);
        return getVidsByFilter(filter, pageIndex, pageSize);
    });

    ipcMain.handle('get-group-names', async () => {
        log.info('db', '查询影视类型列表');
        return getGroupNames();
    });

    ipcMain.handle('get-site-cfg', async () => {
        log.info('config', '获取站点配置');
        const siteCfgPath = path.join(getAppRoot(), 'site_cfg.json');
        if (!fs.existsSync(siteCfgPath)) {
            log.warn('config', `站点配置文件不存在: ${siteCfgPath}`);
            return {};
        }
        return JSON.parse(fs.readFileSync(siteCfgPath, 'utf8'));
    });

    ipcMain.handle('get-recent-vids', async () => {
        log.info('db', '查询最近更新影视列表');
        return getRecentVids();
    });

    ipcMain.handle('app-is-packaged', async () => {
        return app.isPackaged;
    });
}

async function main() {
    await app.whenReady();
    log.info('app', 'electron app 模块已准备就绪');

    app.on('window-all-closed', () => {
        app.quit();
    });

    app.on('before-quit', () => {
        cleanup();
    });

    ensureUserDataDirs();
    log.init(config.logsDir(userDataPath()), config.LOG_PREFIX_MAIN);
    log.info('app', `当前主进程根路径：${getAppRoot()}`);
    log.info('app', `当前用户数据路径：${userDataPath()}`);

    copyIfMissing(path.join(getAppRoot(), config.UPDATE_PREFIX_FILE), config.updatePrefixFilePath(userDataPath()), '更新前缀文件');

    log.info('app', '创建主窗口');
    mainWindow = new BrowserWindow({
        height: 980,
        width: 1910,
        autoHideMenuBar: true,
        fullscreen: true,
        icon: path.join(__dirname, './icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            devTools: true
        }
    });

    log.info('app', '配置主进程-渲染进程事件回调');
    registerIpcHandlers();

    try {
        const dbPath = await getDatabasePath();
        log.info('db', `初始化数据库 ${dbPath}`);
        db = openDatabase(dbPath);
        log.info('db', '数据库初始化完成，加载界面');

        pageHistory.push('home.html');
        await mainWindow.loadFile(path.join(__dirname, '../renderer/page/home.html'));
        if (app.isPackaged === false) {
            mainWindow.webContents.openDevTools();
        }
        log.info('page', '界面加载完成');

        initUpdateScheduler();
    } catch (error) {
        log.error('app', `数据库初始化失败，退出应用: ${error.message}`);
        mainWindow.close();
    }
}

main();
