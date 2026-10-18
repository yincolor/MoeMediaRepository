/**
 * detail.js — detail.html 页面控制器
 * 监听手柄桥接库 (gamepad.js) 发出的自定义事件，实现详情页焦点导航：
 *   - .control-bar（收藏 / 开始播放）
 *   - .site-container（播放来源站点）
 *   - .series-container（剧集列表）
 *
 * 功能：
 *   - 展示海报、名称、类型、地区、年份、标签、简介
 *   - 收藏 / 取消收藏（localStorage）
 *   - 切换站点 → 刷新剧集列表
 *   - 选择剧集 → 写入播放上下文与历史 → 跳转播放页
 *   - 从观看历史进入时，恢复上次的站点与剧集
 */
(function () {
    'use strict';

    var GP = GamepadBridge.EVENTS;

    var currentFocused = null;
    var currentVid = null;
    var videoInfo = null;
    var playlists = null;
    var currentSite = null;
    var seriesData = null;
    var siteCfg = null;

    /* ======================== DOM 查询辅助 ======================== */

    function getControlBarItems() {
        return Array.from(document.querySelectorAll('.control-bar icon-btn'));
    }

    function getSiteItems() {
        return Array.from(document.querySelectorAll('.site-container text-btn'));
    }

    function getSeriesItems() {
        return Array.from(document.querySelectorAll('.series-container text-btn'));
    }

    function getSeriesContainer() {
        return document.querySelector('.series-container');
    }

    function getSiteContainer() {
        return document.querySelector('.site-container');
    }

    /* ======================== 焦点管理 ======================== */

    function setFocus(element) {
        if (currentFocused) {
            currentFocused.classList.remove('focus');
        }
        if (element) {
            element.classList.add('focus');
            currentFocused = element;
            element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            currentFocused = null;
        }
    }

    function initFocus() {
        document.querySelectorAll('.focus').forEach(function (el) {
            el.classList.remove('focus');
        });
        var items = getControlBarItems();
        if (items.length > 0) {
            setFocus(items[0]);
        }
    }

    /* ======================== 区域判断 ======================== */

    function isControlBarItem(el) {
        return el && el.tagName === 'ICON-BTN' && el.closest('.control-bar') !== null;
    }

    function isSiteItem(el) {
        return el && el.tagName === 'TEXT-BTN' && el.closest('.site-container') !== null;
    }

    function isSeriesItem(el) {
        return el && el.tagName === 'TEXT-BTN' && el.closest('.series-container') !== null;
    }

    function isFavoriteButton(el) {
        return el && el.getAttribute('data-action') === 'toggle_favorite';
    }

    function isPlayButton(el) {
        return el && el.getAttribute('data-action') === 'play';
    }

    /* ======================== 方向移动处理 ======================== */

    function handleUp() {
        if (!currentFocused) return;

        if (isSeriesItem(currentFocused)) {
            var series = getSeriesItems();
            var container = getSeriesContainer();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(container);
            var idx = series.indexOf(currentFocused);

            if (idx < columnsInRow) {
                var sites = getSiteItems();
                if (sites.length > 0) {
                    var siteIdx = Math.min(idx, sites.length - 1);
                    setFocus(sites[siteIdx]);
                }
            } else {
                setFocus(series[idx - columnsInRow]);
            }
        } else if (isSiteItem(currentFocused)) {
            var controls = getControlBarItems();
            if (controls.length > 0) {
                var siteIdx = getSiteItems().indexOf(currentFocused);
                var controlIdx = Math.min(siteIdx, controls.length - 1);
                setFocus(controls[controlIdx]);
            }
        }
    }

    function handleDown() {
        if (!currentFocused) return;

        if (isControlBarItem(currentFocused)) {
            var sites = getSiteItems();
            if (sites.length > 0) {
                var controlIdx = getControlBarItems().indexOf(currentFocused);
                var siteIdx = Math.min(controlIdx, sites.length - 1);
                setFocus(sites[siteIdx]);
            }
        } else if (isSiteItem(currentFocused)) {
            var series = getSeriesItems();
            var container = getSeriesContainer();
            if (series.length === 0) return;

            var columnsInRow = window.utils.getCardContainerChildNumInRow(container);
            var siteIdx = getSiteItems().indexOf(currentFocused);
            var seriesIdx = Math.min(siteIdx, columnsInRow - 1);
            if (seriesIdx >= series.length) seriesIdx = 0;

            setFocus(series[seriesIdx]);
        } else if (isSeriesItem(currentFocused)) {
            var series = getSeriesItems();
            var container = getSeriesContainer();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(container);
            var idx = series.indexOf(currentFocused);
            var newIdx = idx + columnsInRow;

            if (newIdx < series.length) {
                setFocus(series[newIdx]);
            }
        }
    }

    function handleLeft() {
        if (!currentFocused) return;

        if (isControlBarItem(currentFocused)) {
            var items = getControlBarItems();
            var idx = items.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(items[idx - 1]);
            }
        } else if (isSiteItem(currentFocused)) {
            var items = getSiteItems();
            var idx = items.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(items[idx - 1]);
            }
        } else if (isSeriesItem(currentFocused)) {
            var items = getSeriesItems();
            var idx = items.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(items[idx - 1]);
            }
        }
    }

    function handleRight() {
        if (!currentFocused) return;

        if (isControlBarItem(currentFocused)) {
            var items = getControlBarItems();
            var idx = items.indexOf(currentFocused);
            if (idx < items.length - 1) {
                setFocus(items[idx + 1]);
            }
        } else if (isSiteItem(currentFocused)) {
            var items = getSiteItems();
            var idx = items.indexOf(currentFocused);
            if (idx < items.length - 1) {
                setFocus(items[idx + 1]);
            }
        } else if (isSeriesItem(currentFocused)) {
            var items = getSeriesItems();
            var idx = items.indexOf(currentFocused);
            if (idx < items.length - 1) {
                setFocus(items[idx + 1]);
            }
        }
    }

    /* ======================== 确认键处理 ======================== */

    function handleConfirm() {
        if (!currentFocused) return;

        if (isFavoriteButton(currentFocused)) {
            console.log('[detail.js] 点击收藏按钮');
            toggleFavorite();
            return;
        }

        if (isPlayButton(currentFocused)) {
            console.log('[detail.js] 点击开始播放按钮');
            if (!currentSite) {
                console.log('[detail.js] 未找到当前选中的站点');
                return;
            }
            if (seriesData && seriesData.length > 0) {
                playSeries(0);
            }
            return;
        }

        if (isSiteItem(currentFocused)) {
            var siteName = currentFocused.getAttribute('data-site-name');
            console.log('[detail.js] 切换站点:', siteName);
            switchSite(siteName);
            return;
        }

        if (isSeriesItem(currentFocused)) {
            var seriesIdx = getSeriesItems().indexOf(currentFocused);
            if (seriesData && seriesData[seriesIdx]) {
                playSeries(seriesIdx);
            }
            return;
        }

        currentFocused.click();
        console.log('[detail.js] 点击元素', currentFocused);
    }

    function handleBack() {
        console.log('[detail.js] 返回键被按下');
        window.utils.backPage();
    }

    /* ======================== 收藏 / 播放 ======================== */

    function toggleFavorite() {
        if (!currentVid) return;
        if (window.utils.isFavoriteVid(currentVid)) {
            window.utils.delFavoriteVid(currentVid);
            console.log('[detail.js] 已取消收藏 vid:', currentVid);
        } else {
            window.utils.addFavoriteVid(currentVid);
            console.log('[detail.js] 已收藏 vid:', currentVid);
        }
        updateFavoriteButtonState();
    }

    function updateFavoriteButtonState() {
        var btn = document.querySelector('.favorite-btn');
        if (!btn) return;
        var isFavorite = !!currentVid && window.utils.isFavoriteVid(currentVid);
        btn.setAttribute('icon-name', isFavorite ? '已收藏' : '未收藏');
        btn.textContent = isFavorite ? '已收藏' : '未收藏';
    }

    function playSeries(seriesIdx) {
        var item = seriesData[seriesIdx];
        if (!item) return;
        console.log('[detail.js] 播放剧集:', item.name, item.url);
        localStorage.setItem('playingM3U8Url', item.url);
        window.utils.setCurrentSite(currentSite);
        window.utils.setCurrentPlayIndex(seriesIdx);
        if (currentVid) {
            window.utils.addHistoryObject(currentVid, currentSite, seriesIdx);
        }
        window.utils.gotoPage('detail.html', 'play.html');
    }

    /* ======================== 事件绑定 ======================== */

    function bindGamepadEvents() {
        window.addEventListener(GP.UP, handleUp);
        window.addEventListener(GP.UP_LONG, handleUp);
        window.addEventListener(GP.DOWN, handleDown);
        window.addEventListener(GP.DOWN_LONG, handleDown);
        window.addEventListener(GP.LEFT, handleLeft);
        window.addEventListener(GP.LEFT_LONG, handleLeft);
        window.addEventListener(GP.RIGHT, handleRight);
        window.addEventListener(GP.RIGHT_LONG, handleRight);
        window.addEventListener(GP.CONFIRM, handleConfirm);
        window.addEventListener(GP.BACK, handleBack);
    }

    /* ======================== 播放链接解析 ======================== */

    /**
     * 解析播放链接文本：
     * 格式：`集名$m3u8URL#集名$m3u8URL`，多个分组用 `$$$` 分隔
     * @param {string} urlListStr - 播放链接文本
     * @returns {Array<{name: string, url: string}>} - 剧集列表
     */
    function parsePlayList(urlListStr) {
        if (!urlListStr) return [];
        var groups = urlListStr.split('$$$');
        var result = [];
        for (var i = 0; i < groups.length; i++) {
            var group = groups[i].trim();
            if (!group) continue;
            var episodes = group.split('#');
            for (var j = 0; j < episodes.length; j++) {
                var episode = episodes[j].trim();
                if (!episode) continue;
                var parts = episode.split('$');
                if (parts.length >= 2) {
                    var name = parts[0].trim();
                    var url = parts[1].trim();
                    if (url && url.toLowerCase().endsWith('.m3u8')) {
                        result.push({ name: name, url: url });
                    }
                }
            }
        }
        return result;
    }

    /* ======================== 渲染 ======================== */

    function renderVideoInfo(info) {
        var titleEl = document.querySelector('.page-header .title');
        var infoEl = document.querySelector('.page-header .info');
        var introEl = document.querySelector('.page-header .intro');

        if (titleEl) titleEl.textContent = info.name || '未知标题';

        if (infoEl) {
            var infoParts = [];
            if (info.media_type) infoParts.push(info.media_type);
            if (info.area) infoParts.push(info.area);
            if (info.year) infoParts.push(info.year);
            if (info.tags && info.tags.length > 0) infoParts.push(info.tags.join(','));
            infoEl.innerHTML = infoParts.join('<span> · </span>');
        }

        if (introEl) introEl.textContent = info.intro || '暂无简介';
    }

    function getSiteTitleBySiteName(siteName) {
        if (siteCfg && siteCfg[siteName] && siteCfg[siteName].title) {
            return siteCfg[siteName].title;
        }
        return siteName;
    }

    function renderSiteList(sites) {
        var siteContainer = getSiteContainer();
        if (!siteContainer) return;

        siteContainer.innerHTML = '';

        sites.forEach(function (site, index) {
            var button = document.createElement('text-btn');
            button.textContent = getSiteTitleBySiteName(site);
            button.setAttribute('data-site-name', site);
            if (index === 0) {
                button.setAttribute('selected', '');
            }
            siteContainer.appendChild(button);
        });
    }

    function renderSeriesList(series, focusIndex) {
        var seriesContainer = getSeriesContainer();
        if (!seriesContainer) return;

        seriesContainer.innerHTML = '';

        series.forEach(function (item, index) {
            var button = document.createElement('text-btn');
            button.textContent = item.name;
            button.setAttribute('data-index', index);
            seriesContainer.appendChild(button);
        });

        var seriesItems = getSeriesItems();
        if (seriesItems.length > 0) {
            var target = Math.min(focusIndex || 0, seriesItems.length - 1);
            setFocus(seriesItems[target]);
        }
    }

    function switchSite(siteName) {
        var siteItems = getSiteItems();
        siteItems.forEach(function (item) {
            if (item.getAttribute('data-site-name') === siteName) {
                item.setAttribute('selected', '');
            } else {
                item.removeAttribute('selected');
            }
        });

        currentSite = siteName;

        if (playlists && playlists[currentVid]) {
            var urlListStr = playlists[currentVid][siteName];
            seriesData = parsePlayList(urlListStr);
            renderSeriesList(seriesData, 0);
        }
    }

    /* ======================== 数据加载 ======================== */

    async function loadVideoDetail() {
        currentVid = window.utils.getCurrentVid();
        console.log('[detail.js] 当前影视 vid:', currentVid);

        if (!currentVid) {
            console.error('[detail.js] 未找到 vid');
            return;
        }

        try {
            siteCfg = await window.moebox.getSiteCfg();
            console.log('[detail.js] 获取站点配置:', siteCfg);

            var infoList = await window.moebox.getInfoListByVidList([currentVid]);
            if (infoList && infoList.length > 0) {
                videoInfo = infoList[0];
                renderVideoInfo(videoInfo);
            }

            window.utils.getPosterObjectUrl([currentVid], function (vid, objectUrl) {
                var posterContainer = document.querySelector('.poster-container img');
                if (posterContainer && objectUrl) {
                    posterContainer.src = objectUrl;
                }
            });

            playlists = await window.moebox.getPlaylistsListByVidList([currentVid]);
            if (playlists[currentVid]) {
                var sites = Object.keys(playlists[currentVid]);
                if (sites.length > 0) {
                    renderSiteList(sites);

                    // 从观看历史进入时，恢复上次的站点与剧集
                    var lastSite = window.utils.getCurrentSite();
                    var lastPlayIndex = parseInt(window.utils.getCurrentPlayIndex(), 10);
                    var initialSite = (lastSite && sites.includes(lastSite)) ? lastSite : sites[0];

                    switchSite(initialSite);
                    if (!isNaN(lastPlayIndex) && lastPlayIndex >= 0) {
                        renderSeriesList(seriesData, lastPlayIndex);
                    }
                }
            }

            updateFavoriteButtonState();
        } catch (error) {
            console.error('[detail.js] 加载影视详情失败:', error);
        }
    }

    /* ======================== 启动 ======================== */

    function init() {
        initFocus();
        bindGamepadEvents();
        loadVideoDetail();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
