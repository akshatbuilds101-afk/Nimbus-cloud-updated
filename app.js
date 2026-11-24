/* ============================================================
   NimbusVault v3.0 — app.js
   Supabase (Auth + Storage + PostgreSQL) · Cloudinary

   SQL TABLES NEEDED:
   
   CREATE TABLE file_metadata (
     id         BIGSERIAL PRIMARY KEY,
     user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     name       TEXT NOT NULL,
     size       BIGINT DEFAULT 0,
     type       TEXT DEFAULT '',
     folder     TEXT DEFAULT '',
     path       TEXT NOT NULL,
     deleted    BOOLEAN DEFAULT FALSE,
     deleted_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE TABLE videos (
     id         BIGSERIAL PRIMARY KEY,
     user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     name       TEXT DEFAULT '',
     url        TEXT NOT NULL,
     size       BIGINT DEFAULT 0,
     deleted    BOOLEAN DEFAULT FALSE,
     deleted_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
   ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
   ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

   ALTER TABLE images ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
   ALTER TABLE images ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
   ALTER TABLE images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
   ALTER TABLE images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

   Enable RLS + policies for user_id = auth.uid() on all tables.
============================================================ */

const { createClient } = supabase;
const supabaseClient = createClient(
  "https://gqtjgokipmeyduxruwiq.supabase.co",
  "sb_publishable_GZZdzy_xUIVjpjnjwa_ilg_r4IDGSRF"
);

// ─── STATE ──────────────────────────────────────────────────
let currentFolder = "";
let allFiles = [];
let allNotes = [];
let currentView = localStorage.getItem('nv-view') || 'list';
let currentShareUrl = '';

// ─── THEME ──────────────────────────────────────────────────
function applyStoredTheme() {
  const theme = localStorage.getItem('nv-theme') || 'default';
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
applyStoredTheme();

// ─── NAVIGATION ─────────────────────────────────────────────
function go(page) { window.location.href = page; }

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const mainWrap = document.querySelector('.main-wrap');
  if (!sidebar) return;
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
    mainWrap?.classList.toggle('sidebar-collapsed');
  }
}

// ─── TOAST ──────────────────────────────────────────────────
function toast(msg, type = "info") {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── MODAL ──────────────────────────────────────────────────
function openModal(msg, onConfirm, modalId = 'confirmModal') {
  const overlay = document.getElementById(modalId);
  if (!overlay) { onConfirm(); return; }
  const msgEl = document.getElementById("confirmMsg");
  if (msg && msgEl) msgEl.textContent = msg;
  overlay.classList.add("open");
  const okBtn = document.getElementById("confirmOkBtn");
  if (okBtn) okBtn.onclick = () => { closeModal(modalId); onConfirm(); };
}
function closeModal(modalId = 'confirmModal') {
  const overlay = document.getElementById(modalId);
  if (overlay) overlay.classList.remove("open");
}

// ─── PROGRESS ───────────────────────────────────────────────
function showProgress(pct, label = "Uploading…") {
  const wrap = document.getElementById("progressWrap");
  const fill = document.getElementById("progressFill");
  const text = document.getElementById("progressText");
  if (!wrap) return;
  wrap.classList.add("show");
  if (fill) fill.style.width = pct + "%";
  if (text) text.textContent = label;
}
function hideProgress() {
  const wrap = document.getElementById("progressWrap");
  if (wrap) {
    const fill = document.getElementById("progressFill");
    if (fill) fill.style.width = "100%";
    setTimeout(() => { wrap.classList.remove("show"); if (fill) fill.style.width = "0%"; }, 400);
  }
}

// ─── HELPERS ────────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return bytes.toFixed(1) + " " + units[i];
}
function formatDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function formatDateRelative(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
  return formatDate(isoStr);
}
function getFileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    pdf:"📄",doc:"📝",docx:"📝",xls:"📊",xlsx:"📊",ppt:"📊",pptx:"📊",
    zip:"🗜️",rar:"🗜️",tar:"🗜️",gz:"🗜️",
    mp4:"🎬",mov:"🎬",avi:"🎬",mkv:"🎬",webm:"🎬",
    mp3:"🎵",wav:"🎵",flac:"🎵",aac:"🎵",
    jpg:"🖼️",jpeg:"🖼️",png:"🖼️",gif:"🖼️",svg:"🖼️",webp:"🖼️",
    js:"💻",ts:"💻",py:"🐍",html:"🌐",css:"🎨",
    txt:"📃",md:"📃",json:"⚙️",env:"⚙️",sh:"💻"
  };
  return map[ext] || "📁";
}
function escapeHtml(str) {
  return (str || '').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── VIEW TOGGLE ────────────────────────────────────────────
function toggleView() {
  currentView = currentView === 'list' ? 'grid' : 'list';
  localStorage.setItem('nv-view', currentView);
  const btn = document.getElementById('viewToggleBtn');
  if (btn) btn.textContent = currentView === 'list' ? '⊟' : '⊞';
  applyView();
}
function applyView() {
  const btn = document.getElementById('viewToggleBtn');
  if (btn) btn.textContent = currentView === 'list' ? '⊟' : '⊞';

  const fileContainer = document.getElementById('fileContainer');
  if (fileContainer) {
    fileContainer.className = currentView === 'grid' ? 'file-grid-view' : 'file-list-view';
  }
  const gallery = document.getElementById('gallery');
  if (gallery) {
    gallery.className = currentView === 'grid' ? 'gallery-grid' : 'gallery-list-view gallery-grid';
  }
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = currentView === 'grid' ? 'video-grid' : 'video-list-view video-grid';
  }
  const noteContainer = document.getElementById('noteContainer');
  if (noteContainer) {
    noteContainer.className = currentView === 'grid' ? 'note-grid-view' : 'note-list-view';
  }
}

