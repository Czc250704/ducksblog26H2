/**
 * DucksBlog26H2 - 前端主逻辑（调用后端 API）
 */

// ==================== 全局配置 ====================
// 后端 API 地址（部署到 Vercel 后替换为你的域名）
const API_BASE = 'https://ducksblog26h2.vercel.app/api'; // 正式地址
// 本地开发时可改为 http://localhost:3000/api

// 管理员账户（仍在前端验证，但上传等操作依赖后端）
const ADMIN_CONFIG = {
    master: { username: 'duck', password: '250901', role: 'master' },
    sub: [
        { username: 'admin1', password: '123123', role: 'sub' },
        { username: 'admin2', password: '123123', role: 'sub' },
        { username: 'admin3', password: '123123', role: 'sub' },
        { username: 'admin4', password: '123123', role: 'sub' }
    ]
};

// ==================== 全局状态 ====================
let state = {
    currentUser: null,
    allDocs: [],
    categories: [],
    pendingFiles: [],
    settings: { globalPasswordEnabled: false, globalPassword: '', categoryPasswords: {} },
    currentCategory: null,
    musicList: [],
    currentMusicIndex: -1,
    isPlaying: false
};

// ==================== 后端 API 封装 ====================
async function fetchData(filename) {
    const res = await fetch(`${API_BASE}/data/${filename}`);
    if (!res.ok) throw new Error(`Fetch ${filename} failed`);
    return await res.json();
}

async function saveData(filename, data) {
    const res = await fetch(`${API_BASE}/data/${filename}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Save ${filename} failed`);
}

async function uploadFile(filename, base64Data) {
    const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, base64Data })
    });
    if (!res.ok) throw new Error('Upload failed');
}

async function getFileUrl(filePath) {
    const res = await fetch(`${API_BASE}/file/${filePath}`);
    const data = await res.json();
    return data.url;
}

// ==================== 数据加载模块 ====================
async function loadAllData() {
    try {
        state.allDocs = await fetchData('files');
        state.categories = await fetchData('categories');
        state.pendingFiles = await fetchData('pending');
        state.settings = await fetchData('settings');
        renderCategories();
        renderRecentUploads();
        renderComments();
        if (state.currentUser?.role === 'master') {
            renderApprovalPanel();
            renderSystemSettings();
        }
    } catch (err) {
        console.error('加载数据失败:', err);
        showToast('数据加载失败，请检查后端服务是否正常运行');
    }
}

// 保存各类数据（统一调用 saveData）
async function saveFilesList() { await saveData('files', state.allDocs); }
async function savePendingList() { await saveData('pending', state.pendingFiles); }
async function saveCategories() { await saveData('categories', state.categories); }
async function saveSettings() { await saveData('settings', state.settings); }

// ==================== UI 渲染（与之前基本相同，但调用 API 部分已改） ====================
function renderCategories() {
    const container = document.getElementById('categoriesGrid');
    if (!container) return;
    container.innerHTML = state.categories.map(cat => {
        const count = state.allDocs.filter(d => (d.category || '未分类') === cat).length;
        return `
            <div class="category-block" data-category="${escapeHtml(cat)}">
                <svg class="category-icon" viewBox="0 0 24 24"><use href="assets/icons/sprite.svg#icon-folder"/></svg>
                <div class="category-name">${escapeHtml(cat)}</div>
                <div class="category-count">${count} 个文件</div>
            </div>
        `;
    }).join('');
    // 绑定点击事件（密码验证逻辑保留，与之前相同）
    document.querySelectorAll('.category-block').forEach(block => {
        block.addEventListener('click', async () => {
            const cat = block.dataset.category;
            let needPassword = false;
            let passwordRequired = '';
            if (state.settings.globalPasswordEnabled && state.settings.globalPassword) {
                needPassword = true;
                passwordRequired = state.settings.globalPassword;
            } else if (state.settings.categoryPasswords[cat]) {
                needPassword = true;
                passwordRequired = state.settings.categoryPasswords[cat];
            }
            if (needPassword) {
                const pwd = prompt(`分类“${cat}”需要密码才能查看，请输入密码：`);
                if (pwd !== passwordRequired) {
                    alert('密码错误');
                    return;
                }
            }
            enterCategory(cat);
        });
    });
}

function enterCategory(category) {
    state.currentCategory = category;
    const files = state.allDocs.filter(d => (d.category || '未分类') === category);
    document.getElementById('categoriesView').classList.add('hidden');
    document.getElementById('filesView').classList.remove('hidden');
    document.getElementById('currentCategoryTitle').innerText = category;
    const container = document.getElementById('filesList');
    container.innerHTML = files.map(file => `
        <div class="file-card-sm" data-filename="${file.filename}" data-type="${file.type}">
            <div class="file-info">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></svg>
                <div>
                    <div class="file-title">${escapeHtml(file.title)}</div>
                    <div class="file-meta">${file.date} · ${file.type.toUpperCase()}</div>
                    <div class="file-creator">上传者: ${escapeHtml(file.uploader || '系统')}</div>
                </div>
            </div>
            <button class="preview-btn">预览</button>
        </div>
    `).join('');
    // 绑定预览事件
    document.querySelectorAll('.file-card-sm').forEach(card => {
        const btn = card.querySelector('.preview-btn');
        const filename = card.dataset.filename;
        const type = card.dataset.type;
        btn.addEventListener('click', (e) => { e.stopPropagation(); previewFile(filename, type); });
        card.addEventListener('click', () => previewFile(filename, type));
    });
    if (state.currentUser) {
        document.getElementById('uploadPanel').classList.remove('hidden');
    } else {
        document.getElementById('uploadPanel').classList.add('hidden');
    }
}

