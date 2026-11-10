/* ============================================================
   我们的星海 · 应用逻辑
   技术栈：three.js + 3d-force-graph（均为 CDN 引入的全局变量）
   ============================================================ */
"use strict";

/* ---------------- 小工具 ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hashStr = (s) => { let a = 0; for (const c of String(s)) a = ((a << 5) - a + c.charCodeAt(0)) | 0; return Math.abs(a); };

/* ---------------- 手机端适配（断点与 styles-mobile.css 保持一致） ---------------- */
const MOBILE_MQ = window.matchMedia("(pointer: coarse) and (max-width: 820px), (pointer: coarse) and (orientation: landscape) and (max-height: 520px)");
const isMobileView = () => MOBILE_MQ.matches;

window.addEventListener("error", (e) => showFatal(e.message));
window.addEventListener("unhandledrejection", (e) => showFatal(String((e.reason && e.reason.message) || e.reason)));
function showFatal(msg) {
  const b = $("#fatal");
  if (!b || !msg) return;
  b.classList.remove("hidden");
  $("#fatalMsg").textContent = msg;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  const h = $("#hint");
  if (h) h.classList.add("hidden"); // 出现轻提示时收起新手提示，二者不叠在一起
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ---------------- 状态 ---------------- */
const PALETTES = {
  night: ["#f8ecd4", "#eed9ae", "#f4e6cc", "#e8d2b4", "#f2e3cf", "#e6cdb0", "#faf1de", "#e2cba6", "#f0e0c4", "#dcc9b0", "#f6ead0", "#e9d6b8"],
  day:   ["#c9a26a", "#b0834f", "#c2a06b", "#a97e50", "#bd9a6f", "#ad8a5e", "#c9ab72", "#a6805a", "#b9926a", "#ab8b62", "#bfa06e", "#a8885f"],
};
const colorForKey = (key) => { const p = PALETTES[THEME.resolved]; return p[hashStr(key) % p.length]; };

/* ---------------- 昼夜主题系统 ---------------- */
const THEME = {
  mode: "auto",      // auto | day | night（用户意图，存 localStorage）
  resolved: "night", // 当前实际生效主题
};

function isDaylightNow() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= 6 && h < 18.5;
}

function resolveTheme() {
  if (THEME.mode === "auto") return isDaylightNow() ? "day" : "night";
  return THEME.mode;
}

function syncThemeButton() {
  $$("#themeSeg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeMode === THEME.mode);
  });
}

function tweenGraphBackground(targetHex, ms = 1000) {
  if (!graph) return;
  const from = new THREE.Color(graph.backgroundColor());
  const to = new THREE.Color(targetHex);
  const t0 = performance.now();
  (function step() {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    graph.backgroundColor("#" + from.clone().lerp(to, e).getHexString());
    if (t < 1) requestAnimationFrame(step);
  })();
}

function applyTheme(resolved, force = false) {
  const prev = THEME.resolved;
  THEME.resolved = resolved;
  if (resolved === "day") document.documentElement.dataset.theme = "day";
  else document.documentElement.removeAttribute("data-theme");
  syncThemeButton();

  // CSS 平滑过渡：临时挂载全局过渡类 1.1 秒
  const root = document.documentElement;
  root.classList.add("theme-anim");
  clearTimeout(applyTheme._t);
  applyTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 1100);

  const changed = resolved !== prev;
  if ((!changed && !force) || !graph) return;

  // 3D 场景联动
  tweenGraphBackground(resolved === "day" ? "#f6efe2" : "#131110");
  graph.linkColor(() => resolved === "day" ? "rgba(150,118,72,0.4)" : "rgba(255,240,222,0.5)");
  graph.linkDirectionalParticleColor(() => resolved === "day" ? "#a8865a" : "#fff4e4");
  if (state.dust) {
    state.dust.material.color.set(resolved === "day" ? 0xc4a878 : 0xfff0de);
    state.dust.material.opacity = resolved === "day" ? 0.4 : 0.45;
  }
  // 重新生成光晕 / 星系标签 / 图例（配色随主题加深或变浅）
  haloCache.forEach((t) => t.dispose());
  haloCache.clear();
  disposeNodeObjects(graph.graphData().nodes);
  graph.nodeThreeObject((n) => makeNodeObject(n));
  if (state.lastGd) {
    buildClusterLayer(state.lastGd.keys, state.lastGd.centers);
    renderLegend(state.lastGd);
  }
}

function switchTheme(mode) {
  THEME.mode = mode;
  try { localStorage.setItem("star-ocean-theme", THEME.mode); } catch (e) {}
  const r = resolveTheme();
  applyTheme(r);
  toast(THEME.mode === "auto"
    ? `已设为跟随时间（当前${r === "day" ? "白天" : "夜晚"}，6:00–18:30 为白天）`
    : THEME.mode === "day" ? "已固定为白天模式 ☀️" : "已固定为夜晚模式 🌙");
}

function initThemeUI() {
  $$("#themeSeg button").forEach((b) => {
    b.addEventListener("click", () => switchTheme(b.dataset.themeMode));
  });
  syncThemeButton();
  // 自动模式：每分钟检查一次是否跨过日出/日落
  setInterval(() => {
    if (THEME.mode !== "auto" || !graph) return;
    const r = resolveTheme();
    if (r !== THEME.resolved) {
      applyTheme(r);
      toast(r === "day" ? "天亮了，星海切换到白天模式 ☀️" : "太阳落山了，星海进入夜晚模式 🌙");
    }
  }, 60000);
}

const state = {
  mode: "year",            // year | place | event
  photos: [],              // 全部照片记录（示例 + 用户添加）
  nodeById: new Map(),     // id -> 持久 node 对象（保持位置）
  texCache: new Map(),     // src -> 圆形纹理
  range: [2019, 2025],
  minYear: 2019, maxYear: 2025,
  hovered: null,
  selected: null,
  sweepId: null,
  pendingFiles: [],
  firstFit: true,
  dust: null,              // 背景星尘对象（主题切换时改色）
  lastGd: null,            // 最近一次图数据（主题切换时重建标签/图例用）
  sphereR: 160,            // 星海球体半径（布局时更新，飞行距离自适应）
  focusCluster: null,      // 当前聚焦的星团（null = 未聚焦）
  _prevRotate: undefined,  // 聚焦前的自动旋转状态
};

// 初始化主题意图（防闪烁脚本已提前把 CSS 主题设好，这里同步 JS 状态）
try { THEME.mode = localStorage.getItem("star-ocean-theme") || "auto"; } catch (e) {}
{
  const qp = new URLSearchParams(location.search).get("theme");
  if (qp === "day" || qp === "night") THEME.mode = qp; // 测试钩子：?theme=day / ?theme=night
}
THEME.resolved = resolveTheme();
if (THEME.resolved === "day") document.documentElement.dataset.theme = "day";
else document.documentElement.removeAttribute("data-theme");