// ─── STORAGE INFO ────────────────────────────────────────────
async function loadStorageInfo(userId) {
  try {
    const { data: files } = await supabaseClient.from("file_metadata").select("size").eq("user_id", userId).eq("deleted", false);
    const { data: vids } = await supabaseClient.from("videos").select("size").eq("user_id", userId).eq("deleted", false);
    const { count: imgCount } = await supabaseClient.from("images").select("id", { count: "exact", head: true }).eq("user_id", userId);

    const fileBytes = (files || []).reduce((a, f) => a + (f.size || 0), 0);
    const vidBytes = (vids || []).reduce((a, v) => a + (v.size || 0), 0);
    const totalBytes = fileBytes + vidBytes;
    const totalGB = 8 * 1024 * 1024 * 1024;
    const pct = Math.min((totalBytes / totalGB) * 100, 100).toFixed(1);
    const usedStr = formatSize(totalBytes);

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setW = (id, w) => { const el = document.getElementById(id); if (el) el.style.width = w; };

    setEl('storageUsedLabel', `${usedStr} of 8 GB`);
    setW('storageFill', pct + '%');
    setEl('storageUsedBig', usedStr);
    setW('storageFill2', pct + '%');
    setEl('bdFiles', formatSize(fileBytes));
    setEl('bdImages', imgCount ? `${imgCount} imgs` : '0');
    setEl('bdVideos', formatSize(vidBytes));
    setEl('settingsStorage', `${usedStr} of 8 GB (${pct}%)`);
    setEl('storageSub', `${pct}% of 8 GB used`);
  } catch (e) { console.warn("Storage load failed:", e); }
}

// ─── AUTH ────────────────────────────────────────────────────
async function signUp() {
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
  if (!email || !password) { toast("Fill in all fields", "warn"); return; }
  const btn = document.getElementById("authBtn");
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = "Creating account…"; }
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = "Create Account →"; }
  if (error) toast(error.message, "error");
  else toast("Account created! Check your email.", "success");
}

async function login() {
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
  if (!email || !password) { toast("Fill in all fields", "warn"); return; }
  const btn = document.getElementById("authBtn");
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = "Signing in…"; }
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = "Sign In →"; }
  if (error) toast(error.message, "error");
  else window.location.href = "dashboard.html";
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

