/**
 * utils.js - 页面共享工具
 * 提供：网格列数计算、收藏管理、观看历史管理、海报文件路径获取、页面导航等工具函数。
 */
window.utils = window.utils || {};

/**
 * 检查当前 grid 布局下，每一行显示几个子元素
 * @param {HTMLDivElement} cardsParentElement - 容器元素
 * @returns {number} 每行元素数量
 */
window.utils.getCardContainerChildNumInRow = function (cardsParentElement) {
    const style = getComputedStyle(cardsParentElement);
    const columns = style.gridTemplateColumns.split(' ').length;
    return columns;
};

/**
 * 检查这个子元素，是父元素的第几个子元素（可传入筛选函数跳过部分元素）
 * @param {HTMLDivElement} checkChildElement - 需要检查序号的子元素
 * @param {(childElement:Element)=>boolean} filterElementCall - 筛选子元素的函数
 * @returns {number} 序号；未找到返回 -1
 */
window.utils.getIndexFromParent = function (checkChildElement, filterElementCall = null) {
    if (!checkChildElement || !checkChildElement.parentElement) {
        return -1;
    }
    const parentElement = checkChildElement.parentElement;
    const children = Array.from(parentElement.children);
    let index = -1;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (filterElementCall && !filterElementCall(child)) {
            continue;
        }
        index++;
        if (child === checkChildElement) {
            return index;
        }
    }
    return -1;
};

/* ======================== 收藏管理（localStorage） ======================== */

window.utils.favoriteVidsKey = 'favoriteVids';
window.utils.getFavoriteVids = function () {
    return JSON.parse(localStorage.getItem(window.utils.favoriteVidsKey)) || [];
};
window.utils.setFavoriteVids = function (vids) {
    vids = [...new Set(vids)];
    localStorage.setItem(window.utils.favoriteVidsKey, JSON.stringify(vids));
};
window.utils.addFavoriteVid = function (vid) {
    const favoriteVids = window.utils.getFavoriteVids();
    favoriteVids.push(vid);
    window.utils.setFavoriteVids(favoriteVids);
};
window.utils.delFavoriteVid = function (vid) {
    const favoriteVids = window.utils.getFavoriteVids();
    const filtered = favoriteVids.filter(id => String(id) !== String(vid));
    window.utils.setFavoriteVids(filtered);
};
window.utils.isFavoriteVid = function (vid) {
    return window.utils.getFavoriteVids().some(id => String(id) === String(vid));
};

/* ======================== 海报本地文件路径 ======================== */

/**
 * 将本地文件路径转换为 file:// URL（用于 CSS url() 与 img.src）
 * @param {string} filePath - 本地文件绝对路径
 * @returns {string} - file:// URL
 */
window.utils.pathToFileUrl = function (filePath) {
    if (!filePath) return filePath;
    var normalized = String(filePath).replace(/\\/g, '/');
    if (/^file:\/\//i.test(normalized)) return normalized;

    var parts = normalized.split('/');
    var encoded = parts.map(function (part, index) {
        // Windows 盘符（如 C:）不编码
        if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
        return encodeURIComponent(part);
    });
    var encodedPath = encoded.join('/');
    if (encodedPath.charAt(0) === '/') encodedPath = encodedPath.slice(1);
    return 'file:///' + encodedPath;
};

/**
 * 获取已缓存到本地的海报图片 file:// URL 列表（该调用不等待网络下载）。
 * 主进程只返回本地海报目录中已存在的文件路径；缺失的海报由主进程异步下载，
 * 下载保存成功后通过 onUpdatePoster（update-poster 事件）逐个推送给页面。
 * @param {Array<string|number>} vids - 影视 ID 列表
 * @param {(vid: string|number, fileUrl: string|null) => void} callback - 每个已缓存海报回调一次
 * @returns {Promise<Object<string|number, string>>} - 以 vid 为键、本地海报文件路径为值的对象（仅缓存部分）
 */
window.utils.getPosterObjectUrl = async function (vids, callback) {
    if (!vids || vids.length === 0) {
        return null;
    }
    console.log('[getPosterObjectUrl] vids:', vids);

    const filePathMap = await window.moebox.getPosterFilePathListByVids(vids);
    console.log('[getPosterObjectUrl] filePathMap:', filePathMap);

    vids.forEach(function (vid) {
        const filePath = filePathMap[vid];
        if (filePath && callback) {
            callback(vid, window.utils.pathToFileUrl(filePath));
        }
    });
    return filePathMap;
};

/* ======================== 页面导航 ======================== */

window.utils.gotoPage = function (oldPage, newPage) {
    window.moebox.gotoPage(oldPage, newPage);
};

window.utils.backPage = function () {
    window.moebox.backPage();
};

window.utils.exitApp = function () {
    window.moebox.quit();
};

/* ======================== 观看历史管理（localStorage） ======================== */

/**
 * 观看历史对象：{ maxIndex, vids: { [vid]: { index, site, playIndex } } }
 */
window.utils.historyObjectsKey = 'historyObjects';
window.utils.getHistoryObjects = function () {
    return JSON.parse(localStorage.getItem(window.utils.historyObjectsKey)) || { maxIndex: 0, vids: {} };
};
window.utils.setHistoryObjects = function (historyObjects) {
    localStorage.setItem(window.utils.historyObjectsKey, JSON.stringify(historyObjects));
};
window.utils.addHistoryObject = function (vid, site, playIndex) {
    const historyObjects = window.utils.getHistoryObjects();
    historyObjects.vids[vid] = { index: historyObjects.maxIndex, site, playIndex };
    historyObjects.maxIndex++;
    window.utils.setHistoryObjects(historyObjects);
};
window.utils.getHistoryObjectsList = function () {
    const historyObjects = window.utils.getHistoryObjects();
    const list = [];
    for (const vid of Object.keys(historyObjects.vids)) {
        const item = historyObjects.vids[vid];
        list.push({ vid, site: item.site, playIndex: item.playIndex, index: item.index });
    }
    // 最近观看的排在最前面
    list.sort((a, b) => b.index - a.index);
    return list;
};

/* ======================== 当前播放上下文 ======================== */

window.utils.currentVidKey = 'currentVid';
window.utils.getCurrentVid = function () {
    return localStorage.getItem(window.utils.currentVidKey);
};
window.utils.setCurrentVid = function (vid) {
    localStorage.setItem(window.utils.currentVidKey, vid);
};

window.utils.currentSiteKey = 'currentSite';
window.utils.getCurrentSite = function () {
    return localStorage.getItem(window.utils.currentSiteKey);
};
window.utils.setCurrentSite = function (site) {
    localStorage.setItem(window.utils.currentSiteKey, site);
};

window.utils.currentPlayIndexKey = 'currentPlayIndex';
window.utils.getCurrentPlayIndex = function () {
    return localStorage.getItem(window.utils.currentPlayIndexKey);
};
window.utils.setCurrentPlayIndex = function (index) {
    localStorage.setItem(window.utils.currentPlayIndexKey, index);
};
