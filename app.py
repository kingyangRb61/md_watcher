import os
import json
import time
import subprocess
import threading
from pathlib import Path
from urllib.parse import unquote

from flask import Flask, render_template, request, jsonify
from flask_sock import Sock
from markdown import markdown
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

app = Flask(__name__)
sock = Sock(app)

# 工作目录：启动参数或默认当前目录下的 notes 文件夹
BASE_DIR = Path(os.environ.get("MD_WATCHER_DIR", Path(__file__).parent / "notes")).resolve()
BASE_DIR.mkdir(parents=True, exist_ok=True)

# WebSocket 连接池
clients = set()
clients_lock = threading.Lock()

# 文件监控
observer = None
watcher_lock = threading.Lock()


def set_base_dir(new_dir: Path):
    """切换工作目录并重启文件监控。"""
    global BASE_DIR, observer
    new_dir = new_dir.resolve()
    if not new_dir.is_dir():
        raise ValueError("not a directory")

    with watcher_lock:
        if observer is not None:
            observer.stop()
            observer.join()
        BASE_DIR = new_dir
        observer = Observer()
        observer.schedule(WatcherHandler(), str(BASE_DIR), recursive=True)
        observer.start()

    broadcast({"action": "dir_changed", "path": str(BASE_DIR)})


def is_safe_path(path: str) -> bool:
    """确保请求的路径不越界。"""
    try:
        target = BASE_DIR / path
        target.resolve().relative_to(BASE_DIR)
        return True
    except ValueError:
        return False