// ─── DASHBOARD STATS ─────────────────────────────────────────
async function loadDashboardStats(userId) {
  try {
    const [{ count: fc }, { count: ic }, { count: nc }, { count: vc }] = await Promise.all([
      supabaseClient.from("file_metadata").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("deleted",false),
      supabaseClient.from("images").select("id",{count:"exact",head:true}).eq("user_id",userId),
      supabaseClient.from("notes").select("id",{count:"exact",head:true}).eq("user_id",userId),
      supabaseClient.from("videos").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("deleted",false),
    ]);
    const s = id => { const el = document.getElementById(id); if(el) return el; return {textContent:''} };
    s('statFiles').textContent = fc ?? 0;
    s('statImages').textContent = ic ?? 0;
    s('statNotes').textContent = nc ?? 0;
    s('statVideos').textContent = vc ?? 0;
  } catch (e) { console.warn("Stats failed:", e); }
}

// ─── FOLDER NAVIGATION ───────────────────────────────────────
function navigateToFolder(folder) {
  currentFolder = folder;
  updateBreadcrumb();
  listFiles();
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (!currentFolder) {
    bc.innerHTML = `<span class="bc-item bc-root" onclick="navigateToFolder('')">📁 My Files</span>`;
  } else {
    const parts = currentFolder.split('/');
    let html = `<span class="bc-item bc-root" onclick="navigateToFolder('')">📁 My Files</span>`;
    let path = '';
    parts.forEach((p, i) => {
      path += (i > 0 ? '/' : '') + p;
      const pathCopy = path;
      html += `<span class="bc-sep">›</span>`;
      if (i === parts.length - 1) {
        html += `<span class="bc-item" style="color:var(--accent)">${escapeHtml(p)}</span>`;
      } else {
        html += `<span class="bc-item" onclick="navigateToFolder('${escapeHtml(pathCopy)}')">${escapeHtml(p)}</span>`;
      }
    });
    bc.innerHTML = html;
  }
}

function createFolder() {
  const input = document.getElementById("folderInput");
  const name = input?.value.trim();
  if (!name) { toast("Enter a folder name", "warn"); return; }
  const newFolder = currentFolder ? `${currentFolder}/${name}` : name;
  navigateToFolder(newFolder);
  input.value = '';
  toast(`Navigated to folder "${name}"`, "success");
}

// ─── FILES ───────────────────────────────────────────────────
async function uploadFile(file) {
  if (!file) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  const folder = currentFolder ? `${user.id}/${currentFolder}` : user.id;
  const path = `${folder}/${Date.now()}_${file.name}`;
  showProgress(10, `Uploading ${file.name}…`);
  const { error } = await supabaseClient.storage.from("files").upload(path, file, { upsert: true });
  if (error) { hideProgress(); toast("Upload failed: " + error.message, "error"); return; }
  showProgress(70, "Saving metadata…");
  await supabaseClient.from("file_metadata").insert([{
    user_id: user.id, name: file.name, size: file.size,
    type: file.type || "", folder: currentFolder, path, deleted: false
  }]);
  showProgress(100, "Done!");
  hideProgress();
  toast(`${file.name} uploaded`, "success");
  listFiles();
}

async function listFiles() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data, error } = await supabaseClient.from("file_metadata")
    .select("*").eq("user_id", user.id).eq("deleted", false)
    .eq("folder", currentFolder).order("created_at", { ascending: false });
  if (error) { console.warn("listFiles error:", error); return; }
  allFiles = data || [];
  sortFiles();
  renderFolders(allFiles);
}

function renderFolders(files) {
  // Show sub-folders based on files in deeper paths
  const foldersEl = document.getElementById('foldersList');
  if (!foldersEl) return;
  foldersEl.innerHTML = '';
  // Could extend for virtual folder chips; for now skip
}

