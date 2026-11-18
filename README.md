# m3u8 下载助手（油猴脚本 + Python 服务端）

通过浏览器油猴脚本自动捕获网页中的 m3u8 地址，点击悬浮小按钮即可把地址和网页标题提交到 Python 服务端，由 ffmpeg 在后台下载为 mp4 文件。

---

## 功能特性

- **浏览器端捕获**：Hook `XMLHttpRequest.open` 与 `fetch`，并叠加 DOM、内联脚本、页面 HTML、`performance` 四重扫描，自动去重。
- **一键提交**：右上角悬浮小按钮（带捕获数量角标），展开面板后可选择地址、编辑文件名（默认取网页标题），提交后自动轮询显示下载结果。
- **服务端异步下载**：ffmpeg 在后台线程执行，不阻塞接口；信号量限流，默认最多 2 个并发任务。
- **任务可追踪**：提交返回 `task_id`，可通过接口查询 `queued / running / success / failed` 状态。
- **安全与健壮**：Token 鉴权、m3u8 地址校验、文件名清洗、ffmpeg 超时与失败清理、结构化日志。
- **配置灵活**：服务端全部走环境变量，脚本配置集中在顶部 `CONFIG` 区。

---

## 工作流程

```
打开视频网页
   │
   ├─ 油猴脚本 Hook 网络请求 / 扫描页面  →  捕获 m3u8（自动去重）
   │
   ▼
点击右上角 ⬇ 按钮  →  选择地址 + 确认文件名（默认网页标题）
   │
   ▼  POST /api/download?token=xxx
Python 服务端  →  创建任务，立即返回 task_id
   │
   ▼  后台 ffmpeg 下载
油猴脚本轮询 GET /api/task/{id}  →  显示"下载中 / 完成 / 失败"
   │
   ▼
文件保存在服务端 download/ 目录
```

---

## 项目结构

| 文件 | 说明 |
| --- | --- |
| `main.py` | **本方案服务端**：FastAPI 接收提交、后台下载、任务状态查询 |
| `tampermonkey/help.monitor.js` | **本方案浏览器脚本**：捕获 m3u8、悬浮按钮、提交与轮询 |
| `download/` | 默认下载输出目录（服务首次启动自动创建） |

> 项目中另有 `app.js`（带登录的 Node  Web 服务）、`tool/main.js`（Node 版单文件下载接口）和 `bak/` 备份文件，它们不属于本方案，仅供历史参考。注意 `app.js` 与 `main.py` 的 `/api/download` 请求格式不同，请勿混用。

---

## 环境要求

- Python 3.10 或更高版本（使用了 `str | None` 类型语法；开发环境为 3.13）
- ffmpeg（已加入 `PATH`，或通过环境变量指定绝对路径）
- 浏览器 + Tampermonkey 扩展

---

## 一、启动服务端

### 1. 安装依赖

用**同一个** Python 解释器安装依赖（用哪个启动就用哪个安装）：

```bash
# 方式 A：Windows 的 py 启动器（推荐）
py -m pip install fastapi uvicorn

# 方式 B：WorkBuddy 内置 Python 的完整路径
/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12/python.exe -m pip install fastapi uvicorn
```

### 2. 启动

如果终端里 `python` 命令不存在（本机的 Git Bash 即如此），任选以下方式：

```bash
# 方式 A：使用 Windows 的 py 启动器（最简单）
py main.py

# 方式 B：使用 WorkBuddy 内置 Python 的完整路径
/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12/python.exe main.py

# 方式 C：临时把内置 Python 加入当前终端的 PATH，之后即可用 python 命令
export PATH="/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12:$PATH"
python main.py
```

> 若已把 Python 加入系统 PATH，直接 `python main.py` 即可。启动前请先切换到项目目录：`cd /d/WorkBuddy/py_m3u8`。

默认监听 `0.0.0.0:10999`，接口文档地址：<http://127.0.0.1:10999/docs>

### 3. 验证

```bash
curl http://127.0.0.1:10999/health
# {"ok":true,"status":"healthy",...}
```

### 4. 环境变量配置（均为可选）

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `M3U8_API_TOKEN` | `my#secret@123456` | 接口令牌，**必须与油猴脚本一致** |
| `M3U8_SAVE_FOLDER` | `./download` | 下载输出目录 |
| `M3U8_FFMPEG_PATH` | `ffmpeg` | ffmpeg 可执行文件路径 |
| `M3U8_HOST` | `0.0.0.0` | 监听地址 |
| `M3U8_PORT` | `10999` | 监听端口 |
| `M3U8_FFMPEG_TIMEOUT` | `3600` | 单个下载超时（秒） |
| `M3U8_MAX_CONCURRENT` | `2` | 最大并发下载数 |

