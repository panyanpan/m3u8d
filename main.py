"""
m3u8 下载服务（FastAPI）

接收 Tampermonkey 油猴脚本提交的 m3u8 地址，后台调用 ffmpeg 下载为 mp4。

依赖安装： pip install fastapi uvicorn
启动服务： python main.py
接口文档： http://127.0.0.1:10999/docs

可用环境变量（均有默认值，按需覆盖）：
  M3U8_API_TOKEN       接口令牌，需与油猴脚本一致，默认 my#secret@123456
  M3U8_SAVE_FOLDER     下载目录，默认当前目录下的 download
  M3U8_FFMPEG_PATH     ffmpeg 可执行文件路径，默认 ffmpeg
  M3U8_HOST            监听地址，默认 0.0.0.0
  M3U8_PORT            监听端口，默认 10999
  M3U8_FFMPEG_TIMEOUT  单个下载超时秒数，默认 3600
  M3U8_MAX_CONCURRENT  最大并发下载数，默认 2
"""

import asyncio
import logging
import os
import re
import subprocess
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================ 配置 ============================
API_TOKEN = os.getenv("M3U8_API_TOKEN", "my#secret@123456")
SAVE_FOLDER = Path(
    os.getenv("M3U8_SAVE_FOLDER", str(Path(__file__).resolve().parent / "download"))
)
FFMPEG_PATH = os.getenv("M3U8_FFMPEG_PATH", "ffmpeg")
HOST = os.getenv("M3U8_HOST", "0.0.0.0")
PORT = int(os.getenv("M3U8_PORT", "10999"))
FFMPEG_TIMEOUT = int(os.getenv("M3U8_FFMPEG_TIMEOUT", "3600"))
MAX_CONCURRENT = max(1, int(os.getenv("M3U8_MAX_CONCURRENT", "2")))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("m3u8d")

SAVE_FOLDER.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="M3U8 下载服务", version="1.0.0")

# 油猴脚本通过 GM_xmlhttpRequest 跨域，本身不受浏览器 CORS 限制；
# 这里放开仅为了本地页面/调试工具可直接调用，不使用 credentials。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================ 模型 ============================
class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class DownloadTask(BaseModel):
    m3u8_url: str
    filename: str | None = None


class TaskInfo(BaseModel):
    id: str
    m3u8_url: str
    filename: str
    status: TaskStatus
    created_at: str
    finished_at: str | None = None
    save_path: str | None = None
    error: str | None = None


# 进程内任务表 + 并发信号量
_tasks: dict[str, TaskInfo] = {}
_sem = asyncio.Semaphore(MAX_CONCURRENT)

_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {
    f"COM{i}" for i in range(1, 10)
} | {f"LPT{i}" for i in range(1, 10)}


# ============================ 工具函数 ============================
def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def verify_token(token: str | None) -> None:
    if not token or token != API_TOKEN:
        raise HTTPException(status_code=401, detail="token 无效")


def validate_m3u8_url(url: str) -> str:
    """校验 m3u8 地址，返回规范化后的 URL。"""
    url = (url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="m3u8 链接不能为空")
    if len(url) > 4096:
        raise HTTPException(status_code=400, detail="m3u8 链接过长")
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="m3u8 链接必须以 http:// 或 https:// 开头")
    if ".m3u8" not in url.lower():
        raise HTTPException(status_code=400, detail="链接中未找到 .m3u8 标识")
    return url


def sanitize_filename(name: str | None) -> str:
    """清洗文件名：剔除非法/控制字符，去掉首尾空白与点，限制长度。"""
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name or "").strip().strip(".")
    cleaned = cleaned[:120].strip().strip(".")
    if not cleaned or cleaned.upper() in _WIN_RESERVED:
        cleaned = uuid.uuid4().hex
    return cleaned


def _run_ffmpeg(m3u8_url: str, out_file: Path) -> tuple[bool, str]:
    """在线程中执行 ffmpeg，返回 (是否成功, 错误信息)。"""
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-nostdin",
        "-i",
        m3u8_url,
        "-c",
        "copy",
        str(out_file),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=FFMPEG_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        out_file.unlink(missing_ok=True)
        return False, f"下载超时（{FFMPEG_TIMEOUT} 秒）"
    except FileNotFoundError:
        return False, f"找不到 ffmpeg，请配置 M3U8_FFMPEG_PATH（当前：{FFMPEG_PATH}）"
    except Exception as exc:  # noqa: BLE001 - 统一转成用户可读错误
        out_file.unlink(missing_ok=True)
        return False, f"调用 ffmpeg 异常：{exc}"

    if proc.returncode != 0:
        out_file.unlink(missing_ok=True)
        detail = (proc.stderr or "").strip()[-2000:]
        return False, detail or f"ffmpeg 退出码 {proc.returncode}"
    return True, ""


async def _process_task(task: TaskInfo) -> None:
    """后台处理下载任务，受信号量限流。"""
    async with _sem:
        task.status = TaskStatus.RUNNING
        log.info("任务开始 id=%s url=%s", task.id, task.m3u8_url)
        out_file = SAVE_FOLDER / f"{task.filename}.mp4"

        ok, err = await asyncio.to_thread(_run_ffmpeg, task.m3u8_url, out_file)
        task.finished_at = _now()

        if ok:
            task.status = TaskStatus.SUCCESS
            task.save_path = str(out_file)
            log.info("任务完成 id=%s path=%s", task.id, out_file)
        else:
            task.status = TaskStatus.FAILED
            task.error = err
            log.error("任务失败 id=%s err=%s", task.id, err)


# ============================ 路由 ============================
@app.get("/health")
async def health():
    """健康检查端点。"""
    return {
        "ok": True,
        "status": "healthy",
        "task_count": len(_tasks),
        "save_folder": str(SAVE_FOLDER),
    }


@app.post("/api/download")
async def api_download(task: DownloadTask, token: str | None = Query(default=None)):
    """接收下载任务，立即返回 task_id，实际下载在后台执行。"""
    verify_token(token)

    m3u8_url = validate_m3u8_url(task.m3u8_url)
    filename = sanitize_filename(task.filename)

    info = TaskInfo(
        id=uuid.uuid4().hex,
        m3u8_url=m3u8_url,
        filename=filename,
        status=TaskStatus.QUEUED,
        created_at=_now(),
    )
    _tasks[info.id] = info
    asyncio.create_task(_process_task(info))

    log.info("收到任务 id=%s filename=%s url=%s", info.id, filename, m3u8_url)
    return {
        "ok": True,
        "msg": "下载任务已提交",
        "task_id": info.id,
        "status": info.status.value,
    }


@app.get("/api/task/{task_id}")
async def api_task(task_id: str, token: str | None = Query(default=None)):
    """查询单个任务的状态与结果。"""
    verify_token(token)
    info = _tasks.get(task_id)
    if not info:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"ok": True, **info.model_dump(mode="json")}


@app.get("/api/tasks")
async def api_tasks(token: str | None = Query(default=None)):
    """查询最近的任务列表（用于调试与排查）。"""
    verify_token(token)
    items = sorted(_tasks.values(), key=lambda t: t.created_at, reverse=True)[:50]
    return {
        "ok": True,
        "total": len(_tasks),
        "tasks": [t.model_dump(mode="json") for t in items],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