function renderFiles(files) {
  const list = document.getElementById("fileList");
  if (!list) return;
  const label = document.getElementById("fileCountLabel");
  if (label) label.textContent = `${files.length} file${files.length !== 1 ? "s" : ""}`;
  if (!files.length) {
    list.innerHTML = `<div class="empty"><span class="empty-icon">📭</span><p>No files here yet.</p><p class="empty-sub">Upload something to get started!</p></div>`;
    return;
  }
  list.innerHTML = "";
  files.forEach(file => {
    const url = supabaseClient.storage.from("files").getPublicUrl(file.path).data.publicUrl;
    const li = document.createElement("li");
    li.className = "file-item";
    li.dataset.name = file.name.toLowerCase();
    li.innerHTML = `
      <div class="file-info">
        <span class="file-icon">${getFileIcon(file.name)}</span>
        <div style="min-width:0">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-meta">${formatSize(file.size)}${file.created_at ? " · " + formatDateRelative(file.created_at) : ""}</div>
        </div>
      </div>
      <div class="file-actions">
        <button class="btn-ghost btn-sm" title="Share" onclick="openShareModal('${url}')">🔗</button>
        <a href="${url}" target="_blank" class="btn-ghost btn-sm" style="text-decoration:none;" title="Open">↗</a>
        <a href="${url}" download="${escapeHtml(file.name)}" class="btn-ghost btn-sm" style="text-decoration:none;" title="Download">⬇</a>
        <button class="btn-danger btn-sm" title="Delete" onclick="confirmDeleteFile('${escapeHtml(file.name)}',${file.id})">🗑</button>
      </div>
    `;
    list.appendChild(li);
  });
  applyView();
}

function sortFiles() {
  const sel = document.getElementById('sortSelect');
  const mode = sel?.value || 'date-desc';
  let sorted = [...allFiles];
  if (mode === 'date-desc') sorted.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  else if (mode === 'date-asc') sorted.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  else if (mode === 'name-asc') sorted.sort((a,b) => a.name.localeCompare(b.name));
  else if (mode === 'name-desc') sorted.sort((a,b) => b.name.localeCompare(a.name));
  else if (mode === 'size-desc') sorted.sort((a,b) => (b.size||0) - (a.size||0));
  else if (mode === 'size-asc') sorted.sort((a,b) => (a.size||0) - (b.size||0));
  renderFiles(sorted);
}

function filterFiles() {
  const q = (document.getElementById("fileSearch")?.value || "").toLowerCase();
  const items = document.querySelectorAll("#fileList .file-item");
  let visible = 0;
  items.forEach(item => {
    const match = item.dataset.name.includes(q);
    item.style.display = match ? "" : "none";
    if (match) visible++;
  });
  const label = document.getElementById("fileCountLabel");
  if (label) label.textContent = `${visible} file${visible !== 1 ? "s" : ""}`;
}

function confirmDeleteFile(name, metaId) {
  openModal(`Move "${name}" to trash?`, () => deleteFile(name, metaId));
}

async function deleteFile(name, metaId) {
  const { error } = await supabaseClient.from("file_metadata")
    .update({ deleted: true, deleted_at: new Date().toISOString() }).eq("id", metaId);
  if (error) { toast("Delete failed", "error"); return; }
  toast(`${name} moved to trash`, "success");
  listFiles();
}

// ─── SHARING ─────────────────────────────────────────────────
function openShareModal(url) {
  currentShareUrl = url;
  const input = document.getElementById('shareLinkInput');
  if (input) input.value = url;
  const modal = document.getElementById('shareModal');
  if (modal) modal.classList.add('open');
}
function copyShareLink() {
  navigator.clipboard.writeText(currentShareUrl).then(() => toast("Link copied!", "success"));
}
function openShareLink() {
  window.open(currentShareUrl, '_blank');
}
function shareViaWhatsApp() {
  window.open(`https://wa.me/?text=${encodeURIComponent('Check this out: ' + currentShareUrl)}`, '_blank');
}
function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => toast("Link copied!", "success"));
}

// ─── IMAGES ──────────────────────────────────────────────────
async function uploadImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Please select an image file", "warn"); return; }
  showProgress(10, "Uploading to Cloudinary…");
  const formData = new FormData();
  formData.append("file", file);
formData.append("upload_preset", "nimbusvault_upload");
  try {
    const res = await fetch("https://api.cloudinary.com/v1_1/ep29qmmd/image/upload", { method: "POST", body: formData });
    showProgress(80, "Saving…");
    const data = await res.json();
    if (data.error) { hideProgress(); toast(data.error.message, "error"); return; }
    const { data: { user } } = await supabaseClient.auth.getUser();
    await supabaseClient.from("images").insert([{ url: data.secure_url, user_id: user.id, name: file.name }]);
    showProgress(100, "Done!"); hideProgress();
    toast("Image uploaded", "success");
    loadImages();
  } catch (err) { hideProgress(); toast("Upload failed: " + err.message, "error"); }
}

