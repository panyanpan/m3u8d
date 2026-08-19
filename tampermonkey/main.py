
import os
import subprocess
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# ----------------配置区----------------
API_TOKEN = "my#secret@123456"  # 和油猴脚本保持一致
SAVE_FOLDER = os.path.join(os.getcwd(), "download")
FFMPEG_PATH = "ffmpeg" # windows写绝对路径如 r"C:\ffmpeg\bin\ffmpeg.exe"
# --------------------------------------

# 自动创建下载目录
os.makedirs(SAVE_FOLDER, exist_ok=True)

# 跨域，允许油猴浏览器脚本访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DownloadTask(BaseModel):
    m3u8_url: str
    filename: str | None = None


# token校验依赖
def verify_token(token: str | None):
    if not token or token != API_TOKEN:
        raise HTTPException(status_code=401, detail="token无效")


@app.post("/api/download")
async def api_download(task: DownloadTask, token: str | None = None):
    verify_token(token)

    m3u8_url = task.m3u8_url.strip()
    filename = task.filename

    if not m3u8_url:
        raise HTTPException(status_code=400, detail="m3u8链接不能为空")

    # 默认文件名
    if not filename:
        filename = str(uuid.uuid4())
    # 过滤非法文件名字符
    filename = "".join([c for c in filename if c not in r'\/:*?"<>|'])
    out_file = os.path.join(SAVE_FOLDER, f"{filename}.mp4")

    # ffmpeg命令下载m3u8转mp4
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", m3u8_url,
        "-c", "copy",
        out_file
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if proc.returncode != 0:
            return {
                "ok": False,
                "msg": "ffmpeg执行失败",
                "stderr": proc.stderr
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"调用ffmpeg异常:{str(e)}")

    return {
        "ok": True,
        "msg": "任务完成",
        "save_path": out_file
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10999)

# 安装依赖 pip install fastapi uvicorn python-multipart
# 启动服务 python main.py
    
