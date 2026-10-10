# Cabinet Assistant · 珍奇柜空间制图与遥感标注工作台

### A Curated Spatial Cartography & Remote Sensing Metadata Studio

> 为 **[Cabinet · 珍奇柜](../../website/Cabinet)** 空间测绘画廊量身定制的轻量级可视化标注与同步工作台。

---

## 1. 核心定位与设计理念

在构建面向全球卫星遥感地貌与国家权威标准地图的交互式画廊时，高清测绘图像动辄几千万像素，纯手写 Markdown 存在**看图割裂、YAML易错、标签不规范**等痛点。

**Cabinet Assistant** 采用 Anti-AI Slop 极简工业质感设计，打通了“大图细节巡礼 ➔ 空间事实录入 ➔ 伴生 MD 存储 ➔ 一键全站编译”的全闭环链路：

* **左侧：多级专题资源树**：自动递归扫描 `pic/` 目录，按文件夹分组呈现，直观筛选 `已完成 (done)`、`草稿 (draft)` 与 `未标注` 状态；
* **中间：OpenSeadragon 视口**：毫秒级加载超大幅面测绘原图，支持 1:1 物理像素点对点显示、长宽比与原始尺寸实时读取；
* **右侧：空间测绘结构化表单**：专为 GIS 与遥感定制的客观事实输入卡片（标题、位置、审图号、比例尺、机构、导语、标签），自动双向同步 Markdown 源码预览；
* **极速联动**：快捷键 `Ctrl+S` 即时落盘写回 `pic/对应目录/xxx.md`，顶部一键触发 `build_cabinet.py` 瞬间完成画廊编译上架！

---

## 2. 目录结构

```text
cabinet-assistant/
├── static/
│   ├── vendor/
│   │   └── openseadragon.min.js   # OpenSeadragon 视口引擎
│   ├── app.js                     # 核心前端交互与数据流逻辑
│   └── style.css                  # 极简暗调工作台样式系统
├── config.json                    # Cabinet 仓库路径配置 (如 D:/website/Cabinet)
├── editor.py                      # 轻量 Python 本地服务 (内置 HTTP Server, 无需复杂依赖)
├── editor.bat                     # Windows 一键启动脚本 (自动检查 Pillow 并打开浏览器)
├── .gitignore
└── README.md
```

---

## 3. 快速启动与使用

### 方式 A：Windows 一键运行
直接双击运行根目录下的：
```text
editor.bat
```
系统将自动检测 `Pillow` 依赖，启动本地服务并在默认浏览器自动打开：
```text
http://127.0.0.1:8099
```

### 方式 B：命令行运行
```bash
python editor.py [--port 8099] [--no-browser]
```

---

## 4. 核心工作流规范

1. **收集新图**：将下载的遥感图或地图母版放入 `Cabinet/pic/` 的任意分类文件夹下；
2. **打开 Assistant**：左侧列表会自动刷新并高亮显示带有 `NEW` 标记的待标注作品；
3. **巡礼与标注**：
   - 滚轮放大至 1:1 查看细节，比对地名与要素；
   - 填入标题、地理区域、审图号、比例尺等空间事实；
   - 状态保留为 `draft`（草稿暂不上线）或拨动至 `done`（完成待上架）；
4. **保存与上线**：
   - 按 `Ctrl+S` 保存伴生 `.md`；
   - 点击右上角 **「⚡ 一键编译同步画廊」**，后台自动完成缩略图压制、高清 WebP 转换与 `manifest.json` 打包！

---

## 5. 开源协议

本项目遵循 [MIT License](LICENSE) 协议开源。
