const path = require('node:path');

/**
 * 返回开发环境下的项目根目录（main/ 的上一级）。
 * 打包环境下由 main.js 使用 process.resourcesPath 覆盖。
 * @returns {string} 项目根目录路径
 */
function getProjectRoot() {
    return path.resolve(__dirname, '..');
}

module.exports = {
    getProjectRoot
};
