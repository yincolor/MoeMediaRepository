/**
 * home.js — home.html 页面控制器
 * 监听手柄桥接库 (gamepad.js) 发出的自定义事件，
 * 实现焦点在 titlebar 按钮和 page-body 卡片之间的移动。
 *
 * 焦点规则：
 *   - 全局同一时刻只有一个元素持有 "focus" CSS 类
 *   - titlebar 区域：水平方向左右移动
 *   - page-body 区域：按 grid 列数上下左右移动
 *   - titlebar ↔ page-body：通过上/下键切换
 *   - gp:confirm：触发当前焦点元素的点击事件
 *   - gp:back：不响应
 */
(function () {
    'use strict';

    /* ======================== 常量 ======================== */

    var GP = GamepadBridge.EVENTS;

    /* ======================== 状态 ======================== */

    var currentFocused = null;

    /* ======================== DOM 查询辅助 ======================== */

    /** 获取 titlebar 中所有按钮 */
    function getTitlebarItems() {
        return Array.from(document.querySelectorAll('.titlebar > .item'));
    }

    /** 获取 page-body 中所有卡片 */
    function getCards() {
        return Array.from(document.querySelectorAll('.page-body poster-card'));
    }

    /** 获取 page-body 容器 */
    function getPageBody() {
        return document.querySelector('.page-body');
    }

    /* ======================== 焦点管理 ======================== */

    /**
     * 设置焦点到指定元素，保证全局只有一个 focus
     * @param {Element|null} element
     */
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

    /** 初始化焦点：默认聚焦到第一个 titlebar 按钮 */
    function initFocus() {
        document.querySelectorAll('.focus').forEach(function (el) {
            el.classList.remove('focus');
        });
        var items = getTitlebarItems();
        if (items.length > 0) {
            setFocus(items[0]);
        }
    }

    /* ======================== 区域判断 ======================== */

    function isTitlebarItem(el) {
        return el && el.classList.contains('item') && el.closest('.titlebar') !== null;
    }

    function isCardItem(el) {
        return el && el.tagName === 'POSTER-CARD' && el.closest('.page-body') !== null;
    }

    /* ======================== 方向移动处理 ======================== */

    function handleUp() {
        if (!currentFocused) return;

        if (isCardItem(currentFocused)) {
            var cards = getCards();
            var pageBody = getPageBody();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(pageBody);
            var idx = cards.indexOf(currentFocused);

            if (idx < columnsInRow) {
                // 已在卡片第一行 → 焦点回到 titlebar，尽量保持列位置
                var items = getTitlebarItems();
                var titleIdx = Math.min(idx, items.length - 1);
                setFocus(items[titleIdx]);
            } else {
                setFocus(cards[idx - columnsInRow]);
            }
        }
        // titlebar 中按上键 → 已在最顶部，不做任何操作
    }

    function handleDown() {
        if (!currentFocused) return;

        if (isTitlebarItem(currentFocused)) {
            var cards = getCards();
            var pageBody = getPageBody();
            if (cards.length === 0) return;

            var columnsInRow = window.utils.getCardContainerChildNumInRow(pageBody);
            var titleIdx = getTitlebarItems().indexOf(currentFocused);
            var cardIdx = Math.min(titleIdx, columnsInRow - 1);
            if (cardIdx >= cards.length) cardIdx = 0;

            setFocus(cards[cardIdx]);
        } else if (isCardItem(currentFocused)) {
            var cards = getCards();
            var pageBody = getPageBody();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(pageBody);
            var idx = cards.indexOf(currentFocused);
            var newIdx = idx + columnsInRow;

            if (newIdx < cards.length) {
                setFocus(cards[newIdx]);
            }
        }
    }

    function handleLeft() {
        if (!currentFocused) return;

        if (isTitlebarItem(currentFocused)) {
            var items = getTitlebarItems();
            var idx = items.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(items[idx - 1]);
            }
        } else if (isCardItem(currentFocused)) {
            var cards = getCards();
            var idx = cards.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(cards[idx - 1]);
            }
        }
    }

    function handleRight() {
        if (!currentFocused) return;

        if (isTitlebarItem(currentFocused)) {
            var items = getTitlebarItems();
            var idx = items.indexOf(currentFocused);
            if (idx < items.length - 1) {
                setFocus(items[idx + 1]);
            }
        } else if (isCardItem(currentFocused)) {
            var cards = getCards();
            var idx = cards.indexOf(currentFocused);
            if (idx < cards.length - 1) {
                setFocus(cards[idx + 1]);
            }
        }
    }

    /* ======================== 确认键处理 ======================== */

    function handleConfirm() {
        if (!currentFocused) return;

        if (isTitlebarItem(currentFocused)) {
            switch (currentFocused.dataset.action) {
                case 'goto_page':
                    window.utils.gotoPage('home.html', currentFocused.dataset.page);
                    break;
                case 'exit_app':
                    window.utils.exitApp();
                    break;
                default:
                    console.log(`[home.js] 未知操作: ${currentFocused.dataset.action}`);
                    break;
            }
        } else if (isCardItem(currentFocused)) {
            var vid = currentFocused.getAttribute('data-vid');
            console.log(`[home.js] 点击卡片: ${vid}`);
            window.utils.setCurrentVid(vid);
            window.utils.gotoPage('home.html', 'detail.html');
        } else {
            console.log(`[home.js] 未知元素: ${currentFocused.className}`);
        }
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
        // 返回键 → 不响应
    }

    /* ======================== 收藏卡片渲染 ======================== */

    function createCard(info) {
        var card = document.createElement('poster-card');
        card.setAttribute('data-vid', info.vid);
        card.setAttribute('img-url', '../img/default.png');
        card.setAttribute('title', info.name || '未知标题');
        card.tabIndex = 0;
        return card;
    }

    function updatePageBodyEmptyState() {
        var pageBody = getPageBody();
        var cards = getCards();
        if (cards.length === 0) {
            pageBody.classList.add('empty');
        } else {
            pageBody.classList.remove('empty');
        }
    }

    /**
     * 初始化时调用：获取收藏的 vid 列表，请求海报与信息，设置收藏卡片
     */
    async function initCards() {
        var pageBody = getPageBody();
        pageBody.innerHTML = '';
        pageBody.classList.add('empty');

        var favoriteVids = window.utils.getFavoriteVids();
        console.log(`[home.js] 收藏的 vid 列表: [${favoriteVids.join(',')}]`);
        if (!favoriteVids || favoriteVids.length <= 0) {
            console.log('[home.js] 没有收藏的影视，显示空状态');
            return;
        }

        // 请求收藏的影视信息
        var infoList = await window.moebox.getInfoListByVidList(favoriteVids);
        console.log(`[home.js] 收藏的影视信息列表: ${infoList.length}个`);

        if (!infoList || infoList.length === 0) {
            console.log('[home.js] 没有收藏的影视信息（t_info），显示空状态');
            return;
        }

        // 设置卡片（使用默认海报图）
        pageBody.innerHTML = '';
        pageBody.classList.remove('empty');
        for (var i = 0; i < infoList.length; i++) {
            pageBody.appendChild(createCard(infoList[i]));
        }

        // 异步请求海报并更新
        window.utils.getPosterObjectUrl(favoriteVids, function (vid, posterObjectUrl) {
            var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
            if (card && posterObjectUrl) {
                card.setAttribute('img-url', posterObjectUrl);
            }
        });
    }

    /* ======================== 启动 ======================== */

    async function init() {
        console.log('[home.js] 初始化');
        initFocus();
        bindGamepadEvents();

        // 设置主进程更新海报图片事件监听
        window.moebox.onUpdatePoster(function (posterData) {
            var vid = posterData.vid;
            if (!posterData.filePath) return;

            console.log('[home.js] 收到更新的海报文件: vid=' + vid + ', filePath=' + posterData.filePath);
            var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
            if (card) {
                card.setAttribute('img-url', window.utils.pathToFileUrl(posterData.filePath));
            }
        });

        await initCards();
        console.log('[home.js] 初始化完成');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
