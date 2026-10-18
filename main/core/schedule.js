/**
 * schedule.js - 更新调度纯函数（不依赖 Electron / DB / 网络）
 *
 * 主进程与更新线程共用，保证"是否可更新/何时可更新"的计算逻辑一致。
 */
function pad(n) {
    return String(n).padStart(2, '0');
}

/**
 * 格式化为 yyyy-MM-dd HH:mm:ss
 */
function nowDateTimeStr(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 计算需要请求的日期列表（Date 对象，含当天零点）。
 * 返回 null 表示当前无需更新。
 */
function buildDateList(lastUpdateTime, now, updateHours) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (!lastUpdateTime) {
        return [today];
    }

    const lastUpdate = new Date(lastUpdateTime);
    if (isNaN(lastUpdate.getTime())) {
        return null;
    }

    const hoursSinceLastUpdate = (now - lastUpdate) / (1000 * 60 * 60);
    if (hoursSinceLastUpdate < updateHours) {
        return null;
    }

    const lastUpdateDate = new Date(lastUpdate.getFullYear(), lastUpdate.getMonth(), lastUpdate.getDate());
    const startDate = new Date(lastUpdateDate);
    startDate.setDate(startDate.getDate() + 1);

    const dateList = [];
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        dateList.push(new Date(d));
    }
    if (dateList.length === 0) {
        return null;
    }
    return dateList;
}

/**
 * 判断当前是否可更新，并给出下次可更新时间。
 * @returns {{due: boolean, nextRunAt: number}} due 为 true 表示立即更新；否则 nextRunAt 为下次可更新的时间戳（毫秒）
 */
function computeUpdateSchedule(lastUpdateTime, now, updateHours) {
    if (!lastUpdateTime) {
        return { due: true, nextRunAt: now.getTime() };
    }

    const lastUpdate = new Date(lastUpdateTime);
    if (isNaN(lastUpdate.getTime())) {
        return { due: true, nextRunAt: now.getTime() };
    }

    const nextRunAt = lastUpdate.getTime() + updateHours * 60 * 60 * 1000;
    if (now.getTime() >= nextRunAt) {
        return { due: true, nextRunAt: now.getTime() };
    }
    return { due: false, nextRunAt };
}

module.exports = {
    nowDateTimeStr,
    buildDateList,
    computeUpdateSchedule
};
