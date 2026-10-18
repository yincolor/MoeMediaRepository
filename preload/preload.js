/**
 * preload.js - 预加载脚本
 * 通过 contextBridge 向渲染进程暴露白名单 API（window.moebox）。
 * 只做桥接，不写业务逻辑。
 */
const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('moebox', {
    /**
     * 退出应用
     */
    quit: () => {
        ipcRenderer.send('quit-app');
    },

    /**
     * 跳转页面
     * @param {string} oldPage - 旧页面文件名（如 home.html）
     * @param {string} newPage - 新页面文件名（如 detail.html）
     */
    gotoPage: (oldPage, newPage) => {
        ipcRenderer.send('goto-page', oldPage, newPage);
    },

    /**
     * 返回上一页
     */
    backPage: () => {
        ipcRenderer.send('back-page');
    },

    /**
     * 获取影视信息列表
     * @param {Array<number>} vids - 影视 ID 列表
     * @returns {Promise<Array<object>>} - 影视信息数组
     */
    getInfoListByVidList: async (vids) => {
        return await ipcRenderer.invoke('get-info-list-by-vids', vids);
    },

    /**
     * 获取海报图片文件的本地路径列表（仅返回本地缓存已存在的，不等待网络下载）
     * 缺失的海报由主进程异步下载，下载保存成功后通过 onUpdatePoster（update-poster 事件）推送。
     * @param {Array<string|number>} vids - 影视 ID 列表
     * @returns {Promise<Object<string|number, string>>} - 以 vid 为键、本地海报文件路径为值的对象（仅缓存部分）
     */
    getPosterFilePathListByVids: async (vids) => {
        return await ipcRenderer.invoke('get-poster-file-path-list-by-vids', vids);
    },

    /**
     * 获取播放链接列表
     * @param {Array<number>} vids - 影视 ID 列表
     * @returns {Promise<Object<number, Object<string, string>>>} - 以 vid、site_name 为键的播放链接映射
     */
    getPlaylistsListByVidList: async (vids) => {
        return await ipcRenderer.invoke('get-playlists-by-vids', vids);
    },

    /**
     * 根据筛选条件获取影视 ID 列表（分页）
     * @param {{group: string, year: string, tags: string[], area: string, letter: string, season: string}} filter - 筛选条件
     * @param {number} pageIndex - 页码（从 1 开始）
     * @param {number} pageSize - 每页数量
     * @returns {Promise<Array<number>>} - vid 数组
     */
    getVidsByFilter: async (filter, pageIndex, pageSize) => {
        return await ipcRenderer.invoke('get-vids-by-filter', filter, pageIndex, pageSize);
    },

    /**
     * 获取影视类型列表（media_type 去重）
     * @returns {Promise<Array<string>>} - 类型名称数组
     */
    getGroupNames: async () => {
        return await ipcRenderer.invoke('get-group-names');
    },

    /**
     * 获取站点配置（site_name → 标题映射）
     * @returns {Promise<Object<string, {name: string, title: string}>>} - 站点配置对象
     */
    getSiteCfg: async () => {
        return await ipcRenderer.invoke('get-site-cfg');
    },

    /**
     * 获取最近更新的影视列表
     * @returns {Promise<Array<{vid: number, pubdate: string, time: string}>>} - 最近更新列表
     */
    getRecentVids: async () => {
        return await ipcRenderer.invoke('get-recent-vids');
    },

    /**
     * 监听主进程推送的海报更新数据
     * payload：{ vid, filePath } — 本地海报文件路径（主进程下载保存成功后推送）
     * @param {(data: {vid: string|number, filePath: string}) => void} callback - 回调函数
     */
    onUpdatePoster: (callback) => {
        ipcRenderer.on('update-poster', (ev, posterData) => {
            callback(posterData);
        });
    },

    /**
     * 获取当前是否为已打包发布的状态
     * @returns {Promise<boolean>} - 是否已打包
     */
    appIsPackaged: async () => {
        return await ipcRenderer.invoke('app-is-packaged');
    }
});
