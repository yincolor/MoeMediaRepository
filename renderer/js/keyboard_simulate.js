/*!
 * 键盘模拟手柄库 (keyboard_simulate.js) —— 仅用于开发时期
 * ------------------------------------------------------------------
 * 在没有真实手柄时，用键盘模拟 gamepad.js 广播的自定义事件，
 * 方便在开发/调试阶段继续工作。生产环境请移除引用。
 *
 * 键位映射：
 *   W / A / S / D  -> 方向 上 / 左 / 下 / 右
 *                     （持续按住则每 266ms 再广播一次对应的长按事件）
 *   J              -> 确认（对应手柄 A 键）   （按下并抬起后触发）
 *   K              -> 返回（对应手柄 B 键）   （按下并抬起后触发）
 *
 * 广播的自定义事件与 gamepad.js 完全一致（均在 window 上监听）：
 *   "gp:up" / "gp:down" / "gp:left" / "gp:right"
 *   "gp:up-long" / "gp:down-long" / "gp:left-long" / "gp:right-long"
 *   "gp:confirm" / "gp:back"
 *
 * 每个 event.detail: { gamepadIndex: -1, button, timestamp }
 *   gamepadIndex 固定为 -1，表示"键盘模拟虚拟手柄"，便于与真实手柄区分。
 */
