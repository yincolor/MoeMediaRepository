# MoeMediaRepository · 萌萌影视仓库

基于 Electron 的 PC 桌面在线影视剧播放器。提供影视库浏览、筛选、详情查看、多站点 / 多剧集切换、HLS 流媒体播放、海报缓存、观看历史与每日增量数据更新。

## 功能特性

- 影视库浏览：分类、年份、地区、标签、字母等条件筛选
- 详情页：海报、简介、演员 / 导演 / 编剧、多播放来源站点与剧集列表切换
- 播放页：使用 [hls.js](https://github.com/video-dev/hls.js) 播放 m3u8 HLS 流媒体（不支持时回退原生 HLS）
- 收藏与观看历史（localStorage 持久化）
- 海报图片按需下载并缓存到本地，缺失海报异步补下并推送渲染进程
- 每日增量更新：独立 worker 线程下载 → 解压 → 解析 → 写库，不阻塞主进程 / 渲染进程
- 游戏手柄 / 键盘模拟导航（TV 风格操作）

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Electron 42 |
| 数据库 | better-sqlite3（WAL 模式） |
| 网络 | axios + axios-retry |
| 流媒体 | hls.js 1.7.3（本地内置） |
| 压缩 | node:zlib（gzip）、node-liblzma（xz） |
| 构建 | electron-builder |

## 目录结构

```
.
├── main/                      # 主进程
│   ├── main.js                #   入口：窗口、IPC、数据库初始化、更新调度
│   ├── config.js              #   共享配置（常量、路径、workerData）
│   ├── core/                  #   主进程与更新线程共用模块
│   │   ├── log.js             #     日志（main_*.log / update_*.log 分文件）
│   │   ├── compress.js        #     gzip 压缩/解压
│   │   ├── lzma.js            #     xz 压缩/解压（测试用）
│   │   ├── req.js             #     axios 网络请求封装
│   │   ├── rootpath.js        #     项目根路径
│   │   └── schedule.js        #     更新调度纯函数
│   ├── db/
│   │   ├── sql.js             #     数据库连接与查询
│   │   └── update.js          #     增量数据清洗与写库
│   ├── poster/
│   │   └── poster.js          #     海报缓存与下载
│   └── worker/
│       └── update-worker.js   #     更新线程（worker_threads）
├── preload/
│   └── preload.js             # contextBridge 暴露 window.moebox API
├── renderer/                  # 渲染进程
│   ├── css/                   #   Theme.css 统一样式
│   ├── js/
│   │   ├── components/        #   icon-btn / poster-card / text-btn 组件
│   │   ├── hls/               #   hls.js 1.7.3
│   │   ├── page/              #   各页面控制器
│   │   ├── gamepad.js         #   手柄事件桥接
│   │   ├── keyboard_simulate.js
│   │   └── utils.js
│   ├── img/                   #   图标资源
│   └── page/                  #   home / catalog / detail / history / play / update
├── tests/                     # 单元测试（node:test）
├── media.db.gz                # 初始数据库压缩包（首次运行解压到用户数据目录）
├── site_cfg.json              # 站点配置（site_name → title 映射）
├── sql_cfg.json               # 数据库表结构定义
├── update_url_prefix          # 更新源 URL 前缀
└── package.json
```

## 快速开始（开发）

```bash
# 安装依赖
npm install

# 启动应用
npm start
```

首次启动会：

1. 在用户数据目录下创建 `db/`、`logs/`、`tmp/` 等目录；
2. 将 `media.db.gz` 解压为初始数据库 `media.db`；
3. 复制 `update_url_prefix` 到用户数据目录；
4. 读取数据库中最新的记录更新时间（`t_info.time` 的 `MAX(time)`）判断是否到期，按需启动更新线程。

### 运行期数据位置（Linux）

| 内容 | 路径 |
| --- | --- |
| 用户数据 | `~/.config/MoeMediaRepository/` |
| 数据库 | `~/.config/MoeMediaRepository/db/media.db` |
| 日志 | `~/.config/MoeMediaRepository/logs/main_*.log`、`update_*.log` |
| 更新前缀 | `~/.config/MoeMediaRepository/update_url_prefix` |
| 海报缓存 | `<系统缓存目录>/MoeMediaRepository/poster/` |

## 配置说明

### `config.js`（`main/config.js`）

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `UPDATE_INTERVAL_MS` | `5 * 60 * 1000` | 更新线程检测 / 重试间隔 |
| `UPDATE_HOURS` | `23` | 距上次更新多久后可再次更新 |
| `UPDATE_REQUEST_TIMEOUT_MS` | `30000` | 更新请求超时 |
| `UPDATE_MAX_RETRIES` | `10` | 更新失败后的最大重试次数（首次不计入，共最多 1 + 10 次） |
| `INITIAL_BACKFILL_DAYS` | `32` | 空库或 `time` 全为空时回填最近多少天 |

### `update_url_prefix`

更新源 URL 前缀。更新线程会拼接为：

```
<prefix>/<年>/<月>/<日>.json.gz
```

例如前缀为 `https://example.com/moemedia` 时，会请求 `https://example.com/moemedia/2026/10/18.json.gz`。

### 更新数据格式

`.json.gz` 解压后为 JSON 对象，结构为「站点名 → 影视记录数组」：

```json
{
  "站点名": [
    {
      "vid": "记录唯一ID",
      "vod_name": "标题",
      "vod_pic": "海报URL",
      "vod_play_url": "集名$m3u8URL#集名$m3u8URL",
      "...": "其他 MacCMS 风格字段"
    }
  ]
}
```

## 数据与更新机制

### 数据库

使用 better-sqlite3 单连接（WAL 模式 + `busy_timeout`），三张表：

- `t_info`：影视基础信息（`vid` 主键，含 `media_type`、`name`、`time` 等）
- `t_poster`：海报 URL（`vid` 关联）
- `t_playlist`：播放链接（`vid + site_name`，`url_list` 为 base64 编码文本）

中文等文本字段入库前经 URL-safe Base64 编码，出库时统一解码。

### 更新调度

- 上次更新时间直接取 `t_info.time` 的 `MAX(time)`（无需状态文件），并补上当前本地时间；等价于 `MAX(time) < 今天` 时判定到期。
- 主进程启动时读取该时间：
  - 已到期 → 立即启动更新线程；
  - 未到期 → 定时到下次可更新时间再启动。
- 空库或 `time` 全为空时，按 `INITIAL_BACKFILL_DAYS` 回填最近 N 天。

### 更新线程（`worker_threads`）

独立于主进程执行「下载 → 解压 → 解析 → 写库」：

- 逐天下载 `.json.gz`，解压后按 `vid` 查重（存在则更新、不存在则新增），单次调用在一个事务内执行，失败自动回滚；
- 今天的文件请求失败则放弃本轮、等待重试；
- 失败每 `UPDATE_INTERVAL_MS` 重试一次，超过 `UPDATE_MAX_RETRIES` 后放弃并退出线程；
- 更新成功后线程退出，下次启动应用时再次检测。

## 渲染进程 API

`preload.js` 通过 `contextBridge` 暴露 `window.moebox`：

| 方法 | 说明 |
| --- | --- |
| `getInfoListByVidList(vids)` | 查询影视信息 |
| `getPosterFilePathListByVids(vids)` | 获取已缓存海报本地路径 |
| `getPlaylistsListByVidList(vids)` | 获取播放链接映射 |
| `getVidsByFilter(filter, page, pageSize)` | 条件筛选影视 ID |
| `getGroupNames()` | 获取影视类型列表 |
| `getSiteCfg()` | 获取站点配置 |
| `getRecentVids()` | 获取最近更新列表 |
| `onUpdatePoster(cb)` | 监听海报下载完成推送 |
| `gotoPage(oldPage, newPage)` | 页面跳转 |
| `backPage()` | 返回上一页 |
| `appIsPackaged()` | 是否已打包 |
| `quit()` | 退出应用 |

## 输入控制

- 手柄：通过 `gamepad.js` 发出 `gp:up` / `gp:down` / `gp:left` / `gp:right` / `gp:confirm` / `gp:back` 及对应长按事件。
- 键盘：`keyboard_simulate.js` 模拟上述手柄事件。
- 播放页支持：确认键播放 / 暂停，左右键快退 / 快进 5 秒，长按连续时移，上下键调节音量，返回键回上一页。

## 测试

```bash
npm run test:unit
# 等价于
node --test tests/*.test.js
```

测试覆盖：日志、lzma、网络请求模块、数据库查询、增量更新写库等。

## 打包

```bash
npm run build:linux
```

使用 electron-builder 打包，产物输出到 `dist/`（如 `dist/moemedia-0.2.0.tar.gz`）。初始数据库 `media.db.gz`、`site_cfg.json`、`sql_cfg.json`、`update_url_prefix` 会作为 `extraResources` 随包分发。

## 许可证

[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.html)
