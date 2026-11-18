// 文件名: server.js
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ---------------- 配置区 ----------------
const API_TOKEN = 'my#secret@123456';                       // 和油猴脚本保持一致
const SAVE_FOLDER = path.join(__dirname, 'download');       // 下载目录
const FFMPEG_PATH = 'ffmpeg';                               // Windows 可写绝对路径，如 'C:\\ffmpeg\\bin\\ffmpeg.exe'
const PORT = 10999;
// ---------------------------------------

// 自动创建下载目录
if (!fs.existsSync(SAVE_FOLDER)) {
    fs.mkdirSync(SAVE_FOLDER, { recursive: true });
}

// 中间件
app.use(cors());                    // 允许跨域
app.use(express.json());            // 解析 JSON 请求体

// token 校验函数
function verifyToken(token) {
    if (!token || token !== API_TOKEN) {
        const err = new Error('token无效');
        err.status = 401;
        throw err;
    }
}

// 过滤非法文件名字符
function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '');
}

// POST /api/download
app.post('/api/download', (req, res) => {
    try {
        // 从查询参数中获取 token（与油猴脚本中 GM_xmlhttpRequest 的 url 拼接方式对应）
        const token = req.query.token;
        verifyToken(token);

        const { m3u8_url, filename: rawFilename } = req.body || {};

        if (!m3u8_url || !m3u8_url.trim()) {
            return res.status(400).json({ ok: false, msg: 'm3u8链接不能为空' });
        }

        const m3u8Url = m3u8_url.trim();

        // 默认文件名
        let filename = rawFilename;
        if (!filename) {
            filename = uuidv4();
        }
        filename = sanitizeFilename(filename);
        const outFile = path.join(SAVE_FOLDER, `${filename}.mp4`);

        // ffmpeg 命令下载 m3u8 转 mp4
        const args = [
            '-y',
            '-i', m3u8Url,
            '-c', 'copy',
            outFile
        ];

        execFile(FFMPEG_PATH, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error('[ffmpeg] 执行失败:', stderr || error.message);
                return res.status(500).json({
                    ok: false,
                    msg: 'ffmpeg执行失败',
                    stderr: stderr || error.message
                });
            }

            console.log('[ffmpeg] 任务完成:', outFile);
            return res.json({
                ok: true,
                msg: '任务完成',
                save_path: outFile
            });
        });
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ ok: false, msg: err.message });
    }
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务已启动: http://0.0.0.0:${PORT}`);
    console.log(`下载目录: ${SAVE_FOLDER}`);
});