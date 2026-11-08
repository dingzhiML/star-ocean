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
  const h = 11;
  sp.scale.set((h * w) / 90, h, 1);
  return sp;
}

/* ---------------- 3D 图谱 ---------------- */
let graph = null;
let dust = null;
const clusterLayer = new THREE.Group();

/* 取景：手机端留白更小、并抬起视角，让星海在竖屏里更饱满 */
function fitView(ms = 800) {
  if (!graph) return;
  graph.zoomToFit(ms, isMobileView() ? 22 : 70);
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
    .linkColor(() => isDay ? "rgba(150,118,72,0.4)" : "rgba(255,240,222,0.5)")
    .linkOpacity(0.16)
    .linkWidth(0)
    .linkDirectionalParticles((l) => (l.__cross ? 1 : 2))
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
    .onNodeClick((node) => { openCard(node.photo); flyToNode(node); })
    .onBackgroundClick(() => closeCard());

  const controls = graph.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  if ("enableDamping" in controls) controls.enableDamping = true;

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
  let resizeFitTimer = null;
  window.addEventListener("resize", () => {
    graph.width(window.innerWidth).height(window.innerHeight);
    const nowMobile = isMobileView();
    if (nowMobile !== wasMobileView) {
      wasMobileView = nowMobile;
      // 横竖屏切换：节点尺寸与取景需要重建，否则尺寸按旧断点渲染
      disposeNodeObjects(graph.graphData().nodes);
      graph.nodeThreeObject((n) => makeNodeObject(n));
      if (state.lastGd) buildClusterLayer(state.lastGd.keys, state.lastGd.centers);
      updateHintCopy();
      setTimeout(() => fitView(700), 120);
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
      o.halo.material.opacity = o.haloBase * tw * o.hoverAmt;
      const s = o.size * (1 + 0.1 * (o.hoverAmt - 1));
      o.photo.scale.set(s, s, 1);
      o.halo.scale.set(s * 2.5, s * 2.5, 1);
    }
  };
  requestAnimationFrame(tick);
}

function makeNodeObject(node) {
  const p = node.photo;
  const color = colorForKey(node.cluster);
  const isDay = THEME.resolved === "day";
  const tex = state.texCache.get(p.src) || haloTexture("#ffc477");
  const size = (8.5 + (hashStr(p.id) % 30) / 10 + (p._user ? 2.5 : 0)) * (isMobileView() ? 1.32 : 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(color), transparent: true, opacity: isDay ? 0.32 : 0.5,
    blending: isDay ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(size * 2.5, size * 2.5, 1);
  const photo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  photo.scale.set(size, size, 1);
  const g = new THREE.Group();
  g.add(halo); g.add(photo);
  node.__obj = { group: g, halo, photo, size, haloBase: isDay ? 0.32 : 0.5, phase: (hashStr(p.id) % 628) / 100, speed: 0.6 + (hashStr(p.id + "s") % 80) / 100, hoverAmt: 1 };
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

/* ---------------- 数据构建 ---------------- */
function buildGraphData() {
  const photos = state.photos;
  for (const p of photos) {
    p.clusterKey = state.mode === "year" ? String(p.year || "未知年份")
      : state.mode === "place" ? (p.place || "未分类")
      : (p.event || "未分类");
  }
  const keys = [...new Set(photos.map((p) => p.clusterKey))];
  keys.sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  const R = 95 + keys.length * 13;
  const centers = {};
  keys.forEach((k, i) => {
    const a = (2 * Math.PI * i) / keys.length - Math.PI / 2;
    centers[k] = { x: Math.cos(a) * R, y: ((hashStr(k) % 90) - 45), z: Math.sin(a) * R };
  });

  // 复用旧节点保持位置，新增节点放到所属星系中心附近
  const nodes = [];
  const seen = new Set();
  for (const p of photos) {
    let node = state.nodeById.get(p.id);
    if (!node) {
      const c = centers[p.clusterKey];
      node = {
        id: p.id,
        x: (c ? c.x : 0) + (Math.random() - 0.5) * 60,
        y: (c ? c.y : 0) + (Math.random() - 0.5) * 40,
        z: (c ? c.z : 0) + (Math.random() - 0.5) * 60,
      };
    }
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
      n.vx += (c.x - n.x) * alpha * 1.1;
      n.vy += (c.y - n.y) * alpha * 0.7;
      n.vz += (c.z - n.z) * alpha * 1.1;
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
    core.scale.set(150, 150, 1);
    core.position.set(c.x, c.y, c.z);
    clusterLayer.add(core);
    const label = labelSprite(k, color);
    label.position.set(c.x, c.y + 52, c.z);
    clusterLayer.add(label);
  }
}

/* ---------------- 重建 ---------------- */
function rebuild(keepCamera = true) {
  disposeNodeObjects(graph.graphData().nodes);
  const gd = buildGraphData();
  state.lastGd = gd;
  graph.graphData({ nodes: gd.nodes, links: gd.links });
  setClusterForce(gd.centers);
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
    el.className = "lg-item";
    el.innerHTML = `<i class="lg-dot" style="background:${colorForKey(k)};color:${colorForKey(k)}"></i><span class="lg-name">${esc(k)}</span><span class="lg-count">${counts[k]}</span>`;
    el.addEventListener("click", () => { closeDrawer(); flyToCenter(gd.centers[k]); });
    list.appendChild(el);
  }
}

function flyToCenter(c) {
  const d = isMobileView() ? 185 : 235;
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
  $("#cardImg").src = p.src;
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
      closeCard();
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
  for (const src of srcs) {
    if (state.texCache.has(src)) { done++; continue; }
    try {
      const img = await loadImage(src);
      state.texCache.set(src, circleTexture(img));
    } catch (e) { console.warn(e); }
    done++;
    onEach(done / srcs.length);
  }
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

  setProgress(100, "欢迎回家 ✨");
  const skipLoader = new URLSearchParams(location.search).has("noloader");
  setTimeout(() => {
    $("#loader").classList.add("done");
    if (!skipLoader) startHint();
  }, skipLoader ? 0 : 500);
}

init();
