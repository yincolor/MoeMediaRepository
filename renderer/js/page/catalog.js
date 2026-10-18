/**
 * catalog.js — catalog.html 页面控制器
 *
 * 页面分两层：
 *   - div.content：占满整个窗口的海报网格层，专门显示影视剧海报（poster-card）。
 *   - dialog#catalog-menu：弹窗层，负责设置筛选条件，并放置「关闭弹窗」/
 *     「返回上一页」/「确认筛选条件」按钮。
 *
 * 焦点规则：
 *   - 全局同一时刻只有一个元素持有 "focus" CSS 类。
 *   - 海报层：按 grid 实时列数上下左右移动；gp:confirm 进入详情页。
 *   - 弹窗层：按 section（btn-row / selector-row）分层，左右在同层移动，
 *             上下在同层多行间移动，行首/行尾再跨到相邻 section。
 *   - gp:back：弹窗关闭时 → 打开弹窗（不是返回上一页）；
 *              弹窗打开时 → 关闭弹窗回到海报层。
 *              真正的「返回上一页」按钮在弹窗内，通过 window.utils.backPage() 实现。
 *
 * 筛选条件：
 *   - 类型(group) / 区域(area) / 字母(letter) / 年份(year) / 标签(tags)
 *   - 弹窗内选择后，点「确认筛选条件」才生效；「关闭弹窗」放弃未确认的选择。
 *   - 所有条件组合为本地 SQLite 筛选，分页每页 30 条，海报层滚动接近底部自动加载更多。
 */
