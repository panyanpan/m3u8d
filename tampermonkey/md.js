// ==UserScript==
// @name         m3u8-Python-download
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Hook XHR/fetch m3u8，commit python api download
// @author       pany
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // =========配置，与后端保持一致========
    const BACKEND_API = "http://192.210.201.104:10999/api/download";
    const API_TOKEN = "my#secret@123456";
    // =====================================

    let capturedM3u8 = null; // 保存最新抓到的m3u8

    // ---------------------- Hook XMLHttpRequest ----------------------
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        const self = this;
        this.addEventListener('readystatechange', function() {
            if (self.readyState === 4) {
                const url = self._url;
                if (url && url.indexOf('.m3u8') !== -1) {
                    capturedM3u8 = url;
                    console.log('[Hook XHR]捕获m3u8:', capturedM3u8);
                }
            }
        });
        return originalXhrSend.apply(this, arguments);
    };

    // ---------------------- Hook fetch ----------------------
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        return originalFetch.apply(this, arguments).then(res => {
            let url = typeof input === 'string' ? input : input.url;
            if (url && url.indexOf('.m3u8') !== -1) {
                capturedM3u8 = url;
                console.log('[Hook fetch]捕获m3u8:', capturedM3u8);
            }
            return res;
        });
    };

    // DOM中查找m3u8链接（兼容旧逻辑）
    function findM3u8Links() {
        const links = new Set();
        document.querySelectorAll('a,video,source').forEach(el=>{
            let src = el.src || el.href;
            if(src && src.includes('.m3u8')){
                links.add(src);
            }
        });
        return Array.from(links);
    }

    // 获取优先顺序：hook捕获到的 > DOM里第一个
    function getBestM3u8(){
        if(capturedM3u8) return capturedM3u8;
        const domList = findM3u8Links();
        if(domList.length>0) return domList[0];
        return null;
    }

    // 提交任务到python后端
    async function submitDownload(m3u8Url, title) {
        return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({
                method: "POST",
                url: `${BACKEND_API}?token=${encodeURIComponent(API_TOKEN)}`,
                headers: {
                    "Content-Type":"application/json"
                },
                data: JSON.stringify({
                    m3u8_url: m3u8Url,
                    filename: title
                }),
                onload(res){
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data);
                    }catch(e){
                        reject(e);
                    }
                },
                onerror(err){
                    reject(err);
                }
            })
        })
    }

    // 添加页面按钮
    function addBtn(){
        const btn = document.createElement('button');
        btn.innerText = "提交m3u8下载";
        btn.style.position = "fixed";
        btn.style.zIndex = "999999";
        btn.style.top = "10px";
        btn.style.right = "10px";
        btn.style.padding = "6px 12px";
        btn.style.background = "#2385bb";
        btn.style.color="#fff";
        btn.style.border = "none";
        btn.style.borderRadius = "4px";
        document.body.appendChild(btn);

        btn.onclick = async ()=>{
            const targetUrl = getBestM3u8();
            if(!targetUrl){
                alert("未捕获到m3u8链接，请播放视频等待请求触发");
                return;
            }
            const pageTitle = document.title;
            console.log("准备提交m3u8：",targetUrl,"文件名：",pageTitle);
            try{
                const res = await submitDownload(targetUrl, pageTitle);
                if(res.ok){
                    alert("✅提交成功\n保存路径:" + res.save_path);
                }else{
                    alert("❌下载失败："+res.msg +"\n"+ (res.stderr||""));
                }
            }catch(err){
                alert("⚠️请求后端失败，请确认Python服务已启动："+err);
            }
        }
    }

    setTimeout(addBtn, 800);

})();