async function loadImages() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from("images")
    .select("*").eq("user_id", user.id).order("id", { ascending: false });
  const gallery = document.getElementById("gallery");
  if (!gallery) return;
  const imgs = data || [];
  if (typeof setAllImagesData === 'function') setAllImagesData(imgs);
  const label = document.getElementById("imgCountLabel");
  if (label) label.textContent = `${imgs.length} image${imgs.length !== 1 ? "s" : ""}`;
  if (!imgs.length) {
    gallery.innerHTML = `<div class="empty"><span class="empty-icon">🖼️</span><p>No images yet.</p></div>`;
    return;
  }
  gallery.innerHTML = "";
  imgs.forEach((img, idx) => {
    const div = document.createElement("div");
    div.className = "gallery-item";
    div.dataset.name = (img.name || '').toLowerCase();
    div.innerHTML = `
      <img src="${img.url}" alt="${escapeHtml(img.name || 'image')}" loading="lazy" onclick="openLightbox('${img.url}',${idx})">
      <div class="gallery-item-overlay"><div class="gallery-item-name">${escapeHtml(img.name || '')}</div></div>
      <div class="gallery-item-actions">
        <button class="gal-btn" title="Share" onclick="event.stopPropagation();openShareModal('${img.url}')">🔗</button>
        <button class="gal-btn" title="Delete" onclick="event.stopPropagation();confirmDeleteImage(${img.id})">✕</button>
      </div>
    `;
    gallery.appendChild(div);
  });
  applyView();
}

function confirmDeleteImage(id) {
  openModal("Delete this image permanently?", () => deleteImage(id));
}
async function deleteImage(id) {
  const { error } = await supabaseClient.from("images").delete().eq("id", id);
  if (error) { toast("Delete failed", "error"); return; }
  toast("Image deleted", "success");
  loadImages();
}

// ─── VIDEOS ──────────────────────────────────────────────────
async function uploadVideo(file) {
  if (!file) return;
  if (!file.type.startsWith("video/")) { toast("Please select a video file", "warn"); return; }
  showProgress(5, `Uploading "${file.name}"… (this may take a while)`);
  const formData = new FormData();
  formData.append("file", file);
 formData.append("upload_preset", "nimbusvault_upload");
  formData.append("resource_type", "video");
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/ep29qmmd/video/upload", true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) showProgress(Math.floor((e.loaded / e.total) * 85), `Uploading "${file.name}"…`);
    };
    xhr.onload = async () => {
      const data = JSON.parse(xhr.responseText);
      if (data.error) { hideProgress(); toast(data.error.message, "error"); return; }
      showProgress(95, "Saving to database…");
      const { data: { user } } = await supabaseClient.auth.getUser();
      await supabaseClient.from("videos").insert([{
        user_id: user.id, url: data.secure_url,
        name: file.name, size: file.size, deleted: false
      }]);
      showProgress(100, "Done!"); hideProgress();
      toast("Video uploaded!", "success");
      loadVideos();
    };
    xhr.onerror = () => { hideProgress(); toast("Upload failed", "error"); };
    xhr.send(formData);
  } catch (err) { hideProgress(); toast("Upload failed: " + err.message, "error"); }
}

