const express = require('express');
const session = require('express-session');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

const app = express();
const PORT = 3000;

// =========账号配置，修改密码时 passwordVersion +1，所有用户强制下线==========
const AUTH_CONFIG = {
  username: 'admin',
  password: '11111',
  passwordVersion: 1
};

app.use(session({
  secret: 'm3u8-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 关闭静态默认index，防止访问/直接返回index.html绕过登录
app.use(express.static('public', { index: false }));

// =====================全局鉴权中间件=====================
app.use((req, res, next) => {
  // 白名单：不需要登录
  const whiteList = [
    '/login.html',
    '/api/login'
  ];
  if (whiteList.includes(req.path)) {
    return next();
  }

  // session校验：登录标记、用户名、密码版本三者同时匹配
  if (
    req.session.isLogin &&
    req.session.loginUser === AUTH_CONFIG.username &&
    req.session.pwdVer === AUTH_CONFIG.passwordVersion
  ) {
    return next();
  }

  // 未登录 / session失效，跳转登录页
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
    req.session.isLogin = true;
    req.session.loginUser = username;
    req.session.pwdVer = AUTH_CONFIG.passwordVersion;
    return res.json({ code: 0, msg: '登录成功' });
  }
  res.json({ code: -1, msg: '账号或密码错误' });
});

// 登出接口
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// 下载文件夹自动创建
const downloadDir = path.join(__dirname, 'download');
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

/**
 * 从m3u8链接提取文件名
 * @param {string} m3u8Url
 * @returns {string}
 */
function getFileNameFromUrl(m3u8Url) {
  try {
    const parseUrl = new URL(m3u8Url);
    const pathname = parseUrl.pathname;
    const basename = path.basename(pathname);
    let name = basename.replace(/\.m3u8$/i, '');
    if (!name || ['index', 'index0', 'playlist', 'live'].includes(name.toLowerCase())) {
      return '';
    }
    return name;
  } catch (e) {
    return '';
  }
}

/**
 * 串行执行ffmpeg下载任务
 * @param {string[]} urlList m3u8链接数组
 * @param {string[]} nameList 文件名数组
 */
async function runBatchDownload(urlList, nameList) {
  const results = [];
  for (let i = 0; i < urlList.length; i++) {
    const m3u8Url = urlList[i].trim();
    let rawName = nameList[i]?.trim();
    if (!rawName) {
      rawName = getFileNameFromUrl(m3u8Url);
      if (!rawName) {
        rawName = `video_${Date.now()}_${i}`;
      }
    }
    const saveName = rawName.replace(/[\\/:*?"<>|]/g, '_');
    const outputPath = path.join(downloadDir, `${saveName}.mp4`);

    const cmd = `ffmpeg -y -i "${m3u8Url}" -c copy "${outputPath}"`;

    results.push({
      index: i + 1,
      url: m3u8Url,
      expectName: saveName
    });

    try {
      await new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            reject({ error, stderr });
          } else {
            resolve(stdout);
          }
        });
      });
      results[i].status = 'success';
      results[i].msg = '下载完成';
      results[i].file = `${saveName}.mp4`;
    } catch (e) {
      results[i].status = 'fail';
      results[i].msg = '下载失败';
      results[i].stderr = e.stderr;
    }
  }
  return results;
}

// 批量下载接口
app.post('/api/download', async (req, res) => {
  const { m3u8Url, fileName } = req.body;
  if (!m3u8Url) {
    return res.json({ code: -1, msg: 'm3u8链接不能为空' });
  }

  const urlList = m3u8Url.split(';').map(s => s.trim()).filter(s => !!s);
  const nameList = (fileName || '').split(';').map(s => s.trim());

  if (urlList.length === 0) {
    return res.json({ code: -1, msg: '未解析到有效m3u8链接，请使用英文分号;分隔多个链接' });
  }

  try {
    const taskResults = await runBatchDownload(urlList, nameList);
    res.json({
      code: 0,
      msg: `批量任务执行完毕，共${urlList.length}个任务`,
      data: taskResults
    });
  } catch (err) {
    res.json({
      code: -1,
      msg: '批量任务异常',
      err: String(err)
    });
  }
});

// 根路由，必须鉴权通过才返回页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`服务启动，访问地址：http://127.0.0.1:${PORT}`);
  // console.log(`账号：${AUTH_CONFIG.username} 密码：${AUTH_CONFIG.password}`);
  console.log(`输出目录：${downloadDir}`);
});