// 预览文件（从后端获取 raw 文件 URL）
async function previewFile(filename, type) {
    const container = showPreviewContainer();
    const fileUrl = await getFileUrl(`uploads/${filename}`);
    if (type === 'md') {
        fetch(fileUrl).then(res => res.text()).then(text => {
            let html = marked.parse(text);
            container.innerHTML = html;
            if (typeof katex !== 'undefined') renderMath(container);
        }).catch(() => container.innerHTML = '<div>加载失败</div>');
    } else if (type === 'pdf') {
        container.innerHTML = `<iframe src="${fileUrl}" width="100%" height="600px"></iframe>`;
    } else if (['jpg','png','gif','webp','svg'].includes(type)) {
        container.innerHTML = `<img src="${fileUrl}" class="max-w-full mx-auto">`;
    } else {
        const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
        container.innerHTML = `<iframe src="${officeUrl}" width="100%" height="600px"></iframe>`;
    }
}

// 提交上传（二级管理员）
async function submitUpload() {
    if (!state.currentUser) {
        showToast('请先登录');
        return;
    }
    const fileInput = document.getElementById('fileInput');
    const title = document.getElementById('fileTitle').value.trim();
    const desc = document.getElementById('fileDesc').value.trim();
    if (!fileInput.files[0] || !title) {
        showToast('请选择文件并填写标题');
        return;
    }
    const file = fileInput.files[0];
    const filename = file.name;
    const ext = filename.split('.').pop().toLowerCase();
    const typeMap = { md:'md', txt:'txt', ppt:'ppt', pptx:'pptx', doc:'doc', docx:'docx', xls:'xls', xlsx:'xlsx', pdf:'pdf', jpg:'jpg', jpeg:'jpeg', png:'png', gif:'gif' };
    const fileType = typeMap[ext] || 'file';
    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64 = e.target.result.split(',')[1];
        const newPending = {
            title: title,
            filename: filename,
            type: fileType,
            date: new Date().toISOString().slice(0,10),
            description: desc,
            category: state.currentCategory,
            uploader: state.currentUser.username,
            fileData: base64
        };
        state.pendingFiles.push(newPending);
        await savePendingList();
        showToast('已提交审核，等待最高管理员批准');
        document.getElementById('fileInput').value = '';
        document.getElementById('fileTitle').value = '';
        document.getElementById('fileDesc').value = '';
    };
    reader.readAsDataURL(file);
}

// 批准文件（最高管理员）
async function approveFile(idx) {
    const item = state.pendingFiles[idx];
    if (!item) return;
    try {
        await uploadFile(item.filename, item.fileData);
        const newDoc = {
            title: item.title,
            filename: item.filename,
            type: item.type,
            date: item.date,
            description: item.description,
            category: item.category,
            uploader: item.uploader
        };
        state.allDocs.push(newDoc);
        await saveFilesList();
        state.pendingFiles.splice(idx, 1);
        await savePendingList();
        renderApprovalPanel();
        renderCategories();
        renderRecentUploads();
        if (state.currentCategory) enterCategory(state.currentCategory);
        showToast('已批准并发布');
    } catch (err) {
        console.error(err);
        showToast('批准失败：' + err.message);
    }
}

// 拒绝文件
async function rejectFile(idx) {
    state.pendingFiles.splice(idx, 1);
    await savePendingList();
    renderApprovalPanel();
    showToast('已拒绝');
}

// 其他辅助函数（escapeHtml, showToast, renderMath, 评论模块, 音乐播放器等）与原代码相同，此处省略
// 请从之前提供的 main.js 中复制保留这些函数

// 注意：所有涉及文件预览时获取 raw URL 的地方统一使用 getFileUrl 函数

// 初始化（保留原初始化代码，去除与 config.js 相关部分）
document.addEventListener('DOMContentLoaded', async () => {
    // 检查本地存储的登录状态
    const savedUser = localStorage.getItem('ducksblog_user');
    if (savedUser) {
        try {
            const u = JSON.parse(savedUser);
            if (u.username === ADMIN_CONFIG.master.username) state.currentUser = { ...ADMIN_CONFIG.master, role: 'master' };
            else if (ADMIN_CONFIG.sub.some(s => s.username === u.username)) state.currentUser = { ...ADMIN_CONFIG.sub.find(s => s.username === u.username), role: 'sub' };
        } catch(e) {}
    }
    await loadAllData();
    // 绑定事件（略，参考原代码）
    // 初始化音乐、评论等模块
    initMusicPlayer();
    loadComments();
    updateUIForAdmin();
});