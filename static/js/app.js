let currentPath = null;
let ws = null;

const treeEl = document.getElementById('tree');
const previewEl = document.getElementById('preview');
const currentFileEl = document.getElementById('current-file');
const statusEl = document.getElementById('status');

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

            node.addEventListener('click', () => {
                const expanded = children.classList.toggle('expanded');
                icon.textContent = expanded ? '▼' : '▶';
            });
        } else {
            icon.textContent = '📄';
            node.append(icon, label);
            li.appendChild(node);
            node.addEventListener('click', () => loadFile(item.path));
        }
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
        // 默认展开第一层
        ul.querySelectorAll('.children').forEach(c => {
            c.classList.add('expanded');
            c.previousElementSibling.querySelector('.icon').textContent = '▼';
        });
        treeEl.appendChild(ul);
    } catch (err) {
        treeEl.innerHTML = '<div class="empty">加载失败：' + err.message + '</div>';
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

        // 高亮代码块
        if (typeof hljs !== 'undefined') {
            previewEl.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        // 激活当前文件
        treeEl.querySelectorAll('.node').forEach(n => n.classList.remove('active'));
        const active = treeEl.querySelector('.node[data-path="' + CSS.escape(path) + '"]');
        if (active) active.classList.add('active');
    } catch (err) {
        previewEl.innerHTML = '<div class="placeholder">加载失败：' + err.message + '</div>';
    }
}

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
        } else if (msg.action === 'created' || msg.action === 'deleted') {
            loadTree();
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

// 启动
loadTree();
connectWebSocket();
