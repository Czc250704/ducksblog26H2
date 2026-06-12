/**
 * DucksBlog26H2 - 完整模块化系统
 * 敏感配置从 config.js 引入，不提交到仓库
 */

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

// 管理员账户（非敏感，可以放在这里）
const ADMIN_CONFIG = {
    master: { username: 'duck', password: '250901', role: 'master' },
    sub: [
        { username: 'admin1', password: '123123', role: 'sub' },
        { username: 'admin2', password: '123123', role: 'sub' },
        { username: 'admin3', password: '123123', role: 'sub' },
        { username: 'admin4', password: '123123', role: 'sub' }
    ]
};

// ==================== GitHub API 工具模块（使用 config.js 中的 CONFIG） ====================
// 注意：config.js 必须存在且定义 CONFIG 对象
let GitHubAPI = null;

function initGitHubAPI() {
    if (typeof CONFIG === 'undefined') {
        console.error('config.js 未加载，请确保 assets/js/config.js 存在并定义 CONFIG');
        return false;
    }
    GitHubAPI = {
        async getFile(path) {
            const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `token ${CONFIG.GITHUB_TOKEN}` }
            });
            if (!res.ok) {
                if (res.status === 404) return null;
                throw new Error(`GitHub API error: ${res.status}`);
            }
            const data = await res.json();
            return { content: atob(data.content), sha: data.sha };
        },
        async updateFile(path, content, message, sha = null) {
            const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}`;
            const body = {
                message: message,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: CONFIG.BRANCH
            };
            if (sha) body.sha = sha;
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`GitHub update failed: ${res.status}`);
            return await res.json();
        },
        async uploadFile(filename, base64Data) {
            const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/uploads/${filename}`;
            let sha = null;
            try {
                const res = await fetch(url, {
                    headers: { 'Authorization': `token ${CONFIG.GITHUB_TOKEN}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    sha = data.sha;
                }
            } catch(e) {}
            const body = {
                message: `Upload file ${filename}`,
                content: base64Data,
                branch: CONFIG.BRANCH
            };
            if (sha) body.sha = sha;
            const uploadRes = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!uploadRes.ok) throw new Error('Upload failed');
        }
    };
    return true;
}

// ==================== 数据加载模块 ====================
async function loadAllData() {
    if (!GitHubAPI) return;
    try {
        const filesRes = await GitHubAPI.getFile('data/files.json');
        state.allDocs = filesRes ? JSON.parse(filesRes.content) : [];
        const catRes = await GitHubAPI.getFile('data/categories.json');
        state.categories = catRes ? JSON.parse(catRes.content) : ['电工', '代码', '笔记'];
        const pendRes = await GitHubAPI.getFile('data/pending.json');
        state.pendingFiles = pendRes ? JSON.parse(pendRes.content) : [];
        const setRes = await GitHubAPI.getFile('data/settings.json');
        if (setRes) state.settings = JSON.parse(setRes.content);
        else {
            state.settings = { globalPasswordEnabled: false, globalPassword: '', categoryPasswords: {} };
            await GitHubAPI.updateFile('data/settings.json', JSON.stringify(state.settings, null, 2), 'Init settings');
        }
        renderCategories();
        renderRecentUploads();
        renderComments();
        if (state.currentUser?.role === 'master') {
            renderApprovalPanel();
            renderSystemSettings();
        }
    } catch (err) {
        console.error('加载数据失败:', err);
        showToast('数据加载失败，请检查网络或GitHub配置');
    }
}

async function saveFilesList() {
    const content = JSON.stringify(state.allDocs, null, 2);
    const existing = await GitHubAPI.getFile('data/files.json');
    await GitHubAPI.updateFile('data/files.json', content, 'Update files list', existing?.sha);
}

async function savePendingList() {
    const content = JSON.stringify(state.pendingFiles, null, 2);
    const existing = await GitHubAPI.getFile('data/pending.json');
    await GitHubAPI.updateFile('data/pending.json', content, 'Update pending list', existing?.sha);
}

async function saveCategories() {
    const content = JSON.stringify(state.categories, null, 2);
    const existing = await GitHubAPI.getFile('data/categories.json');
    await GitHubAPI.updateFile('data/categories.json', content, 'Update categories', existing?.sha);
}

async function saveSettings() {
    const content = JSON.stringify(state.settings, null, 2);
    const existing = await GitHubAPI.getFile('data/settings.json');
    await GitHubAPI.updateFile('data/settings.json', content, 'Update settings', existing?.sha);
}

// ==================== UI 渲染模块 ====================
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

function renderRecentUploads() {
    const sorted = [...state.allDocs].sort((a,b) => new Date(b.date) - new Date(a.date));
    const recent = sorted.slice(0,5);
    const container = document.getElementById('recentUploadsList');
    container.innerHTML = recent.map(doc => `<li class="recent-item"><span>${escapeHtml(doc.title)}</span><span class="recent-date">${doc.date}</span></li>`).join('');
}

// ==================== 预览模块 ====================
function showPreviewContainer() {
    const modal = document.getElementById('previewModal');
    const container = document.getElementById('previewContainer');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    container.innerHTML = '<div class="text-center py-10">加载中...</div>';
    return container;
}

function previewFile(filename, type) {
    const container = showPreviewContainer();
    const fileUrl = `uploads/${encodeURIComponent(filename)}`;
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
        const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(window.location.origin + '/' + fileUrl)}`;
        container.innerHTML = `<iframe src="${officeUrl}" width="100%" height="600px"></iframe>`;
    }
}

function renderMath(element) {
    if (!katex) return;
    const inline = /\\\(([\s\S]+?)\\\)/g, display = /\\\[([\s\S]+?)\\\]/g;
    function walk(node) {
        if (node.nodeType === 3) {
            let html = node.textContent;
            let has = false;
            html = html.replace(display, (m,f)=>{has=true; try{return katex.renderToString(f,{displayMode:true});}catch(e){return m;}});
            html = html.replace(inline, (m,f)=>{has=true; try{return katex.renderToString(f,{displayMode:false});}catch(e){return m;}});
            if(has){ let span=document.createElement('span'); span.innerHTML=html; node.parentNode.replaceChild(span,node); }
        } else if(node.nodeType===1 && !['SCRIPT','STYLE','CODE'].includes(node.tagName))
            node.childNodes.forEach(walk);
    }
    walk(element);
}

// ==================== 管理员模块 ====================
function showAdminLoginModal() {
    document.getElementById('adminModal').classList.remove('hidden');
    document.getElementById('adminModal').classList.add('flex');
}
function closeAdminModal() {
    document.getElementById('adminModal').classList.add('hidden');
    document.getElementById('adminModal').classList.remove('flex');
}
function handleAdminLogin() {
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    let user = null;
    if (username === ADMIN_CONFIG.master.username && password === ADMIN_CONFIG.master.password) {
        user = { ...ADMIN_CONFIG.master, role: 'master' };
    } else {
        user = ADMIN_CONFIG.sub.find(u => u.username === username && u.password === password);
        if (user) user = { ...user, role: 'sub' };
    }
    if (user) {
        state.currentUser = user;
        localStorage.setItem('ducksblog_user', JSON.stringify({ username: user.username, role: user.role }));
        closeAdminModal();
        updateUIForAdmin();
        showToast(`欢迎，${user.username}`);
    } else {
        document.getElementById('adminLoginError').innerText = '用户名或密码错误';
    }
}
function logout() {
    state.currentUser = null;
    localStorage.removeItem('ducksblog_user');
    updateUIForAdmin();
    showToast('已退出登录');
}
function updateUIForAdmin() {
    const isLoggedIn = !!state.currentUser;
    const isMaster = state.currentUser?.role === 'master';
    document.getElementById('adminLoginBtn').classList.toggle('hidden', isLoggedIn);
    document.getElementById('logoutBtn').classList.toggle('hidden', !isLoggedIn);
    document.getElementById('userRoleBadge').innerText = isLoggedIn ? (isMaster ? '最高管理员' : '二级管理员') : '';
    if (state.currentCategory && document.getElementById('filesView').classList.contains('hidden') === false) {
        document.getElementById('uploadPanel').classList.toggle('hidden', !isLoggedIn);
    }
    document.getElementById('newCategoryBtn').classList.toggle('hidden', !isMaster);
    document.getElementById('deleteCategoryBtn').classList.toggle('hidden', !isMaster || !state.currentCategory);
    document.getElementById('approvalPanel').classList.toggle('hidden', !isMaster);
    if (isMaster) {
        renderApprovalPanel();
        renderSystemSettings();
    }
}
async function renderApprovalPanel() {
    const container = document.getElementById('pendingList');
    if (!container) return;
    if (state.pendingFiles.length === 0) {
        container.innerHTML = '<div class="text-center text-stone-400">暂无待审批文件</div>';
        return;
    }
    container.innerHTML = state.pendingFiles.map((item, idx) => `
        <div class="pending-item" data-idx="${idx}">
            <div class="pending-info">
                <div><strong>${escapeHtml(item.title)}</strong> (${item.type})</div>
                <div>上传者: ${escapeHtml(item.uploader)} · ${item.date}</div>
            </div>
            <div class="pending-actions">
                <button class="approve-btn" data-idx="${idx}">批准</button>
                <button class="reject-btn" data-idx="${idx}">拒绝</button>
            </div>
        </div>
    `).join('');
    document.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', () => approveFile(parseInt(btn.dataset.idx)));
    });
    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => rejectFile(parseInt(btn.dataset.idx)));
    });
}
async function approveFile(idx) {
    const item = state.pendingFiles[idx];
    if (!item) return;
    try {
        if (item.fileData) {
            await GitHubAPI.uploadFile(item.filename, item.fileData);
        }
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
async function rejectFile(idx) {
    state.pendingFiles.splice(idx, 1);
    await savePendingList();
    renderApprovalPanel();
    showToast('已拒绝');
}
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
    const typeMap = {
        md:'md', txt:'txt', ppt:'ppt', pptx:'pptx', doc:'doc', docx:'docx', xls:'xls', xlsx:'xlsx', pdf:'pdf',
        jpg:'jpg', jpeg:'jpeg', png:'png', gif:'gif'
    };
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
async function createNewCategory() {
    if (state.currentUser?.role !== 'master') return;
    const newCat = prompt('请输入新分类名称');
    if (!newCat || state.categories.includes(newCat)) {
        alert('分类已存在或无效');
        return;
    }
    state.categories.push(newCat);
    await saveCategories();
    renderCategories();
    showToast(`分类“${newCat}”已创建`);
}
async function deleteCurrentCategory() {
    if (state.currentUser?.role !== 'master') return;
    if (!state.currentCategory) return;
    if (confirm(`确定要删除分类“${state.currentCategory}”吗？其中的文件将移入“未分类”。`)) {
        for (let doc of state.allDocs) {
            if (doc.category === state.currentCategory) doc.category = '未分类';
        }
        state.categories = state.categories.filter(c => c !== state.currentCategory);
        if (!state.categories.includes('未分类')) state.categories.push('未分类');
        await saveCategories();
        await saveFilesList();
        document.getElementById('filesView').classList.add('hidden');
        document.getElementById('categoriesView').classList.remove('hidden');
        renderCategories();
        showToast('分类已删除');
    }
}
function renderSystemSettings() {
    const container = document.getElementById('categoryPasswordSettings');
    if (!container) return;
    const toggle = document.getElementById('globalPasswordToggle');
    const pwdGroup = document.getElementById('passwordSettingGroup');
    const pwdInput = document.getElementById('globalPasswordInput');
    toggle.checked = state.settings.globalPasswordEnabled;
    pwdGroup.style.display = state.settings.globalPasswordEnabled ? 'block' : 'none';
    pwdInput.value = state.settings.globalPassword || '';
    container.innerHTML = '<h4 class="text-sm font-medium mt-2">分类独立密码</h4>';
    state.categories.forEach(cat => {
        const currentPwd = state.settings.categoryPasswords[cat] || '';
        container.innerHTML += `
            <div class="setting-item">
                <label>${escapeHtml(cat)}</label>
                <input type="password" id="pwd_${escapeHtml(cat)}" placeholder="留空表示无密码" value="${escapeHtml(currentPwd)}" class="text-sm">
            </div>
        `;
    });
    document.getElementById('saveSettingsBtn').onclick = async () => {
        state.settings.globalPasswordEnabled = toggle.checked;
        if (toggle.checked) state.settings.globalPassword = pwdInput.value;
        else state.settings.globalPassword = '';
        for (let cat of state.categories) {
            const input = document.getElementById(`pwd_${cat}`);
            if (input) {
                if (input.value) state.settings.categoryPasswords[cat] = input.value;
                else delete state.settings.categoryPasswords[cat];
            }
        }
        await saveSettings();
        showToast('设置已保存');
    };
    toggle.addEventListener('change', () => {
        pwdGroup.style.display = toggle.checked ? 'block' : 'none';
    });
}

// ==================== 评论模块 ====================
let comments = [];
function loadComments() {
    const stored = localStorage.getItem('ducksblog_comments');
    comments = stored ? JSON.parse(stored) : [];
    renderComments();
}
function saveComments() {
    localStorage.setItem('ducksblog_comments', JSON.stringify(comments));
    renderComments();
}
function renderComments() {
    const container = document.getElementById('commentsList');
    if (!container) return;
    container.innerHTML = comments.map(c => `
        <div class="comment-item">
            <div class="comment-avatar">${c.avatar || '访'}</div>
            <div class="comment-content">
                <div class="comment-author">${escapeHtml(c.author)}</div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
                <div class="comment-time">${c.time}</div>
            </div>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
}
function addComment(text) {
    if (!text.trim()) return;
    comments.unshift({
        author: '访客',
        text: text.trim(),
        time: new Date().toLocaleString(),
        avatar: '访'
    });
    saveComments();
}

// ==================== 音乐播放器模块 ====================
async function loadMusic() {
    try {
        const res = await fetch('data/music.json');
        if (res.ok) state.musicList = await res.json();
        else state.musicList = [];
        renderPlaylist();
    } catch(e) { state.musicList = []; }
}
function renderPlaylist() {
    const el = document.getElementById('playlist');
    el.innerHTML = state.musicList.map((t, idx) => `<div class="playlist-item ${idx===state.currentMusicIndex?'active':''}" data-idx="${idx}">${escapeHtml(t.name)}</div>`).join('');
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.addEventListener('click', () => playMusic(parseInt(item.dataset.idx)));
    });
}
function playMusic(idx) {
    if (!state.musicList[idx]) return;
    state.currentMusicIndex = idx;
    const audio = document.getElementById('audioPlayer');
    audio.src = state.musicList[idx].url;
    audio.play();
    state.isPlaying = true;
    updatePlayerUI();
    renderPlaylist();
}
function togglePlayPause() {
    const audio = document.getElementById('audioPlayer');
    if (!audio.src && state.musicList.length) playMusic(0);
    else if (state.isPlaying) { audio.pause(); state.isPlaying = false; }
    else { audio.play(); state.isPlaying = true; }
    updatePlayerUI();
}
function nextTrack() { if(state.musicList.length) playMusic((state.currentMusicIndex+1)%state.musicList.length); }
function prevTrack() { if(state.musicList.length) playMusic((state.currentMusicIndex-1+state.musicList.length)%state.musicList.length); }
function updatePlayerUI() {
    const cur = document.getElementById('currentTrack');
    const btn = document.getElementById('playPause');
    if (state.currentMusicIndex >=0) cur.innerText = state.musicList[state.currentMusicIndex].name;
    else cur.innerText = '未选择歌曲';
    btn.innerHTML = state.isPlaying ? '⏸' : '▶';
}

// ==================== 辅助函数 ====================
function escapeHtml(str) { return str?.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m])) || ''; }
function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = '#333';
        toast.style.color = 'white';
        toast.style.padding = '8px 16px';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '10000';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 3000);
}

// ==================== 模态框控制 ====================
function initModalControls() {
    const modal = document.getElementById('previewModal');
    const win = document.getElementById('modalWindow');
    const header = document.getElementById('modalHeader');
    document.querySelector('.modal-close').onclick = () => modal.classList.add('hidden');
    document.querySelector('.modal-minimize').onclick = () => modal.classList.add('hidden');
    let drag = false, offX, offY;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.modal-buttons')) return;
        drag = true;
        offX = e.clientX - win.offsetLeft;
        offY = e.clientY - win.offsetTop;
        win.style.position = 'fixed';
        win.style.margin = '0';
    });
    window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        let left = e.clientX - offX, top = e.clientY - offY;
        left = Math.min(window.innerWidth-100, Math.max(0, left));
        top = Math.min(window.innerHeight-80, Math.max(0, top));
        win.style.left = left + 'px';
        win.style.top = top + 'px';
    });
    window.addEventListener('mouseup', () => drag = false);
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    if (!initGitHubAPI()) {
        showToast('配置错误：请确保 assets/js/config.js 存在且包含正确的 GitHub Token');
        return;
    }
    const savedUser = localStorage.getItem('ducksblog_user');
    if (savedUser) {
        try {
            const u = JSON.parse(savedUser);
            if (u.username === ADMIN_CONFIG.master.username) state.currentUser = { ...ADMIN_CONFIG.master, role: 'master' };
            else if (ADMIN_CONFIG.sub.some(s => s.username === u.username)) state.currentUser = { ...ADMIN_CONFIG.sub.find(s => s.username === u.username), role: 'sub' };
        } catch(e) {}
    }
    await loadAllData();
    document.getElementById('adminLoginBtn').addEventListener('click', showAdminLoginModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('adminLoginConfirm').addEventListener('click', handleAdminLogin);
    document.getElementById('closeAdminModal').addEventListener('click', closeAdminModal);
    document.getElementById('backToCategories').addEventListener('click', () => {
        document.getElementById('filesView').classList.add('hidden');
        document.getElementById('categoriesView').classList.remove('hidden');
        state.currentCategory = null;
    });
    document.getElementById('newCategoryBtn').addEventListener('click', createNewCategory);
    document.getElementById('deleteCategoryBtn').addEventListener('click', deleteCurrentCategory);
    document.getElementById('uploadSubmit').addEventListener('click', submitUpload);
    document.getElementById('submitComment').addEventListener('click', () => {
        addComment(document.getElementById('commentInput').value);
        document.getElementById('commentInput').value = '';
    });
    document.getElementById('playPause').addEventListener('click', togglePlayPause);
    document.getElementById('nextTrack').addEventListener('click', nextTrack);
    document.getElementById('prevTrack').addEventListener('click', prevTrack);
    initModalControls();
    loadComments();
    loadMusic();
    updateUIForAdmin();
});