/* ---------------- IndexedDB（用户添加的照片） ---------------- */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    // 加 6 秒超时保护：个别环境下 indexedDB 打开会挂起，超时则降级为"无本地照片"模式
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IndexedDB 打开超时")), 6000);
      const req = indexedDB.open("star-ocean-db", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("photos", { keyPath: "id" });
      req.onsuccess = () => { clearTimeout(timer); this._db = req.result; resolve(this._db); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
    });
  },
  async tx(mode) { const db = await this.open(); return db.transaction("photos", mode).objectStore("photos"); },
  async getAll() { const st = await this.tx("readonly"); return new Promise((res, rej) => { const r = st.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); },
  async put(rec) { const st = await this.tx("readwrite"); return new Promise((res, rej) => { const r = st.put(rec); r.onsuccess = res; r.onerror = () => rej(r.error); }); },
  async del(id) { const st = await this.tx("readwrite"); return new Promise((res, rej) => { const r = st.delete(id); r.onsuccess = res; r.onerror = () => rej(r.error); }); },
  async clear() { const st = await this.tx("readwrite"); return new Promise((res, rej) => { const r = st.clear(); r.onsuccess = res; r.onerror = () => rej(r.error); }); },
};

/* ---------------- 背景音乐 ---------------- */
const TRACKS = [
  { file: "music/a-memory-away.mp3", name: "回忆渐近", orig: "A Memory Away - Tanner Helland" },
  { file: "music/home.mp3", name: "家", orig: "Home - Tanner Helland" },
  { file: "music/remember.mp3", name: "铭记", orig: "Remember - Tanner Helland" },
  { file: "music/deserve-to-be-loved.mp3", name: "值得被爱", orig: "Deserve to be Loved - Tanner Helland" },
  { file: "music/from-here.mp3", name: "从此出发", orig: "From Here - Tanner Helland" },
];
const audio = new Audio();
audio.volume = 0.55;
audio.preload = "metadata";
let trackIdx = 0;
let musicWanted = true;
let pendingAutoplay = false;

function musicPref() {
  try { return localStorage.getItem("star-ocean-autoplay") !== "off"; } catch (e) { return true; }
}
function setMusicPref(on) {
  try { localStorage.setItem("star-ocean-autoplay", on ? "on" : "off"); } catch (e) {}
}

function initMusic() {
  const btnPlay = $("#mPlay");
  const topBtn = $("#btnMusicToggle");
  const autoplayToggle = $("#autoplayToggle");
  const list = $("#trackList");
  const seek = $("#mSeek");
  const timeEl = $("#mTime");
  let seeking = false;

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return "00:00";
    s = Math.round(s);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  const updateSeekUI = () => {
    const d = audio.duration, c = audio.currentTime || 0;
    const hasDur = isFinite(d) && d > 0;
    seek.disabled = !hasDur;
    if (!seeking && hasDur) seek.value = Math.round((c / d) * 1000);
    timeEl.textContent = fmt(c) + " / " + (hasDur ? fmt(d) : "--:--");
  };

  const setPlayingUI = (playing) => {
    btnPlay.textContent = playing ? "⏸" : "▶";
    btnPlay.title = playing ? "暂停" : "播放";
    $("#eq").classList.toggle("on", playing);
    if (topBtn) {
      topBtn.classList.toggle("playing", playing);
      topBtn.title = playing ? "暂停音乐" : "播放音乐";
    }
    const now = $("#musicNow");
    if (now) {
      const cur = audio.src ? "《" + TRACKS[trackIdx].name + "》" : "未播放";
      now.textContent = cur + (playing ? " · 播放中" : "");
    }
  };

  const renderTrackList = () => {
    if (!list) return;
    list.innerHTML = "";
    TRACKS.forEach((t, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "track-item" + (i === trackIdx ? " active" : "");
      b.innerHTML = `<span class="ti-name">${esc(t.name)}</span><span class="ti-orig">${esc(t.orig)}</span>`;
      b.addEventListener("click", () => playIdx(i));
      list.appendChild(b);
    });
  };

  const playIdx = (i) => {
    trackIdx = (i + TRACKS.length) % TRACKS.length;
    const t = TRACKS[trackIdx];
    audio.src = t.file;
    audio.title = t.orig;
    $("#mTitle").textContent = "《" + t.name + "》";
    renderTrackList();
    seeking = false;
    seek.value = 0;
    seek.disabled = true;
    timeEl.textContent = "00:00 / 00:00";
    audio.play().then(() => { pendingAutoplay = false; }).catch(() => { pendingAutoplay = true; });
  };

  const toggle = () => {
    if (!audio.src) return playIdx(trackIdx);
    if (audio.paused) audio.play().catch(() => toast("再点一下就能播放 🎵"));
    else audio.pause();
  };

  btnPlay.addEventListener("click", toggle);
  if (topBtn) topBtn.addEventListener("click", toggle);
  $("#mNext").addEventListener("click", () => playIdx(trackIdx + 1));
  $("#mPrev").addEventListener("click", () => playIdx(trackIdx - 1));
  audio.addEventListener("ended", () => playIdx(trackIdx + 1));
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("timeupdate", updateSeekUI);
  audio.addEventListener("loadedmetadata", updateSeekUI);
  // 拖动进度条：拖动中只预览时间，松手才跳转
  seek.addEventListener("input", () => {
    seeking = true;
    if (isFinite(audio.duration) && audio.duration > 0) {
      timeEl.textContent = fmt((seek.value / 1000) * audio.duration) + " / " + fmt(audio.duration);
    }
  });
  seek.addEventListener("change", () => {
    if (isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (seek.value / 1000) * audio.duration;
    }
    seeking = false;
  });
  $("#mVol").addEventListener("input", (e) => { audio.volume = e.target.value / 100; });

  musicWanted = musicPref();
  autoplayToggle.checked = musicWanted;
  autoplayToggle.addEventListener("change", () => {
    musicWanted = autoplayToggle.checked;
    setMusicPref(musicWanted);
    if (musicWanted && audio.paused) toggle();
  });

  renderTrackList();
  setPlayingUI(false);

  // 浏览器限制自动播放：第一次触摸/按键后再播放（避开音乐控件本身）
  const unlock = (e) => {
    if (e.target && e.target.closest && e.target.closest("#btnMusicToggle, #mPlay, #autoplayToggle")) return;
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
    if (musicWanted && audio.paused) playIdx(trackIdx);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  // 打开页面就尝试播放；若被浏览器拦截，等第一次交互
  setTimeout(() => {
    if (musicWanted && audio.paused) playIdx(trackIdx);
  }, 700);
}

/* ---------------- 图像处理 ---------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败: " + String(src).slice(0, 60)));
    img.src = src;
  });
}

function circleTexture(img) {
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const sw = Math.min(img.width, img.height);
  const sx = (img.width - sw) / 2, sy = (img.height - sw) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,248,238,0.32)";
  ctx.lineWidth = 5;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const haloCache = new Map();
function haloTexture(hexColor) {
  const key = THEME.resolved + ":" + hexColor;
  if (haloCache.has(key)) return haloCache.get(key);
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  const c = hexColor.replace("#", "");
  const rgb = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  g.addColorStop(0, "rgba(255,245,225,0.95)");
  g.addColorStop(0.25, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
  g.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  haloCache.set(key, tex);
  return tex;
}

function labelSprite(text, colorHex) {
  const font = "600 46px 'Microsoft YaHei', 'PingFang SC', sans-serif";
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 60;
  cv.width = w; cv.height = 90;
  const ctx2 = cv.getContext("2d");
  ctx2.font = font;
  ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
  ctx2.shadowColor = colorHex; ctx2.shadowBlur = 22;
  ctx2.fillStyle = THEME.resolved === "day" ? "rgba(88,68,42,0.95)" : "rgba(255,248,238,0.95)";
  ctx2.fillText(text, w / 2, 48);
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 });
  const sp = new THREE.Sprite(mat);
  const h = isMobileView() ? 13.5 : 11;
  sp.scale.set((h * w) / 90, h, 1);
  return sp;
}

/* ---------------- 3D 图谱 ---------------- */
let graph = null;
let dust = null;
const clusterLayer = new THREE.Group();

/* 取景：手机端留白更小、并抬起视角，让星海在竖屏里更饱满；大屏桌面收窄留白让星海更满 */
function fitView(ms = 800) {
  if (!graph) return;
  const pad = isMobileView() ? 22 : (innerWidth >= 1600 ? 44 : 70);
  graph.zoomToFit(ms, pad);
  clearTimeout(fitView._t);
  if (isMobileView()) fitView._t = setTimeout(tiltCameraForMobile, ms + 140);
}

function graphCenterVec() {
  const nodes = (graph && graph.graphData().nodes) || [];
  const c = new THREE.Vector3();
  if (!nodes.length) return c;
  for (const n of nodes) { c.x += n.x; c.y += n.y; c.z += n.z; }
  return c.multiplyScalar(1 / nodes.length);
}

function tiltCameraForMobile() {
  if (!graph || !isMobileView()) return;
  const cam = graph.camera();
  if (!cam) return;
  const center = graphCenterVec();
  const sph = new THREE.Spherical().setFromVector3(cam.position.clone().sub(center));
  if (!isFinite(sph.radius) || sph.radius <= 0) return;
  if (Math.abs(sph.phi - 1.02) < 0.12) return;
  sph.phi = 1.02; /* 约 32° 俯角：横排的星系环变成更有层次的椭圆 */
  const pos = new THREE.Vector3().setFromSpherical(sph).add(center);
  graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: center.x, y: center.y, z: center.z }, 800);
}

