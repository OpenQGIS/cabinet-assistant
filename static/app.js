/**
 * Cabinet Assistant · 核心前端控制器 (app.js)
 * 支持双模式：
 * 1. 本地服务模式 (http://127.0.0.1:8099) - Python 后端免授权直连
 * 2. GitHub Pages 模式 (openqgis.github.io) - 基于 File System Access API 原位授权读写本地文件夹
 */

(function () {
  'use strict';

  let appMode = 'server'; // 'server' | 'fs'
  let fsRootHandle = null;
  let fsPicHandle = null;
  let fsThumbsHandle = null;

  let currentItems = [];
  let activeItem = null;
  let activeFilter = 'all';
  let osdViewer = null;
  let currentTags = [];

  const IMAGE_EXTS = new Set(['tif', 'tiff', 'jpg', 'jpeg', 'jfif', 'png', 'webp']);

  // DOM Elements
  const elCabinetPath = document.getElementById('cabinetPathDisplay');
  const elFileList = document.getElementById('fileList');
  const elSearchInput = document.getElementById('searchInput');
  const elViewerEmpty = document.getElementById('viewerEmpty');
  const elConnectOverlay = document.getElementById('connectOverlay');
  const elBtnConnectFolder = document.getElementById('btnConnectFolder');
  const elBtnConnectFolderBig = document.getElementById('btnConnectFolderBig');
  const elViewerStatusbar = document.getElementById('viewerStatusbar');
  
  // Status counts
  const elCountAll = document.getElementById('countAll');
  const elCountPublished = document.getElementById('countPublished');
  const elCountModified = document.getElementById('countModified');
  const elCountDone = document.getElementById('countDone');
  const elCountDraft = document.getElementById('countDraft');
  const elCountNew = document.getElementById('countNew');

  // Form Inputs
  const elFormStatusBadge = document.getElementById('formStatusBadge');
  const elInputTitle = document.getElementById('inputTitle');
  const elInputId = document.getElementById('inputId');
  const elSubCategoriesList = document.getElementById('subCategoriesList');
  const elInputSubCategoryNew = document.getElementById('inputSubCategoryNew');
  const elInputRegion = document.getElementById('inputRegion');
  const elInputReviewNumber = document.getElementById('inputReviewNumber');
  const elInputScale = document.getElementById('inputScale');
  const elInputSource = document.getElementById('inputSource');
  const elInputDescription = document.getElementById('inputDescription');
  const elInputDownload = document.getElementById('inputDownload');
  const elTagsList = document.getElementById('tagsList');
  const elInputTagNew = document.getElementById('inputTagNew');
  const elRawMarkdown = document.getElementById('rawMarkdownPreview');

  let currentSubCategories = [];

  // Status Bar
  const elInfoRes = document.getElementById('infoResolution');
  const elInfoAspect = document.getElementById('infoAspect');
  const elInfoFilesize = document.getElementById('infoFilesize');
  const elInfoZoom = document.getElementById('infoZoom');

  // Modals
  const elSettingsModal = document.getElementById('settingsModal');
  const elSyncModal = document.getElementById('syncModal');
  const elSyncConsole = document.getElementById('syncConsoleLog');

  // -------------------------------------------------------------
  // IndexedDB 存储本地文件夹句柄 (供 Pages 模式记忆授权)
  // -------------------------------------------------------------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('cabinet-assistant-db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((res) => {
        const tx = db.transaction('handles').objectStore('handles').get(key);
        tx.onsuccess = () => res(tx.result);
        tx.onerror = () => res(undefined);
      });
    } catch (_) { return undefined; }
  }

  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      return await new Promise((res) => {
        const tx = db.transaction('handles', 'readwrite').objectStore('handles').put(val, key);
        tx.onsuccess = () => res();
        tx.onerror = () => res();
      });
    } catch (_) { }
  }

  // -------------------------------------------------------------
  // 1. 初始化
  // -------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    bootstrapApp();
  });

  function initEvents() {
    // 搜索与过滤器
    elSearchInput.addEventListener('input', renderFileList);
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        renderFileList();
      });
    });

    // 表单 Tabs 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        if (tab === 'metaTab') {
          document.getElementById('metaTab').hidden = false;
          document.getElementById('rawTab').hidden = true;
        } else {
          document.getElementById('metaTab').hidden = true;
          document.getElementById('rawTab').hidden = false;
          updateRawMarkdownPreview();
        }
      });
    });

    const btnBackToForm = document.getElementById('btnBackToForm');
    if (btnBackToForm) {
      btnBackToForm.addEventListener('click', () => {
        const metaBtn = document.querySelector('.tab-btn[data-tab="metaTab"]');
        if (metaBtn) metaBtn.click();
      });
    }

    const btnCopyRawMd = document.getElementById('btnCopyRawMd');
    if (btnCopyRawMd) {
      btnCopyRawMd.addEventListener('click', async () => {
        const text = document.getElementById('rawMarkdownPreview').value;
        try {
          await navigator.clipboard.writeText(text);
          showToast('已复制完整 Markdown 源码到剪贴板');
        } catch (_) {
          showToast('复制失败，请手动选中文本复制');
        }
      });
    }

    // 状态单选框变化
    document.querySelectorAll('input[name="itemStatus"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateFormStatusBadge(e.target.value);
        updateRawMarkdownPreview();
      });
    });

    // 表单输入时同步 Raw Markdown
    [elInputTitle, elInputId, elInputRegion, elInputReviewNumber, elInputScale, elInputSource, elInputDescription, elInputDownload].forEach(input => {
      input.addEventListener('input', updateRawMarkdownPreview);
      input.addEventListener('change', updateRawMarkdownPreview);
    });

    // 胶囊快捷添加（支持回车与空格键自动成词）
    setupCapsuleInput(
      elInputSubCategoryNew,
      addSubCategory,
      () => currentSubCategories,
      removeSubCategory
    );

    setupCapsuleInput(
      elInputTagNew,
      addTag,
      () => currentTags,
      removeTag
    );

    // 快捷标签与分类点击
    document.querySelectorAll('#quickSubCategories .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        addSubCategory(chip.dataset.val);
      });
    });

    document.querySelectorAll('#quickTags .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        addTag(chip.dataset.val);
      });
    });

    // 缩放操作
    document.getElementById('btnZoomFit').addEventListener('click', () => {
      if (osdViewer && osdViewer.viewport) osdViewer.viewport.goHome();
    });
    document.getElementById('btnZoomActual').addEventListener('click', () => {
      if (osdViewer && osdViewer.viewport) osdViewer.viewport.zoomTo(1.0);
    });

    // 保存与重置
    document.getElementById('btnSaveMd').addEventListener('click', saveCurrentItem);
    document.getElementById('btnResetForm').addEventListener('click', () => {
      if (activeItem) populateForm(activeItem);
    });

    // 快捷键 Ctrl+S
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentItem();
      }
    });

    // 顶部路径与更换路径按钮
    const btnChangeTop = document.getElementById('btnChangePathTop');
    if (btnChangeTop) btnChangeTop.addEventListener('click', openSettingsModal);

    const pathBadgeBox = document.getElementById('pathBadgeBox');
    if (pathBadgeBox) pathBadgeBox.addEventListener('click', openSettingsModal);

    const btnEmptyPath = document.getElementById('btnEmptySetPath');
    if (btnEmptyPath) btnEmptyPath.addEventListener('click', openSettingsModal);

    // 打开系统文件位置
    document.getElementById('btnOpenExplorer').addEventListener('click', async () => {
      if (appMode === 'fs' || (window.location.protocol === 'https:' && window.location.hostname.includes('github.io'))) {
        showToast('GitHub Pages 模式无法直接调起本地 Explorer，请在本地双击 editor.bat 使用此功能');
        return;
      }
      try {
        const payload = activeItem ? { rel_path: activeItem.rel_path } : {};
        const res = await fetch('/api/open-system', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBody(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast(activeItem ? `已在文件资源管理器中定位: ${activeItem.title}` : '已在文件资源管理器中打开画廊图片目录');
        } else {
          showToast('打开失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        showToast('无法连接本地服务: ' + e.message);
      }
    });

    // 打开画廊预览
    document.getElementById('btnOpenGallery').addEventListener('click', () => {
      if (appMode === 'server') {
        window.open('/gallery/', '_blank');
      } else {
        window.open('https://openqgis.github.io/Cabinet/', '_blank');
      }
    });

    // 同步画廊
    document.getElementById('btnSyncCabinet').addEventListener('click', syncCabinet);
    document.getElementById('btnCloseSync').addEventListener('click', () => elSyncModal.close());
    document.getElementById('btnDoneSync').addEventListener('click', () => elSyncModal.close());

    // 设置弹窗
    document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnCloseSettings').addEventListener('click', () => elSettingsModal.close());
    document.getElementById('btnCancelSettings').addEventListener('click', () => elSettingsModal.close());
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);

    const btnPickNative = document.getElementById('btnPickFolderNative');
    if (btnPickNative) btnPickNative.addEventListener('click', onPickFolderNativeClick);

    const btnOpenExpSetting = document.getElementById('btnOpenExplorerSetting');
    if (btnOpenExpSetting) btnOpenExpSetting.addEventListener('click', onOpenExplorerSettingClick);

    if (elSettingsModal) {
      elSettingsModal.addEventListener('click', (e) => {
        const rect = elSettingsModal.getBoundingClientRect();
        const inDialog = (
          rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX && e.clientX <= rect.left + rect.width
        );
        if (!inDialog) elSettingsModal.close();
      });
    }

    // 连接文件夹按钮 (Pages 模式)
    if (elBtnConnectFolder) elBtnConnectFolder.addEventListener('click', pickCabinetFolder);
    if (elBtnConnectFolderBig) elBtnConnectFolderBig.addEventListener('click', pickCabinetFolder);
  }

  // -------------------------------------------------------------
  // 2. 模式检测与数据加载
  // -------------------------------------------------------------
  async function bootstrapApp() {
    const modeBadge = document.getElementById('modeBadge');
    // 优先检测本地 Python 服务
    try {
      const res = await fetch('/api/items', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          appMode = 'server';
          if (modeBadge) {
            modeBadge.textContent = '本地服务';
            modeBadge.className = 'mode-badge';
            modeBadge.title = '运行于 http://127.0.0.1:8099 本地 Python 服务';
          }
          const shortPath = (data.cabinet_path || 'Cabinet 连接就绪').replace(/\\/g, '/');
          elCabinetPath.textContent = shortPath;
          elCabinetPath.title = data.cabinet_path || '';
          if (elBtnConnectFolder) elBtnConnectFolder.style.display = 'none';
          if (elConnectOverlay) elConnectOverlay.style.display = 'none';

          currentItems = data.items || [];
          updateCounts();
          renderFileList();
          const emptyBtn = document.getElementById('btnEmptySetPath');
          const emptyTitle = document.getElementById('emptyPromptTitle');
          if (currentItems.length > 0) {
            if (emptyBtn) emptyBtn.style.display = 'none';
            if (emptyTitle) emptyTitle.textContent = '请从左侧选择一幅空间测绘图或遥感影像';
            if (!activeItem) selectItem(currentItems[0]);
          } else {
            if (emptyBtn) emptyBtn.style.display = 'inline-flex';
            if (emptyTitle) emptyTitle.textContent = '当前路径下未检测到测绘图片或 pic/ 文件夹';
          }
          return;
        }
      }
    } catch (_) {
      // 本地服务未运行或在 GitHub Pages 模式
    }

    // 切换至 File System Access 静态模式
    appMode = 'fs';
    if (modeBadge) {
      modeBadge.textContent = 'GitHub Pages';
      modeBadge.className = 'mode-badge fs';
      modeBadge.title = '运行于纯静态模式，通过 File System Access API 原位访问本地文件夹';
    }
    if (elBtnConnectFolder) elBtnConnectFolder.style.display = 'inline-flex';
    elCabinetPath.textContent = '待连接本地文件夹';

    // 尝试恢复以往授权的文件夹句柄
    const restored = await tryRestoreFsHandle();
    if (!restored) {
      if (elConnectOverlay) elConnectOverlay.style.display = 'flex';
      const emptyBtn = document.getElementById('btnEmptySetPath');
      if (emptyBtn) emptyBtn.style.display = 'inline-flex';
    }
  }

  async function tryRestoreFsHandle() {
    const savedHandle = await idbGet('cabinet_dir_handle');
    if (!savedHandle) return false;

    try {
      // 确认权限
      const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await initFromFsHandle(savedHandle);
        return true;
      }
    } catch (_) { }
    return false;
  }

  async function pickCabinetFolder() {
    if (!window.showDirectoryPicker) {
      alert('当前浏览器不支持本地文件夹访问，请使用 Chrome 或 Edge 浏览器打开！');
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await idbSet('cabinet_dir_handle', handle);
      await initFromFsHandle(handle);
    } catch (e) {
      if (e.name !== 'AbortError') {
        showToast('文件夹授权失败: ' + e.message);
      }
    }
  }

  async function initFromFsHandle(handle) {
    fsRootHandle = handle;
    let picHandle = handle;

    // 检查所选目录是否是 Cabinet 根目录（包含 pic 子目录）
    try {
      picHandle = await handle.getDirectoryHandle('pic');
    } catch (_) {
      // 若直接选择了 pic 目录本身
    }

    try {
      fsThumbsHandle = await handle.getDirectoryHandle('thumbs');
    } catch (_) {
      fsThumbsHandle = null;
    }

    fsPicHandle = picHandle;
    elCabinetPath.textContent = handle.name;
    if (elConnectOverlay) elConnectOverlay.style.display = 'none';

    await scanFsItems(picHandle);
  }

  async function scanFsItems(picHandle) {
    showToast('正在扫描本地空间图片与描述卡片...');
    const items = [];

    async function walk(dirHandle, pathParts) {
      const fileMap = new Map();
      const mdMap = new Map();

      for await (const [name, entry] of dirHandle.entries()) {
        if (entry.kind === 'file') {
          const parts = name.split('.');
          const ext = parts.pop().toLowerCase();
          const stem = parts.join('.');

          if (IMAGE_EXTS.has(ext)) {
            fileMap.set(stem, { name, entry, ext });
          } else if (ext === 'md') {
            mdMap.set(stem, { name, entry });
          }
        }
      }

      for (const [stem, img] of fileMap.entries()) {
        const md = mdMap.get(stem);
        const folderStr = pathParts.join('/');
        const relPath = (folderStr ? folderStr + '/' : '') + img.name;

        let meta = {};
        let body = '';

        if (md) {
          try {
            const mdFile = await md.entry.getFile();
            const text = await mdFile.text();
            const parsed = parseClientFrontmatter(text);
            meta = parsed.meta;
            body = parsed.body;
          } catch (_) { }
        }

        const fileObj = await img.entry.getFile();
        const defaultSub = pathParts.join(' · ') || '未分类';
        const itemId = meta.id || stem.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

        let thumbBlobUrl = '';
        let mainBlobUrl = '';

        // 1. 如果存在 thumbs 目录，优先查找预生成的 webp 缩略图（加载极快且原生支持 tif）
        if (fsThumbsHandle) {
          try {
            const th = await fsThumbsHandle.getFileHandle(`${itemId}.webp`);
            const tf = await th.getFile();
            thumbBlobUrl = URL.createObjectURL(tf);
          } catch (_) {
            try {
              const th = await fsThumbsHandle.getFileHandle(`${stem}.webp`);
              const tf = await th.getFile();
              thumbBlobUrl = URL.createObjectURL(tf);
            } catch (_) { }
          }
        }

        // 2. 如果不是 tif 格式，直接为原图生成 blobUrl
        if (img.ext !== 'tif' && img.ext !== 'tiff') {
          try {
            mainBlobUrl = URL.createObjectURL(fileObj);
            if (!thumbBlobUrl) {
              thumbBlobUrl = mainBlobUrl;
            }
          } catch (_) { }
        }

        items.push({
          id: itemId,
          title: meta.title || stem,
          filename: img.name,
          rel_path: relPath,
          folder: folderStr || 'root',
          has_md: !!md,
          status: meta.status || (md ? 'draft' : 'unannotated'),
          category: meta.category || 'gis',
          subCategory: meta.subCategory || defaultSub,
          region: meta.region || '',
          source: meta.source || '',
          scale: meta.scale || '',
          reviewNumber: meta.reviewNumber || '',
          tags: meta.tags || [],
          download: meta.download !== false,
          description: body || meta.description || '',
          file_size: fileObj.size,
          _fileEntry: img.entry,
          _mdEntry: md ? md.entry : null,
          _dirHandle: dirHandle,
          _blobUrl: mainBlobUrl,
          _thumbUrl: thumbBlobUrl
        });
      }

      // 递归子目录
      for await (const [name, entry] of dirHandle.entries()) {
        if (entry.kind === 'directory' && !name.startsWith('.') && name !== '_cache') {
          await walk(entry, [...pathParts, name]);
        }
      }
    }

    await walk(picHandle, []);
    items.sort((a, b) => (a.folder + a.title).localeCompare(b.folder + b.title));

    currentItems = items;
    updateCounts();
    renderFileList();

    if (currentItems.length > 0) {
      selectItem(currentItems[0]);
    } else {
      showToast('未在所选文件夹下找到测绘图片，请确认选中的是 Cabinet 或 pic 文件夹');
    }
  }

  // -------------------------------------------------------------
  // 3. 列表渲染与计数
  // -------------------------------------------------------------
  function updateCounts() {
    const total = currentItems.length;
    const published = currentItems.filter(i => i.status === 'published').length;
    const modified = currentItems.filter(i => i.status === 'modified').length;
    const done = currentItems.filter(i => i.status === 'done').length;
    const draft = currentItems.filter(i => i.status === 'draft').length;
    const unannotated = currentItems.filter(i => i.status === 'unannotated').length;

    elCountAll.textContent = total;
    if (elCountPublished) elCountPublished.textContent = published;
    if (elCountModified) elCountModified.textContent = modified;
    elCountDone.textContent = done;
    elCountDraft.textContent = draft;
    elCountNew.textContent = unannotated;
  }

  function renderFileList() {
    elFileList.innerHTML = '';
    const query = elSearchInput.value.trim().toLowerCase();

    const filtered = currentItems.filter(item => {
      // 状态筛选
      if (activeFilter === 'published' && item.status !== 'published') return false;
      if (activeFilter === 'modified' && item.status !== 'modified') return false;
      if (activeFilter === 'done' && item.status !== 'done') return false;
      if (activeFilter === 'draft' && item.status !== 'draft') return false;
      if (activeFilter === 'new' && item.status !== 'unannotated') return false;

      // 搜索筛选
      if (query) {
        const matchTitle = (item.title || '').toLowerCase().includes(query);
        const matchId = (item.id || '').toLowerCase().includes(query);
        const matchRegion = (item.region || '').toLowerCase().includes(query);
        const matchFolder = (item.folder || '').toLowerCase().includes(query);
        if (!matchTitle && !matchId && !matchRegion && !matchFolder) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      elFileList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);">没有符合条件的作品</div>';
      return;
    }

    // 按文件夹分组
    const groups = {};
    filtered.forEach(item => {
      const f = item.folder || '根目录';
      if (!groups[f]) groups[f] = [];
      groups[f].push(item);
    });

    Object.keys(groups).forEach(folder => {
      const groupEl = document.createElement('div');
      groupEl.className = 'folder-group';

      const titleEl = document.createElement('div');
      titleEl.className = 'folder-title';
      titleEl.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter"><path d="M2 4h7l2 3h11v13H2V4z"/></svg> <span>${folder}</span>`;
      groupEl.appendChild(titleEl);

      groups[folder].forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'file-item' + (activeItem && activeItem.rel_path === item.rel_path ? ' active' : '');
        
        let statusBadge = '<span class="status-badge-mini done">DONE</span>';
        if (item.status === 'published') statusBadge = '<span class="status-badge-mini published">PUB</span>';
        else if (item.status === 'modified') statusBadge = '<span class="status-badge-mini modified">MOD</span>';
        else if (item.status === 'draft') statusBadge = '<span class="status-badge-mini draft">DRAFT</span>';
        else if (item.status === 'unannotated') statusBadge = '<span class="status-badge-mini new">NEW</span>';

        const thumbSrc = (appMode === 'server')
          ? `/api/thumb?path=${encodeURIComponent(item.rel_path)}`
          : (item._thumbUrl || item._blobUrl || '');

        let thumbMarkup = '';
        if (thumbSrc) {
          thumbMarkup = `<img class="file-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex';">
          <div class="file-thumb placeholder" style="display:none;"><svg class="ic mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="3" width="18" height="18"/><polygon points="3 16 9 10 13 14 17 9 21 13 21 21 3 21"/></svg></div>`;
        } else {
          thumbMarkup = `<div class="file-thumb placeholder"><svg class="ic mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="3" width="18" height="18"/><polygon points="3 16 9 10 13 14 17 9 21 13 21 21 3 21"/></svg></div>`;
        }

        itemEl.innerHTML = `
          ${thumbMarkup}
          <div class="file-info">
            <div class="file-title-row">
              <span class="file-title" title="${item.title}">${item.title}</span>
              ${statusBadge}
            </div>
            <div class="file-meta-row">
              <span>${item.region || item.source || item.filename}</span>
            </div>
          </div>
        `;

        itemEl.addEventListener('click', () => selectItem(item));
        groupEl.appendChild(itemEl);
      });

      elFileList.appendChild(groupEl);
    });
  }

  // -------------------------------------------------------------
  // 4. 作品深览巡视台 (OpenSeadragon)
  // -------------------------------------------------------------
  async function selectItem(item) {
    activeItem = item;
    renderFileList();
    populateForm(item);
    await loadOsdImage(item);
  }

  async function loadOsdImage(item) {
    elViewerEmpty.style.display = 'none';

    if (osdViewer) {
      osdViewer.destroy();
      osdViewer = null;
    }

    let imgUrl = '';
    if (appMode === 'server') {
      imgUrl = `/api/image?path=${encodeURIComponent(item.rel_path)}`;
    } else if (item._fileEntry) {
      if (!item._blobUrl) {
        const ext = item.filename.split('.').pop().toLowerCase();
        if (ext === 'tif' || ext === 'tiff') {
          try {
            showToast('正在解析大尺寸测绘 TIFF 影像...');
            const f = await item._fileEntry.getFile();
            const decoded = await decodeTiffFile(f);
            item._blobUrl = decoded.fullBlobUrl;
            if (!item._thumbUrl) {
              item._thumbUrl = decoded.thumbBlobUrl;
              renderFileList();
            }
          } catch (err) {
            console.warn('UTIF decode error:', err);
          }
        } else {
          try {
            const f = await item._fileEntry.getFile();
            item._blobUrl = URL.createObjectURL(f);
          } catch (_) { }
        }
      }
      imgUrl = item._blobUrl || item._thumbUrl || '';
    }

    const tempImg = new Image();
    tempImg.onload = function () {
      const w = tempImg.naturalWidth;
      const h = tempImg.naturalHeight;
      const aspect = (w / h).toFixed(2);
      const sizeMb = (item.file_size / (1024 * 1024)).toFixed(1);

      elInfoRes.textContent = `${w} × ${h} px`;
      elInfoAspect.textContent = `${aspect}:1 构图`;
      elInfoFilesize.textContent = `${sizeMb} MB 原图`;

      osdViewer = OpenSeadragon({
        id: 'osdContainer',
        prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/',
        tileSources: {
          type: 'image',
          url: imgUrl
        },
        showNavigationControl: false,
        animationTime: 0.25,
        blendTime: 0.1,
        constrainDuringPan: true,
        maxZoomPixelRatio: 2.5,
        minZoomLevel: 0.2,
        defaultZoomLevel: 0,
        visibilityRatio: 0.8
      });

      osdViewer.addHandler('zoom', function (e) {
        if (elInfoZoom) {
          const ratio = Math.round(e.zoom * 100);
          elInfoZoom.textContent = `${ratio}%`;
        }
      });
    };

    tempImg.onerror = function () {
      if (item._thumbUrl && imgUrl !== item._thumbUrl) {
        imgUrl = item._thumbUrl;
        tempImg.src = imgUrl;
        return;
      }
      showToast('图片加载遇到异常，请确认源文件完整性');
    };
    tempImg.src = imgUrl;
  }

  // 纯前端解码 TIFF 影像
  async function decodeTiffFile(fileObj) {
    if (typeof UTIF === 'undefined') {
      throw new Error('UTIF 库未加载');
    }
    const buffer = await fileObj.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error('无效的 TIFF 影像');
    }
    const firstIfd = ifds[0];
    UTIF.decodeImage(buffer, firstIfd);
    const rgba = UTIF.toRGBA8(firstIfd);
    const width = firstIfd.width || firstIfd.t256[0];
    const height = firstIfd.height || firstIfd.t257[0];

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);

    const fullBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/jpeg', 0.92);
    });

    const thumbCanvas = document.createElement('canvas');
    const maxThumbDim = 120;
    const scale = Math.min(maxThumbDim / width, maxThumbDim / height);
    thumbCanvas.width = Math.round(width * scale);
    thumbCanvas.height = Math.round(height * scale);
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await new Promise(res => thumbCanvas.toBlob(res, 'image/jpeg', 0.85));

    return {
      fullBlobUrl: URL.createObjectURL(fullBlob),
      thumbBlobUrl: URL.createObjectURL(thumbBlob),
      width,
      height
    };
  }

  // -------------------------------------------------------------
  // 5. 表单字段填充与 Markdown 生成
  // -------------------------------------------------------------
  function populateForm(item) {
    elInputTitle.value = item.title || '';
    elInputId.value = item.id || '';
    elInputRegion.value = item.region || '';
    elInputReviewNumber.value = item.reviewNumber || '';
    elInputScale.value = item.scale || '';
    elInputSource.value = item.source || '';
    elInputDescription.value = item.description || '';
    elInputDownload.checked = item.download !== false;

    // 解析 subCategory 为多胶囊列表
    let subCats = [];
    if (Array.isArray(item.subCategory)) {
      subCats = [...item.subCategory];
    } else if (typeof item.subCategory === 'string' && item.subCategory.trim()) {
      if (item.subCategory.includes(' · ')) {
        subCats = item.subCategory.split(' · ').map(s => s.trim()).filter(Boolean);
      } else if (item.subCategory.includes(',')) {
        subCats = item.subCategory.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        subCats = [item.subCategory.trim()];
      }
    }
    currentSubCategories = subCats;
    renderSubCategories();

    const validStatuses = ['published', 'modified', 'done', 'draft'];
    let statusVal = 'done';
    if (validStatuses.includes(item.status)) {
      statusVal = item.status;
    } else if (item.status === 'unannotated' || !item.has_md) {
      statusVal = 'draft';
    }
    const radio = document.querySelector(`input[name="itemStatus"][value="${statusVal}"]`);
    if (radio) radio.checked = true;
    updateFormStatusBadge(statusVal);

    currentTags = Array.isArray(item.tags) ? [...item.tags] : [];
    renderTags();
    updateRawMarkdownPreview();
  }

  function updateFormStatusBadge(status) {
    elFormStatusBadge.className = 'form-status-badge ' + (status || 'draft');
    const badgeTextMap = {
      'published': '已上架 (PUB)',
      'modified': '待推送 (MOD)',
      'done': '待上架 (DONE)',
      'draft': '草稿 (DRAFT)',
      'unannotated': '待标注 (NEW)'
    };
    elFormStatusBadge.textContent = badgeTextMap[status] || (status ? status.toUpperCase() : '草稿');
  }

  function renderSubCategories() {
    if (!elSubCategoriesList) return;
    elSubCategoriesList.innerHTML = '';
    currentSubCategories.forEach(sub => {
      const tagItem = document.createElement('span');
      tagItem.className = 'tag-item';
      tagItem.innerHTML = `<span>${sub}</span><button type="button" class="tag-remove" data-sub="${sub}" aria-label="移除分类"><svg class="ic mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      tagItem.querySelector('.tag-remove').addEventListener('click', () => removeSubCategory(sub));
      elSubCategoriesList.appendChild(tagItem);
    });
    updateRawMarkdownPreview();
  }

  function addSubCategory(sub) {
    sub = (sub || '').trim();
    if (sub && !currentSubCategories.includes(sub)) {
      currentSubCategories.push(sub);
      renderSubCategories();
    }
  }

  function removeSubCategory(sub) {
    currentSubCategories = currentSubCategories.filter(s => s !== sub);
    renderSubCategories();
  }

  function renderTags() {
    elTagsList.innerHTML = '';
    currentTags.forEach(tag => {
      const tagItem = document.createElement('span');
      tagItem.className = 'tag-item';
      tagItem.innerHTML = `<span>${tag}</span><button type="button" class="tag-remove" data-tag="${tag}" aria-label="移除标签"><svg class="ic mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      tagItem.querySelector('.tag-remove').addEventListener('click', () => removeTag(tag));
      elTagsList.appendChild(tagItem);
    });
    updateRawMarkdownPreview();
  }

  function addTag(tag) {
    tag = tag.trim();
    if (tag && !currentTags.includes(tag)) {
      currentTags.push(tag);
      renderTags();
    }
  }

  function removeTag(tag) {
    currentTags = currentTags.filter(t => t !== tag);
    renderTags();
  }

  function setupCapsuleInput(inputEl, addFn, listGetter, removeFn) {
    if (!inputEl) return;

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const val = inputEl.value.trim();
        if (val) {
          addFn(val);
          inputEl.value = '';
        }
      } else if (e.key === 'Backspace' && !inputEl.value) {
        const list = listGetter();
        if (list.length > 0) {
          removeFn(list[list.length - 1]);
        }
      }
    });

    inputEl.addEventListener('blur', () => {
      const val = inputEl.value.trim();
      if (val) {
        addFn(val);
        inputEl.value = '';
      }
    });

    inputEl.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (text && (text.includes(' ') || text.includes(',') || text.includes('，') || text.includes('、'))) {
        e.preventDefault();
        const parts = text.split(/[\s,，、]+/).map(s => s.trim()).filter(Boolean);
        parts.forEach(addFn);
        inputEl.value = '';
      }
    });
  }

  function updateRawMarkdownPreview() {
    const statusRadio = document.querySelector('input[name="itemStatus"]:checked');
    const status = statusRadio ? statusRadio.value : 'done';

    const metaLines = ['---'];
    metaLines.push(`id: ${elInputId.value.trim()}`);
    metaLines.push(`title: ${elInputTitle.value.trim()}`);
    metaLines.push(`category: gis`);
    metaLines.push(`categoryName: 网上GIS图片分享`);
    if (currentSubCategories.length === 1) {
      metaLines.push(`subCategory: ${currentSubCategories[0]}`);
    } else if (currentSubCategories.length > 1) {
      metaLines.push('subCategory:');
      currentSubCategories.forEach(s => metaLines.push(`  - ${s}`));
    }
    if (elInputRegion.value.trim()) metaLines.push(`region: ${elInputRegion.value.trim()}`);
    if (elInputSource.value.trim()) metaLines.push(`source: ${elInputSource.value.trim()}`);
    if (elInputScale.value.trim()) metaLines.push(`scale: ${elInputScale.value.trim()}`);
    if (elInputReviewNumber.value.trim()) metaLines.push(`reviewNumber: ${elInputReviewNumber.value.trim()}`);
    
    if (currentTags.length > 0) {
      metaLines.push('tags:');
      currentTags.forEach(t => metaLines.push(`  - ${t}`));
    }
    metaLines.push(`status: ${status}`);
    metaLines.push(`download: ${elInputDownload.checked ? 'true' : 'false'}`);
    metaLines.push('---');
    metaLines.push('');
    const desc = elInputDescription.value.trim();
    if (desc) {
      metaLines.push(desc);
      metaLines.push('');
    }

    elRawMarkdown.value = metaLines.join('\n');
  }

  // -------------------------------------------------------------
  // 6. 保存与同步
  // -------------------------------------------------------------
  async function saveCurrentItem() {
    if (!activeItem) {
      showToast('请先选择要保存的作品');
      return;
    }

    const statusRadio = document.querySelector('input[name="itemStatus"]:checked');
    const status = statusRadio ? statusRadio.value : 'done';

    const subVal = currentSubCategories.length === 1 ? currentSubCategories[0] : currentSubCategories;

    const payload = {
      rel_path: activeItem.rel_path,
      id: elInputId.value.trim() || activeItem.id,
      title: elInputTitle.value.trim() || activeItem.title,
      subCategory: subVal,
      region: elInputRegion.value.trim(),
      reviewNumber: elInputReviewNumber.value.trim(),
      scale: elInputScale.value.trim(),
      source: elInputSource.value.trim(),
      tags: currentTags,
      status: status,
      download: elInputDownload.checked,
      description: elInputDescription.value.trim()
    };

    if (appMode === 'server') {
      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBody(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast(`已成功保存: ${payload.title}.md`);
          Object.assign(activeItem, payload);
          activeItem.has_md = true;
          updateCounts();
          renderFileList();
        } else {
          showToast('保存失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        showToast('保存异常: ' + e.message);
      }
    } else {
      // Pages 模式：File System Access 原位写入本地磁盘
      try {
        const dir = activeItem._dirHandle;
        const stem = activeItem.filename.split('.').slice(0, -1).join('.');
        const mdName = `${stem}.md`;
        const fh = await dir.getFileHandle(mdName, { create: true });
        const writable = await fh.createWritable();
        await writable.write(elRawMarkdown.value);
        await writable.close();

        showToast(`已原位写回本地文件: ${mdName}`);
        Object.assign(activeItem, payload);
        activeItem.has_md = true;
        updateCounts();
        renderFileList();
      } catch (e) {
        showToast('写入本地文件失败: ' + e.message);
      }
    }
  }

  async function syncCabinet() {
    if (appMode !== 'server') {
      showToast('GitHub Pages 模式无法直接调用本地构建脚本，请运行本地 editor.bat 执行一键同步！');
      return;
    }

    elSyncConsole.textContent = '正在执行 build_cabinet.py 生成切片、转换下载 WebP 并打包 manifest...\n\n';
    elSyncModal.showModal();

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        elSyncConsole.textContent = data.output || '同步成功！';
        showToast('画廊全站同步编译成功');
      } else {
        elSyncConsole.textContent = '同步出错:\n' + (data.output || data.error);
        showToast('同步执行失败，请查看日志');
      }
    } catch (e) {
      elSyncConsole.textContent = '网络请求异常: ' + e.message;
    }
  }

  // -------------------------------------------------------------
  // 7. 配置弹窗与辅助函数
  // -------------------------------------------------------------
  async function openSettingsModal() {
    if (appMode === 'server') {
      try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        const input = document.getElementById('settingCabinetPath');
        if (input) input.value = cfg.cabinet_path || '';
        const statusEl = document.getElementById('settingPathStatus');
        if (statusEl) {
          statusEl.innerHTML = `支持选择 <code>Cabinet</code> 根目录（例如 <code>D:\\website\\Cabinet</code>），也可直接选择 <code>pic</code> 文件夹，系统会自动向上解析。`;
        }
        elSettingsModal.showModal();
      } catch (e) {
        showToast('获取设置失败: ' + e.message);
      }
    } else {
      // Pages 模式直接调起本地文件夹授权
      pickCabinetFolder();
    }
  }

  async function onPickFolderNativeClick() {
    if (appMode === 'server') {
      const btn = document.getElementById('btnPickFolderNative');
      if (btn) btn.disabled = true;
      showToast('正在调起系统资源管理器，请在弹出窗口中选择 Cabinet 根目录…');
      try {
        const cur = (document.getElementById('settingCabinetPath')?.value || '').trim();
        const res = await fetch('/api/pick_dir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBody({ initial_dir: cur })
        });
        const data = await res.json();
        if (data.ok && !data.cancelled && data.path) {
          const input = document.getElementById('settingCabinetPath');
          if (input) input.value = data.path;
          const statusEl = document.getElementById('settingPathStatus');
          if (!data.has_pic) {
            showToast(`已选路径：${data.path}（未检测到 pic 文件夹）`);
            if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-red)">未发现 pic/ 文件夹，请确认是否选择正确</span>`;
          } else {
            showToast(`已选择路径：${data.path}`);
            if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-green)">已检测到 pic/ 文件夹，路径有效。点击「保存并重新加载」即可应用。</span>`;
          }
        }
      } catch (e) {
        showToast('调用资源管理器失败: ' + e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    } else {
      pickCabinetFolder();
    }
  }

  async function onOpenExplorerSettingClick() {
    const cur = (document.getElementById('settingCabinetPath')?.value || '').trim();
    if (!cur) {
      showToast('请先输入或选择路径');
      return;
    }
    if (appMode !== 'server') {
      showToast('网页模式下无法直接打开本地文件资源管理器');
      return;
    }
    try {
      const res = await fetch('/api/open-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody({ path: cur })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('已在系统资源管理器中打开: ' + cur);
      } else {
        showToast('打开失败: ' + (data.error || '未知错误'));
      }
    } catch (e) {
      showToast('请求异常: ' + e.message);
    }
  }

  async function saveSettings() {
    const newPath = document.getElementById('settingCabinetPath').value.trim();
    if (!newPath) return;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody({ cabinet_path: newPath })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('配置已更新，正在重新加载作品...');
        elSettingsModal.close();
        await bootstrapApp();
      }
    } catch (e) {
      showToast('保存配置异常: ' + e.message);
    }
  }

  function parseClientFrontmatter(content) {
    const meta = {};
    let body = '';
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { meta, body: content.trim() };

    const yamlBlock = match[1];
    body = match[2].trim();
    let currentKey = null;

    yamlBlock.split('\n').forEach(line => {
      line = line.trimEnd();
      if (!line || line.startsWith('#')) return;

      const listMatch = line.match(/^\s*-\s+(.*)$/);
      if (listMatch && currentKey) {
        if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
        meta[currentKey].push(listMatch[1].trim().replace(/^['"]|['"]$/g, ''));
        return;
      }

      const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1].trim();
        const rawVal = kvMatch[2].trim();
        if (rawVal === '') {
          meta[currentKey] = [];
        } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          meta[currentKey] = rawVal.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        } else if (rawVal.toLowerCase() === 'true') {
          meta[currentKey] = true;
        } else if (rawVal.toLowerCase() === 'false') {
          meta[currentKey] = false;
        } else {
          meta[currentKey] = rawVal.replace(/^['"]|['"]$/g, '');
        }
      }
    });

    return { meta, body };
  }

  function jsonBody(obj) {
    return JSON.stringify(obj);
  }

  function showToast(msg) {
    const old = document.querySelector('.toast-msg');
    if (old) old.remove();

    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 2500);
  }

})();
