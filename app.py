import os
import json
import time
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

# 最近修改的文件（用于 WebSocket 推送）
last_modified_file = None


def is_safe_path(path: str) -> bool:
    """确保请求的路径不越界。"""
    try:
        target = BASE_DIR / path
        target.resolve().relative_to(BASE_DIR)
        return True
    except ValueError:
        return False


def build_tree(path: Path) -> list:
    """递归构建目录树，仅包含 Markdown 文件和目录。"""
    items = []
    try:
        for entry in sorted(path.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            rel = entry.relative_to(BASE_DIR).as_posix()
            if entry.is_dir():
                children = build_tree(entry)
                if children:
                    items.append({"name": entry.name, "path": rel, "type": "dir", "children": children})
            elif entry.suffix.lower() in (".md", ".markdown"):
                items.append({"name": entry.name, "path": rel, "type": "file"})
    except PermissionError:
        pass
    return items


@app.route("/")
def index():
    return render_template("index.html", base_dir=str(BASE_DIR))


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
    def on_modified(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).suffix.lower() not in (".md", ".markdown"):
            return
        global last_modified_file
        rel = Path(event.src_path).relative_to(BASE_DIR).as_posix()
        last_modified_file = rel
        broadcast({"action": "modified", "path": rel})

    def on_created(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).suffix.lower() not in (".md", ".markdown"):
            return
        rel = Path(event.src_path).relative_to(BASE_DIR).as_posix()
        broadcast({"action": "created", "path": rel})

    def on_deleted(self, event):
        if event.is_directory:
            return
        if Path(event.src_path).suffix.lower() not in (".md", ".markdown"):
            return
        rel = Path(event.src_path).relative_to(BASE_DIR).as_posix()
        broadcast({"action": "deleted", "path": rel})

    def on_moved(self, event):
        self.on_deleted(type("E", (), {"src_path": event.src_path, "is_directory": False})())
        self.on_created(type("E", (), {"src_path": event.dest_path, "is_directory": False})())


def start_watcher():
    observer = Observer()
    observer.schedule(WatcherHandler(), str(BASE_DIR), recursive=True)
    observer.start()
    return observer


if __name__ == "__main__":
    observer = start_watcher()
    try:
        # 本地开发使用 5000 端口，关闭 debug 避免 reloader 导致 watcher 重复
        app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
    finally:
        observer.stop()
        observer.join()
