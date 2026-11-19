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

本方案的全部文件位于仓库的 `m3u8d/` 子目录下（本 README 即在该目录中）：

| 文件                             | 说明                                  |
| ------------------------------ | ----------------------------------- |
| `main.py`                      | **本方案服务端**：FastAPI 接收提交、后台下载、任务状态查询 |
| `tampermonkey/help.monitor.js` | **本方案浏览器脚本**：捕获 m3u8、悬浮按钮、提交与轮询     |
| `download/`                    | 默认下载输出目录（服务首次启动自动创建）                |

> 项目中另有 `app.js`（带登录的 Node  Web 服务）、`tool/main.js`（Node 版单文件下载接口）和 `bak/` 备份文件，它们不属于本方案，仅供历史参考。注意 `app.js` 与 `main.py` 的 `/api/download` 请求格式不同，请勿混用。

---

## 环境要求

|   |   |
| - | - |

- Python 3.10 或更高版本（使用了 `str | None` 类型语法；开发环境为 3.13）
- ffmpeg（已加入 `PATH`，或通过环境变量指定绝对路径）
- 浏览器 + Tampermonkey 扩展

---

## 一、启动服务端

> 本方案的全部文件位于 `m3u8d/` 目录，以下命令默认在该目录下执行。请先 `cd` 到该目录：
>
> - Windows Git Bash：`cd /d/WorkBuddy/py_m3u8/m3u8d`
> - Windows CMD：`cd /d D:\WorkBuddy\py_m3u8\m3u8d`
> - Linux：`cd /path/to/m3u8d`

### 1. 环境准备

**Windows**

- Python 3.10+（本机可用 `py` 启动器，或 WorkBuddy 内置 Python）
- ffmpeg（加入 `PATH`，或通过环境变量指定绝对路径）

**Linux（以 Ubuntu / Debian 为例）**

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv ffmpeg
```

CentOS / RHEL 系：`sudo yum install -y python3 python3-pip ffmpeg`

安装后用 `python3 --version && ffmpeg -version` 确认两者可用。

### 2. 安装依赖

推荐用虚拟环境隔离依赖（**用哪个解释器启动，就用哪个解释器安装**）：

**Linux（推荐 venv）**

```bash
cd /path/to/m3u8d
python3 -m venv .venv
source .venv/bin/activa
```

> 后续每次启动前先 `source .venv/bin/activate`；退出虚拟环境用 `deactivate`。

**Windows**

```bash
# 方式 A：Windows 的 py 启动器
py -m pip install fastapi uvicorn

# 方式 B：WorkBuddy 内置 Python 的完整路径
/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12/python.exe -m pip install fastapi uvicorn
```

### 3. 启动

**Linux**

```bash
# 常规启动（虚拟环境激活后，或未使用虚拟环境）
python3 main.py

# 也可显式用 uvicorn 启动（效果等同于 main.py）
uvicorn main:app --host 0.0.0.0 --port 10999
```

**Windows**（终端里 `python` 命令不存在时，任选其一）

```bash
py main.py                                                          # 方式 A：py 启动器
/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12/python.exe main.py   # 方式 B：完整路径
export PATH="/c/Users/panya/.workbuddy/binaries/python/versions/3.13.12:$PATH"  # 方式 C：临时加 PATH
python main.py
```

默认监听 `0.0.0.0:10999`，接口文档地址：<http://127.0.0.1:10999/docs>

### 4. 验证

```bash
curl http://127.0.0.1:10999/health
# {"ok":true,"status":"healthy",...}
```

### 5. 环境变量配置（均为可选）

| 环境变量                  | 默认值                         | 说明                 |
| --------------------- | --------------------------- | ------------------ |
| `M3U8_API_TOKEN`      | `my#secret@123456`          | 接口令牌，**必须与油猴脚本一致** |
| `M3U8_SAVE_FOLDER`    | `main.py` 同目录下的 `download/` | 下载输出目录             |
| `M3U8_FFMPEG_PATH`    | `ffmpeg`                    | ffmpeg 可执行文件路径     |
| `M3U8_HOST`           | `0.0.0.0`                   | 监听地址               |
| `M3U8_PORT`           | `10999`                     | 监听端口               |
| `M3U8_FFMPEG_TIMEOUT` | `3600`                      | 单个下载超时（秒）          |
| `M3U8_MAX_CONCURRENT` | `2`                         | 最大并发下载数            |

**Linux 示例**

```bash
export M3U8_API_TOKEN="my#secret@123456"
export M3U8_SAVE_FOLDER="/data/videos"
export M3U8_FFMPEG_PATH="/usr/bin/ffmpeg"
python3 main.py
```

**Windows PowerShell 示例**

```powershell
$env:M3U8_API_TOKEN="my#secret@123456"
$env:M3U8_SAVE_FOLDER="D:\videos"
python main.py
```

### 6. Linux 后台运行（可选）

**方式 A：nohup（简单）**

```bash
nohup python3 main.py > app.log 2>&1 &
echo $! > app.pid          # 记录 PID
tail -f app.log            # 查看日志
kill $(cat app.pid)        # 停止服务
```

**方式 B：systemd（推荐生产环境）**

创建 `/etc/systemd/system/m3u8d.service`（路径按实际修改）：

```ini
[Unit]
Description=M3U8 Download Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/m3u8d
ExecStart=/opt/m3u8d/.venv/bin/python main.py
Environment="M3U8_API_TOKEN=my#secret@123456"
Environment="M3U8_SAVE_FOLDER=/data/videos"
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now m3u8d
sudo systemctl status m3u8d
# 查看日志：journalctl -u m3u8d -f
```

**防火墙**（需要从其他机器访问时开放 10999 端口）

```bash
sudo ufw allow 10999/tcp                                              # Ubuntu
sudo firewall-cmd --add-port=10999/tcp --permanent && sudo firewall-cmd --reload   # CentOS
```

> 服务监听 `0.0.0.0`，部署在公网时请务必修改默认 token，并配合防火墙/反向代理限制来源，避免接口被滥用。

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
  apiUrl: 'http://127.0.0.1:10999/api/download',
  taskApiPrefix: 'http://127.0.0.1:10999/api/task/',
  token: 'my#secret@123456',
  pollInterval: 2000,
  pollMax: 30
};
```

- `apiUrl` / `taskApiPrefix`：改为你的服务端地址；本机测试可用 `http://127.0.0.1:10999`。
- `token`：必须与服务端 `M3U8_API_TOKEN` 一致。
- `pollInterval` / `pollMax`：轮询间隔与最大次数，默认最多等待 60 秒。

1. 打开视频网页，等待脚本捕获地址（右上角按钮角标数字会变化）。
2. 点击 `⬇` 按钮，在面板中选择地址、确认文件名，点击"提交下载"。
3. 面板会显示"下载中…"直至成功（显示保存路径）或失败（显示错误原因）。

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