示例（Windows PowerShell 风格）：

```powershell
$env:M3U8_API_TOKEN="your-token"
$env:M3U8_SAVE_FOLDER="D:\videos"
python main.py
```

---

## 二、API 接口

所有接口都需要在查询参数携带 `token`，例如 `?token=my%23secret%40123456`（`#`、`@` 需 URL 编码）。

### `POST /api/download` —— 提交下载任务

请求体：

```json
{
  "m3u8_url": "https://example.com/video/index.m3u8",
  "filename": "视频标题"
}
```

响应：

```json
{
  "ok": true,
  "msg": "下载任务已提交",
  "task_id": "629b983c1ddf445c88f8d8ad7d604fef",
  "status": "queued"
}
```

curl 示例：

```bash
curl -X POST "http://127.0.0.1:10999/api/download?token=my%23secret%40123456" \
  -H "Content-Type: application/json" \
  -d '{"m3u8_url":"https://example.com/index.m3u8","filename":"demo"}'
```

### `GET /api/task/{task_id}` —— 查询任务状态

```json
{
  "ok": true,
  "id": "629b983c...",
  "status": "success",
  "save_path": "D:\\videos\\demo.mp4",
  "error": null
}
```

`status` 取值：`queued`（排队）、`running`（下载中）、`success`（成功）、`failed`（失败）。

### `GET /api/tasks` —— 查看最近 50 个任务

### `GET /health` —— 健康检查（无需 token）

错误响应统一为 `{"detail": "错误说明"}`，鉴权失败返回 HTTP 401，参数错误返回 400。

---

## 三、安装与配置油猴脚本

1. 浏览器安装 Tampermonkey 扩展。
2. 新建脚本，将 `tampermonkey/help.monitor.js` 的全部内容粘贴进去并保存。
3. 修改脚本顶部的 `CONFIG` 区：

```js
const CONFIG = {
  apiUrl: 'http://192.210.201.104:10999/api/download',
  taskApiPrefix: 'http://192.210.201.104:10999/api/task/',
  token: 'my#secret@123456',
  pollInterval: 2000,
  pollMax: 30
};
```

- `apiUrl` / `taskApiPrefix`：改为你的服务端地址；本机测试可用 `http://127.0.0.1:10999`。
- `token`：必须与服务端 `M3U8_API_TOKEN` 一致。
- `pollInterval` / `pollMax`：轮询间隔与最大次数，默认最多等待 60 秒。

4. 打开视频网页，等待脚本捕获地址（右上角按钮角标数字会变化）。
5. 点击 `⬇` 按钮，在面板中选择地址、确认文件名，点击"提交下载"。
6. 面板会显示"下载中…"直至成功（显示保存路径）或失败（显示错误原因）。

---

## 四、常见问题

**Q：提交后返回 401 / token 无效**
检查服务端环境变量 `M3U8_API_TOKEN` 与脚本 `CONFIG.token` 是否完全一致（注意 `#`、`@` 等特殊字符的 URL 编码）。

**Q：按钮角标一直是 0，捕获不到地址**
部分站点的 m3u8 由播放器在点击播放时才动态请求，或地址藏在 `blob:` / 加密逻辑中。建议先触发视频播放，再查看浏览器控制台是否出现 `[m3u8助手] 捕获:` 日志。

**Q：GM_xmlhttpRequest 报跨域/连接失败**
确认脚本头部包含 `@connect *`（或改为 `@connect` 具体域名/IP），并在 Tampermonkey 弹出的跨域授权提示中允许。

**Q：任务状态 failed，提示 ffmpeg 错误**
确认服务端 ffmpeg 可用（`ffmpeg -version`），且该 m3u8 不需要额外的 Cookie / Referer / 鉴权头 —— 当前版本未向 ffmpeg 透传这些请求头。

**Q：服务重启后任务记录不见了**
任务状态保存在进程内内存中，重启即清空；已下载完成的文件不受影响。如需持久化可接入 SQLite。

---

## 注意事项

- 服务端与脚本的 **token 和地址必须匹配**，这是最常见的问题来源。
- 任务表为内存存储，不适合多实例部署；如需多实例请改用数据库或消息队列。
- 并发下载数由 `M3U8_MAX_CONCURRENT` 控制，避免同时拉取过多分片占满带宽。
