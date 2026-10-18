const zlib = require('node:zlib');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

/**
 * 同步压缩字符串为 gzip Buffer
 * @param {string} str - 需要压缩的字符串
 * @param {string} encoding - 字符串编码，默认 utf8
 * @returns {Buffer} 压缩结果
 */
function compressStringSync(str, encoding = 'utf8') {
  const input = Buffer.from(str, encoding);
  return zlib.gzipSync(input, { level: 9 });
}

/**
 * 同步解压 gzip Buffer 为字符串
 * @param {Buffer} buffer - gzip 压缩数据
 * @param {string} encoding - 字符串编码，默认 utf8
 * @returns {string} 解压后的字符串
 */
function decompressBufferSync(buffer, encoding = 'utf8') {
  const decompressed = zlib.gunzipSync(buffer);
  return decompressed.toString(encoding);
}

/**
 * 流式解压 gzip 文件到目标文件（适合大文件，内存占用低）
 * @param {string} sourcePath - gzip 压缩文件路径
 * @param {string} destPath - 解压后的目标文件路径
 * @returns {Promise<void>}
 */
async function decompressGzipFile(sourcePath, destPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    zlib.createGunzip(),
    fs.createWriteStream(destPath)
  );
}

module.exports = { compressStringSync, decompressBufferSync, decompressGzipFile };


// const { xzSync, unxzSync } = require('node-liblzma');

// /**
//  * 同步压缩字符串为 xz Buffer
//  * @param {string} str - 需要压缩的字符串
//  * @param {string} encoding - 字符串编码，默认 utf8
//  * @returns {Buffer} 压缩结果
//  */
// function compressStringSync(str, encoding = 'utf8') {
//   const input = Buffer.from(str, encoding);
//   return xzSync(input, { preset: 9, extreme: true });
// }

// /**
//  * 同步解压 xz Buffer 为字符串
//  * @param {Buffer} buffer - xz 压缩数据
//  * @param {string} encoding - 字符串编码，默认 utf8
//  * @returns {string} 解压后的字符串
//  */
// function decompressBufferSync(buffer, encoding = 'utf8') {
//   const decompressed = unxzSync(buffer);
//   return decompressed.toString(encoding);
// }

// module.exports = { compressStringSync, decompressBufferSync };
