# MD Watcher

一个轻量级的本地 Markdown 实时预览工具，基于 Flask + WebSocket 实现。

## 功能

- 左侧目录树浏览 Markdown 文件
- 右侧实时渲染预览
- 文件修改后浏览器自动刷新
- 代码高亮、表格、列表、引用等常用语法支持

## 启动方式

### Windows

双击或命令行执行：

```bat
start.bat
```

### macOS / Linux

```bash
./start.sh
```

然后浏览器访问 `http://127.0.0.1:5000`。

## 指定预览目录

默认预览当前目录下的 `notes` 文件夹。可以通过环境变量指定：

```bat
set MD_WATCHER_DIR=D:\\我的文档
python app.py
```

## 项目结构

```
.
├── .python/              # 独立版 Python 3.12（已配置好）
├── app.py                # Flask 后端
├── notes/                # 默认 Markdown 文件目录
├── requirements.txt      # Python 依赖
├── start.bat / start.sh  # 启动脚本
├── static/               # 前端样式和脚本
└── templates/            # HTML 模板
```

## 后续扩展

- 双栏编辑 + 实时预览
- 全文搜索
- 双向链接与知识图谱
- 用户系统与服务端部署