function updateHintCopy() {
  const h = $("#hint");
  if (!h) return;
  h.textContent = isMobileView()
    ? "点右上角菜单 · 单指拖动旋转 · 双指缩放 · 轻触照片看故事"
    : "点右上角菜单探索 · 拖拽旋转 · 滚轮缩放 · 点击照片看故事";
}

/* ---------------- 聚焦系统（星团聚焦 / 其他星团变暗） ---------------- */
function linkClusters(l) {
  const s = typeof l.source === "object" ? l.source : state.nodeById.get(l.source);
  const t = typeof l.target === "object" ? l.target : state.nodeById.get(l.target);
  return [s && s.cluster, t && t.cluster];
}
function currentLinkColor(l) {
  const day = THEME.resolved === "day";
  const fc = state.focusCluster;
  if (!fc) return day ? "rgba(150,118,72,0.4)" : "rgba(255,240,222,0.5)";
  const [a, b] = linkClusters(l);
  const inFocus = a === fc || b === fc;
  return inFocus ? (day ? "rgba(150,118,72,0.55)" : "rgba(255,240,222,0.55)")
                 : (day ? "rgba(150,118,72,0.05)" : "rgba(255,240,222,0.05)");
}
function currentLinkParticles(l) {
  if (!state.focusCluster) return 1;
  const [a, b] = linkClusters(l);
  return (a === state.focusCluster || b === state.focusCluster) ? 2 : 0;
}
function applyFocusLinkStyles() {
  if (!graph) return;
  graph.linkColor((l) => currentLinkColor(l));
  graph.linkDirectionalParticles((l) => currentLinkParticles(l));
}
function setFocusCluster(key) {
  state.focusCluster = key || null;
  document.body.classList.toggle("focus-mode", !!state.focusCluster);
  if (graph) {
    const c = graph.controls();
    if (state.focusCluster) {
      state._prevRotate = c.autoRotate;
      c.autoRotate = false;               // 聚焦时暂停自动旋转，画面稳定
    } else if (state._prevRotate !== undefined) {
      const wantRotate = $("#btnRotate") ? $("#btnRotate").classList.contains("active") : true;
      c.autoRotate = wantRotate;
      state._prevRotate = undefined;
    }
    applyFocusLinkStyles();
    if (state.lastGd) buildClusterLayer(state.lastGd.keys, state.lastGd.centers);
  }
  if (state.lastGd) renderLegend(state.lastGd);
}
function clearFocus(refit = true) {
  if (!state.focusCluster) return;
  setFocusCluster(null);
  if (refit && graph) fitView(900);
}
/* 飞向星团：按星团半径精确计算镜头距离，让星团恰好充满画面；
   桌面端把星团放到屏幕右侧，给左侧信息卡留出空间 */
function flyToCluster(c) {
  const cam = graph.camera();
  const fov = cam.fov || 40;
  const tanH = Math.tan((fov / 2) * Math.PI / 180);
  const aspect = innerWidth / Math.max(1, innerHeight);
  const vertDist = (c.r * 1.06) / tanH;
  const horizDist = (c.r * 1.06) / (tanH * Math.max(0.5, aspect));
  const dist = Math.max(120, vertDist, isMobileView() ? horizDist : vertDist);
  const dir = cam.position.clone().sub(new THREE.Vector3(c.x, c.y, c.z));
  if (dir.lengthSq() < 1) dir.set(0.5, 0.4, 0.75);
  dir.normalize();
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  let target = new THREE.Vector3(c.x, c.y, c.z);
  if (!isMobileView()) {
    // 视线目标左移 → 星团呈现在屏幕右侧，左侧留给信息卡
    const widthWorld = 2 * dist * tanH * aspect;
    target = target.add(right.multiplyScalar(-0.22 * widthWorld));
  }
  const pos = target.clone().add(dir.multiplyScalar(dist));
  graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: target.x, y: target.y, z: target.z }, 1100);
}
/* 容差点选：点击位置附近 tol 像素内最近的可见星辰 */
function pickNearestNode(px, py) {
  const tol = isMobileView() ? 26 : 18;
  // 手机端：多指手势（捏合缩放）结束后 400ms 内的"点击"是手势残留，忽略
  if (isMobileView() && Date.now() - (state._lastGestureEnd || 0) < 400) return null;
  let best = null, bestD = tol * tol;
  for (const n of graph.graphData().nodes) {
    if (!n.__visible) continue;
    const sc = graph.graph2ScreenCoords(n.x, n.y, n.z);
    const dx = sc.x - px, dy = sc.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = n; }
  }
  return best;
}

