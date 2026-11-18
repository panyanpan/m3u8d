// ==UserScript==
// @name         m3u8 下载助手（提交到 Python 服务）
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  捕获页面 m3u8 地址，点击悬浮小按钮提交给 Python 服务下载为 mp4
// @author       pany
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ==================== 配置区（按需修改） ====================
  const CONFIG = {
    // Python 服务的下载接口地址（token 会自动作为查询参数拼接）
    apiUrl: 'http://192.210.201.104:10999/api/download',
    // 任务状态查询接口前缀，最终请求形如 {taskApiPrefix}{task_id}?token=xxx
    taskApiPrefix: 'http://192.210.201.104:10999/api/task/',
    // 与 Python 服务保持一致的令牌
    token: 'my#secret@123456',
    // 提交后轮询任务状态的间隔（毫秒）与最大次数，2s * 30 = 60s
    pollInterval: 2000,
    pollMax: 30
  };
  // 提示：若服务部署在本机，把上面两个地址中的 IP 改为 127.0.0.1 即可。
  // 若希望收紧跨域授权，可把头部 @connect * 改为 @connect 具体域名/IP。
  // ==========================================================

  // 捕获到的 m3u8 地址（Set 自动去重，保持发现顺序）
  const found = new Set();

  const isM3U8 = (s) =>
    typeof s === 'string' &&
    /^https?:\/\/[^\s"'<>()]+?\.m3u8(?:[?#][^\s"'<>()]*)?$/i.test(s.trim());

  /** 加入候选集合（相对地址按当前页面补全） */
  function addM3U8(raw) {
    if (typeof raw !== 'string' || raw.length < 8) return;
    let url;
    try {
      url = new URL(raw, location.href).href;
    } catch (e) {
      return;
    }
    if (!isM3U8(url) || found.has(url)) return;
    found.add(url);
    console.log('[m3u8助手] 捕获:', url);
    updatePanel();
  }

  // ---------------------- Hook XMLHttpRequest ----------------------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (url) addM3U8(String(url));
    } catch (e) { /* 忽略 hook 异常，不影响页面 */ }
    return origOpen.apply(this, arguments);
  };

  // ---------------------- Hook fetch ----------------------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      try {
        let url = '';
        if (typeof input === 'string') url = input;
        else if (input instanceof URL) url = input.href;
        else if (input && input.url) url = input.url;
        if (url) addM3U8(url);
      } catch (e) { /* 忽略 */ }
      return origFetch.apply(this, arguments);
    };
  }

  // ---------------------- 扫描页面 ----------------------
  function scanPage() {
    // 1) 常见媒体/链接标签
    document.querySelectorAll('a, video, source').forEach((el) => {
      addM3U8(el.src || el.href || el.getAttribute('src') || el.getAttribute('href'));
    });
    // 2) 内联脚本里硬编码的地址
    document.querySelectorAll('script:not([src])').forEach((s) => {
      const m = (s.textContent || '').match(
        /https?:\/\/[^\s"'<>()]+?\.m3u8(?:[?#][^\s"'<>()]*)?/gi
      );
      if (m) m.forEach(addM3U8);
    });
    // 3) 页面 HTML 兜底（JSON 数据、隐藏配置等）
    try {
      const m = (document.documentElement.outerHTML || '').match(
        /https?:\/\/[^\s"'<>()]+?\.m3u8(?:[?#][^\s"'<>()]*)?/gi
      );
      if (m) m.forEach(addM3U8);
    } catch (e) { /* 忽略 */ }
    // 4) 已发生的网络请求（含动态加载）
    try {
      performance.getEntriesByType('resource').forEach((e) => addM3U8(e.name));
    } catch (e) { /* 忽略 */ }
  }

  scanPage();
  // DOM 变化时防抖重扫
  let scanTimer = null;
  try {
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanPage, 500);
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  } catch (e) { /* 忽略 */ }

  // ---------------------- GM_xmlhttpRequest Promise 封装 ----------------------
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        timeout: options.timeout || 15000,
        onload: (res) => resolve(res),
        onerror: (err) => reject(err),
        ontimeout: () => reject(new Error('请求超时'))
      });
    });
  }

  // ---------------------- UI ----------------------
  let panel, listEl, nameInput, submitBtn, statusEl, badge;

  function setStatus(text, color) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = color || '#666';
  }

  function updatePanel() {
    if (badge) badge.textContent = String(found.size);
    if (!panel) return;
    const countEl = panel.querySelector('#m3u8-helper-count');
    if (countEl) countEl.textContent = `（共 ${found.size} 个）`;
    if (!listEl) return;

    const previous = listEl.value;
    listEl.innerHTML = '';
    found.forEach((url) => {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = url.length > 68 ? url.slice(0, 68) + '…' : url;
      opt.title = url;
      listEl.appendChild(opt);
    });
    if (previous && found.has(previous)) listEl.value = previous;
  }

  function buildUI() {
    // 小圆按钮
    const btn = document.createElement('div');
    btn.id = 'm3u8-helper-btn';
    btn.textContent = '⬇';
    btn.title = '提交捕获到的 m3u8 到下载服务';
    Object.assign(btn.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      width: '34px', height: '34px', textAlign: 'center', lineHeight: '34px',
      background: '#2385bb', color: '#fff', borderRadius: '50%',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)', cursor: 'pointer',
      font: 'bold 18px/34px sans-serif', userSelect: 'none'
    });

    badge = document.createElement('span');
    Object.assign(badge.style, {
      position: 'absolute', top: '-5px', right: '-5px', minWidth: '16px',
      height: '16px', padding: '0 3px', background: '#e74c3c', color: '#fff',
      borderRadius: '8px', fontSize: '10px', lineHeight: '16px', textAlign: 'center'
    });
    badge.textContent = '0';
    btn.appendChild(badge);
    document.body.appendChild(btn);

    // 轻量面板
    panel = document.createElement('div');
    panel.id = 'm3u8-helper-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '54px', right: '12px', zIndex: '2147483647',
      width: '380px', maxWidth: 'calc(100vw - 24px)', display: 'none',
      background: '#fff', color: '#222', border: '1px solid #ddd',
      borderRadius: '8px', boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      font: '13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden'
    });
    panel.innerHTML = `
      <div style="padding:8px 12px;background:#f5f5f5;border-bottom:1px solid #eee;font-weight:bold">
        🎬 m3u8 下载助手 <span id="m3u8-helper-count" style="color:#888;font-weight:normal"></span>
      </div>
      <div style="padding:10px 12px">
        <label style="display:block;margin-bottom:4px;color:#666">选择地址：</label>
        <select id="m3u8-helper-list" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px"></select>
        <label style="display:block;margin:10px 0 4px;color:#666">文件名（默认网页标题）：</label>
        <input id="m3u8-helper-name" type="text" style="width:100%;box-sizing:border-box;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px" />
        <div id="m3u8-helper-status" style="margin:8px 0;min-height:18px;color:#666;font-size:12px;word-break:break-all"></div>
        <button id="m3u8-helper-submit" style="width:100%;padding:8px;background:#2385bb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">提交下载</button>
      </div>`;
    document.body.appendChild(panel);

    listEl = panel.querySelector('#m3u8-helper-list');
    nameInput = panel.querySelector('#m3u8-helper-name');
    submitBtn = panel.querySelector('#m3u8-helper-submit');
    statusEl = panel.querySelector('#m3u8-helper-status');
    nameInput.value = (document.title || '').replace(/[\\/:*?"<>|]/g, '_').trim();

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') updatePanel();
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { panel.style.display = 'none'; });
    submitBtn.addEventListener('click', onSubmit);
  }

  // ---------------------- 提交与轮询 ----------------------
  async function onSubmit() {
    const url = listEl && listEl.value;
    if (!url) {
      setStatus('尚未捕获到 m3u8 地址，请稍候或先触发视频播放。', '#c0392b');
      return;
    }
    const filename = (nameInput.value || document.title || '').trim();
    submitBtn.disabled = true;
    setStatus('正在提交…');

    try {
      const res = await gmRequest({
        method: 'POST',
        url: CONFIG.apiUrl + '?token=' + encodeURIComponent(CONFIG.token),
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ m3u8_url: url, filename: filename }),
        responseType: 'text'
      });

      let data;
      try {
        data = JSON.parse(res.responseText);
      } catch (e) {
        throw new Error('服务返回格式异常：' + String(res.responseText || '').slice(0, 120));
      }
      if (res.status < 200 || res.status >= 300 || !data.ok) {
        throw new Error(data.detail || data.msg || ('HTTP ' + res.status));
      }

      setStatus('任务已提交（' + data.task_id.slice(0, 8) + '），等待下载结果…', '#2980b9');
      await pollTask(data.task_id);
    } catch (err) {
      setStatus('提交失败：' + (err && err.message ? err.message : String(err)), '#c0392b');
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function pollTask(taskId) {
    const query = '?token=' + encodeURIComponent(CONFIG.token);
    for (let i = 0; i < CONFIG.pollMax; i++) {
      await new Promise((r) => setTimeout(r, CONFIG.pollInterval));
      try {
        const res = await gmRequest({
          method: 'GET',
          url: CONFIG.taskApiPrefix + encodeURIComponent(taskId) + query,
          responseType: 'text'
        });
        const data = JSON.parse(res.responseText);
        if (data.status === 'success') {
          setStatus('✅ 下载完成：' + data.save_path, '#27ae60');
          return;
        }
        if (data.status === 'failed') {
          setStatus('❌ 下载失败：' + (data.error || '未知错误'), '#c0392b');
          return;
        }
        setStatus('下载中…（' + data.status + '）', '#2980b9');
      } catch (e) {
        // 单次查询失败不中断轮询
      }
    }
    setStatus('任务已在后台下载，请稍后到服务端 download 目录查看。', '#f39c12');
  }

  // ---------------------- 启动 ----------------------
  function init() {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }
    buildUI();
    updatePanel();
    console.log('[m3u8助手] 已启动，正在监测页面…');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