async function loadVideos() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from("videos")
    .select("*").eq("user_id", user.id).eq("deleted", false).order("id", { ascending: false });
  const grid = document.getElementById("videoGrid");
  if (!grid) return;
  const vids = data || [];
  const label = document.getElementById("videoCountLabel");
  if (label) label.textContent = `${vids.length} video${vids.length !== 1 ? "s" : ""}`;
  if (!vids.length) {
    grid.innerHTML = `<div class="empty"><span class="empty-icon">🎬</span><p>No videos yet.</p></div>`;
    return;
  }
  grid.innerHTML = "";
  vids.forEach(vid => {
    const div = document.createElement("div");
    div.className = "video-card";
    div.dataset.name = (vid.name || '').toLowerCase();
    div.innerHTML = `
      <div class="video-thumb" onclick="openVideoPlayer('${vid.url}','${escapeHtml(vid.name || 'Video')}')">
        <video src="${vid.url}" preload="metadata" muted></video>
        <div class="video-play-btn"></div>
      </div>
      <div class="video-info">
        <div class="video-name">${escapeHtml(vid.name || 'Video')}</div>
        <div class="video-meta">${formatSize(vid.size)}${vid.created_at ? " · " + formatDateRelative(vid.created_at) : ""}</div>
        <div class="video-actions">
          <button class="btn-ghost btn-sm" onclick="openShareModal('${vid.url}')">🔗 Share</button>
          <a href="${vid.url}" download class="btn-ghost btn-sm" style="text-decoration:none">⬇</a>
          <button class="btn-danger btn-sm" onclick="confirmDeleteVideo(${vid.id},'${escapeHtml(vid.name || '')}')">🗑</button>
        </div>
      </div>
    `;
    grid.appendChild(div);
  });
  applyView();
}

function confirmDeleteVideo(id, name) {
  openModal(`Move "${name}" to trash?`, () => deleteVideo(id, name));
}
async function deleteVideo(id, name) {
  const { error } = await supabaseClient.from("videos")
    .update({ deleted: true, deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) { toast("Delete failed", "error"); return; }
  toast(`"${name}" moved to trash`, "success");
  loadVideos();
}

// ─── NOTES ───────────────────────────────────────────────────
async function saveNote() {
  const input = document.getElementById("noteInput");
  const text = input?.value.trim();
  if (!text) { toast("Write something first", "warn"); return; }
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("notes").insert([{ content: text, user_id: user.id }]);
  if (error) { toast("Could not save: " + error.message, "error"); return; }
  input.value = "";
  const cc = document.getElementById("charCount");
  if (cc) cc.textContent = "0 characters";
  toast("Note saved", "success");
  loadNotes();
}

async function loadNotes() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from("notes")
    .select("*").eq("user_id", user.id).order("id", { ascending: false });
  allNotes = data || [];
  renderNotes(allNotes);
}

function renderNotes(notes) {
  const list = document.getElementById("notesList");
  if (!list) return;
  const label = document.getElementById("noteCountLabel");
  if (label) label.textContent = `${notes.length} note${notes.length !== 1 ? "s" : ""}`;
  if (!notes.length) {
    list.innerHTML = `<div class="empty"><span class="empty-icon">📝</span><p>No notes yet. Write something!</p></div>`;
    return;
  }
  list.innerHTML = "";
  notes.forEach(note => {
    const li = document.createElement("li");
    li.className = "note-item";
    li.dataset.content = note.content.toLowerCase();
    li.innerHTML = `
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-footer">
        <span class="note-date">${formatDateRelative(note.created_at)}</span>
        <div style="display:flex;gap:5px;">
          <button class="btn-ghost btn-sm" onclick="copyNoteText(${note.id})" title="Copy">📋</button>
          <button class="btn-danger btn-sm" onclick="confirmDeleteNote(${note.id})">Delete</button>
        </div>
      </div>
    `;
    list.appendChild(li);
  });
  applyView();
}

function filterNotes() {
  const q = (document.getElementById("noteSearch")?.value || "").toLowerCase();
  const items = document.querySelectorAll("#notesList .note-item");
  let visible = 0;
  items.forEach(item => {
    const match = item.dataset.content.includes(q);
    item.style.display = match ? "" : "none";
    if (match) visible++;
  });
  const label = document.getElementById("noteCountLabel");
  if (label) label.textContent = `${visible} note${visible !== 1 ? "s" : ""}`;
}

function copyNoteText(id) {
  const note = allNotes.find(n => n.id === id);
  if (note) navigator.clipboard.writeText(note.content).then(() => toast("Copied!", "success"));
}

