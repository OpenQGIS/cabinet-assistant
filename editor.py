#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cabinet Assistant — 珍奇柜空间制图与遥感标注工作台
专为 Cabinet 设计的本地轻量可视化标注与同步系统：
- 左侧分类树与作品列表 (区分草稿 / 已完成状态)
- 中间高清大图深览 (OpenSeadragon / 1:1 像素巡礼)
- 右侧空间测绘事实表单 (标题、地点、审图号、比例尺、机构、导语、标签)
- 原位读写 pic/**/*.md，一键编译同步 Cabinet 全站！
"""

import sys
import os
import re
import json
import math
import mimetypes
import argparse
import threading
import subprocess
import webbrowser
import urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image

# 解决 Windows 控制台编码
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

Image.MAX_IMAGE_PIXELS = None

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CACHE_DIR = BASE_DIR / ".cache"
CONFIG_FILE = BASE_DIR / "config.json"
PORT_DEFAULT = 8099

IMAGE_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".jfif", ".png", ".webp"}

_config_lock = threading.Lock()
_config_cache = None


def get_config():
    global _config_cache
    with _config_lock:
        if _config_cache is None:
            cfg = {"cabinet_path": "D:/website/Cabinet"}
            if CONFIG_FILE.exists():
                try:
                    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                        cfg.update(json.load(f))
                except Exception:
                    pass
            _config_cache = cfg
        return dict(_config_cache)


def save_config(cfg):
    global _config_cache
    with _config_lock:
        _config_cache = dict(cfg)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_cabinet_dir():
    cfg = get_config()
    p = cfg.get("cabinet_path", "D:/website/Cabinet")
    return Path(p).resolve()


def get_pic_dir():
    return get_cabinet_dir() / "pic"


def parse_frontmatter(content: str):
    """解析 YAML Frontmatter 与 Markdown 正文"""
    meta = {}
    body = ""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
    if not match:
        return meta, content.strip()

    yaml_block, body = match.groups()
    current_key = None
    is_list = False

    for line in yaml_block.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue

        list_match = re.match(r"^\s*-\s+(.*)$", line)
        if list_match and current_key:
            val = list_match.group(1).strip().strip("'\"")
            if not is_list:
                meta[current_key] = []
                is_list = True
            meta[current_key].append(val)
            continue

        kv_match = re.match(r"^([a-zA-Z0-9_-]+):\s*(.*)$", line)
        if kv_match:
            current_key = kv_match.group(1).strip()
            val = kv_match.group(2).strip()
            is_list = False

            if val == "":
                meta[current_key] = []
                is_list = True
            elif val.startswith("[") and val.endswith("]"):
                items = [x.strip().strip("'\"") for x in val[1:-1].split(",") if x.strip()]
                meta[current_key] = items
            elif val.lower() in ("true", "yes"):
                meta[current_key] = True
            elif val.lower() in ("false", "no"):
                meta[current_key] = False
            else:
                meta[current_key] = val.strip("'\"")

    return meta, body.strip()


def serialize_frontmatter(meta: dict, body: str) -> str:
    """将字典与正文序列化为标准 YAML Frontmatter Markdown"""
    lines = ["---"]
    order = [
        "id", "title", "category", "categoryName", "subCategory",
        "region", "source", "scale", "reviewNumber",
        "tags", "status", "download"
    ]
    written = set()

    def write_key_val(k, v):
        if isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, list):
            lines.append(f"{k}:")
            for it in v:
                lines.append(f"  - {it}")
        elif v is not None:
            lines.append(f"{k}: {v}")

    for k in order:
        if k in meta:
            write_key_val(k, meta[k])
            written.add(k)

    for k, v in meta.items():
        if k not in written:
            write_key_val(k, v)

    lines.append("---")
    lines.append("")
    if body:
        lines.append(body.strip())
        lines.append("")
    return "\n".join(lines)


def choose_directory(initial_dir=""):
    """调起系统原生目录选择窗口 (Tkinter -> Windows PowerShell -> macOS osascript)"""
    initial = os.path.abspath(initial_dir) if initial_dir and os.path.exists(initial_dir) else None

    # 方案 1: Tkinter (Windows / macOS / Linux)
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        root.focus_force()
        folder = filedialog.askdirectory(initialdir=initial, title="选择 Cabinet 项目根目录 (包含 pic 文件夹)")
        root.destroy()
        if folder:
            return os.path.normpath(folder)
    except Exception:
        pass

    # 方案 2: Windows PowerShell
    if sys.platform.startswith("win"):
        try:
            ps_script = (
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; "
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$f.Description = '选择 Cabinet 项目根目录 (包含 pic 文件夹)'; "
                "$f.ShowNewFolderButton = $false; "
            )
            if initial:
                ps_script += f"$f.SelectedPath = '{initial}'; "
            ps_script += "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script],
                                 capture_output=True, text=True, timeout=60)
            chosen = res.stdout.strip()
            if chosen:
                return os.path.normpath(chosen)
        except Exception:
            pass

    return ""


class CabinetAssistantHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/":
            self.serve_file(STATIC_DIR / "index.html" if (STATIC_DIR / "index.html").exists() else BASE_DIR / "index.html")
        elif path == "/gallery" or path == "/gallery/":
            self.serve_file(get_cabinet_dir() / "index.html")
        elif path.startswith("/gallery/"):
            rel = urllib.parse.unquote(path[len("/gallery/"):])
            self.serve_file(get_cabinet_dir() / rel)
        elif path.startswith("/static/"):
            rel = urllib.parse.unquote(path[len("/static/"):])
            self.serve_file(STATIC_DIR / rel)
        elif path == "/api/config":
            self.send_json(get_config())
        elif path == "/api/items":
            self.handle_api_items()
        elif path == "/api/image":
            self.handle_api_image(params)
        elif path == "/api/thumb":
            self.handle_api_thumb(params)
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}

        if path == "/api/config":
            save_config(body)
            self.send_json({"ok": True, "config": get_config()})
        elif path == "/api/pick_dir":
            self.handle_api_pick_dir(body)
        elif path == "/api/save":
            self.handle_api_save(body)
        elif path == "/api/sync":
            self.handle_api_sync()
        elif path == "/api/open-system":
            self.handle_api_open_system(body)
        else:
            self.send_error(404, "Not Found")

    def handle_api_pick_dir(self, body):
        initial = body.get("initial_dir", "").strip() or str(get_cabinet_dir())
        folder = choose_directory(initial)
        if not folder:
            self.send_json({"ok": True, "cancelled": True, "path": ""})
            return

        if os.path.basename(folder).lower() == "pic" and os.path.isdir(folder):
            parent = os.path.dirname(folder)
            if parent:
                folder = parent

        save_config({"cabinet_path": folder})
        has_pic = (Path(folder) / "pic").is_dir()
        self.send_json({
            "ok": True,
            "cancelled": False,
            "path": folder,
            "has_pic": has_pic
        })

    def serve_file(self, file_path: Path):
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, f"File not found: {file_path.name}")
            return
        mime, _ = mimetypes.guess_type(str(file_path))
        mime = mime or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e))

    def handle_api_items(self):
        pic_dir = get_pic_dir()
        if not pic_dir.exists():
            self.send_json({"ok": False, "error": f"pic 目录不存在: {pic_dir}", "items": []})
            return

        items = []
        for root, dirs, files in os.walk(pic_dir):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in IMAGE_EXTS:
                    full_img_path = Path(root) / file
                    rel_img_path = full_img_path.relative_to(pic_dir).as_posix()
                    stem = full_img_path.stem

                    md_path = full_img_path.with_suffix(".md")
                    has_md = md_path.exists()

                    meta = {}
                    body = ""
                    if has_md:
                        try:
                            with open(md_path, "r", encoding="utf-8") as f:
                                meta, body = parse_frontmatter(f.read())
                        except Exception:
                            pass

                    # 尝试从同级文件夹推断默认分类
                    folder_parts = Path(rel_img_path).parts[:-1]
                    default_sub = " · ".join(folder_parts) if folder_parts else "未分类"

                    # 基础信息
                    title = meta.get("title", stem)
                    item_id = meta.get("id", re.sub(r"[^a-zA-Z0-9_-]", "_", stem.lower()))
                    status = meta.get("status", "draft" if has_md else "unannotated")
                    category = meta.get("category", "gis")
                    sub_category = meta.get("subCategory", default_sub)
                    region = meta.get("region", "")
                    source = meta.get("source", "")
                    scale = meta.get("scale", "")
                    review_number = meta.get("reviewNumber", "")
                    tags = meta.get("tags", [])
                    download = meta.get("download", True)

                    items.append({
                        "id": item_id,
                        "title": title,
                        "filename": file,
                        "rel_path": rel_img_path,
                        "folder": "/".join(folder_parts) if folder_parts else "root",
                        "has_md": has_md,
                        "status": status,
                        "category": category,
                        "subCategory": sub_category,
                        "region": region,
                        "source": source,
                        "scale": scale,
                        "reviewNumber": review_number,
                        "tags": tags,
                        "download": download,
                        "description": body or meta.get("description", ""),
                        "file_size": full_img_path.stat().st_size
                    })

        # 按文件夹与名称排序
        items.sort(key=lambda x: (x["folder"], x["title"]))
        self.send_json({"ok": True, "cabinet_path": str(get_cabinet_dir()), "items": items})

    def handle_api_image(self, params):
        rel = params.get("path", [""])[0]
        if not rel:
            self.send_error(400, "Missing path param")
            return
        full_path = (get_pic_dir() / rel).resolve()
        self.serve_file(full_path)

    def handle_api_thumb(self, params):
        rel = params.get("path", [""])[0]
        if not rel:
            self.send_error(400, "Missing path param")
            return
        full_path = (get_pic_dir() / rel).resolve()
        if not full_path.exists():
            self.send_error(404, "Image not found")
            return

        # 缓存极速缩略图
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_key = f"{full_path.stem}_{full_path.stat().st_mtime_ns}.webp"
        cache_file = CACHE_DIR / cache_key

        if not cache_file.exists():
            try:
                with Image.open(full_path) as im:
                    im = im.convert("RGB")
                    im.thumbnail((480, 480), Image.Resampling.LANCZOS)
                    im.save(cache_file, "WEBP", quality=80)
            except Exception as e:
                self.send_error(500, f"Thumb generate error: {e}")
                return

        self.serve_file(cache_file)

    def handle_api_save(self, body):
        rel_path = body.get("rel_path")
        if not rel_path:
            self.send_json({"ok": False, "error": "缺少 rel_path 参数"}, 400)
            return

        img_path = get_pic_dir() / rel_path
        md_path = img_path.with_suffix(".md")

        meta = {
            "id": body.get("id"),
            "title": body.get("title"),
            "category": body.get("category", "gis"),
            "categoryName": body.get("categoryName", "网上GIS图片分享"),
            "subCategory": body.get("subCategory", ""),
            "region": body.get("region", ""),
            "source": body.get("source", ""),
            "scale": body.get("scale", ""),
            "reviewNumber": body.get("reviewNumber", ""),
            "tags": body.get("tags", []),
            "status": body.get("status", "done"),
            "download": body.get("download", True)
        }
        desc = body.get("description", "")
        content = serialize_frontmatter(meta, desc)

        try:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(content)
            self.send_json({"ok": True, "msg": f"已成功保存: {md_path.name}", "md_content": content})
        except Exception as e:
            self.send_json({"ok": False, "error": f"保存失败: {e}"}, 500)

    def handle_api_sync(self):
        cabinet_dir = get_cabinet_dir()
        script_path = cabinet_dir / "tools" / "build_cabinet.py"
        if not script_path.exists():
            self.send_json({"ok": False, "error": f"未找到构建脚本: {script_path}"}, 404)
            return

        try:
            res = subprocess.run(
                [sys.executable, str(script_path)],
                cwd=str(cabinet_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60
            )
            output = res.stdout + ("\n" + res.stderr if res.stderr else "")
            self.send_json({
                "ok": res.returncode == 0,
                "returncode": res.returncode,
                "output": output
            })
        except Exception as e:
            self.send_json({"ok": False, "error": f"同步执行异常: {e}"}, 500)

    def handle_api_open_system(self, body):
        custom_path = body.get("path", "").strip()
        rel_path = body.get("rel_path", "").strip()
        if custom_path:
            target = Path(custom_path).resolve()
        else:
            target = (get_pic_dir() / rel_path).resolve() if rel_path else get_pic_dir().resolve()
        
        if not target.exists():
            parent = target.parent
            if parent.exists():
                target = parent
            else:
                self.send_json({"ok": False, "error": f"路径不存在: {target}"}, 404)
                return

        try:
            if sys.platform.startswith("win"):
                target_str = str(target).replace("/", "\\")
                if target.is_file():
                    # Windows 原生命令高亮选中文件
                    subprocess.Popen(f'explorer.exe /select,"{target_str}"', shell=True)
                else:
                    os.startfile(target_str)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-R" if target.is_file() else "", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target.parent if target.is_file() else target)])
            self.send_json({"ok": True, "path": str(target)})
        except Exception as e:
            self.send_json({"ok": False, "error": f"打开失败: {e}"}, 500)


def main():
    parser = argparse.ArgumentParser(description="Cabinet Assistant Web Editor")
    parser.add_argument("--port", type=int, default=PORT_DEFAULT, help="Server port")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser")
    args = parser.parse_args()

    port = args.port
    server = ThreadingHTTPServer(("127.0.0.1", port), CabinetAssistantHandler)
    url = f"http://127.0.0.1:{port}"

    print("=" * 60)
    print("🚀 Cabinet Assistant · 珍奇柜标注与同步工作台已启动")
    print(f"🌐 本地访问地址: {url}")
    print(f"📁 目标画廊路径: {get_cabinet_dir()}")
    print("=" * 60)

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Cabinet Assistant 已停止运行。")
        server.server_close()


if __name__ == "__main__":
    main()
