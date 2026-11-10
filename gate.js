/* ============================================================
   我们的星海 · 家庭暗号门锁
   ------------------------------------------------------------
   ★ 改暗号方法：用记事本打开本文件，修改下面 PASSCODE 引号里的
     内容，保存后重新上传即可。
   - 勾选「记住这台设备」后，本机下次打开不再询问
   - 未解锁前：照片数据与应用完全不会加载
   ============================================================ */
(function () {
  "use strict";
  var PASSCODE = "950828";              // ←←← 家庭暗号在这里改
  var LS_KEY = "star-ocean-unlocked";

  function unlocked() {
    try { return localStorage.getItem(LS_KEY) === "1"; } catch (e) { return false; }
  }
  function remember(on) {
    try {
      if (on) localStorage.setItem(LS_KEY, "1");
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }
  function loadScript(src, cb) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = function () { if (cb) cb(); };
    s.onerror = function () { gateError("资源加载失败，请检查网络后刷新重试"); };
    document.body.appendChild(s);
  }
  function bootApp() {
    document.body.classList.remove("gate-active"); // 防止 overflow:hidden 残留
    loadScript("data/sample-photos.js?v=20261120", function () {
      loadScript("app.js?v=20261120", function () {
        var g = document.getElementById("gate");
        if (g) {
          g.classList.add("gate-done");
          setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 650);
        }
      });
    });
  }
  window.__starOceanBoot = bootApp;  // 测试钩子

  function gateError(msg) {
    var err = document.getElementById("gateError");
    if (!err) return;
    err.textContent = msg;
    err.classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (unlocked()) { bootApp(); return; }
    var gate = document.getElementById("gate");
    if (!gate) { bootApp(); return; }   // 页面无门锁标记时兜底放行
    gate.classList.remove("hidden");
    document.body.classList.add("gate-active");

    var input = document.getElementById("gateInput");
    var btn = document.getElementById("gateBtn");
    var rememberBox = document.getElementById("gateRemember");

    function tryUnlock() {
      var v = (input.value || "").trim();
      if (v === PASSCODE) {
        remember(rememberBox && rememberBox.checked);
        gate.classList.add("gate-ok");
        setTimeout(function () {
          gate.classList.add("hidden");
          document.body.classList.remove("gate-active");
          bootApp();
        }, 320);
      } else {
        gateError("暗号不对，再想想 💫");
        gate.classList.remove("shake"); void gate.offsetWidth; gate.classList.add("shake");
        try { input.select(); } catch (e) {}
      }
    }
    btn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);
  });
})();