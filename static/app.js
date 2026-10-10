/**
 * Cabinet Assistant · 核心前端控制器 (app.js)
 */

(function () {
  'use strict';

  let currentItems = [];
  let activeItem = null;
  let activeFilter = 'all';
  let osdViewer = null;
  let currentTags = [];

  // DOM Elements
  const elCabinetPath = document.getElementById('cabinetPathDisplay');
  const elFileList = document.getElementById('fileList');
  const elSearchInput = document.getElementById('searchInput');
  const elViewerEmpty = document.getElementById('viewerEmpty');
  const elViewerStatusbar = document.getElementById('viewerStatusbar');
  
  // Status counts
  const elCountAll = document.getElementById('countAll');
  const elCountDone = document.getElementById('countDone');
  const elCountDraft = document.getElementById('countDraft');
  const elCountNew = document.getElementById('countNew');

  // Form Inputs
  const elFormStatusBadge = document.getElementById('formStatusBadge');
  const elInputTitle = document.getElementById('inputTitle');
  const elInputId = document.getElementById('inputId');
  const elInputSubCategory = document.getElementById('inputSubCategory');
  const elInputRegion = document.getElementById('inputRegion');
  const elInputReviewNumber = document.getElementById('inputReviewNumber');
  const elInputScale = document.getElementById('inputScale');
  const elInputSource = document.getElementById('inputSource');
  const elInputDescription = document.getElementById('inputDescription');
  const elInputDownload = document.getElementById('inputDownload');
  const elTagsList = document.getElementById('tagsList');
  const elInputTagNew = document.getElementById('inputTagNew');
  const elRawMarkdown = document.getElementById('rawMarkdownPreview');

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
  // 1. 初始化
  // -------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadCabinetItems();
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

    // 状态单选框变化
    document.querySelectorAll('input[name="itemStatus"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateFormStatusBadge(e.target.value);
        updateRawMarkdownPreview();
      });
    });

    // 表单输入时同步 Raw Markdown
    [elInputTitle, elInputId, elInputSubCategory, elInputRegion, elInputReviewNumber, elInputScale, elInputSource, elInputDescription, elInputDownload].forEach(input => {
      input.addEventListener('input', updateRawMarkdownPreview);
      input.addEventListener('change', updateRawMarkdownPreview);
    });

    // 快捷标签与分类点击
    document.querySelectorAll('#quickSubCategories .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        elInputSubCategory.value = chip.dataset.val;
        updateRawMarkdownPreview();
      });
    });

    document.querySelectorAll('#quickTags .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        addTag(chip.dataset.val);
      });
    });

    // 添加新标签回车
    elInputTagNew.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = elInputTagNew.value.trim();
        if (val) {
          addTag(val);
          elInputTagNew.value = '';
        }
      }
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

    // 打开系统文件位置
    document.getElementById('btnOpenExplorer').addEventListener('click', () => {
      if (!activeItem) return;
      fetch('/api/open-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody({ rel_path: activeItem.rel_path })
      });
    });

    // 打开画廊预览
    document.getElementById('btnOpenGallery').addEventListener('click', () => {
      window.open('http://127.0.0.1:8099/static/index.html', '_blank');
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
  }

  // -------------------------------------------------------------
  // 2. 数据加载与列表渲染
  // -------------------------------------------------------------
  async function loadCabinetItems() {
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      if (!data.ok) {
        showToast('加载失败: ' + (data.error || '无法读取 Cabinet'));
        return;
      }

      elCabinetPath.textContent = data.cabinet_path || 'Cabinet 连接就绪';
      currentItems = data.items || [];
      updateCounts();
      renderFileList();

      // 默认选中第一幅图
      if (currentItems.length > 0 && !activeItem) {
        selectItem(currentItems[0]);
      }
    } catch (e) {
      showToast('连接本地服务异常: ' + e.message);
    }
  }

  function updateCounts() {
    const total = currentItems.length;
    const done = currentItems.filter(i => i.status === 'done').length;
    const draft = currentItems.filter(i => i.status === 'draft').length;
    const unannotated = currentItems.filter(i => i.status === 'unannotated').length;

    elCountAll.textContent = total;
    elCountDone.textContent = done;
    elCountDraft.textContent = draft;
    elCountNew.textContent = unannotated;
  }

  function renderFileList() {
    elFileList.innerHTML = '';
    const query = elSearchInput.value.trim().toLowerCase();

    const filtered = currentItems.filter(item => {
      // 状态筛选
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
      titleEl.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> <span>${folder}</span>`;
      groupEl.appendChild(titleEl);

      groups[folder].forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'file-item' + (activeItem && activeItem.rel_path === item.rel_path ? ' active' : '');
        
        let statusBadge = '<span class="status-badge-mini done">DONE</span>';
        if (item.status === 'draft') statusBadge = '<span class="status-badge-mini draft">DRAFT</span>';
        if (item.status === 'unannotated') statusBadge = '<span class="status-badge-mini new">NEW</span>';

        itemEl.innerHTML = `
          <img class="file-thumb" src="/api/thumb?path=${encodeURIComponent(item.rel_path)}" alt="" loading="lazy">
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
  // 3. 作品选中与 OpenSeadragon 深览视窗
  // -------------------------------------------------------------
  function selectItem(item) {
    activeItem = item;
    renderFileList();
    populateForm(item);
    loadOsdImage(item);
  }

  function loadOsdImage(item) {
    elViewerEmpty.style.display = 'none';

    if (osdViewer) {
      osdViewer.destroy();
      osdViewer = null;
    }

    const imgUrl = `/api/image?path=${encodeURIComponent(item.rel_path)}`;

    // 读取图像自然分辨率
    const tempImg = new Image();
    tempImg.onload = function () {
      const w = tempImg.naturalWidth;
      const h = tempImg.naturalHeight;
      const aspect = (w / h).toFixed(2);
      const sizeMb = (item.file_size / (1024 * 1024)).toFixed(1);

      elInfoRes.textContent = `${w} × ${h} px`;
      elInfoAspect.textContent = `${aspect}:1 构图`;
      elInfoFilesize.textContent = `${sizeMb} MB 原图`;

      // 初始化 OpenSeadragon 单图视口
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
    tempImg.src = imgUrl;
  }

  // -------------------------------------------------------------
  // 4. 表单数据填充与标签管理
  // -------------------------------------------------------------
  function populateForm(item) {
    elInputTitle.value = item.title || '';
    elInputId.value = item.id || '';
    elInputSubCategory.value = item.subCategory || '';
    elInputRegion.value = item.region || '';
    elInputReviewNumber.value = item.reviewNumber || '';
    elInputScale.value = item.scale || '';
    elInputSource.value = item.source || '';
    elInputDescription.value = item.description || '';
    elInputDownload.checked = item.download !== false;

    // 状态
    const statusVal = item.status === 'draft' ? 'draft' : 'done';
    const radio = document.querySelector(`input[name="itemStatus"][value="${statusVal}"]`);
    if (radio) radio.checked = true;
    updateFormStatusBadge(statusVal);

    // 标签
    currentTags = Array.isArray(item.tags) ? [...item.tags] : [];
    renderTags();
    updateRawMarkdownPreview();
  }

  function updateFormStatusBadge(status) {
    elFormStatusBadge.className = 'form-status-badge ' + (status === 'done' ? 'done' : 'draft');
    elFormStatusBadge.textContent = status === 'done' ? '🚀 已完成 (DONE)' : '🚧 草稿 (DRAFT)';
  }

  function renderTags() {
    elTagsList.innerHTML = '';
    currentTags.forEach(tag => {
      const tagItem = document.createElement('span');
      tagItem.className = 'tag-item';
      tagItem.innerHTML = `<span>${tag}</span><span class="tag-remove" data-tag="${tag}">✕</span>`;
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

  function updateRawMarkdownPreview() {
    const statusRadio = document.querySelector('input[name="itemStatus"]:checked');
    const status = statusRadio ? statusRadio.value : 'done';

    const metaLines = ['---'];
    metaLines.push(`id: ${elInputId.value.trim()}`);
    metaLines.push(`title: ${elInputTitle.value.trim()}`);
    metaLines.push(`category: gis`);
    metaLines.push(`categoryName: 网上GIS图片分享`);
    metaLines.push(`subCategory: ${elInputSubCategory.value.trim()}`);
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
  // 5. 保存与同步
  // -------------------------------------------------------------
  async function saveCurrentItem() {
    if (!activeItem) {
      showToast('请先选择要保存的作品');
      return;
    }

    const statusRadio = document.querySelector('input[name="itemStatus"]:checked');
    const status = statusRadio ? statusRadio.value : 'done';

    const payload = {
      rel_path: activeItem.rel_path,
      id: elInputId.value.trim() || activeItem.id,
      title: elInputTitle.value.trim() || activeItem.title,
      subCategory: elInputSubCategory.value.trim(),
      region: elInputRegion.value.trim(),
      reviewNumber: elInputReviewNumber.value.trim(),
      scale: elInputScale.value.trim(),
      source: elInputSource.value.trim(),
      tags: currentTags,
      status: status,
      download: elInputDownload.checked,
      description: elInputDescription.value.trim()
    };

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody(payload)
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`已成功保存: ${payload.title}.md`);
        // 更新本地对象状态
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
  }

  async function syncCabinet() {
    elSyncConsole.textContent = '⏳ 正在执行 build_cabinet.py 生成切片、转换下载 WebP 并打包 manifest...\n\n';
    elSyncModal.showModal();

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        elSyncConsole.textContent = data.output || '同步成功！';
        showToast('🎉 画廊全站同步编译成功！');
      } else {
        elSyncConsole.textContent = '❌ 同步出错:\n' + (data.output || data.error);
        showToast('同步执行失败，请查看日志');
      }
    } catch (e) {
      elSyncConsole.textContent = '❌ 网络请求异常: ' + e.message;
    }
  }

  // -------------------------------------------------------------
  // 6. 配置弹窗
  // -------------------------------------------------------------
  async function openSettingsModal() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      document.getElementById('settingCabinetPath').value = cfg.cabinet_path || '';
      elSettingsModal.showModal();
    } catch (e) {
      showToast('获取设置失败: ' + e.message);
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
        loadCabinetItems();
      }
    } catch (e) {
      showToast('保存配置异常: ' + e.message);
    }
  }

  // -------------------------------------------------------------
  // 辅助函数
  // -------------------------------------------------------------
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
