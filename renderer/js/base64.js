/**
 * 浏览器端 URL‑safe Base64 编码（与 Node.js 版本的 base64Encode 等效）
 * @param {string} str - 要编码的 UTF‑8 字符串
 * @returns {string} URL‑safe Base64 编码（无填充）
 */
function base64Encode(str) {
    if (!str) return '';

    // 1. 将字符串转换为 UTF‑8 字节数组
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);

    // 2. 将字节数组转为二进制字符串（btoa 要求每个字符代表一个字节）
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    // 3. 标准 Base64 编码
    let base64 = btoa(binary);

    // 4. 转换为 URL‑safe 格式并移除填充 '='
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * 解码浏览器端的 URL‑safe Base64 字符串（对应 Node.js端 的 base64Encode）
 * @param {string} str - URL‑safe Base64 编码的字符串（无填充）
 * @returns {string} 解码后的 UTF‑8 字符串
 */
function base64Decode(str) {
    if (!str) return '';

    // 1. 将 URL‑safe 字符替换为标准 Base64 字符
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

    // 2. 补齐填充符 '='，使长度成为 4 的倍数
    while (base64.length % 4) {
        base64 += '=';
    }

    // 3. 使用 atob 解码为二进制字符串（每个字符对应一个字节）
    const binaryString = atob(base64);

    // 4. 将二进制字符串转为 Uint8Array，再用 TextDecoder 按 UTF‑8 解码
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
}