def build_tree(path: Path) -> list:
    """递归构建目录树，包含 Markdown 文件和所有目录（空目录也显示）。"""
    items = []
    try:
        for entry in sorted(path.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            rel = entry.relative_to(BASE_DIR).as_posix()
            if entry.is_dir():
                children = build_tree(entry)
                items.append({"name": entry.name, "path": rel, "type": "dir", "children": children})
            elif entry.suffix.lower() in (".md", ".markdown"):
                items.append({"name": entry.name, "path": rel, "type": "file"})
    except PermissionError:
        pass
    return items


@app.route("/")
def index():
    return render_template("index.html", base_dir=str(BASE_DIR))


@app.route("/api/current-dir")
def api_current_dir():
    return jsonify({"path": str(BASE_DIR)})


@app.route("/api/tree")
def api_tree():
    return jsonify(build_tree(BASE_DIR))


@app.route("/api/file")
def api_file():
    rel_path = request.args.get("path", "")
    rel_path = unquote(rel_path).lstrip("/")
    if not is_safe_path(rel_path):
        return jsonify({"error": "invalid path"}), 400

    target = BASE_DIR / rel_path
    if not target.is_file():
        return jsonify({"error": "file not found"}), 404

    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = target.read_text(encoding="gbk", errors="ignore")

    html = markdown(
        content,
        extensions=[
            "fenced_code",
            "tables",
            "toc",
            "nl2br",
        ],
    )
    return jsonify({"path": rel_path, "content": content, "html": html})


@app.route("/api/select-folder", methods=["POST"])
def api_select_folder():
    """弹出系统文件夹选择对话框，返回用户选择的目录。"""
    if os.name != "nt":
        return jsonify({"error": "系统对话框仅在 Windows 上可用"}), 400

    ps_script = (
        'Add-Type -AssemblyName System.Windows.Forms; '
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
        '$d.Description = "选择 Markdown 工作目录"; '
        '$d.ShowNewFolderButton = $true; '
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { '
        '    Write-Host $d.SelectedPath '
        '}'
    )

    try:
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, timeout=60, encoding="utf-8"
        )
    except Exception as e:
        return jsonify({"error": f"无法启动系统对话框: {e}"}), 500

    selected = result.stdout.strip()
    if not selected:
        return jsonify({"canceled": True})

    try:
        set_base_dir(Path(selected))
        return jsonify({"path": str(BASE_DIR)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/create", methods=["POST"])
def api_create():
    """新建文件或文件夹。"""
    data = request.get_json() or {}
    item_type = data.get("type")
    parent = data.get("parent", "")
    name = data.get("name", "")

    if item_type not in ("file", "dir") or not name:
        return jsonify({"error": "invalid params"}), 400

    parent = unquote(parent).lstrip("/")
    if parent and not is_safe_path(parent):
        return jsonify({"error": "invalid parent path"}), 400

    parent_path = BASE_DIR / parent if parent else BASE_DIR
    if not parent_path.is_dir():
        return jsonify({"error": "parent not found"}), 404

    target = parent_path / name
    if not is_safe_path(target.relative_to(BASE_DIR).as_posix()):
        return jsonify({"error": "invalid name"}), 400

    # 自动处理重名
    stem = target.stem
    suffix = target.suffix
    counter = 1
    original = target
    while target.exists():
        target = original.with_name(f"{stem} ({counter}){suffix}")
        counter += 1

    try:
        if item_type == "dir":
            target.mkdir(parents=True, exist_ok=False)
        else:
            target.touch(exist_ok=False)
        rel = target.relative_to(BASE_DIR).as_posix()
        return jsonify({"path": rel, "name": target.name, "type": item_type})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/rename", methods=["POST"])
def api_rename():
    """重命名文件或文件夹。"""
    data = request.get_json() or {}
    old_path = data.get("old_path", "")
    new_name = data.get("new_name", "")

    if not old_path or not new_name:
        return jsonify({"error": "invalid params"}), 400

    old_path = unquote(old_path).lstrip("/")
    if not is_safe_path(old_path):
        return jsonify({"error": "invalid old path"}), 400

    old_target = BASE_DIR / old_path
    if not old_target.exists():
        return jsonify({"error": "not found"}), 404

    new_target = old_target.parent / new_name
    if not is_safe_path(new_target.relative_to(BASE_DIR).as_posix()):
        return jsonify({"error": "invalid new name"}), 400

    if new_target.exists():
        return jsonify({"error": "target already exists"}), 409

    try:
        old_target.rename(new_target)
        new_rel = new_target.relative_to(BASE_DIR).as_posix()
        return jsonify({"path": new_rel, "name": new_target.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/delete", methods=["DELETE"])
def api_delete():
    """删除文件或文件夹。"""
    rel_path = request.args.get("path", "")
    rel_path = unquote(rel_path).lstrip("/")
    if not rel_path or not is_safe_path(rel_path):
        return jsonify({"error": "invalid path"}), 400

    target = BASE_DIR / rel_path
    if not target.exists():
        return jsonify({"error": "not found"}), 404

    try:
        import shutil
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@sock.route("/ws")
def websocket(ws):
    with clients_lock:
        clients.add(ws)
    try:
        while True:
            message = ws.receive(timeout=30)
            if message is None:
                continue
            data = json.loads(message)
            if data.get("action") == "ping":
                ws.send(json.dumps({"action": "pong"}))
    finally:
        with clients_lock:
            clients.discard(ws)


def broadcast(message: dict):
    text = json.dumps(message)
    with clients_lock:
        dead = set()
        for ws in clients:
            try:
                ws.send(text)
            except Exception:
                dead.add(ws)
        clients.difference_update(dead)


class WatcherHandler(FileSystemEventHandler):
    def _rel(self, src_path):
        try:
            return Path(src_path).relative_to(BASE_DIR).as_posix()
        except ValueError:
            return None

    def _should_notify(self, event):
        # 目录变化始终通知；文件只通知 Markdown
        if event.is_directory:
            return True
        return Path(event.src_path).suffix.lower() in (".md", ".markdown")

    def on_modified(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).suffix.lower() not in (".md", ".markdown"):
            return
        rel = self._rel(event.src_path)
        if rel:
            broadcast({"action": "modified", "path": rel})

    def on_created(self, event):
        if not self._should_notify(event):
            return
        rel = self._rel(event.src_path)
        if rel:
            broadcast({"action": "created", "path": rel, "is_directory": event.is_directory})

    def on_deleted(self, event):
        if not self._should_notify(event):
            return
        rel = self._rel(event.src_path)
        if rel:
            broadcast({"action": "deleted", "path": rel, "is_directory": event.is_directory})

    def on_moved(self, event):
        self.on_deleted(type("E", (), {"src_path": event.src_path, "is_directory": event.is_directory})())
        self.on_created(type("E", (), {"src_path": event.dest_path, "is_directory": event.is_directory})())


def start_watcher():
    global observer
    observer = Observer()
    observer.schedule(WatcherHandler(), str(BASE_DIR), recursive=True)
    observer.start()
    return observer


if __name__ == "__main__":
    observer = start_watcher()
    try:
        app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False, threaded=True)
    finally:
        observer.stop()
        observer.join()
