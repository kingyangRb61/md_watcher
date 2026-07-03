let currentPath = null;
let ws = null;

const treeEl = document.getElementById('tree');
const previewEl = document.getElementById('preview');
const currentFileEl = document.getElementById('current-file');
const statusEl = document.getElementById('status');
const baseDirEl = document.querySelector('.base-dir');
const contextMenuEl = document.getElementById('context-menu');
const toastEl = document.getElementById('toast');
const sidebarEl = document.querySelector('.sidebar');
const btnCollapse = document.getElementById('btn-collapse');
const btnExpand = document.getElementById('btn-expand');

let contextTarget = null;
let renamingNode = null;

// 侧边栏展开/收缩
function toggleSidebar(collapsed) {
    sidebarEl.classList.toggle('collapsed', collapsed);
    btnExpand.classList.toggle('hidden', !collapsed);
    try {
        localStorage.setItem('mdwatcher.sidebarCollapsed', collapsed ? '1' : '0');
    } catch (e) {}
}

function initSidebarState() {
    let collapsed = false;
    try {
        collapsed = localStorage.getItem('mdwatcher.sidebarCollapsed') === '1';
    } catch (e) {}
    toggleSidebar(collapsed);
}

btnCollapse.addEventListener('click', () => toggleSidebar(true));
btnExpand.addEventListener('click', () => toggleSidebar(false));

// 构建目录树 DOM
function buildTree(items) {
    const ul = document.createElement('ul');
    for (const item of items) {
        const li = document.createElement('li');
        const node = document.createElement('div');
        node.className = 'node';
        node.dataset.path = item.path;
        node.dataset.type = item.type;

        const icon = document.createElement('span');
        icon.className = 'icon';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.name;

        if (item.type === 'dir') {
            icon.textContent = '▶';
            node.append(icon, label);
            li.appendChild(node);

            const children = buildTree(item.children);
            children.className = 'children';
            li.appendChild(children);

            node.addEventListener('click', (e) => {
                if (renamingNode) return;
                const expanded = children.classList.toggle('expanded');
                icon.textContent = expanded ? '▼' : '▶';
            });
        } else {
            icon.textContent = '📄';
            node.append(icon, label);
            li.appendChild(node);
            node.addEventListener('click', () => loadFile(item.path));
        }

        node.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, item, node);
        });

        ul.appendChild(li);
    }
    return ul;
}

async function loadTree() {
    try {
        const res = await fetch('/api/tree');
        const items = await res.json();
        treeEl.innerHTML = '';
        if (items.length === 0) {
            treeEl.innerHTML = '<div class="empty">暂无 Markdown 文件</div>';
            return;
        }
        const ul = buildTree(items);
        ul.querySelectorAll('.children').forEach(c => {
            c.classList.add('expanded');
            c.previousElementSibling.querySelector('.icon').textContent = '▼';
        });
        treeEl.appendChild(ul);

        // 恢复选中状态
        if (currentPath) {
            const active = treeEl.querySelector('.node[data-path="' + CSS.escape(currentPath) + '"]');
            if (active) active.classList.add('active');
        }
    } catch (err) {
        treeEl.innerHTML = '<div class="empty">加载失败：' + err.message + '</div>';
    }
}

async function loadCurrentDir() {
    try {
        const res = await fetch('/api/current-dir');
        const data = await res.json();
        if (baseDirEl) {
            baseDirEl.textContent = data.path;
            baseDirEl.title = data.path;
        }
    } catch (err) {
        console.error('load current dir failed', err);
    }
}