/* ---------------- 全屏搜索（手机 / 电脑共用） ---------------- */
function setSearchMode(on) {
  const page = $("#searchPage");
  const input = $("#searchInput");
  if (!page) return;
  page.classList.toggle("hidden", !on);
  page.setAttribute("aria-hidden", on ? "false" : "true");
  document.body.classList.toggle("search-open", on);
  if (on) {
    closeDrawer();
    setTimeout(() => {
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }, 60);
  } else if (input) {
    input.blur();
  }
}

/* ---------------- 菜单抽屉 ---------------- */
function openDrawer() {
  const d = $("#drawer"), s = $("#drawerScrim");
  if (!d) return;
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  if (s) s.classList.add("show");
  document.body.classList.add("drawer-open");
}
function closeDrawer() {
  const d = $("#drawer"), s = $("#drawerScrim");
  if (!d) return;
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  if (s) s.classList.remove("show");
  document.body.classList.remove("drawer-open");
}
function initDrawer() {
  $("#btnMenu").addEventListener("click", openDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
}

/* 底栏实际高度写入 CSS 变量：提示/toast 永远贴在底栏上方，不会压住控件 */
function syncDockHeight() {
  const dock = document.querySelector(".hud-bottom");
  if (!dock) return;
  document.documentElement.style.setProperty("--dock-h", Math.round(dock.getBoundingClientRect().height) + "px");
}

function initGraph() {
  const isDay = THEME.resolved === "day";
  graph = new ForceGraph3D($("#scene"), { controlType: "orbit" })
    .backgroundColor(isDay ? "#f6efe2" : "#131110")
    .showNavInfo(false)
    .nodeVisibility((n) => n.__visible)
    .linkVisibility((l) => l.__visible)
    .linkColor((l) => currentLinkColor(l))
    .linkOpacity(0.1)
    .linkWidth(0)
    .linkDirectionalParticles((l) => currentLinkParticles(l))
    .linkDirectionalParticleSpeed(0.004)
    .linkDirectionalParticleWidth(1.5)
    .linkDirectionalParticleColor(() => isDay ? "#a8865a" : "#fff4e4")
    .nodeLabel((n) => {
      const p = n.photo;
      return `<b>${esc(p.title)}</b><span>${esc(p.date)} · ${esc(p.place)} · ${esc(p.event)}</span>`;
    })
    .nodeThreeObject((n) => makeNodeObject(n))
    .onNodeHover((node) => {
      state.hovered = node;
      document.body.style.cursor = node ? "pointer" : "default";
    })
    .onNodeClick((node) => {
      // 手机端：捏合缩放结束后的"点击"是手势残留，忽略
      if (isMobileView() && Date.now() - (state._lastGestureEnd || 0) < 400) return;
      openCard(node.photo); flyToNode(node);
    })
    .onBackgroundClick((ev) => {
      // 容差点选：点到星辰附近也能选中，不必精确点中
      const pick = ev && typeof ev.clientX === "number" ? pickNearestNode(ev.clientX, ev.clientY) : null;
      if (pick) { openCard(pick.photo); flyToNode(pick); }
      else closeCard();
    });

  const controls = graph.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  if ("enableDamping" in controls) controls.enableDamping = true;
  // 手机端：禁用节点拖拽，保证单指拖动永远是旋转/平移视角；
  // 否则聚焦后星星铺满屏幕，拖动全被识别成"拖星星"，视角无法操作
  if (isMobileView()) graph.enableNodeDrag(false);

  // 手机端：记录多指手势结束时刻（配合点击守卫，防止捏合后误开卡片）
  const sceneEl = $("#scene");
  if (sceneEl) {
    sceneEl.addEventListener("touchstart", (e) => { if (e.touches.length >= 2) state._pinching = true; }, { passive: true });
    sceneEl.addEventListener("touchend", (e) => {
      if (state._pinching && e.touches.length === 0) { state._lastGestureEnd = Date.now(); state._pinching = false; }
    }, { passive: true });
  }

  graph.onEngineStop(() => {
    if (state.firstFit) { state.firstFit = false; fitView(900); }
  });

  // 背景星尘
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 280 + Math.random() * 640;
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 420 * 0.6;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: isDay ? 0xc4a878 : 0xfff0de,
    size: 2.4, transparent: true, opacity: isDay ? 0.4 : 0.45,
    sizeAttenuation: true, depthWrite: false,
  });
  dust = new THREE.Points(geo, mat);
  state.dust = dust;
  graph.scene().add(dust);
  graph.scene().add(clusterLayer);

  let wasMobileView = isMobileView();
  let wasBigScreen = innerWidth >= 1600;
  let resizeFitTimer = null;
  window.addEventListener("resize", () => {
    graph.width(window.innerWidth).height(window.innerHeight);
    const nowMobile = isMobileView();
    const nowBig = innerWidth >= 1600;
    if (nowMobile !== wasMobileView || nowBig !== wasBigScreen) {
      wasMobileView = nowMobile;
      wasBigScreen = nowBig;
      // 横竖屏切换 / 大屏档位切换：节点尺寸与取景需要重建，否则尺寸按旧断点渲染
      disposeNodeObjects(graph.graphData().nodes);
      graph.nodeThreeObject((n) => makeNodeObject(n));
      if (state.lastGd) buildClusterLayer(state.lastGd.keys, state.lastGd.centers);
      updateHintCopy();
      if (nowMobile) setTimeout(() => fitView(700), 120);
      else setTimeout(() => fitView(600), 120);
    }
    // 手机端屏幕尺寸/方向变化后重新取景，避免星海缩在一角或跑出画面
    if (isMobileView()) {
      clearTimeout(resizeFitTimer);
      resizeFitTimer = setTimeout(() => fitView(650), 260);
    } else {
      // 从手机宽度拉回桌面宽度时，退出全屏搜索
      setSearchMode(false, true);
    }
    syncDockHeight();
  });

  // 呼吸 / 悬停动画
  const tick = (t) => {
    requestAnimationFrame(tick);
    const time = t / 1000;
    if (dust) dust.rotation.y += 0.00035;
    const nodes = graph ? graph.graphData().nodes : [];
    for (const node of nodes) {
      const o = node.__obj;
      if (!o) continue;
      const focus = state.hovered === node || state.selected === node ? 1.4 : 1;
      o.hoverAmt += (focus - o.hoverAmt) * 0.12;
      const tw = 0.72 + 0.28 * Math.sin(time * o.speed + o.phase);
      // 聚焦模式：非聚焦星团整体变暗淡（平滑过渡）
      const dimT = !state.focusCluster || node.cluster === state.focusCluster ? 1 : 0.14;
      if (o.dimAmt === undefined) o.dimAmt = 1;
      o.dimAmt += (dimT - o.dimAmt) * 0.08;
      o.photo.material.opacity = o.dimAmt;
      o.halo.material.opacity = o.haloBase * tw * o.hoverAmt * (0.3 + 0.7 * o.dimAmt);
      const s = o.size * (1 + 0.1 * (o.hoverAmt - 1));
      o.photo.scale.set(s, s, 1);
      o.halo.scale.set(s * o.haloScale, s * o.haloScale, 1);
    }
  };
  requestAnimationFrame(tick);
}

