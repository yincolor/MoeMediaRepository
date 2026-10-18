/*!
 * Gamepad 自定义事件桥接库 (gamepad.js)
 * ------------------------------------------------------------------
 * 基于 W3C Gamepad API，在 window.onload 后自动开始监听手柄输入，
 * 并将原始按钮状态转换为语义化的自定义事件广播给页面其他对象。
 *
 * 自定义事件（均在 window 上 dispatch，可用 window.addEventListener 监听）：
 *   1. "gp:up"        方向键-上 按下          （持续按住则每 266ms 再广播一次 "gp:up-long"）
 *   2. "gp:down"      方向键-下 按下          （同上 -> "gp:down-long"）
 *   3. "gp:left"      方向键-左 按下          （同上 -> "gp:left-long"）
 *   4. "gp:right"     方向键-右 按下          （同上 -> "gp:right-long"）
 *   5. "gp:confirm"   A 键 按下并抬起后触发
 *   6. "gp:back"      B 键 按下并抬起后触发
 *
 * 每个事件的 detail 包含: { gamepadIndex, button, timestamp }
 */
(function (global) {
  'use strict';

  // 防止重复初始化
  if (global.GamepadBridge) {
    return;
  }

  /* ----------------------------- 配置常量 ----------------------------- */

  var LONG_PRESS_DELAY = 500;    // 进入长按状态的判定延时（毫秒）：按下后持续 266ms 仍未抬起，则进入长按状态
  var LONG_PRESS_INTERVAL = 200; // 进入长按状态后，长按事件的广播间隔（毫秒）
  var DEBOUNCE_DELAY = 80; // 新增：按钮防抖间隔（毫秒）


  // Standard Gamepad 标准映射按钮索引（绝大多数现代手柄遵循）
  var BTN = {
    A: 0,     // 确认
    B: 1,     // 返回
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15
  };

  // 对外暴露的事件名
  var EVENTS = {
    UP: 'gp:up',
    DOWN: 'gp:down',
    LEFT: 'gp:left',
    RIGHT: 'gp:right',
    UP_LONG: 'gp:up-long',
    DOWN_LONG: 'gp:down-long',
    LEFT_LONG: 'gp:left-long',
    RIGHT_LONG: 'gp:right-long',
    CONFIRM: 'gp:confirm',
    BACK: 'gp:back',
    CONNECT: 'gp:connected',
    DISCONNECT: 'gp:disconnected'
  };

  /* ----------------------------- 内部状态 ----------------------------- */

  // 按钮当前是否处于按下状态（按 "gamepadIndex:buttonIndex" 记录，支持多手柄）
  var pressedMap = {};

  // 长按阶段定时器句柄（按 "gamepadIndex:buttonIndex" 记录）
  //   delayTimer: 进入长按状态前的延时句柄（setTimeout，266ms）
  //   intervalTimer: 进入长按状态后的重发句柄（setInterval，140ms）
  var longPressTimers = {};

  var lastPressTimeMap = {}; // 新增：记录上次按下时间

  // 轮询句柄
  var rafId = null;
  var started = false;

  /* ----------------------------- 工具函数 ----------------------------- */

  function hasGamepadApi() {
    return !!(global.navigator && typeof global.navigator.getGamepads === 'function');
  }

  function key(gamepadIndex, buttonIndex) {
    return gamepadIndex + ':' + buttonIndex;
  }

  function getButton(gamepad, buttonIndex) {
    var b = gamepad.buttons[buttonIndex];
    return b ? b : null;
  }

  function isButtonPressed(gamepad, buttonIndex) {
    var b = getButton(gamepad, buttonIndex);
    if (!b) return false;
    // 兼容数字 / 对象两种 buttons 表示方式
    return typeof b === 'number' ? b > 0.5 : !!b.pressed;
  }

  // 广播自定义事件到 window
  function emit(eventName, gamepad, buttonIndex) {
    var detail = {
      gamepadIndex: gamepad.index,
      button: buttonIndex,
      timestamp: gamepad.timestamp || Date.now()
    };
    var event;
    try {
      event = new global.CustomEvent(eventName, { detail: detail, bubbles: false, cancelable: true });
    } catch (e) {
      // 兼容老旧浏览器
      event = global.document.createEvent('CustomEvent');
      event.initCustomEvent(eventName, false, true, detail);
    }
    global.dispatchEvent(event);
  }

  // 获取第一个可用的手柄（按 index 顺序）
  function getFirstGamepad() {
    if (!hasGamepadApi()) return null;
    var pads = global.navigator.getGamepads();
    if (!pads) return null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i]) return pads[i];
    }
    return null;
  }

  /* --------------------------- 方向键处理逻辑 --------------------------- */
  //
  // 自动重复采用"先延时再加速"模式：
  //   1. 按下沿：立即广播基础事件，并启动一个 266ms 的延时定时器；
  //   2. 若 266ms 后通过 getFirstGamepad() 校验仍未抬起：进入长按状态，
  //      广播首个长按事件，并启动一个 140ms 间隔的重发定时器；
  //   3. 重发定时器每次触发都校验仍处于按下状态，是则广播长按事件；
  //   4. 抬起沿：清除延时与重发两个定时器，退出长按状态。
  //   下次按下重新从第 1 步开始，需要再次保持 266ms 才会进入长按状态。
  //
  function handleDirectionButton(gamepad, buttonIndex, baseEvent, longEvent) {
    var k = key(gamepad.index, buttonIndex);
    var nowPressed = isButtonPressed(gamepad, buttonIndex);
    var wasPressed = !!pressedMap[k];

    if (nowPressed && !wasPressed) {
      // —— 按下沿 ——

      // 防抖
      var now = Date.now();
      var last = lastPressTimeMap[k] || 0;
      if (now - last < DEBOUNCE_DELAY) {
        // 防抖触发：忽略本次按下，但仍标记为已按下（用于后续抬起清除）
        pressedMap[k] = true;
        // 更新时间戳，避免后续再次被忽略
        lastPressTimeMap[k] = now;
        return;
      }

      pressedMap[k] = true;
      
      console.log(`[Gamepad] 发送事件 ${buttonIndex}`);
      emit(baseEvent, gamepad, buttonIndex);
      lastPressTimeMap[k] = now; 

      var t = { delayTimer: null, intervalTimer: null };

      // 266ms 后若仍未抬起，进入长按状态
      t.delayTimer = global.setTimeout(function () {
        if (!pressedMap[k]) return;
        var pad = getFirstGamepad();
        if (pad && isButtonPressed(pad, buttonIndex)) {
          emit(longEvent, pad, buttonIndex); // 进入长按状态的第一个事件

          // 进入长按状态后，每 140ms 重发一次
          t.intervalTimer = global.setInterval(function () {
            var p = getFirstGamepad();
            if (p && isButtonPressed(p, buttonIndex)) {
              emit(longEvent, p, buttonIndex);
            } else {
              // 不再按下，清理自身
              global.clearInterval(t.intervalTimer);
              t.intervalTimer = null;
            }
          }, LONG_PRESS_INTERVAL);
        }
      }, LONG_PRESS_DELAY);

      longPressTimers[k] = t;

    } else if (!nowPressed && wasPressed) {
      // —— 抬起沿 ——
      pressedMap[k] = false;
      var t = longPressTimers[k];
      if (t) {
        if (t.delayTimer) {
          global.clearTimeout(t.delayTimer);
          t.delayTimer = null;
        }
        if (t.intervalTimer) {
          global.clearInterval(t.intervalTimer);
          t.intervalTimer = null;
        }
        delete longPressTimers[k];
      }
    }
  }

  /* --------------------------- 确认/返回键处理逻辑 --------------------------- */
  //
  // 仅在"按下后抬起"的完整动作结束时广播事件。
  // 按下沿只标记状态，不广播。
  //
  function handleActionButton(gamepad, buttonIndex, event) {
    var k = key(gamepad.index, buttonIndex);
    var nowPressed = isButtonPressed(gamepad, buttonIndex);
    var wasPressed = !!pressedMap[k];

    if (nowPressed && !wasPressed) {
      // 按下沿：仅记录
      pressedMap[k] = true;
    } else if (!nowPressed && wasPressed) {
      // 抬起沿：广播
      pressedMap[k] = false;
      emit(event, gamepad, buttonIndex);
    }
  }

  /* ----------------------------- 主轮询循环 ----------------------------- */

  function tick() {
    var pad = getFirstGamepad();
    if (pad) {
      handleDirectionButton(pad, BTN.DPAD_UP, EVENTS.UP, EVENTS.UP_LONG);
      handleDirectionButton(pad, BTN.DPAD_DOWN, EVENTS.DOWN, EVENTS.DOWN_LONG);
      handleDirectionButton(pad, BTN.DPAD_LEFT, EVENTS.LEFT, EVENTS.LEFT_LONG);
      handleDirectionButton(pad, BTN.DPAD_RIGHT, EVENTS.RIGHT, EVENTS.RIGHT_LONG);
      handleActionButton(pad, BTN.A, EVENTS.CONFIRM);
      handleActionButton(pad, BTN.B, EVENTS.BACK);
    }
    rafId = global.requestAnimationFrame(tick);
  }

  /* ----------------------------- 生命周期 ----------------------------- */

  function start() {
    if (started || !hasGamepadApi()) return;
    started = true;

    // 手柄连接 / 断开 通知（可选监听）
    global.addEventListener('gamepadconnected', function (e) {
      emit(EVENTS.CONNECT, e.gamepad || { index: -1, timestamp: Date.now() }, -1);
    });
    global.addEventListener('gamepaddisconnected', function (e) {
      emit(EVENTS.DISCONNECT, e.gamepad || { index: -1, timestamp: Date.now() }, -1);
    });

    // 启动轮询
    rafId = global.requestAnimationFrame(tick);
  }

  function destroy() {
    started = false;
    if (rafId) {
      global.cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (var k in longPressTimers) {
      if (Object.prototype.hasOwnProperty.call(longPressTimers, k)) {
        var t = longPressTimers[k];
        if (t.delayTimer) global.clearTimeout(t.delayTimer);
        if (t.intervalTimer) global.clearInterval(t.intervalTimer);
      }
    }
    longPressTimers = {};
    pressedMap = {};
    lastPressTimeMap = {};
  }

  /* ----------------------------- 对外接口 ----------------------------- */

  global.GamepadBridge = {
    EVENTS: EVENTS,
    BUTTONS: BTN,
    LONG_PRESS_INTERVAL: LONG_PRESS_INTERVAL,
    DEBOUNCE_DELAY: DEBOUNCE_DELAY, // 方便外部调节
    start: start,
    destroy: destroy,
    isSupported: hasGamepadApi
  };

  /* --------------------------- 自动启动（window.onload） --------------------------- */

  function autoload() {
    if (!hasGamepadApi()) {
      // 当前环境不支持 Gamepad API，静默退出
      return;
    }
    if (global.document && global.document.readyState === 'complete') {
      start();
    } else {
      global.addEventListener('load', start);
    }
  }

  // 引入本脚本即自动注册，无需手动调用
  autoload();

})(typeof window !== 'undefined' ? window : this);
