/**
 * lzma.js - XZ（LZMA）压缩/解压工具模块
 * 基于 node-liblzma 实现，用于与外部 xz 压缩格式交互。
 */
const { xzSync, unxzSync } = require('node-liblzma');

/**
 * 同步压缩字符串为 xz Buffer
 * @param {string} str - 需要压缩的字符串
 * @param {string} encoding - 字符串编码，默认 utf8
 * @returns {Buffer} 压缩结果
 */
function compressStringSync(str, encoding = 'utf8') {
  const input = Buffer.from(str, encoding);
  return xzSync(input, { preset: 9, extreme: true });
}

/**
 * 同步解压 xz Buffer 为字符串
 * @param {Buffer} buffer - xz 压缩数据
 * @param {string} encoding - 字符串编码，默认 utf8
 * @returns {string} 解压后的字符串
 */
function decompressBufferSync(buffer, encoding = 'utf8') {
  const decompressed = unxzSync(buffer);
  return decompressed.toString(encoding);
}

module.exports = { compressStringSync, decompressBufferSync };