function makeNodeObject(node) {
  const p = node.photo;
  const color = colorForKey(node.cluster);
  const isDay = THEME.resolved === "day";
  const isMob = isMobileView();
  const tex = state.texCache.get(p.src) || haloTexture("#ffc477");
  const bigScreen = !isMob && innerWidth >= 1600;
  // 照片多时保持星辰小巧（太大会显得乱），点击有容差机制兜底
  const manyN = state.photos.length >= 120 ? 1.05 : 1;
  const size = (8.5 + (hashStr(p.id) % 30) / 10 + (p._user ? 2.5 : 0)) * (isMob ? 1.32 : (bigScreen ? 1.12 : 1)) * manyN;
  const haloScale = isMob ? 1.85 : 2.0;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(color), transparent: true, opacity: isDay ? 0.24 : (isMob ? 0.3 : 0.34),
    blending: isDay ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(size * haloScale, size * haloScale, 1);
  const photo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  photo.scale.set(size, size, 1);
  const g = new THREE.Group();
  g.add(halo); g.add(photo);
  node.__obj = { group: g, halo, photo, size, haloScale, haloBase: isDay ? 0.24 : (isMob ? 0.3 : 0.34), phase: (hashStr(p.id) % 628) / 100, speed: 0.6 + (hashStr(p.id + "s") % 80) / 100, hoverAmt: 1 };
  return g;
}

function disposeNodeObjects(nodes) {
  for (const n of nodes) {
    if (!n.__obj) continue;
    n.__obj.halo.material.dispose();
    n.__obj.photo.material.dispose();
    n.__obj = null;
  }
}

/* ---------------- 数据构建：球体星海布局 ----------------
   所有照片汇聚成一个实心球体：半径随照片总数按体积增长（照片越多球越大）；
   星团在球内按斐波那契球面分布、互相交融，照片数多的星团体积更大。 */
function buildGraphData() {
  const photos = state.photos;
  for (const p of photos) {
    p.clusterKey = state.mode === "year" ? String(p.year || "未知年份")
      : state.mode === "place" ? (p.place || "未分类")
      : (p.event || "未分类");
  }
  const keys = [...new Set(photos.map((p) => p.clusterKey))];
  keys.sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

  const N = Math.max(1, photos.length);
  const R0 = 30 * Math.cbrt(N);      // 星海球体半径：随照片数增长（N=225 → 约182）
  state.sphereR = R0;
  const K = keys.length;
  const countOf = {};
  for (const p of photos) countOf[p.clusterKey] = (countOf[p.clusterKey] || 0) + 1;

  const centers = {};
  keys.forEach((k, i) => {
    const m = countOf[k] || 1;
    // 星团球半径：按该星团照片占比切分球体体积，星团之间轻微交融
    const r_c = Math.max(26, R0 * Math.cbrt(m / N) * 0.62 + 12);
    let cx = 0, cy = 0, cz = 0;
    if (K > 1) {
      // 斐波那契球面：星团中心均匀铺在球内
      const phi = Math.acos(1 - (2 * (i + 0.5)) / K);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const Rc = R0 * 0.5;
      cx = Math.cos(theta) * Math.sin(phi) * Rc;
      cy = Math.cos(phi) * Rc * 0.78;   // 稍压扁，更有星系盘的层次感
      cz = Math.sin(theta) * Math.sin(phi) * Rc;
    }
    centers[k] = { x: cx, y: cy, z: cz, r: r_c };
  });

  // 复用旧节点保持位置（力导向会把它们拉到新家），新增节点直接放进所属星团球内
  const nodes = [];
  const seen = new Set();
  for (const p of photos) {
    let node = state.nodeById.get(p.id);
    const c = centers[p.clusterKey];
    // 每个节点的"家"：星团球内的固定随机点（重构时更新，力导向把星星拉回家）
    const rr = c.r * Math.cbrt(Math.random());
    const ang = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const home = {
      x: rr * Math.sin(ph) * Math.cos(ang),
      y: rr * Math.sin(ph) * Math.sin(ang) * 0.85,
      z: rr * Math.cos(ph),
    };
    if (!node) {
      node = {
        id: p.id,
        x: c.x + home.x,
        y: c.y + home.y,
        z: c.z + home.z,
      };
    }
    node.__home = home;
    node.photo = p;
    node.cluster = p.clusterKey;
    if (!node.__visible) node.__visible = true;
    state.nodeById.set(p.id, node);
    seen.add(p.id);
    nodes.push(node);
  }
  for (const [id] of state.nodeById) {
    if (!seen.has(id)) state.nodeById.delete(id);
  }

  // 连线：同星系按时间串联 + 跨星系少量"神经"连接
  const links = [];
  const linkSet = new Set();
  const addLink = (a, b, cross) => {
    const key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
    if (linkSet.has(key) || a.id === b.id) return;
    linkSet.add(key);
    links.push({ source: a.id, target: b.id, __cross: cross, __visible: true });
  };
  const byCluster = {};
  for (const n of nodes) (byCluster[n.cluster] ||= []).push(n);
  for (const arr of Object.values(byCluster)) {
    arr.sort((a, b) => a.photo.date.localeCompare(b.photo.date));
    for (let i = 0; i < arr.length - 1; i++) addLink(arr[i], arr[i + 1], false);
    for (let i = 0; i + 2 < arr.length; i += 2) if (hashStr(arr[i].id + arr[i + 2].id) % 10 < 7) addLink(arr[i], arr[i + 2], false);
  }
  const crossCount = Math.max(4, Math.floor(nodes.length * 0.3));
  for (let i = 0; i < crossCount; i++) {
    const a = nodes[Math.floor(Math.random() * nodes.length)];
    const b = nodes[Math.floor(Math.random() * nodes.length)];
    if (a && b && a.cluster !== b.cluster) addLink(a, b, true);
  }
  return { nodes, links, keys, centers };
}

function setClusterForce(centers) {
  graph.d3Force("cluster", (alpha) => {
    for (const n of graph.graphData().nodes) {
      const c = centers[n.cluster];
      if (!c) continue;
      // 拉向星团球内的"家"：整个星团聚成一个球，所有星团融成一颗大球
      const h = n.__home || { x: 0, y: 0, z: 0 };
      n.vx += (c.x + h.x - n.x) * alpha * 1.2;
      n.vy += (c.y + h.y - n.y) * alpha * 0.9;
      n.vz += (c.z + h.z - n.z) * alpha * 1.2;
    }
  });
}

