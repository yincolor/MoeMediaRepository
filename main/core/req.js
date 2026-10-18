/**
 * req.js - 网络请求模块
 * 基于 axios + axios-retry：
 *  - 30 秒超时，指数退避重试
 *  - 随机 UA 池
 *  - 海报等资源请求按域名排队（同域名串行 + 1.5 秒间隔），支持 AbortController 取消
 */
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const log = require('./log.js');

// 预定义的用户代理池，模拟不同浏览器和环境
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
    'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11',
    'Mozilla/5.0 (Windows NT 5.1) AppleWebKit/535.11 (KHTML, like Gecko) Chrome/17.0.963.84 Safari/535.11 SE 2.X MetaSr 1.0',
    'Mozilla/5.0 (Linux; U; Android 2.2.1; zh-cn; HTC_Wildfire_A3333 Build/FRG83D) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1'
];

/**
 * 获取随机 User-Agent
 * @returns {string} 随机选择的 UA 字符串
 */
function getRandomUA() {
    const index = Math.floor(Math.random() * USER_AGENTS.length);
    return USER_AGENTS[index];
}

/**
 * 创建 Axios 实例并配置重试策略
 */
function createAxiosInstance() {
    const instance = axios.create({
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });

    axiosRetry(instance, {
        retries: 10,
        retryDelay: (retryCount) => {
            const baseDelay = 5000;
            const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 500;
            return Math.min(delay, 10000);
        },
        retryCondition: (error) => {
            if (error.code === 'ENOTFOUND') {
                return false;
            }
            return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                (error.response && error.response.status >= 500) ||
                (error.response && error.response.status === 429) ||
                error.code === 'ECONNABORTED' ||
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT';
        },
        shouldResetTimeout: true,
        onRetry: (retryCount, error, requestConfig) => {
            const status = error.response ? error.response.status : 'N/A';
            const code = error.code || 'N/A';
            log.warn('net', `请求失败(状态码: ${status}, 错误码: ${code})，正在进行第 ${retryCount} 次重试... URL: ${requestConfig.url}`);
            if (requestConfig.headers) {
                requestConfig.headers['User-Agent'] = getRandomUA();
            } else {
                requestConfig.headers = { 'User-Agent': getRandomUA() };
            }
        }
    });

    instance.interceptors.request.use((config) => {
        if (!config.headers['User-Agent']) {
            config.headers['User-Agent'] = getRandomUA();
        }
        return config;
    }, (error) => {
        return Promise.reject(error);
    });

    return instance;
}

const httpClient = createAxiosInstance();

/**
 * 记录请求错误详情
 */
function logRequestError(method, url, error) {
    const status = error.response ? error.response.status : 'N/A';
    const responseData = error.response ? error.response.data : null;
    const responseSummary = responseData ?
        (typeof responseData === 'string' ? responseData.substring(0, 200) :
            JSON.stringify(responseData).substring(0, 200)) : 'N/A';
    log.error('net', `${method} 请求失败: ${url}`);
    log.error('net', `  - 状态码: ${status}`);
    log.error('net', `  - 错误信息: ${error.message}`);
    if (responseSummary !== 'N/A') {
        log.error('net', `  - 响应摘要: ${responseSummary}`);
    }
}

const get = (url, params = {}, config = {}) => {
    return httpClient.get(url, { params, ...config })
        .then(response => response)
        .catch(error => {
            logRequestError('GET', url, error);
            throw error;
        });
};

const post = (url, data = {}, config = {}) => {
    return httpClient.post(url, data, config)
        .then(response => response)
        .catch(error => {
            logRequestError('POST', url, error);
            throw error;
        });
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const requestsByDomain = {};   // 域名 => 请求队列 [{url, callback, controller, resolve, reject}]
const processingByDomain = {}; // 域名 => 是否正在处理中

/**
 * 处理指定域名的请求队列
 * @param {string} domain - 域名
 */
async function processDomainQueue(domain) {
    if (processingByDomain[domain]) {
        return;
    }

    processingByDomain[domain] = true;

    const queue = requestsByDomain[domain];
    if (!queue || queue.length === 0) {
        delete requestsByDomain[domain];
        delete processingByDomain[domain];
        return;
    }

    while (queue.length > 0) {
        const { url, callback, controller, resolve, reject } = queue.shift();

        // 检查请求是否已被取消（在排队等待期间）
        if (controller && controller.signal && controller.signal.aborted) {
            log.info('net', `域名 ${domain} 的请求 ${url} 已被取消，跳过执行`);
            if (reject) {
                reject(new Error('Request aborted before sending'));
            }
            continue;
        }

        try {
            log.info('net', `处理域名 ${domain} 的请求: ${url}, 剩余队列长度: ${queue.length}, 等待 1500 毫秒`);
            await delay(1500);
            // 等待结束后再次检查是否已被取消
            if (controller && controller.signal && controller.signal.aborted) {
                log.info('net', `域名 ${domain} 的请求 ${url} 在等待期间被取消，跳过执行`);
                if (reject) {
                    reject(new Error('Request aborted during delay'));
                }
                continue;
            }
            log.info('net', `域名 ${domain} 的请求 ${url} 开始发送`);
            const requestConfig = {
                responseType: 'arraybuffer',
                timeout: 10000
            };
            if (controller && controller.signal) {
                requestConfig.signal = controller.signal;
            }
            let arrayBuffer = (await httpClient.get(url, requestConfig)).data;
            if (arrayBuffer instanceof Buffer) {
                arrayBuffer = arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
            }
            if (callback) {
                callback(arrayBuffer);
            }
            if (resolve) {
                resolve(arrayBuffer);
            }
            log.info('net', `域名 ${domain} 的请求完成，剩余队列长度: ${queue.length}`);
        } catch (error) {
            const isAbortError = (controller && controller.signal && controller.signal.aborted) ||
                error.code === 'ERR_CANCELED' ||
                error.name === 'CanceledError';
            if (isAbortError) {
                log.info('net', `域名 ${domain} 的请求 ${url} 已被取消`);
                if (reject) {
                    reject(error);
                }
            } else {
                log.error('net', `getAxiosArrayBuffer 请求失败: ${error.message}, URL: ${url}`);
                if (callback) {
                    callback(null);
                }
                if (reject) {
                    reject(error);
                }
            }
        }
    }

    delete requestsByDomain[domain];
    delete processingByDomain[domain];
}

/**
 * 封装 Axios 请求，返回 ArrayBuffer 类型的响应数据，
 * 实现按域名排队，每个域名同时只请求一个 URL，避免请求频繁被拒绝
 * @param {string} url - 请求地址
 * @param {AbortController} controller - 取消请求的 AbortController 实例
 * @param {function} callback - 成功回调函数，参数为 ArrayBuffer
 */
function getAxiosArrayBuffer(url, controller, callback) {
    const domain = new URL(url).hostname;

    return new Promise((resolve, reject) => {
        if (!requestsByDomain[domain]) {
            requestsByDomain[domain] = [];
        }

        requestsByDomain[domain].push({ url, callback, controller, resolve, reject });

        processDomainQueue(domain);
    });
}

module.exports = {
    get,
    post,
    getRandomUA,
    getAxiosArrayBuffer,
    instance: httpClient
};