async function loadFile(path) {
    try {
        const res = await fetch('/api/file?path=' + encodeURIComponent(path));
        const data = await res.json();
        if (data.error) {
            previewEl.innerHTML = '<div class="placeholder">' + data.error + '</div>';
            return;
        }
        currentPath = path;
        currentFileEl.textContent = path;
        previewEl.innerHTML = '<div class="markdown-body">' + data.html + '</div>';

        if (typeof hljs !== 'undefined') {
            previewEl.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        treeEl.querySelectorAll('.node').forEach(n => n.classList.remove('active'));
        const active = treeEl.querySelector('.node[data-path="' + CSS.escape(path) + '"]');
        if (active) active.classList.add('active');
    } catch (err) {
        previewEl.innerHTML = '<div class="placeholder">加载失败：' + err.message + '</div>';
    }
}

// 右键菜单
function showContextMenu(e, item, node) {
    contextTarget = { item, node };
    contextMenuEl.innerHTML = '';

    const menuItems = [
        { label: '新建文件', action: () => createItem('file', item.path, item.type === 'dir') },
        { label: '新建文件夹', action: () => createItem('dir', item.path, item.type === 'dir') },
        { label: '重命名', action: () => startRename(item, node) },
        { label: '删除', action: () => deleteItem(item), danger: true },
        { label: '刷新', action: () => loadTree() },
    ];

    menuItems.forEach(mi => {
        const div = document.createElement('div');
        div.className = 'context-menu-item' + (mi.danger ? ' danger' : '');
        div.textContent = mi.label;
        div.addEventListener('click', () => {
            mi.action();
            hideContextMenu();
        });
        contextMenuEl.appendChild(div);
    });

    const rect = treeEl.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY;
    contextMenuEl.classList.remove('hidden');

    const menuRect = contextMenuEl.getBoundingClientRect();
    if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 8;
    if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 8;

    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';
}

function hideContextMenu() {
    contextMenuEl.classList.add('hidden');
    contextTarget = null;
}

document.addEventListener('click', (e) => {
    if (!contextMenuEl.contains(e.target)) hideContextMenu();
});

// 打开文件夹
async function openFolder() {
    try {
        const res = await fetch('/api/select-folder', { method: 'POST' });
        const data = await res.json();
        if (data.canceled) return;
        if (data.error) {
            showToast(data.error);
            return;
        }
        currentPath = null;
        currentFileEl.textContent = '未选择文件';
        previewEl.innerHTML = '<div class="placeholder">请从左侧选择一个 Markdown 文件</div>';
        await loadCurrentDir();
        await loadTree();
        showToast('已切换到：' + data.path);
    } catch (err) {
        showToast('打开文件夹失败：' + err.message);
    }
}

// 新建文件/文件夹
async function createItem(type, targetPath, isDir) {
    const parent = isDir ? targetPath : (targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '');
    const defaultName = type === 'dir' ? '新建文件夹' : '新建文档.md';

    try {
        const res = await fetch('/api/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, parent, name: defaultName })
        });
        const data = await res.json();
        if (data.error) {
            showToast(data.error);
            return;
        }
        await loadTree();
        // 自动进入重命名
        const newNode = treeEl.querySelector('.node[data-path="' + CSS.escape(data.path) + '"]');
        if (newNode) startRename(data, newNode);
    } catch (err) {
        showToast('创建失败：' + err.message);
    }
}

// 重命名
function startRename(item, node) {
    if (renamingNode) return;
    renamingNode = node;

    const label = node.querySelector('.label');
    const oldName = item.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'rename-input';

    label.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
        const newName = input.value.trim();
        if (newName && newName !== oldName) {
            try {
                const res = await fetch('/api/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ old_path: item.path, new_name: newName })
                });
                const data = await res.json();
                if (data.error) {
                    showToast(data.error);
                    input.replaceWith(label);
                } else {
                    if (currentPath === item.path) {
                        currentPath = data.path;
                        currentFileEl.textContent = data.path;
                    }
                    await loadTree();
                }
            } catch (err) {
                showToast('重命名失败：' + err.message);
                input.replaceWith(label);
            }
        } else {
            input.replaceWith(label);
        }
        renamingNode = null;
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.replaceWith(label);
            renamingNode = null;
        }
    });
}

// 删除
async function deleteItem(item) {
    if (!confirm('确定要删除 "' + item.name + '" 吗？')) return;
    try {
        const res = await fetch('/api/delete?path=' + encodeURIComponent(item.path), { method: 'DELETE' });
        const data = await res.json();
        if (data.error) {
            showToast(data.error);
            return;
        }
        if (currentPath === item.path || (currentPath && currentPath.startsWith(item.path + '/'))) {
            currentPath = null;
            currentFileEl.textContent = '未选择文件';
            previewEl.innerHTML = '<div class="placeholder">请从左侧选择一个 Markdown 文件</div>';
        }
        await loadTree();
    } catch (err) {
        showToast('删除失败：' + err.message);
    }
}

// Toast 提示
function showToast(message, duration = 2500) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// WebSocket
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws');

    ws.onopen = () => {
        statusEl.textContent = '已连接';
        statusEl.className = 'status connected';
        ws.send(JSON.stringify({ action: 'ping' }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.action === 'modified' && msg.path === currentPath) {
            loadFile(currentPath);
        } else if (msg.action === 'created' || msg.action === 'deleted' || msg.action === 'dir_changed') {
            loadTree();
            if (msg.action === 'dir_changed') {
                loadCurrentDir();
                currentPath = null;
                currentFileEl.textContent = '未选择文件';
                previewEl.innerHTML = '<div class="placeholder">请从左侧选择一个 Markdown 文件</div>';
            }
        }
    };

    ws.onclose = () => {
        statusEl.textContent = '未连接';
        statusEl.className = 'status disconnected';
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
        statusEl.textContent = '连接错误';
        statusEl.className = 'status disconnected';
    };
}

// 事件绑定
document.getElementById('btn-open-folder').addEventListener('click', openFolder);
document.getElementById('btn-refresh').addEventListener('click', loadTree);

// 启动
initSidebarState();
loadCurrentDir();
loadTree();
connectWebSocket();