function buildClusterLayer(keys, centers) {
  for (const child of [...clusterLayer.children]) {
    clusterLayer.remove(child);
    if (child.material) {
      if (child.material.map && child.material.map.dispose && !haloCache.has(child.material.map)) child.material.map.dispose?.();
      child.material.dispose();
    }
  }
  for (const k of keys) {
    const c = centers[k];
    const color = colorForKey(k);
    const isDay = THEME.resolved === "day";
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(color), transparent: true, opacity: isDay ? 0.2 : 0.14,
      blending: isDay ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false,
    }));
    const coreS = Math.max(150, (c.r || 60) * 1.7);
    core.scale.set(coreS, coreS, 1);
    core.position.set(c.x, c.y, c.z);
    clusterLayer.add(core);
    const label = labelSprite(k, color);
    label.position.set(c.x, c.y + Math.max(38, (c.r || 60) * 0.92), c.z);
    clusterLayer.add(label);
  }
}

/* ---------------- 重建 ---------------- */
function rebuild(keepCamera = true) {
  // 切换分组/增删照片时退出聚焦
  if (state.focusCluster) {
    state.focusCluster = null;
    document.body.classList.remove("focus-mode");
    try { graph.controls().autoRotate = $("#btnRotate").classList.contains("active"); } catch (e) {}
  }
  disposeNodeObjects(graph.graphData().nodes);
  const gd = buildGraphData();
  state.lastGd = gd;
  graph.graphData({ nodes: gd.nodes, links: gd.links });
  setClusterForce(gd.centers);
  applyFocusLinkStyles();
  buildClusterLayer(gd.keys, gd.centers);
  renderLegend(gd);
  initStateRange();
  applyTimeFilter();
  graph.d3ReheatSimulation();
  setTimeout(() => fitView(800), keepCamera ? 500 : 120);
}

/* ---------------- 图例 ---------------- */
function renderLegend(gd) {
  $("#legendTitle").textContent = "星系 · " + { year: "按年份", place: "按地点", event: "按事件" }[state.mode];
  const counts = {};
  for (const p of state.photos) counts[p.clusterKey] = (counts[p.clusterKey] || 0) + 1;
  const list = $("#legendList");
  list.innerHTML = "";
  for (const k of gd.keys) {
    const el = document.createElement("div");
    el.className = "lg-item" + (state.focusCluster === k ? " active" : "");
    el.innerHTML = `<i class="lg-dot" style="background:${colorForKey(k)};color:${colorForKey(k)}"></i><span class="lg-name">${esc(k)}</span><span class="lg-count">${counts[k]}</span>`;
    el.addEventListener("click", () => {
      closeDrawer();
      if (state.focusCluster === k) {
        clearFocus();
        toast("已退出聚焦");
        return;
      }
      setFocusCluster(k);
      flyToCluster(gd.centers[k]);
      toast(`已聚焦「${k}」 · 其他星团已变暗 · 再点一次图例可退出`);
    });
    list.appendChild(el);
  }
}

function flyToCenter(c) {
  // 星团中心距离随球体半径自适应（球越大飞得越远）
  const d = Math.max(120, (state.sphereR || 160)) * (isMobileView() ? 1.05 : 1.25);
  graph.cameraPosition({ x: c.x + d * 0.62, y: c.y + d * 0.38, z: c.z + d * 0.68 }, { x: c.x, y: c.y, z: c.z }, 1100);
}

function flyToNode(node) {
  const d = isMobileView() ? 92 : 130;
  graph.cameraPosition(
    { x: node.x + d * 0.55, y: node.y + d * 0.35, z: node.z + d * 0.75 },
    { x: node.x, y: node.y, z: node.z }, 900
  );
}

/* ---------------- 时间线 ---------------- */
function initStateRange() {
  const years = state.photos.map((p) => p.year || new Date().getFullYear());
  state.minYear = Math.min(...years);
  state.maxYear = Math.max(...years);
  state.range = [state.minYear, state.maxYear];
  const f = $("#tlFrom"), t = $("#tlTo");
  f.min = t.min = state.minYear;
  f.max = t.max = state.maxYear;
  f.value = state.minYear;
  t.value = state.maxYear;
  // 刻度
  const ticks = $("#tlTicks");
  ticks.innerHTML = "";
  const span = state.maxYear - state.minYear;
  const step = span > 14 ? 5 : span > 8 ? 2 : 1;
  for (let y = state.minYear; y <= state.maxYear; y += step) {
    const el = document.createElement("span");
    el.className = "tl-tick";
    el.style.left = ((y - state.minYear) / Math.max(1, span)) * 100 + "%";
    el.textContent = y;
    ticks.appendChild(el);
  }
}

function applyTimeFilter() {
  let [from, to] = state.range;
  if (from > to) [from, to] = [to, from];
  for (const node of graph.graphData().nodes) {
    node.__visible = node.photo.year >= from && node.photo.year <= to;
  }
  for (const l of graph.graphData().links) {
    const s = typeof l.source === "object" ? l.source : state.nodeById.get(l.source);
    const t = typeof l.target === "object" ? l.target : state.nodeById.get(l.target);
    l.__visible = !!(s && t && s.__visible && t.__visible);
  }
  graph.nodeVisibility((n) => n.__visible);
  graph.linkVisibility((l) => l.__visible);
  // 滑块与填充
  const f = $("#tlFrom"), t = $("#tlTo");
  f.value = from; t.value = to;
  $("#tlFromLabel").textContent = from + "年";
  $("#tlToLabel").textContent = to + "年";
  const span = Math.max(1, state.maxYear - state.minYear);
  const fill = $("#tlFill");
  fill.style.left = ((from - state.minYear) / span) * 100 + "%";
  fill.style.width = Math.max(2, ((to - from) / span) * 100) + "%";
  if (state.selected && !state.selected.__visible) closeCard();
}

function initTimelineUI() {
  const f = $("#tlFrom"), t = $("#tlTo");
  f.addEventListener("input", () => {
    stopSweep();
    let v = +f.value;
    if (v > +t.value) v = +t.value;
    state.range = [v, +t.value];
    applyTimeFilter();
  });
  t.addEventListener("input", () => {
    stopSweep();
    let v = +t.value;
    if (v < +f.value) v = +f.value;
    state.range = [+f.value, v];
    applyTimeFilter();
  });
  $("#tlReset").addEventListener("click", () => { stopSweep(); state.range = [state.minYear, state.maxYear]; applyTimeFilter(); });
  $("#btnSweep").addEventListener("click", () => {
    if (state.sweepId) { stopSweep(); return; }
    const btn = $("#btnSweep");
    btn.textContent = "⏸"; btn.classList.add("playing");
    let y = state.minYear;
    state.range = [state.minYear, y];
    applyTimeFilter();
    state.sweepId = setInterval(() => {
      y += 1;
      if (y > state.maxYear) { stopSweep(); return; }
      state.range = [state.minYear, y];
      applyTimeFilter();
    }, 650);
  });
}

function stopSweep() {
  if (state.sweepId) { clearInterval(state.sweepId); state.sweepId = null; }
  const btn = $("#btnSweep");
  btn.textContent = "▶"; btn.classList.remove("playing");
}

