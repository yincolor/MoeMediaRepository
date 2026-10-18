/**
 * history.js — history.html 页面控制器
 * 监听手柄桥接库 (gamepad.js) 发出的自定义事件，
 * 实现焦点在 page-body 卡片之间的移动。
 *
 * 焦点规则：
 *   - 全局同一时刻只有一个元素持有 "focus" CSS 类
 *   - page-body 区域：按 grid 列数上下左右移动
 *   - gp:confirm：点击卡片 → 跳转到详情页（携带记住的站点与剧集）
 *   - gp:back：返回上一页
 */
(function () {
    'use strict';

    var GP = GamepadBridge.EVENTS;

    var currentFocused = null;

    /* ======================== DOM 查询辅助 ======================== */

    function getCards() {
        return Array.from(document.querySelectorAll('.page-body poster-card'));
    }

    function getPageBody() {
        return document.querySelector('.page-body');
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
        var cards = getCards();
        if (cards.length > 0) {
            setFocus(cards[0]);
        }
    }

    function isCardItem(el) {
        return el && el.tagName === 'POSTER-CARD' && el.closest('.page-body') !== null;
    }

    /* ======================== 方向移动处理 ======================== */

    function handleUp() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var cards = getCards();
        var pageBody = getPageBody();
        var columnsInRow = window.utils.getCardContainerChildNumInRow(pageBody);
        var idx = cards.indexOf(currentFocused);

        if (idx >= columnsInRow) {
            setFocus(cards[idx - columnsInRow]);
        }
    }

    function handleDown() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var cards = getCards();
        var pageBody = getPageBody();
        var columnsInRow = window.utils.getCardContainerChildNumInRow(pageBody);
        var idx = cards.indexOf(currentFocused);
        var newIdx = idx + columnsInRow;

        if (newIdx < cards.length) {
            setFocus(cards[newIdx]);
        }
    }

    function handleLeft() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var cards = getCards();
        var idx = cards.indexOf(currentFocused);
        if (idx > 0) {
            setFocus(cards[idx - 1]);
        }
    }

    function handleRight() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var cards = getCards();
        var idx = cards.indexOf(currentFocused);
        if (idx < cards.length - 1) {
            setFocus(cards[idx + 1]);
        }
    }

    /* ======================== 确认 / 返回 ======================== */

    function handleConfirm() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var vid = currentFocused.getAttribute('data-vid');
        var site = currentFocused.getAttribute('data-site');
        var playIndex = currentFocused.getAttribute('data-play-index');
        if (vid) {
            console.log('[history.js] 点击卡片，vid:', vid, 'site:', site, 'playIndex:', playIndex);
            window.utils.setCurrentVid(vid);
            if (site) {
                window.utils.setCurrentSite(site);
            }
            if (playIndex) {
                window.utils.setCurrentPlayIndex(playIndex);
            }
            window.utils.gotoPage('history.html', 'detail.html');
        }
    }

    function handleBack() {
        window.utils.backPage();
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

    /* ======================== 历史卡片渲染 ======================== */

    function createHistoryCard(info, historyItem) {
        var card = document.createElement('poster-card');
        card.setAttribute('data-vid', info.vid);
        card.setAttribute('img-url', '../img/default.png');
        card.setAttribute('title', info.name || '未知标题');
        if (historyItem) {
            if (historyItem.site) {
                card.setAttribute('data-site', historyItem.site);
            }
            if (historyItem.playIndex !== undefined && historyItem.playIndex !== null) {
                card.setAttribute('data-play-index', historyItem.playIndex);
            }
        }
        card.tabIndex = 0;
        return card;
    }

    function updateEmptyState() {
        var pageBody = getPageBody();
        if (getCards().length === 0) {
            pageBody.classList.add('empty');
        } else {
            pageBody.classList.remove('empty');
        }
    }

    async function initCards() {
        var pageBody = getPageBody();
        if (!pageBody) return;

        pageBody.innerHTML = '';
        pageBody.classList.add('empty');

        var historyObjectsList = window.utils.getHistoryObjectsList();
        var historyVids = historyObjectsList.map(item => item.vid) || [];
        console.log('[history.js] 观看历史的 vid 列表: [' + historyVids.join(',') + ']');

        if (!historyVids || historyVids.length <= 0) {
            console.log('[history.js] 没有观看历史，显示空状态');
            return;
        }

        var infoList = await window.moebox.getInfoListByVidList(historyVids);
        console.log('[history.js] 观看历史的影视信息列表: ' + (infoList ? infoList.length : 0) + '个');

        if (!infoList || infoList.length === 0) {
            console.log('[history.js] 没有观看历史的影视信息，显示空状态');
            return;
        }

        // 按历史顺序（最近观看在前）渲染卡片
        pageBody.innerHTML = '';
        pageBody.classList.remove('empty');
        var infoMap = {};
        infoList.forEach(info => { infoMap[info.vid] = info; });

        historyObjectsList.forEach(historyItem => {
            var info = infoMap[historyItem.vid];
            if (info) {
                pageBody.appendChild(createHistoryCard(info, historyItem));
            }
        });

        // 异步请求海报并更新
        window.utils.getPosterObjectUrl(historyVids, function (vid, posterObjectUrl) {
            var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
            if (card && posterObjectUrl) {
                card.setAttribute('img-url', posterObjectUrl);
            }
        });

        initFocus();
    }

    /* ======================== 启动 ======================== */

    async function init() {
        console.log('[history.js] 初始化');
        bindGamepadEvents();

        window.moebox.onUpdatePoster(function (posterData) {
            var vid = posterData.vid;
            if (!posterData.filePath) return;

            console.log('[history.js] 收到更新的海报文件: vid=' + vid + ', filePath=' + posterData.filePath);
            var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
            if (card) {
                card.setAttribute('img-url', window.utils.pathToFileUrl(posterData.filePath));
            }
        });

        await initCards();
        console.log('[history.js] 初始化完成');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
