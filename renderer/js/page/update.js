/**
 * update.js — update.html 页面控制器（一周更新）
 * 监听手柄桥接库 (gamepad.js) 发出的自定义事件，
 * 实现焦点在多个日期分组的卡片容器之间移动。
 *
 * 数据分组逻辑：
 *   1. 有 pubdate 的影视：按 pubdate 的「星期几」放到对应星期几的容器
 *   2. 剩余没有 pubdate 的影视：按 time 的「星期几」放到对应星期几的容器
 *
 * 焦点规则：
 *   - 左右方向：在同一 card-container 内的 grid 卡片间移动
 *   - 上下方向：在不同 card-container 之间跨组移动
 *   - gp:confirm：点击卡片 → 跳转到详情页
 *   - gp:back：返回上一页
 */
(function () {
    'use strict';

    var GP = GamepadBridge.EVENTS;

    var currentFocused = null;

    /* ======================== DOM 查询辅助 ======================== */

    function getPageBody() {
        return document.querySelector('.page-body');
    }

    function getCardContainers() {
        return Array.from(document.querySelectorAll('.card-container'));
    }

    function getCardsInContainer(container) {
        return Array.from(container.querySelectorAll('poster-card'));
    }

    function getContainerOfCard(card) {
        return card ? card.closest('.card-container') : null;
    }

    /* ======================== 日期工具 ======================== */

    function parseDayOfWeek(dateStr) {
        if (!dateStr) return -1;
        var parts = dateStr.split('-');
        if (parts.length !== 3) return -1;
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (isNaN(d.getTime())) return -1;
        return d.getDay();
    }

    function dayOfWeekName(day) {
        const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return names[day] || '';
    }

    /**
     * 生成最近 7 天的分组标题（今天 / 昨天 / 前天 / 具体日期）
     */
    function buildDaySections() {
        const pageBody = getPageBody();
        pageBody.innerHTML = '';
        const sections = [];
        const now = new Date();

        for (let i = 0; i < 7; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);

            let label;
            if (i === 0) {
                label = `今天(${dayOfWeekName(date.getDay())})`;
            } else if (i === 1) {
                label = `昨天(${dayOfWeekName(date.getDay())})`;
            } else if (i === 2) {
                label = `前天(${dayOfWeekName(date.getDay())})`;
            } else {
                label = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${dayOfWeekName(date.getDay())})`;
            }

            const line = document.createElement('div');
            line.className = 'line';
            line.innerHTML = `<hr class="aero-classic"><span>${label}</span><hr class="aero-classic">`;
            pageBody.appendChild(line);

            const container = document.createElement('div');
            container.className = 'card-container';
            pageBody.appendChild(container);

            sections.push({ container, dayOfWeek: date.getDay() });
        }
        return sections;
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
        var containers = getCardContainers();
        for (var i = 0; i < containers.length; i++) {
            var cards = getCardsInContainer(containers[i]);
            if (cards.length > 0) {
                setFocus(cards[0]);
                return;
            }
        }
        currentFocused = null;
    }

    function isCardItem(el) {
        return el && el.tagName === 'POSTER-CARD' && el.closest('.card-container') !== null;
    }

    /* ======================== 方向移动处理 ======================== */

    function handleUp() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var container = getContainerOfCard(currentFocused);
        var cards = getCardsInContainer(container);
        var columnsInRow = window.utils.getCardContainerChildNumInRow(container);
        var idx = cards.indexOf(currentFocused);

        if (idx >= columnsInRow) {
            setFocus(cards[idx - columnsInRow]);
        } else {
            var containers = getCardContainers();
            var containerIdx = containers.indexOf(container);
            if (containerIdx > 0) {
                var prevContainer = containers[containerIdx - 1];
                var prevCards = getCardsInContainer(prevContainer);
                if (prevCards.length > 0) {
                    var colInRow = idx % columnsInRow;
                    var prevColumns = window.utils.getCardContainerChildNumInRow(prevContainer);
                    var targetCol = Math.min(colInRow, prevColumns - 1);
                    var targetRowStart = Math.floor((prevCards.length - 1) / prevColumns) * prevColumns;
                    var targetIdx = targetRowStart + targetCol;
                    if (targetIdx >= prevCards.length) {
                        targetIdx = prevCards.length - 1;
                    }
                    setFocus(prevCards[targetIdx]);
                }
            }
        }
    }

    function handleDown() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var container = getContainerOfCard(currentFocused);
        var cards = getCardsInContainer(container);
        var columnsInRow = window.utils.getCardContainerChildNumInRow(container);
        var idx = cards.indexOf(currentFocused);
        var newIdx = idx + columnsInRow;

        if (newIdx < cards.length) {
            setFocus(cards[newIdx]);
        } else {
            var containers = getCardContainers();
            var containerIdx = containers.indexOf(container);
            if (containerIdx < containers.length - 1) {
                var nextContainer = containers[containerIdx + 1];
                var nextCards = getCardsInContainer(nextContainer);
                if (nextCards.length > 0) {
                    var colInRow = idx % columnsInRow;
                    var nextColumns = window.utils.getCardContainerChildNumInRow(nextContainer);
                    var targetIdx = Math.min(colInRow, nextColumns - 1);
                    if (targetIdx >= nextCards.length) {
                        targetIdx = nextCards.length - 1;
                    }
                    setFocus(nextCards[targetIdx]);
                }
            }
        }
    }

    function handleLeft() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var container = getContainerOfCard(currentFocused);
        var cards = getCardsInContainer(container);
        var idx = cards.indexOf(currentFocused);
        if (idx > 0) {
            setFocus(cards[idx - 1]);
        }
    }

    function handleRight() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var container = getContainerOfCard(currentFocused);
        var cards = getCardsInContainer(container);
        var idx = cards.indexOf(currentFocused);
        if (idx < cards.length - 1) {
            setFocus(cards[idx + 1]);
        }
    }

    /* ======================== 确认 / 返回 ======================== */

    function handleConfirm() {
        if (!currentFocused || !isCardItem(currentFocused)) return;

        var vid = currentFocused.getAttribute('data-vid');
        if (vid) {
            console.log('[update.js] 点击卡片，vid:', vid);
            window.utils.setCurrentVid(vid);
            window.utils.gotoPage('update.html', 'detail.html');
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

    /* ======================== 卡片渲染与数据加载 ======================== */

    function createCard(info) {
        var card = document.createElement('poster-card');
        card.setAttribute('tabindex', '0');
        card.setAttribute('data-vid', info.vid);
        card.setAttribute('img-url', '../img/default.png');
        card.setAttribute('title', info.name || '未知标题');
        return card;
    }

    function groupByDayOfWeek(sections, recentList, infoList) {
        const grouped = {};
        sections.forEach((section, index) => {
            grouped[index] = [];
        });

        const sectionIndexByDayOfWeek = {};
        sections.forEach((section, index) => {
            sectionIndexByDayOfWeek[section.dayOfWeek] = index;
        });

        // 建立 vid -> info 的映射
        const infoMap = {};
        infoList.forEach(info => {
            infoMap[info.vid] = info;
        });

        // 第一步：处理有 pubdate 的影视
        const assignedVids = new Set();
        recentList.forEach(item => {
            if (item.pubdate) {
                const dow = parseDayOfWeek(item.pubdate);
                const containerIdx = sectionIndexByDayOfWeek[dow];
                if (containerIdx !== undefined && grouped[containerIdx]) {
                    const info = infoMap[item.vid];
                    if (info) {
                        grouped[containerIdx].push(info);
                        assignedVids.add(item.vid);
                    }
                }
            }
        });

        // 第二步：处理剩余没有 pubdate 的影视，用 time
        recentList.forEach(item => {
            if (!assignedVids.has(item.vid) && item.time) {
                const dow = parseDayOfWeek(item.time);
                const containerIdx = sectionIndexByDayOfWeek[dow];
                if (containerIdx !== undefined && grouped[containerIdx]) {
                    const info = infoMap[item.vid];
                    if (info) {
                        grouped[containerIdx].push(info);
                    }
                }
            }
        });

        return grouped;
    }

    function renderCards(sections, groupedData) {
        const allVids = [];

        sections.forEach((section, index) => {
            const container = section.container;
            container.innerHTML = '';

            const list = groupedData[index] || [];
            list.forEach(info => {
                container.appendChild(createCard(info));
                allVids.push(info.vid);
            });
        });

        updateEmptyState();

        if (allVids.length > 0) {
            window.utils.getPosterObjectUrl(allVids, function (vid, posterObjectUrl) {
                var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
                if (card && posterObjectUrl) {
                    card.setAttribute('img-url', posterObjectUrl);
                }
            });
        }
    }

    function updateEmptyState() {
        var pageBody = getPageBody();
        var hasCards = document.querySelectorAll('.card-container poster-card').length > 0;
        if (hasCards) {
            pageBody.classList.remove('empty');
        } else {
            pageBody.classList.add('empty');
        }
    }

    async function loadData(sections) {
        console.log('[update.js] 开始加载最近更新的影视数据');

        try {
            var recentList = await window.moebox.getRecentVids();
            console.log('[update.js] 获取到 ' + recentList.length + ' 个最近更新的影视');

            if (!recentList || recentList.length === 0) {
                console.log('[update.js] 没有最近更新的影视');
                updateEmptyState();
                return;
            }

            var vids = recentList.map(function (item) { return item.vid; });
            var infoList = await window.moebox.getInfoListByVidList(vids);
            console.log('[update.js] 获取到 ' + (infoList ? infoList.length : 0) + ' 个影视详情');

            if (!infoList || infoList.length === 0) {
                updateEmptyState();
                return;
            }

            var groupedData = groupByDayOfWeek(sections, recentList, infoList);
            renderCards(sections, groupedData);
            initFocus();
        } catch (error) {
            console.error('[update.js] 加载数据失败:', error);
        }
    }

    /* ======================== 启动 ======================== */

    async function init() {
        console.log('[update.js] 初始化');

        var sections = buildDaySections();
        bindGamepadEvents();

        window.moebox.onUpdatePoster(function (posterData) {
            var vid = posterData.vid;
            if (!posterData.filePath) return;

            console.log('[update.js] 收到更新的海报文件: vid=' + vid + ', filePath=' + posterData.filePath);
            var card = document.querySelector('poster-card[data-vid="' + vid + '"]');
            if (card) {
                card.setAttribute('img-url', window.utils.pathToFileUrl(posterData.filePath));
            }
        });

        await loadData(sections);
        console.log('[update.js] 初始化完成');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