/* ---------------- 搜索 ---------------- */
let searchTimer = null;
function initSearch() {
  const input = $("#searchInput");
  const results = $("#searchResults");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderResults(input.value.trim()), 150);
  });
  $("#btnSearchOpen").addEventListener("click", () => setSearchMode(true));
  $("#searchCancel").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = "";
    results.innerHTML = "";
    results.classList.add("hidden");
    $("#searchClear").classList.add("hidden");
    setSearchMode(false);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = results.querySelector(".sr-item"); if (first) first.dispatchEvent(new Event("mousedown")); } });
  $("#searchClear").addEventListener("click", () => { input.value = ""; results.classList.add("hidden"); $("#searchClear").classList.add("hidden"); input.focus(); });
}

function renderResults(q) {
  const results = $("#searchResults");
  $("#searchClear").classList.toggle("hidden", !q);
  if (!q) { results.classList.add("hidden"); return; }
  const ql = q.toLowerCase();
  const hits = state.photos.filter((p) =>
    [p.title, p.place, p.event, p.note, p.date].some((f) => String(f || "").toLowerCase().includes(ql))
  ).slice(0, 8);
  results.innerHTML = "";
  if (!hits.length) {
    results.innerHTML = `<div class="sr-item" style="cursor:default"><span class="s">没有找到「${esc(q)}」相关的照片</span></div>`;
    results.classList.remove("hidden");
    return;
  }
  for (const p of hits) {
    const el = document.createElement("div");
    el.className = "sr-item";
    el.innerHTML = `<img src="${p.src}" alt=""><div><div class="t">${esc(p.title)}</div><div class="s">${esc(p.date)} · ${esc(p.place)} · ${esc(p.event)}</div></div>`;
    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      locatePhoto(p);
      results.classList.add("hidden");
      setSearchMode(false);
    });
    results.appendChild(el);
  }
  results.classList.remove("hidden");
}

function locatePhoto(p) {
  const node = state.nodeById.get(p.id);
  if (!node) return;
  if (node.photo.year < state.range[0] || node.photo.year > state.range[1]) {
    state.range = [Math.min(state.range[0], node.photo.year), Math.max(state.range[1], node.photo.year)];
    applyTimeFilter();
  }
  openCard(p);
  flyToNode(node);
}

/* ---------------- 照片详情卡 ---------------- */
function openCard(p) {
  if (isMobileView()) setSearchMode(false); // 手机上详情是全屏页，先收起搜索页
  closeDrawer();
  const node = state.nodeById.get(p.id);
  state.selected = node || null;
  // 详情页用高清图（full），星辰节点用的是缩略图（src）
  const img = $("#cardImg");
  img.src = p.full || p.src;
  img.style.opacity = "0";
  img.onload = () => { img.style.opacity = "1"; };
  $("#cardTitle").textContent = p.title;
  $("#cardDate").textContent = p.date;
  $("#cardPlace").textContent = p.place || "—";
  $("#cardEvent").textContent = p.event || "—";
  $("#cardNote").textContent = p.note || "";
  $("#cardDelete").classList.toggle("hidden", !p._user);
  $("#card").classList.remove("hidden");
}

function closeCard() {
  state.selected = null;
  $("#card").classList.add("hidden");
}

/* ---------------- 添加照片 ---------------- */
function initAddPanel() {
  const modal = $("#addModal");
  const drop = $("#dropZone");
  const fileInput = $("#fileInput");

  $("#btnAdd").addEventListener("click", () => { closeDrawer(); modal.classList.remove("hidden"); renderMyPhotos(); });
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    addFiles(Array.from(e.dataTransfer.files || []));
  });
  fileInput.addEventListener("change", () => { addFiles(Array.from(fileInput.files || [])); fileInput.value = ""; });

  $("#fDate").valueAsDate = new Date();

  $("#savePhotos").addEventListener("click", savePending);

  $("#clearMine").addEventListener("click", async () => {
    if (!confirm("确定要清空所有手动添加的照片吗？（不会影响正式相册）")) return;
    try { await idb.clear(); } catch (e) {}
    state.photos = state.photos.filter((p) => !p._user);
    rebuild();
    renderMyPhotos();
    toast("已清空手动添加的照片");
  });

  // 弹窗关闭
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.close).classList.add("hidden")));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      $$(".modal").forEach((m) => m.classList.add("hidden"));
      $("#lightbox").classList.add("hidden");
      closeCard();
      clearFocus();
      setSearchMode(false);
      $("#searchResults").classList.add("hidden");
    }
  });
}

function addFiles(files) {
  const imgs = files.filter((f) => /^image\//.test(f.type));
  if (!imgs.length) { toast("请选择图片文件哦"); return; }
  state.pendingFiles.push(...imgs);
  renderThumbs();
}

function renderThumbs() {
  const grid = $("#thumbGrid");
  grid.innerHTML = "";
  grid.classList.toggle("hidden", !state.pendingFiles.length);
  $("#savePhotos").disabled = !state.pendingFiles.length;
  for (const f of state.pendingFiles) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    grid.appendChild(img);
  }
}

async function downscale(file, maxSide = 1280) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("读取失败"));
    r.readAsDataURL(file);
  });
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.85);
}

async function savePending() {
  if (!state.pendingFiles.length) return;
  const date = $("#fDate").value || new Date().toISOString().slice(0, 10);
  const place = $("#fPlace").value.trim();
  const event = $("#fEvent").value.trim();
  const note = $("#fNote").value.trim();
  const titleBase = $("#fTitle").value.trim();
  const files = state.pendingFiles;
  $("#savePhotos").disabled = true;
  $("#savePhotos").textContent = "✨ 正在加入…";
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const small = await downscale(files[i]);
      // 提前生成圆形纹理，保证新照片立刻以真实图像出现在星海中
      try { state.texCache.set(small, circleTexture(await loadImage(small))); } catch (e) {}
      const title = titleBase
        ? (files.length > 1 ? `${titleBase} ${i + 1}` : titleBase)
        : `${event || place || "我们的回忆"} · ${date.slice(0, 7)}`;
      const rec = {
        id: "u" + Date.now() + "_" + i,
        title, date, year: +date.slice(0, 4),
        place, event, note,
        src: small, _user: true,
      };
      try { await idb.put(rec); } catch (e) { toast("注意：当前浏览器不支持本地保存，刷新后照片会消失", 4000); }
      state.photos.push(rec);
      ok++;
    } catch (e) { console.warn(e); }
  }
  state.pendingFiles = [];
  renderThumbs();
  $("#savePhotos").textContent = "✨ 加入星海";
  $("#savePhotos").disabled = true;
  ["#fTitle", "#fNote"].forEach((s) => ($(s).value = ""));
  rebuild();
  renderMyPhotos();
  toast(`已把 ${ok} 张照片加入星海 ✨`);
  setTimeout(() => $("#addModal").classList.add("hidden"), 600);
}

