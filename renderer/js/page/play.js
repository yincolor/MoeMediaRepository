/**
 * play.js — play.html 页面控制器（播放页）
 *
 * 播放页结构（play.html）：
 *   - video：通过 hls.js 播放 m3u8 HLS 流媒体（不支持时回退原生 HLS）
 *   - .control-layer
 *       - .process > input[type=range]  进度条
 *       - .playstop > icon-btn          播放 / 暂停按钮
 *       - .volume > icon-btn + .volumn-value  音量显示
 *
 * 手柄映射：
 *   - gp:confirm：播放 / 暂停
 *   - gp:left / gp:right：快退 / 快进 5 秒
 *   - gp:left-long / gp:right-long：连续时移（暂停 → 每个长按事件步进 3 秒 →
 *     最后一次长按事件 1 秒后恢复播放）
 *   - gp:up / gp:down：音量加 / 减 10（仅点击响应，长按不响应）
 *   - gp:back：返回上一页
 *
 * 各控制组件在状态变化时单独显示，3 秒无操作后自动隐藏。
 */
(function () {
    'use strict';

    var GP = window.GamepadBridge ? window.GamepadBridge.EVENTS : {
        UP: 'gp:up', DOWN: 'gp:down', LEFT: 'gp:left', RIGHT: 'gp:right',
        UP_LONG: 'gp:up-long', DOWN_LONG: 'gp:down-long', LEFT_LONG: 'gp:left-long', RIGHT_LONG: 'gp:right-long',
        CONFIRM: 'gp:confirm', BACK: 'gp:back'
    };

    /* ======================== 控制层组件访问器 ======================== */

    var controlLayer = {
        getInstance: function () {
            return document.querySelector('.control-layer');
        }
    };

    // var processBar = {
    //     getInstance: function () {
    //         const layer = controlLayer.getInstance();
    //         return layer ? layer.querySelector('.process') : null;
    //     },
    //     getInput: function () {
    //         const bar = processBar.getInstance();
    //         return bar ? bar.querySelector('input[type="range"]') : null;
    //     },
    //     show: function () {
    //         const bar = processBar.getInstance();
    //         if (bar) bar.classList.remove('visibility-hide');
    //     },
    //     hide: function () {
    //         const bar = processBar.getInstance();
    //         if (bar) bar.classList.add('visibility-hide');
    //     },
    //     setProcess: function (floatNum) {
    //         const input = processBar.getInput();
    //         if (input) input.value = floatNum;
    //     }
    // };

    var processBar = {
        getInstance: function () {
            const layer = controlLayer.getInstance();
            return layer ? layer.querySelector('.process') : null;
        },
        getInput: function () {
            const bar = processBar.getInstance();
            return bar ? bar.querySelector('input[type="range"]') : null;
        },
        getCurTimeElement: function () {
            const bar = processBar.getInstance();
            return bar ? bar.querySelector('.cur_time') : null;
        },
        getEndTimeElement: function () {
            const bar = processBar.getInstance();
            return bar ? bar.querySelector('.end_time') : null;
        },
        show: function () {
            const bar = processBar.getInstance();
            if (bar) bar.classList.remove('visibility-hide');
        },
        hide: function () {
            const bar = processBar.getInstance();
            if (bar) bar.classList.add('visibility-hide');
        },
        setProcess: function (floatNum) {
            const input = processBar.getInput();
            if (input) input.value = floatNum;
        },
        /**
         * 更新当前播放时间 / 总时长文本
         * @param {string} curText 当前时间文本，如 "00:01:23"
         * @param {string} endText 总时长文本，如 "00:45:00"
         */
        setTimeText: function (curText, endText) {
            const curEl = processBar.getCurTimeElement();
            const endEl = processBar.getEndTimeElement();
            // 文本未变化时不写 DOM，减少重排
            if (curEl && curEl.textContent !== curText) curEl.textContent = curText;
            if (endEl && endEl.textContent !== endText) endEl.textContent = endText;
        }
    };

    var playstop = {
        getInstance: function () {
            const layer = controlLayer.getInstance();
            return layer ? layer.querySelector('.playstop icon-btn') : null;
        },
        getStatus: function () {
            const btn = playstop.getInstance();
            return btn ? btn.getAttribute('icon-name') : '';
        },
        setStatus: function (iconName) {
            const btn = playstop.getInstance();
            if (btn) btn.setAttribute('icon-name', iconName);
        },
        show: function () {
            const layer = controlLayer.getInstance();
            const playstop = layer.querySelector('.playstop');
            if (playstop) playstop.classList.remove('visibility-hide');
        },
        hide: function () {
            const layer = controlLayer.getInstance();
            const playstop = layer.querySelector('.playstop');
            if (playstop) playstop.classList.add('visibility-hide');
        }
    };

    var volume = {
        getInstance: function () {
            const layer = controlLayer.getInstance();
            return layer ? layer.querySelector('.volume') : null;
        },
        getValueElement: function () {
            const vol = volume.getInstance();
            return vol ? vol.querySelector('.volumn-value') : null;
        },
        setValue: function (num) {
            const el = volume.getValueElement();
            if (el) el.textContent = String(num);
        },
        show: function () {
            const vol = volume.getInstance();
            if (vol) vol.classList.remove('visibility-hide');
        },
        hide: function () {
            const vol = volume.getInstance();
            if (vol) vol.classList.add('visibility-hide');
        }
    };

    /* ======================== 状态 ======================== */

    var controlBarHideTimerId = null;
    var seekResumeTimerId = null;
    var isSeeking = false;
    var hls = null;

    /* ======================== DOM 辅助 ======================== */

    function getVideoElement() {
        return document.querySelector('video');
    }

    /**
     * 销毁当前 hls.js 实例，释放资源
     */
    function destroyHls() {
        if (hls) {
            try {
                hls.destroy();
            } catch (e) {
                console.warn('[play.js] destroyHls: 销毁 hls 实例失败:', e.message);
            }
            hls = null;
        }
    }

    /* ======================== 控制组件显隐 ======================== */

    function showProcessBar() {
        processBar.show();
        resetControlBarHideTimer();
    }

    function showPlaystop() {
        playstop.show();
        resetControlBarHideTimer();
    }

    function showVolume() {
        volume.show();
        resetControlBarHideTimer();
    }

    function hideControlComponents() {
        processBar.hide();
        playstop.hide();
        volume.hide();
    }

    function resetControlBarHideTimer() {
        if (controlBarHideTimerId) {
            clearTimeout(controlBarHideTimerId);
        }
        controlBarHideTimerId = setTimeout(hideControlComponents, 3000);
    }

    /* ======================== 播放状态 ======================== */

    function updatePlayButton(isPlaying) {
        playstop.setStatus(isPlaying ? '暂停' : '播放');
    }

    /**
     * 将秒数格式化为 HH:MM:SS
     * @param {number} seconds - 秒数
     * @param {string} invalidText - 秒数无效（NaN / Infinity / 负数）时的显示文本
     * @returns {string}
     */
    function formatTime(seconds, invalidText) {
        if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) {
            return invalidText || '--:--:--';
        }

        var total = Math.floor(seconds);
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;

        function pad(n) {
            return n < 10 ? '0' + n : String(n);
        }

        return pad(h) + ':' + pad(m) + ':' + pad(s);
    }

    function updateProgressBar() {
        var video = getVideoElement();
        if (!video) return;

        var duration = video.duration || 0;
        var currentTime = video.currentTime || 0;

        // 直播流 duration 可能为 Infinity，此时进度条按 0 处理
        var percent = (isFinite(duration) && duration > 0)
            ? (currentTime / duration) * 100
            : 0;

        processBar.setProcess(percent); // 设置进度条进度

        /* 设置时间 */
        var endText = formatTime(duration, '--:--:--');
        var curText = formatTime(currentTime, '00:00:00');
        // 直播/未知时长时，当前时间也按已播放时长正常显示即可
        processBar.setTimeText(curText, endText);
    }

    // function updateProgressBar() {
    //     var video = getVideoElement();
    //     if (!video) return;

    //     var duration = video.duration || 0;
    //     var currentTime = video.currentTime || 0;
    //     var percent = duration > 0 ? (currentTime / duration) * 100 : 0;

    //     processBar.setProcess(percent); // 设置进度条进度

    //     /* 设置时间 */

    // }

    function updateVolumeDisplay() {
        var video = getVideoElement();
        if (!video) return;
        volume.setValue(Math.round(video.volume * 100));
    }

    /**
     * 设置播放音量（0-100）
     * @param {number} volumeNumber - 目标音量
     */
    function setVolume(volumeNumber) {
        var video = getVideoElement();
        if (!video) return;

        var validVolume = parseInt(volumeNumber, 10);
        if (isNaN(validVolume)) {
            validVolume = 100;
        }
        validVolume = Math.max(0, Math.min(100, validVolume));

        if (validVolume > 0 && video.muted) {
            video.muted = false;
        }
        video.volume = validVolume / 100;
        volume.setValue(validVolume);
        showVolume();
    }

    function togglePlayPause() {
        var video = getVideoElement();
        if (!video) {
            console.warn('[play.js] togglePlayPause: video 元素未找到');
            return;
        }

        if (video.paused) {
            video.play().catch(function (e) {
                console.error('[play.js] togglePlayPause: 播放失败:', e.message);
            });
            updatePlayButton(true);
        } else {
            video.pause();
            updatePlayButton(false);
        }
        showPlaystop();
    }

    /* ======================== 方向键处理 ======================== */

    function handleUp() {
        console.log('[play.js] handleUp: 方向上键 - 音量增加');
        var video = getVideoElement();
        if (!video) return;
        var currentVolume = Math.round(video.volume * 100);
        setVolume(currentVolume + 10);
    }

    function handleDown() {
        console.log('[play.js] handleDown: 方向下键 - 音量减少');
        var video = getVideoElement();
        if (!video) return;
        var currentVolume = Math.round(video.volume * 100);
        setVolume(currentVolume - 10);
    }

    function handleLeft() {
        console.log('[play.js] handleLeft: 方向左键 - 快退5秒');
        var video = getVideoElement();
        if (!video) return;
        video.currentTime = Math.max(0, video.currentTime - 5);
        updateProgressBar();
        showProcessBar();
    }

    function handleRight() {
        console.log('[play.js] handleRight: 方向右键 - 快进5秒');
        var video = getVideoElement();
        if (!video) return;
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        updateProgressBar();
        showProcessBar();
    }

    /* ======================== 长按时移 ======================== */

    function handleLeftLong() {
        console.log('[play.js] handleLeftLong: 长按左键 - 开始快退');
        startSeek(-1);
    }

    function handleRightLong() {
        console.log('[play.js] handleRightLong: 长按右键 - 开始快进');
        startSeek(1);
    }

    function startSeek(direction) {
        var video = getVideoElement();
        if (!video) return;

        if (!isSeeking) {
            console.log('[play.js] startSeek: 首次进入长按时移模式，暂停视频');
            isSeeking = true;
            video.pause();
            updatePlayButton(false);
            showProcessBar();
        }

        if (seekResumeTimerId) {
            clearTimeout(seekResumeTimerId);
        }

        video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + direction * 3));
        updateProgressBar();
    }

    function endSeek() {
        if (!isSeeking) {
            return;
        }

        if (seekResumeTimerId) {
            clearTimeout(seekResumeTimerId);
        }

        seekResumeTimerId = setTimeout(function () {
            var video = getVideoElement();
            if (video && !video.ended) {
                console.log('[play.js] endSeek: 1秒定时到达，恢复播放');
                video.play().catch(function (e) {
                    console.error('[play.js] endSeek: 恢复播放失败:', e.message);
                });
                updatePlayButton(true);
            } else {
                console.log('[play.js] endSeek: 视频已结束或不存在，不恢复播放');
            }
            isSeeking = false;
        }, 1000);
    }

    function handleConfirm() {
        console.log('[play.js] handleConfirm: 确认键被按下 - 切换播放/暂停');
        togglePlayPause();
    }

    function handleBack() {
        console.log('[play.js] handleBack: 返回键被按下');
        window.utils.backPage();
    }

    /* ======================== 事件绑定 ======================== */

    function bindGamepadEvents() {
        // 上下键：仅点击响应音量，长按不响应
        window.addEventListener(GP.UP, handleUp);
        window.addEventListener(GP.DOWN, handleDown);
        // 左右键：点击快进快退
        window.addEventListener(GP.LEFT, handleLeft);
        window.addEventListener(GP.RIGHT, handleRight);
        // 左右长按：连续时移；同时重置「恢复播放」定时器
        window.addEventListener(GP.LEFT_LONG, handleLeftLong);
        window.addEventListener(GP.RIGHT_LONG, handleRightLong);
        window.addEventListener(GP.LEFT_LONG, endSeek);
        window.addEventListener(GP.RIGHT_LONG, endSeek);

        window.addEventListener(GP.CONFIRM, handleConfirm);
        window.addEventListener(GP.BACK, handleBack);
    }

    function bindProgressBarEvents() {
        var input = processBar.getInput();
        if (!input) return;

        input.addEventListener('input', function () {
            var video = getVideoElement();
            if (!video || !video.duration) return;

            var percent = parseFloat(input.value);
            if (isNaN(percent)) return;

            video.currentTime = (percent / 100) * video.duration;
            updateProgressBar();
            showProcessBar();
        });
    }

    function bindVideoEvents() {
        var video = getVideoElement();
        if (!video) {
            console.warn('[play.js] bindVideoEvents: video 元素未找到');
            return;
        }

        video.addEventListener('timeupdate', updateProgressBar);
        video.addEventListener('durationchange', updateProgressBar); 
        
        video.addEventListener('play', function () {
            console.log('[play.js] bindVideoEvents: 视频开始播放');
            updatePlayButton(true);
            showPlaystop();
        });
        video.addEventListener('pause', function () {
            console.log('[play.js] bindVideoEvents: 视频暂停');
            updatePlayButton(false);
            showPlaystop();
        });
        video.addEventListener('ended', function () {
            console.log('[play.js] bindVideoEvents: 视频播放结束');
            updatePlayButton(false);
            processBar.setProcess(0);
            showProcessBar();
            showPlaystop();
        });
        video.addEventListener('loadedmetadata', function () {
            console.log('[play.js] bindVideoEvents: 视频元数据加载完成');
            updateProgressBar();
        });
    }

    /* ======================== 播放源 ======================== */

    /** 根据 localStorage 中的 m3u8 地址，使用 hls.js 播放（不支持时回退原生 HLS） */
    function startPlay() {
        var video = getVideoElement();
        if (!video) {
            console.error('[play.js] startPlay: video 元素未找到');
            return;
        }

        var m3u8Url = localStorage.getItem('playingM3U8Url');
        console.log('[play.js] m3u8Url:', m3u8Url);
        if (!m3u8Url || m3u8Url.trim() === '') {
            console.error('[play.js] 没有找到有效的 m3u8 参数，无法播放');
            return;
        }
        m3u8Url = m3u8Url.trim();

        // 清理旧实例，避免重复加载
        destroyHls();

        var HlsLib = window.Hls;
        if (HlsLib && HlsLib.isSupported()) {
            playWithHlsJs(video, m3u8Url, HlsLib);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            playWithNativeHls(video, m3u8Url);
        } else {
            console.error('[play.js] 当前环境既不支持 hls.js，也不支持原生 HLS');
        }
    }

    /** 使用 hls.js 播放 m3u8 流媒体 */
    function playWithHlsJs(video, m3u8Url, HlsLib) {
        console.log('[play.js] 使用 hls.js 播放:', m3u8Url);

        hls = new HlsLib();
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);

        hls.on(HlsLib.Events.MANIFEST_PARSED, function () {
            console.log('[play.js] hls.js 清单解析完成，开始播放');
            video.play().catch(function (e) {
                console.log('[play.js] 自动播放被拦截，请手动点击播放: ' + e.message);
            });
        });

        hls.on(HlsLib.Events.ERROR, function (event, data) {
            if (!data.fatal) return;

            console.error('[play.js] hls.js 致命错误:', data.type, data.details);
            if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
                console.log('[play.js] 网络错误，尝试恢复加载');
                hls.startLoad();
            } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
                console.log('[play.js] 媒体错误，尝试恢复');
                hls.recoverMediaError();
            } else {
                console.error('[play.js] 不可恢复错误，销毁 hls 实例');
                destroyHls();
            }
        });
    }

    /** 原生 HLS 回退播放（如 Safari） */
    function playWithNativeHls(video, m3u8Url) {
        console.log('[play.js] 使用原生 HLS 播放:', m3u8Url);
        video.src = m3u8Url;
        video.play().catch(function (e) {
            console.log('[play.js] 自动播放被拦截，请手动点击播放: ' + e.message);
        });
    }

    /* ======================== 启动 ======================== */

    function init() {
        console.log('[play.js] init: 开始初始化播放器');

        // 初始音量
        var video = getVideoElement();
        if (video) {
            video.volume = 1;
        }
        volume.setValue(100);

        bindProgressBarEvents();
        bindVideoEvents();
        bindGamepadEvents();

        window.addEventListener('beforeunload', destroyHls);

        hideControlComponents();
        showProcessBar();
        showPlaystop();
        startPlay();
        console.log('[play.js] init: 播放器初始化完成');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