(function (global) {
  'use strict';

  // 防止重复初始化
  if (global.KeyboardSimulate) {
    return;
  }

  /* ----------------------------- 配置常量 ----------------------------- */

  var LONG_PRESS_DELAY = 466;    // 进入长按状态的判定延时（毫秒）：按下后持续 266ms 仍未抬起，则进入长按状态
  var LONG_PRESS_INTERVAL = 140; // 进入长按状态后，长按事件的广播间隔（毫秒）

  // 与 gamepad.js 相同的标准按钮索引，确保 button 字段语义一致
  var BTN = {
    A: 0,          // 确认 (J)
    B: 1,          // 返回 (K)
    DPAD_UP: 12,   // W
    DPAD_DOWN: 13, // S
    DPAD_LEFT: 14, // A
    DPAD_RIGHT: 15 // D
  };

  // 对外事件名（与 gamepad.js 完全一致）
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
    BACK: 'gp:back'
  };

  // 键位 -> 行为映射
  // 使用 KeyboardEvent.code（如 "KeyW"），不受大小写 / CapsLock / 输入法影响
  var KEY_MAP = {
    'KeyW': { type: 'dir', button: BTN.DPAD_UP, base: EVENTS.UP, long: EVENTS.UP_LONG },
    'KeyS': { type: 'dir', button: BTN.DPAD_DOWN, base: EVENTS.DOWN, long: EVENTS.DOWN_LONG },
    'KeyA': { type: 'dir', button: BTN.DPAD_LEFT, base: EVENTS.LEFT, long: EVENTS.LEFT_LONG },
    'KeyD': { type: 'dir', button: BTN.DPAD_RIGHT, base: EVENTS.RIGHT, long: EVENTS.RIGHT_LONG },
    'KeyJ': { type: 'action', button: BTN.A, event: EVENTS.CONFIRM },
    'KeyK': { type: 'action', button: BTN.B, event: EVENTS.BACK }
  };

  // 虚拟手柄索引：-1 表示由键盘模拟产生，与真实手柄区分
  var SIMULATED_INDEX = -1;

  /* ----------------------------- 内部状态 ----------------------------- */

  // button 索引 -> 当前是否处于按下状态（边沿检测）
  var pressedMap = {};

  // button 索引 -> 长按阶段定时器句柄
  //   delayTimer: 进入长按状态前的延时句柄（setTimeout，266ms）
  //   intervalTimer: 进入长按状态后的重发句柄（setInterval，140ms）
  var longPressTimers = {};

  var started = false;

  /* ----------------------------- 工具函数 ----------------------------- */

  function isSupported() {
    return !!(global.document && typeof global.document.addEventListener === 'function');
  }

  // 当前焦点是否落在文本输入元素上，是则不拦截按键，避免影响正常输入
  function isTypingTarget() {
    var el = global.document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (typeof el.isContentEditable === 'boolean' && el.isContentEditable) return true;
    return false;
  }

  // 广播自定义事件到 window，detail 结构与 gamepad.js 保持一致
  function emit(eventName, buttonIndex) {
    var detail = {
      gamepadIndex: SIMULATED_INDEX,
      button: buttonIndex,
      timestamp: Date.now()
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

  /* --------------------------- 方向键（长按）处理 --------------------------- */
  //
  // 键盘事件天然维护按下/抬起状态，因此无需像 gamepad.js 那样轮询，
  // 直接在 keydown / keyup 里做边沿处理。自动重复采用"先延时再加速"模式：
  //   1. 按下沿：立即广播基础事件，并启动一个 266ms 的延时定时器；
  //   2. 若 266ms 后仍未抬起：进入长按状态，广播首个长按事件，并启动一个 140ms 间隔的重发定时器；
  //   3. 重发定时器每次触发都校验仍处于按下状态，是则广播长按事件；
  //   4. 抬起沿：清除延时与重发两个定时器，退出长按状态。
  //   下次按下重新从第 1 步开始，需要再次保持 266ms 才会进入长按状态。
  //
  function handleDirectionDown(buttonIndex, baseEvent, longEvent) {
    pressedMap[buttonIndex] = true;
    emit(baseEvent, buttonIndex);

    var t = {
      delayTimer: global.setTimeout(function () {
        // 266ms 后仍处于按下状态 -> 进入长按状态
        if (!pressedMap[buttonIndex]) return;
        emit(longEvent, buttonIndex); // 进入长按状态的第一个事件

        t.intervalTimer = global.setInterval(function () {
          if (pressedMap[buttonIndex]) {
            emit(longEvent, buttonIndex);
          } else {
            // 不再按下，清理自身
            global.clearInterval(t.intervalTimer);
            t.intervalTimer = null;
          }
        }, LONG_PRESS_INTERVAL);
      }, LONG_PRESS_DELAY)
    };
    longPressTimers[buttonIndex] = t;
  }

  function handleDirectionUp(buttonIndex) {
    pressedMap[buttonIndex] = false;
    var t = longPressTimers[buttonIndex];
    if (t) {
      if (t.delayTimer) {
        global.clearTimeout(t.delayTimer);
        t.delayTimer = null;
      }
      if (t.intervalTimer) {
        global.clearInterval(t.intervalTimer);
        t.intervalTimer = null;
      }
      delete longPressTimers[buttonIndex];
    }
  }

  /* --------------------------- 确认/返回键处理 --------------------------- */
  //
  // 仅在"按下后抬起"的完整动作结束时广播事件。
  // 按下沿只标记状态，不广播。
  //
  function handleActionDown(buttonIndex) {
    pressedMap[buttonIndex] = true;
  }

  function handleActionUp(buttonIndex, event) {
    // 仅当确实按下过才触发，避免状态错乱
    if (pressedMap[buttonIndex]) {
      pressedMap[buttonIndex] = false;
      emit(event, buttonIndex);
    }
  }

  /* ----------------------------- 事件处理 ----------------------------- */

  function onKeyDown(e) {
    // 浏览器对按住的键会持续派发 keydown（e.repeat=true），直接忽略，
    // 长按广播已由 setInterval 负责，避免重复触发。
    if (e.repeat) return;
    // 焦点在输入框等元素时不拦截，保持正常输入
    if (isTypingTarget()) return;

    var mapping = KEY_MAP[e.code];
    if (!mapping) return;

    // 边沿检测：已按下则忽略，防止异常重复
    if (pressedMap[mapping.button]) return;

    if (mapping.type === 'dir') {
      handleDirectionDown(mapping.button, mapping.base, mapping.long);
    } else {
      handleActionDown(mapping.button);
    }
  }

  function onKeyUp(e) {
    if (isTypingTarget()) return;

    var mapping = KEY_MAP[e.code];
    if (!mapping) return;

    if (mapping.type === 'dir') {
      handleDirectionUp(mapping.button);
    } else {
      handleActionUp(mapping.button, mapping.event);
    }
  }

  /* ----------------------------- 生命周期 ----------------------------- */

  function start() {
    if (started || !isSupported()) return;
    started = true;
    console.log("[键盘模拟] 绑定键盘按键事件")
    global.document.addEventListener('keydown', onKeyDown);
    global.document.addEventListener('keyup', onKeyUp);
  }

  function destroy() {
    started = false;
    global.document.removeEventListener('keydown', onKeyDown);
    global.document.removeEventListener('keyup', onKeyUp);
    for (var k in longPressTimers) {
      if (Object.prototype.hasOwnProperty.call(longPressTimers, k)) {
        var t = longPressTimers[k];
        if (t.delayTimer) global.clearTimeout(t.delayTimer);
        if (t.intervalTimer) global.clearInterval(t.intervalTimer);
      }
    }
    longPressTimers = {};
    pressedMap = {};
  }

  /* ----------------------------- 对外接口 ----------------------------- */

  global.KeyboardSimulate = {
    EVENTS: EVENTS,
    BUTTONS: BTN,
    KEY_MAP: KEY_MAP,
    LONG_PRESS_INTERVAL: LONG_PRESS_INTERVAL,
    SIMULATED_INDEX: SIMULATED_INDEX,
    start: start,
    destroy: destroy,
    isSupported: isSupported
  };

  /* --------------------------- 自动启动（window.onload） --------------------------- */

  function onWindowLoad() {
    if (!moebox) return;
    moebox.appIsPackaged().then((isPakcaged) => {
      if (isPakcaged == false) {
        console.log('[键盘模拟] 此应用尚未打包，执行初始化'); 
        global.KeyboardSimulate.start();
        return;
      }
      console.log('[键盘模拟] 此应用已打包，无需键盘模拟，取消执行初始化'); 
    }); 
  }

  function autoload() {
    if (!isSupported()) {
      return;
    }
    window.addEventListener('load', onWindowLoad)
  }

  // 引入本脚本即自动注册，无需手动调用
  autoload();

})(typeof window !== 'undefined' ? window : this);