(function () {
    'use strict';

    /* ======================== 常量 ======================== */

    var GP = window.GamepadBridge ? window.GamepadBridge.EVENTS : {
        UP: 'gp:up', DOWN: 'gp:down', LEFT: 'gp:left', RIGHT: 'gp:right',
        UP_LONG: 'gp:up-long', DOWN_LONG: 'gp:down-long', LEFT_LONG: 'gp:left-long', RIGHT_LONG: 'gp:right-long',
        CONFIRM: 'gp:confirm', BACK: 'gp:back'
    };

    var ALL_LABEL = '不限';

    /* ======================== 状态 ======================== */

    var currentFocused = null;
    var lastPosterFocus = null;
    var lastDialogFocus = null;

    var isLoading = false;
    var hasMore = true;

    window.currentFilter = null;
    window.currentPage = 1;
    window.pageSize = 30;

    /* ======================== DOM 查询辅助 ======================== */

    function getContent() {
        return document.querySelector('.content');
    }

    function getDialog() {
        return document.getElementById('catalog-menu');
    }

    function getPosters() {
        return Array.from(document.querySelectorAll('.content poster-card'));
    }

    function isDialogOpen() {
        var dialog = getDialog();
        return !!(dialog && dialog.open);
    }

    function getSelectorRows() {
        var dialog = getDialog();
        if (!dialog) return [];
        return Array.from(dialog.querySelectorAll('.selector-row'));
    }

    /** 读取筛选行的 label（如「类型」「区域」），去掉冒号 */
    function getRowLabel(row) {
        var span = row.querySelector('span');
        if (!span) return '';
        return span.textContent.replace(/[：:]/g, '').trim();
    }

    /** 筛选行 label → 筛选条件字段名 */
    function getRowFilterType(row) {
        var map = {
            '类型': 'group',
            '区域': 'area',
            '字母': 'letter',
            '年份': 'year',
            '标签': 'tags'
        };
        return map[getRowLabel(row)] || null;
    }

    /**
     * 动态枚举弹窗的「层」：每个 btn-row / selector-row 为一层。
     * 层内可聚焦元素为 icon-btn / text-btn。
     */
    function getDialogLayers() {
        var dialog = getDialog();
        if (!dialog) return [];

        var layers = [];
        Array.prototype.forEach.call(dialog.children, function (section) {
            if (!section.classList ||
                (!section.classList.contains('btn-row') && !section.classList.contains('selector-row'))) {
                return;
            }
            var items = Array.from(section.querySelectorAll('icon-btn, text-btn'));
            if (items.length === 0) return;
            layers.push({ el: section, items: items });
        });
        return layers;
    }

    /** 定位元素在弹窗第几层、层内第几个 */
    function locateInDialog(el) {
        if (!el) return null;
        var layers = getDialogLayers();
        for (var i = 0; i < layers.length; i++) {
            var idx = layers[i].items.indexOf(el);
            if (idx !== -1) return { layerPos: i, idx: idx };
        }
        return null;
    }

    /**
     * 将层内元素按实际换行（offsetTop）分组为多行。
     * 返回 [[idx, idx...], ...]，便于实现「一行一行」的上下移动。
     */
    function computeRows(items) {
        var rows = [];
        var currentTop = null;
        var currentRow = [];
        for (var i = 0; i < items.length; i++) {
            var top = items[i].offsetTop;
            if (top !== currentTop) {
                if (currentRow.length > 0) rows.push(currentRow);
                currentRow = [];
                currentTop = top;
            }
            currentRow.push(i);
        }
        if (currentRow.length > 0) rows.push(currentRow);
        return rows;
    }

    function findRowCol(rows, idx) {
        for (var r = 0; r < rows.length; r++) {
            var c = rows[r].indexOf(idx);
            if (c !== -1) return { row: r, col: c };
        }
        return { row: 0, col: 0 };
    }

    /* ======================== 区域判断 ======================== */

    function isInPosterLayer(el) {
        return !!(el && el.closest && el.closest('.content'));
    }

    function isInDialogLayer(el) {
        return !!(el && el.closest && el.closest('#catalog-menu'));
    }

    /* ======================== 焦点管理 ======================== */

    function setFocus(element) {
        if (currentFocused) {
            currentFocused.classList.remove('focus');
        }
        if (element) {
            element.classList.add('focus');
            currentFocused = element;

            if (isInPosterLayer(element)) {
                lastPosterFocus = element;
            } else if (isInDialogLayer(element)) {
                lastDialogFocus = element;
            }

            if (element.scrollIntoView) {
                element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        } else {
            currentFocused = null;
        }
    }

    function initFocus() {
        document.querySelectorAll('.focus').forEach(function (el) {
            el.classList.remove('focus');
        });
        currentFocused = null;
        lastPosterFocus = null;
        lastDialogFocus = null;

        // 进入页面时弹窗隐藏，焦点落在第一张海报上（若已有）
        var posters = getPosters();
        if (posters.length > 0) {
            setFocus(posters[0]);
        }
    }

    /* ======================== 弹窗开关 ======================== */

    function getFirstDialogItem() {
        var layers = getDialogLayers();
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].items.length > 0) return layers[i].items[0];
        }
        return null;
    }

    /** 打开弹窗：焦点优先恢复到上次弹窗内聚焦的元素 */
    function openDialog() {
        var dialog = getDialog();
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();

        var target = (lastDialogFocus && isInDialogLayer(lastDialogFocus)) ? lastDialogFocus : getFirstDialogItem();
        if (target) setFocus(target);
    }

    /** 关闭弹窗后，把焦点还给海报层 */
    function restoreFocusToPosterLayer() {
        var posters = getPosters();
        var target = (lastPosterFocus && posters.indexOf(lastPosterFocus) !== -1)
            ? lastPosterFocus
            : (posters[0] || null);
        setFocus(target);
    }

    /** 关闭弹窗（放弃未确认的选择） */
    function closeDialog() {
        var dialog = getDialog();
        if (!dialog) return;
        applyFilterToSelectorRows(window.currentFilter || getDefaultFilter());
        if (dialog.open) dialog.close();
        restoreFocusToPosterLayer();
    }

    /** 确认筛选条件：收集弹窗选择 → 刷新海报 → 关闭弹窗 */
    function confirmFilter() {
        var filter = collectCurrentFilter();
        updateCardViewWhenFilterChanged(filter);

        var dialog = getDialog();
        if (dialog && dialog.open) dialog.close();
        restoreFocusToPosterLayer();
    }

    /* ======================== 方向移动处理 ======================== */

    function handleUp() {
        if (!currentFocused) return;

        if (isInDialogLayer(currentFocused)) {
            var loc = locateInDialog(currentFocused);
            if (!loc) return;
            var layers = getDialogLayers();
            var layer = layers[loc.layerPos];
            var rows = computeRows(layer.items);
            var info = findRowCol(rows, loc.idx);

            if (info.row > 0) {
                var upperRow = rows[info.row - 1];
                setFocus(layer.items[upperRow[Math.min(info.col, upperRow.length - 1)]]);
                return;
            }
            if (loc.layerPos > 0) {
                var prev = layers[loc.layerPos - 1];
                var prevRows = computeRows(prev.items);
                var prevFirstRow = prevRows[0] || [];
                if (prevFirstRow.length > 0) {
                    setFocus(prev.items[prevFirstRow[Math.min(info.col, prevFirstRow.length - 1)]]);
                }
            }
            return;
        }

        if (isInPosterLayer(currentFocused)) {
            var posters = getPosters();
            var content = getContent();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(content);
            var idx = posters.indexOf(currentFocused);
            if (idx >= columnsInRow) {
                setFocus(posters[idx - columnsInRow]);
            }
            return;
        }
    }

    function handleDown() {
        if (!currentFocused) return;

        if (isInDialogLayer(currentFocused)) {
            var loc = locateInDialog(currentFocused);
            if (!loc) return;
            var layers = getDialogLayers();
            var layer = layers[loc.layerPos];
            var rows = computeRows(layer.items);
            var info = findRowCol(rows, loc.idx);

            if (info.row < rows.length - 1) {
                var lowerRow = rows[info.row + 1];
                setFocus(layer.items[lowerRow[Math.min(info.col, lowerRow.length - 1)]]);
                return;
            }
            if (loc.layerPos < layers.length - 1) {
                var next = layers[loc.layerPos + 1];
                var nextRows = computeRows(next.items);
                var nextFirstRow = nextRows[0] || [];
                if (nextFirstRow.length > 0) {
                    setFocus(next.items[nextFirstRow[Math.min(info.col, nextFirstRow.length - 1)]]);
                }
            }
            return;
        }

        if (isInPosterLayer(currentFocused)) {
            var posters = getPosters();
            var content = getContent();
            var columnsInRow = window.utils.getCardContainerChildNumInRow(content);
            var idx = posters.indexOf(currentFocused);
            var newIdx = idx + columnsInRow;

            var lastRowStart = Math.floor((posters.length - 1) / columnsInRow) * columnsInRow;

            if (newIdx < posters.length) {
                setFocus(posters[newIdx]);

                // 焦点移动到最后一排时触发分页加载
                if (newIdx >= lastRowStart && !isLoading && hasMore) {
                    loadMorePosters();
                }
            } else if (idx >= lastRowStart && !isLoading && hasMore) {
                // 焦点已在最后一排，继续向下时也尝试加载下一页
                loadMorePosters();
            }
            return;
        }
    }

    function handleLeft() {
        if (!currentFocused) return;

        if (isInDialogLayer(currentFocused)) {
            var loc = locateInDialog(currentFocused);
            if (!loc) return;
            var layerItems = getDialogLayers()[loc.layerPos].items;
            if (loc.idx > 0) {
                setFocus(layerItems[loc.idx - 1]);
            }
            return;
        }

        if (isInPosterLayer(currentFocused)) {
            var posters = getPosters();
            var idx = posters.indexOf(currentFocused);
            if (idx > 0) {
                setFocus(posters[idx - 1]);
            }
            return;
        }
    }

    function handleRight() {
        if (!currentFocused) return;

        if (isInDialogLayer(currentFocused)) {
            var loc = locateInDialog(currentFocused);
            if (!loc) return;
            var layerItems = getDialogLayers()[loc.layerPos].items;
            if (loc.idx < layerItems.length - 1) {
                setFocus(layerItems[loc.idx + 1]);
            }
            return;
        }

        if (isInPosterLayer(currentFocused)) {
            var posters = getPosters();
            var idx = posters.indexOf(currentFocused);
            if (idx < posters.length - 1) {
                setFocus(posters[idx + 1]);
            }
            return;
        }
    }

    /* ======================== 确认键处理 ======================== */

    function selectRowItem(row, item) {
        var items = Array.from(row.querySelectorAll('text-btn'));
        items.forEach(function (it) {
            it.removeAttribute('selected');
        });
        item.setAttribute('selected', '');
    }

    function handleConfirm() {
        if (!currentFocused) return;

        if (isInDialogLayer(currentFocused)) {
            var action = currentFocused.getAttribute('data-action');
            if (action === 'back_page') {
                window.utils.backPage();
                return;
            }
            if (action === 'close_dialog') {
                closeDialog();
                return;
            }
            if (action === 'confirm_filter') {
                confirmFilter();
                return;
            }

            // 筛选选项：只更新选中态，等待「确认筛选条件」生效
            var row = currentFocused.closest('.selector-row');
            if (row) {
                selectRowItem(row, currentFocused);
            }
            return;
        }

        if (isInPosterLayer(currentFocused)) {
            var vid = currentFocused.getAttribute('data-vid');
            if (vid) {
                console.log('[catalog.js] 点击海报，vid:', vid);
                window.utils.setCurrentVid(vid);
                window.utils.gotoPage('catalog.html', 'detail.html');
            }
            return;
        }
    }

    function handleBack() {
        // 返回键不是返回上一页：
        // 弹窗关闭 → 打开弹窗；弹窗打开 → 关闭弹窗回到海报层。
        if (isDialogOpen()) {
            closeDialog();
        } else {
            openDialog();
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
        window.addEventListener(GP.BACK, handleBack);
    }

    /* ======================== 筛选器初始化 ======================== */

    function initYearSelector() {
        var yearRow = document.getElementById('year-selector');
        if (!yearRow) return;

        // 清空重建，避免与任何残留的年份按钮重复
        Array.from(yearRow.querySelectorAll('text-btn')).forEach(function (btn) {
            btn.remove();
        });

        var allBtn = document.createElement('text-btn');
        allBtn.textContent = ALL_LABEL;
        yearRow.appendChild(allBtn);

        var currentYear = new Date().getFullYear();
        for (var y = currentYear; y > 2000; y--) {
            var b = document.createElement('text-btn');
            b.textContent = String(y);
            yearRow.appendChild(b);
        }
        var earlier = document.createElement('text-btn');
        earlier.textContent = '2000及以前';
        yearRow.appendChild(earlier);
    }

    /** 保证每个筛选行都有「不限」作为第一项（标签行等） */
    function ensureAllOptionForRows() {
        getSelectorRows().forEach(function (row) {
            var items = Array.from(row.querySelectorAll('text-btn'));
            if (items.length === 0) return;
            if (items[0].textContent.trim() !== ALL_LABEL) {
                var allBtn = document.createElement('text-btn');
                allBtn.textContent = ALL_LABEL;
                row.insertBefore(allBtn, items[0]);
            }
        });
    }

    function initSelector() {
        initYearSelector();
        ensureAllOptionForRows();
        window.currentFilter = getDefaultFilter();
        applyFilterToSelectorRows(window.currentFilter);
    }

    /* ======================== 筛选条件收集 / 回显 ======================== */

    function getDefaultFilter() {
        return { group: 'all', year: 'all', tags: [], area: 'all', letter: 'all', season: 'all' };
    }

    /** 弹窗选项文字 → 传给 SQL 的筛选值 */
    function optionValueToFilterValue(label, type) {
        if (label === ALL_LABEL) return 'all';
        if (type === 'year' && label === '2000及以前') return '2000及以前';
        return label;
    }

    function getRowSelectedButton(row) {
        var selected = row.querySelector('text-btn[selected]');
        if (!selected) {
            var items = row.querySelectorAll('text-btn');
            selected = items.length ? items[0] : null;
        }
        return selected;
    }

    /**
     * 解析 text-btn 的 data-keyword 属性（逗号分隔的关键词字符串列表）。
     * 无该属性或内容为空时返回 null。
     */
    function parseDataKeywords(btn) {
        if (!btn || !btn.hasAttribute('data-keyword')) return null;
        var raw = btn.getAttribute('data-keyword') || '';
        var keywords = raw.split(',').map(function (s) {
            return s.trim();
        }).filter(function (s) {
            return s;
        });
        return keywords.length > 0 ? keywords : null;
    }

    /**
     * 取按钮的模糊匹配关键词：
     * 有 data-keyword 时使用其关键词列表；否则使用 [按钮文字]。
     */
    function getButtonKeywords(btn) {
        var keywords = parseDataKeywords(btn);
        if (keywords) return keywords;
        return [btn.textContent.trim()];
    }

    /**
     * 收集某个筛选行内全部关键词（每个按钮的文字 + data-keyword 列表），
     * 并剔除「不限」「其他」。用于「其他」的 NOT LIKE 排除匹配。
     */
    function collectCategoryKeywords(row) {
        var keywords = [];
        Array.from(row.querySelectorAll('text-btn')).forEach(function (item) {
            var text = item.textContent.trim();
            if (text === ALL_LABEL || text === '其他') return;
            keywords.push(text);
            var dataKeywords = parseDataKeywords(item);
            if (dataKeywords) {
                keywords = keywords.concat(dataKeywords);
            }
        });
        return Array.from(new Set(keywords));
    }

    function getRowSelectedValue(row) {
        var selected = getRowSelectedButton(row);
        return selected ? selected.textContent.trim() : ALL_LABEL;
    }

    function collectCurrentFilter() {
        var filter = getDefaultFilter();

        getSelectorRows().forEach(function (row) {
            var type = getRowFilterType(row);
            if (!type) return;
            var btn = getRowSelectedButton(row);
            var label = getRowSelectedValue(row);
            var value = optionValueToFilterValue(label, type);

            switch (type) {
                case 'group':
                    filter.group = value;
                    break;
                case 'area':
                    filter.area = value;
                    if (value !== 'all') {
                        if (label === '其他') {
                            filter.areaExcludeKeywords = collectCategoryKeywords(row);
                        } else {
                            filter.areaKeywords = getButtonKeywords(btn);
                        }
                    }
                    break;
                case 'letter':
                    filter.letter = value;
                    break;
                case 'year':
                    filter.year = value;
                    break;
                case 'tags':
                    if (value !== 'all') {
                        if (label === '其他') {
                            filter.tagsExcludeKeywords = collectCategoryKeywords(row);
                        } else {
                            filter.tags = getButtonKeywords(btn);
                        }
                    }
                    break;
            }
        });

        console.log('[catalog.js] collectCurrentFilter 结果:', JSON.stringify(filter));
        return filter;
    }

    function getFilterValueForType(filter, type) {
        switch (type) {
            case 'group': return filter.group || 'all';
            case 'area': return filter.area || 'all';
            case 'letter': return filter.letter || 'all';
            case 'year': return filter.year || 'all';
            case 'tags': return (filter.tags && filter.tags.length > 0) ? filter.tags[0] : 'all';
            default: return 'all';
        }
    }

    /** 把已生效的筛选条件回显到弹窗各筛选行（单选） */
    function applyFilterToSelectorRows(filter) {
        getSelectorRows().forEach(function (row) {
            var type = getRowFilterType(row);
            if (!type) return;

            var items = Array.from(row.querySelectorAll('text-btn'));
            if (items.length === 0) return;

            var desired = getFilterValueForType(filter, type);
            var target = items[0];
            for (var i = 0; i < items.length; i++) {
                var value = optionValueToFilterValue(items[i].textContent.trim(), type);
                if (value === desired) {
                    target = items[i];
                    break;
                }
            }

            items.forEach(function (it) {
                it.removeAttribute('selected');
            });
            target.setAttribute('selected', '');
        });
    }

    /* ======================== 海报列表渲染 ======================== */

    function setPosterContent(poster, info, posterObjectUrl) {
        if (!poster) return;

        // 图片和标题都通过组件属性设置，不直接操作 shadow DOM
        poster.setAttribute('img-url', posterObjectUrl || '../img/default.png');
        poster.setAttribute('title', info.name || '未知标题');
    }

    function createPosterCard(info, posterObjectUrl) {
        var poster = document.createElement('poster-card');
        poster.setAttribute('data-vid', info.vid);
        poster.setAttribute('tabindex', '0');
        setPosterContent(poster, info, posterObjectUrl);
        return poster;
    }

    function updateEmptyState() {
        var content = getContent();
        if (!content) return;
        if (getPosters().length === 0) {
            content.classList.add('empty');
        } else {
            content.classList.remove('empty');
        }
    }

    function clearPosters() {
        var content = getContent();
        if (!content) return;
        content.innerHTML = '';
        updateEmptyState();
    }

    function renderPosters(infos, posterUrlMap) {
        var content = getContent();
        if (!content) return;

        clearPosters();

        if (!infos || infos.length === 0) {
            return;
        }

        content.classList.remove('empty');
        infos.forEach(function (info) {
            var posterObjectUrl = posterUrlMap && posterUrlMap[info.vid] ? posterUrlMap[info.vid] : '';
            content.appendChild(createPosterCard(info, posterObjectUrl));
        });

        var posters = getPosters();
        if (posters.length > 0) {
            setFocus(posters[0]);
        } else {
            updateEmptyState();
        }
    }

    function appendPosters(infos, posterUrlMap) {
        var content = getContent();
        if (!content) return;

        if (!infos || infos.length === 0) {
            return;
        }

        content.classList.remove('empty');
        infos.forEach(function (info) {
            var posterObjectUrl = posterUrlMap && posterUrlMap[info.vid] ? posterUrlMap[info.vid] : '';
            content.appendChild(createPosterCard(info, posterObjectUrl));
        });
    }

    function updateCardPoster(vid, objectUrl) {
        var poster = document.querySelector('poster-card[data-vid="' + vid + '"]');
        if (!poster || !objectUrl) return;
        poster.setAttribute('img-url', objectUrl);
    }

    /* ======================== 数据加载 ======================== */

    /** 加载下一页海报（滚动接近底部触发） */
    async function loadMorePosters() {
        if (isLoading || !hasMore) return;

        try {
            isLoading = true;
            window.currentPage += 1;

            console.log('[catalog.js] 加载下一页，页码:', window.currentPage, '筛选条件:', window.currentFilter);

            var vids = await window.moebox.getVidsByFilter(window.currentFilter, window.currentPage, window.pageSize);
            console.log('[catalog.js] 获取到下一页 vid 列表，数量:', vids.length);

            if (!vids || vids.length === 0) {
                hasMore = false;
                return;
            }
            if (vids.length < window.pageSize) {
                hasMore = false;
            }

            var infoList = await window.moebox.getInfoListByVidList(vids);
            if (infoList && infoList.length > 0) {
                appendPosters(infoList, {});
                window.utils.getPosterObjectUrl(vids, function (vid, objectUrl) {
                    updateCardPoster(vid, objectUrl);
                });
            }
        } catch (error) {
            console.error('[catalog.js] 加载下一页失败:', error);
        } finally {
            isLoading = false;
        }
    }

    /** 筛选条件变更时，刷新海报列表视图 */
    async function updateCardViewWhenFilterChanged(newFilter) {
        try {
            window.currentFilter = newFilter || collectCurrentFilter();
            window.currentPage = 1;
            isLoading = false;
            hasMore = true;

            console.log('[catalog.js] 更新海报视图，筛选条件:', window.currentFilter);

            var vids = await window.moebox.getVidsByFilter(window.currentFilter, window.currentPage, window.pageSize);
            console.log('[catalog.js] 获取到 vid 列表，数量:', vids.length);

            if (!vids || vids.length === 0) {
                clearPosters();
                return;
            }
            if (vids.length < window.pageSize) {
                hasMore = false;
            }

            var infoList = await window.moebox.getInfoListByVidList(vids);
            if (!infoList || infoList.length === 0) {
                clearPosters();
                return;
            }

            renderPosters(infoList, {});

            window.utils.getPosterObjectUrl(vids, function (vid, objectUrl) {
                updateCardPoster(vid, objectUrl);
            });
        } catch (error) {
            console.error('[catalog.js] 更新海报视图失败:', error);
            clearPosters();
        }
    }

    /* ======================== 启动 ======================== */

    function bindPosterUpdateListener() {
        // 主进程推送海报更新后，刷新对应卡片
        window.moebox.onUpdatePoster(function (posterData) {
            var vid = posterData.vid;
            if (!posterData.filePath) return;

            console.log('[catalog.js] 收到更新的海报文件: vid=' + vid + ', filePath=' + posterData.filePath);
            updateCardPoster(vid, window.utils.pathToFileUrl(posterData.filePath));
        });
    }

    async function init() {
        var dialog = getDialog();
        if (dialog) {
            // 进入 catalog 页面时弹窗层隐藏
            if (dialog.open) dialog.close();

            // ESC 或原生关闭弹窗时，放弃未确认的选择并恢复焦点到海报层
            dialog.addEventListener('close', function () {
                applyFilterToSelectorRows(window.currentFilter || getDefaultFilter());
                restoreFocusToPosterLayer();
            });
        }

        initSelector();
        initFocus();
        bindGamepadEvents();
        bindPosterUpdateListener();

        await updateCardViewWhenFilterChanged();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