function renderMyPhotos() {
  const mine = state.photos.filter((p) => p._user);
  $("#myPhotos").classList.toggle("hidden", !mine.length && !state.pendingFiles.length);
  $("#myCount").textContent = mine.length ? `(${mine.length})` : "";
  const list = $("#myList");
  list.innerHTML = "";
  for (const p of mine) {
    const item = document.createElement("div");
    item.className = "my-item";
    item.title = p.title;
    const img = document.createElement("img");
    img.src = p.src;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.addEventListener("click", async () => {
      try { await idb.del(p.id); } catch (e) {}
      state.photos = state.photos.filter((x) => x.id !== p.id);
      closeCard();
      rebuild();
      renderMyPhotos();
      toast("已移除：" + p.title);
    });
    item.append(img, btn);
    list.appendChild(item);
  }
}

/* ---------------- 其他 UI ---------------- */
function initOtherUI() {
  // 分组切换
  $$("#modeSeg button").forEach((b) => b.addEventListener("click", () => {
    $$("#modeSeg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.mode = b.dataset.mode;
    rebuild();
  }));
  // 自动旋转
  const rotateBtn = $("#btnRotate");
  if (rotateBtn) {
    rotateBtn.textContent = "自动旋转：开";
    rotateBtn.addEventListener("click", () => {
      const on = !graph.controls().autoRotate;
      graph.controls().autoRotate = on;
      rotateBtn.classList.toggle("active", on);
      rotateBtn.textContent = "自动旋转：" + (on ? "开" : "关");
    });
  }
  // 重新取景
  const fitBtn = $("#btnFit");
  if (fitBtn) fitBtn.addEventListener("click", () => { closeDrawer(); fitView(800); });
  // 卡片
  $("#cardClose").addEventListener("click", closeCard);
  $("#cardFly").addEventListener("click", () => {
    const node = state.selected;
    if (!node) return;
    // 手机详情是全屏页：先回到星海，再飞向该星球
    if (isMobileView()) closeCard();
    flyToNode(node);
  });
  // 点击详情卡大图 → 灯箱放大
  const cardImg = $("#cardImg");
  cardImg.style.cursor = "zoom-in";
  cardImg.addEventListener("click", () => {
    const p = state.selected && state.selected.photo;
    if (!p) return;
    $("#lightboxImg").src = p.full || p.src;
    $("#lightbox").classList.remove("hidden");
  });
  $("#lightbox").addEventListener("click", () => $("#lightbox").classList.add("hidden"));
  $("#cardDelete").addEventListener("click", async () => {
    const node = state.selected;
    if (!node) return;
    const p = node.photo;
    if (!confirm(`删除「${p.title}」？`)) return;
    try { await idb.del(p.id); } catch (e) {}
    state.photos = state.photos.filter((x) => x.id !== p.id);
    closeCard();
    rebuild();
    renderMyPhotos();
  });
}

function startHint() {
  const h = $("#hint");
  updateHintCopy();
  h.classList.remove("hidden");
  setTimeout(() => h.classList.add("hidden"), 9000);
}

/* ---------------- 启动 ---------------- */
function setProgress(pct, text) {
  $("#loaderFill").style.width = pct + "%";
  if (text) $("#loaderText").textContent = text;
}

async function preloadTextures(photos, onEach) {
  const srcs = [...new Set(photos.map((p) => p.src))];
  let done = 0;
  const CONCURRENCY = 6; // 并发加载，225 张缩略图也能秒级完成
  const queue = srcs.slice();
  const worker = async () => {
    while (queue.length) {
      const src = queue.shift();
      if (!state.texCache.has(src)) {
        try {
          const img = await loadImage(src);
          state.texCache.set(src, circleTexture(img));
        } catch (e) { console.warn("纹理加载失败:", src); }
      }
      done++;
      onEach(done / srcs.length);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function init() {
  initMusic();
  initDrawer();
  initAddPanel();
  initOtherUI();

  // 底栏高度实时写入 --dock-h：提示/toast 永远贴在底栏上方
  syncDockHeight();
  if (typeof ResizeObserver !== "undefined") {
    const dock = document.querySelector(".hud-bottom");
    if (dock) new ResizeObserver(() => syncDockHeight()).observe(dock);
  }

  setProgress(6, "正在打开记忆宝盒…");
  let userPhotos = [];
  try { userPhotos = await idb.getAll(); }
  catch (e) { console.warn("IndexedDB 不可用：", e); }

  state.photos = [
    ...(window.SAMPLE_PHOTOS || []).map((p) => ({ ...p, _user: false })),
    ...userPhotos.map((p) => ({ ...p, _user: true })),
  ];

  setProgress(14, "正在点亮照片…");
  await preloadTextures(state.photos, (r) => setProgress(14 + r * 74));

  setProgress(92, "正在编织星座连线…");
  initGraph();
  initTimelineUI();
  initSearch();
  initThemeUI();
  rebuild(false);

  // 测试钩子：?ui=drawer / search / card / add（无头浏览器截图验证用，正常访问不受影响）
  const uiParams = new URLSearchParams(location.search);
  const uiHook = uiParams.get("ui");
  if (uiHook === "drawer") {
    if (uiParams.has("expand")) $$(".drawer-acc").forEach((d) => { d.open = true; });
    openDrawer();
  }
  else if (uiHook === "search") setSearchMode(true);
  else if (uiHook === "card") { const p = state.photos[0]; if (p) openCard(p); }
  else if (uiHook === "add") { $("#addModal").classList.remove("hidden"); renderMyPhotos(); }
  else if (uiHook === "focus") {
    // 聚焦模式测试：?ui=focus&cluster=2023
    const k = uiParams.get("cluster") || (state.lastGd && state.lastGd.keys[0]);
    if (k) {
      setFocusCluster(k);
      const p = state.photos.find((x) => x.clusterKey === k);
      if (p) { openCard(p); const node = state.nodeById.get(p.id); if (node) flyToNode(node); }
    }
  }
  else if (uiHook === "lightbox") {
    const p = state.photos[0];
    if (p) { openCard(p); $("#lightboxImg").src = p.full || p.src; $("#lightbox").classList.remove("hidden"); }
  }
  else if (uiHook === "geo") {
    const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
    const hud = document.querySelector(".hud-bottom");
    const cs = hud ? getComputedStyle(hud) : null;
    const info = JSON.stringify({
      w: innerWidth, h: innerHeight,
      pc: matchMedia("(pointer: coarse)").matches,
      mq: isMobileView(),
      pad: cs ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft] : null,
      hud: g(".hud-bottom"), tl: g("#timeline"), body: g(".tl-body"),
      scrollW: document.documentElement.scrollWidth,
    });
    document.title = "GEO " + info;
    const f = $("#fatal");
    if (f) { f.classList.remove("hidden"); f.style.fontSize = "11px"; $("#fatalMsg").textContent = info; }
  }

  setProgress(100, "欢迎回家 ✨");
  const skipLoader = new URLSearchParams(location.search).has("noloader");
  setTimeout(() => {
    $("#loader").classList.add("done");
    if (!skipLoader) startHint();
  }, skipLoader ? 0 : 500);
}

init();