function confirmDeleteNote(id) {
  openModal("Delete this note?", () => deleteNote(id));
}
async function deleteNote(id) {
  const { error } = await supabaseClient.from("notes").delete().eq("id", id);
  if (error) { toast("Delete failed", "error"); return; }
  toast("Note deleted", "success");
  loadNotes();
}

// ─── RECENTS ─────────────────────────────────────────────────
async function loadRecents(userId) {
  const list = document.getElementById('recentsList');
  if (!list) return;
  try {
    const [{ data: files }, { data: imgs }, { data: vids }, { data: notes }] = await Promise.all([
      supabaseClient.from("file_metadata").select("*").eq("user_id", userId).eq("deleted", false).order("created_at", {ascending:false}).limit(10),
      supabaseClient.from("images").select("*").eq("user_id", userId).order("id", {ascending:false}).limit(5),
      supabaseClient.from("videos").select("*").eq("user_id", userId).eq("deleted", false).order("created_at", {ascending:false}).limit(5),
      supabaseClient.from("notes").select("*").eq("user_id", userId).order("id", {ascending:false}).limit(5),
    ]);

    let items = [
      ...(files||[]).map(f => ({ ...f, _type:'file', _date: f.created_at })),
      ...(imgs||[]).map(i => ({ ...i, _type:'image', _date: i.created_at || new Date().toISOString() })),
      ...(vids||[]).map(v => ({ ...v, _type:'video', _date: v.created_at })),
      ...(notes||[]).map(n => ({ ...n, _type:'note', _date: n.created_at })),
    ].sort((a, b) => new Date(b._date) - new Date(a._date)).slice(0, 25);

    if (!items.length) {
      list.innerHTML = `<div class="empty"><span class="empty-icon">🕐</span><p>No recent activity yet.</p></div>`;
      return;
    }

    list.innerHTML = items.map(item => {
      let name = item.name || item.content?.substring(0, 40) || 'Item';
      let icon = item._type === 'file' ? getFileIcon(item.name||'') : item._type === 'image' ? '🖼️' : item._type === 'video' ? '🎬' : '📝';
      let url = '';
      if (item._type === 'file') url = supabaseClient.storage.from("files").getPublicUrl(item.path).data.publicUrl;
      else if (item._type === 'image' || item._type === 'video') url = item.url || '';
      return `
        <div class="recent-item" data-name="${escapeHtml((name+'').toLowerCase())}">
          <span style="font-size:1.2rem">${icon}</span>
          <div class="recent-info">
            <div class="recent-name">${escapeHtml(name)}</div>
            <div class="recent-date">${formatDateRelative(item._date)}</div>
          </div>
          <span class="recent-type-badge">${item._type}</span>
          ${url ? `<div class="recent-actions"><button class="btn-ghost btn-sm" onclick="openShareModal('${url}')">🔗</button><a href="${url}" target="_blank" class="btn-ghost btn-sm" style="text-decoration:none">↗</a></div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) { list.innerHTML = `<div class="empty"><span class="empty-icon">⚠️</span><p>Failed to load recents.</p></div>`; }
}

// ─── TRASH ───────────────────────────────────────────────────
async function loadTrash(userId) {
  const list = document.getElementById('trashList');
  if (!list) return;
  try {
    const [{ data: files }, { data: vids }] = await Promise.all([
      supabaseClient.from("file_metadata").select("*").eq("user_id", userId).eq("deleted", true).order("deleted_at", {ascending:false}),
      supabaseClient.from("videos").select("*").eq("user_id", userId).eq("deleted", true).order("deleted_at", {ascending:false}),
    ]);
    const items = [
      ...(files||[]).map(f => ({ ...f, _type:'file' })),
      ...(vids||[]).map(v => ({ ...v, _type:'video' })),
    ];
    if (!items.length) {
      list.innerHTML = `<div class="empty"><span class="empty-icon">🗑️</span><p>Trash is empty.</p></div>`;
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="trash-item">
        <span style="font-size:1.2rem">${item._type === 'video' ? '🎬' : getFileIcon(item.name||'')}</span>
        <div class="trash-item-info">
          <div class="trash-item-name">${escapeHtml(item.name||'')}</div>
          <div class="trash-item-date">Deleted ${formatDateRelative(item.deleted_at)}</div>
        </div>
        <div class="trash-item-actions">
          <button class="btn-ghost btn-sm" onclick="restoreItem(${item.id},'${item._type}')">↺ Restore</button>
          <button class="btn-danger btn-sm" onclick="permanentDelete(${item.id},'${item._type}','${escapeHtml(item.path||'')}')">Delete Forever</button>
        </div>
      </div>
    `).join('');
  } catch (e) { list.innerHTML = `<div class="empty"><span class="empty-icon">⚠️</span><p>Failed to load trash.</p></div>`; }
}

async function restoreItem(id, type) {
  const table = type === 'video' ? 'videos' : 'file_metadata';
  await supabaseClient.from(table).update({ deleted: false, deleted_at: null }).eq("id", id);
  toast("Item restored", "success");
  const { data: { user } } = await supabaseClient.auth.getUser();
  loadTrash(user.id);
}

async function permanentDelete(id, type, path) {
  openModal("Permanently delete this item? This cannot be undone.", async () => {
    const table = type === 'video' ? 'videos' : 'file_metadata';
    await supabaseClient.from(table).delete().eq("id", id);
    if (path && type === 'file') await supabaseClient.storage.from("files").remove([path]);
    toast("Permanently deleted", "success");
    const { data: { user } } = await supabaseClient.auth.getUser();
    loadTrash(user.id);
  });
}

async function emptyTrash() {
  openModal("Empty all trash? This cannot be undone.", async () => {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: files } = await supabaseClient.from("file_metadata").select("path").eq("user_id", user.id).eq("deleted", true);
    if (files?.length) {
      await supabaseClient.storage.from("files").remove(files.map(f => f.path));
      await supabaseClient.from("file_metadata").delete().eq("user_id", user.id).eq("deleted", true);
    }
    await supabaseClient.from("videos").delete().eq("user_id", user.id).eq("deleted", true);
    toast("Trash emptied", "success");
    loadTrash(user.id);
  });
}

// ─── SHARED ITEMS ─────────────────────────────────────────────
async function loadSharedItems(userId) {
  const list = document.getElementById('sharedList');
  if (!list) return;
  try {
    const [{ data: files }, { data: imgs }, { data: vids }] = await Promise.all([
      supabaseClient.from("file_metadata").select("*").eq("user_id", userId).eq("deleted", false).order("created_at", {ascending:false}).limit(20),
      supabaseClient.from("images").select("*").eq("user_id", userId).order("id", {ascending:false}).limit(10),
      supabaseClient.from("videos").select("*").eq("user_id", userId).eq("deleted", false).order("created_at", {ascending:false}).limit(10),
    ]);
    const items = [
      ...(files||[]).map(f => ({ name: f.name, url: supabaseClient.storage.from("files").getPublicUrl(f.path).data.publicUrl, type: 'file', icon: getFileIcon(f.name) })),
      ...(imgs||[]).map(i => ({ name: i.name || 'Image', url: i.url, type: 'image', icon: '🖼️' })),
      ...(vids||[]).map(v => ({ name: v.name || 'Video', url: v.url, type: 'video', icon: '🎬' })),
    ];
    const label = document.getElementById('sharedCountLabel');
    if (label) label.textContent = `${items.length} shareable item${items.length !== 1 ? 's' : ''}`;
    if (!items.length) {
      list.innerHTML = `<div class="empty"><span class="empty-icon">🔗</span><p>No items to share yet.</p></div>`;
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="shared-item">
        <span style="font-size:1.2rem">${item.icon}</span>
        <div class="shared-info">
          <div class="shared-name">${escapeHtml(item.name)}</div>
          <div class="shared-url">${item.url}</div>
        </div>
        <div class="shared-actions">
          <button class="btn-ghost btn-sm" onclick="openShareModal('${item.url}')">🔗 Share</button>
          <a href="${item.url}" target="_blank" class="btn-ghost btn-sm" style="text-decoration:none">↗</a>
        </div>
      </div>
    `).join('');
  } catch (e) { list.innerHTML = `<div class="empty"><span class="empty-icon">⚠️</span><p>Failed to load items.</p></div>`; }
}
