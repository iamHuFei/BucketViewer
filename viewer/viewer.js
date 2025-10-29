// Viewer JavaScript - 存储桶查看器主逻辑

// 全局错误捕获
window.addEventListener('error', function(event) {
  console.error('[Bucket Viewer] Error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    error: event.error
  });
});

window.addEventListener('unhandledrejection', function(event) {
  console.error('[Bucket Viewer] Promise rejection:', event.reason);
});

class BucketViewer {
  constructor() {
    this.bucketId = null;
    this.bucketUrl = null;
    this.files = [];
    this.filteredFiles = [];
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalPages = 0;
    this.currentView = 'grid';
    this.sortBy = 'name';
    this.sortOrder = 'asc';
    this.categoryFilter = '';
    this.searchQuery = '';
    this.currentImageIndex = 0;
    this.imageFiles = [];

    // PUT覆盖功能相关
    this.putDetectionHistory = [];

    this.init();
  }

  async init() {
    console.log('[Bucket Viewer] init() - Starting initialization');

    // 清空localStorage历史数据（插件启动时）
    this.clearLocalStorageHistory();

    // 获取URL参数
    this.parseUrlParams();
    console.log('[Bucket Viewer] init() - Parsed params:', { bucketId: this.bucketId, bucketUrl: this.bucketUrl });

    // 绑定事件监听器
    this.bindEvents();

    // 根据参数类型决定显示界面
    if (this.bucketId) {
      console.log('[Bucket Viewer] init() - Has bucketId, loading data directly');
      // 如果有bucketId（后台解析完成），直接加载数据
      this.showUrlInputSection(false);
      await this.loadData();
    } else {
      console.log('[Bucket Viewer] init() - No bucketId, showing URL input');
      // 没有bucketId，总是显示URL输入界面
      this.showUrlInputSection(true);
      this.hideLoading();

      // 如果有预填充的URL，设置到输入框并显示提示
      if (this.bucketUrl) {
        console.log('[Bucket Viewer] Pre-filling URL input with:', this.bucketUrl);
        setTimeout(() => {
          const urlInput = document.getElementById('bucketUrlInput');
          if (urlInput) {
            urlInput.value = this.bucketUrl;
            console.log('[Bucket Viewer] URL pre-filled successfully');
          } else {
            console.error('[Bucket Viewer] URL input element not found for pre-filling');
          }
        }, 200);
      }

      // 强制确保URL输入框可见
      setTimeout(() => {
        const urlSection = document.getElementById('urlInputSection');
        if (urlSection) {
          console.log('[Bucket Viewer] Force showing URL input section');
          urlSection.classList.remove('hidden');
          urlSection.style.display = 'flex';
          urlSection.style.visibility = 'visible';
        } else {
          console.error('[Bucket Viewer] URL input section not found in DOM!');
        }

        // 隐藏其他可能显示的元素
        const bucketInfo = document.getElementById('bucketInfo');
        if (bucketInfo) {
          bucketInfo.classList.add('hidden');
          bucketInfo.style.display = 'none';
        }
      }, 100);
    }

    // 渲染界面
    this.render();

    // 重试绑定待处理的按钮
    setTimeout(() => {
      this.retryPendingBindings();
    }, 500);

    // 初始化PUT覆盖功能
    this.loadDetectionHistory();

    // 添加按钮点击测试（开发模式）
    if (window.location.search.includes('debug=true')) {
      this.addButtonTestListeners();
    }

    console.log('[Bucket Viewer] init() - Initialization complete');
  }

  parseUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    this.bucketId = urlParams.get('bucket');
    this.bucketUrl = urlParams.get('url');
  }

  bindEvents() {
    // URL输入事件
    const parseBtn = document.getElementById('parseUrlBtn');
    const urlInput = document.getElementById('bucketUrlInput');
    if (parseBtn && urlInput) {
      parseBtn.addEventListener('click', () => this.parseUrlInput());
      urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.parseUrlInput();
        }
      });
    }

  
    // 折叠式组件事件
    this.bindButton('templatesToggle', () => this.toggleSection('templatesToggle', 'templatesContent'));
    this.bindButton('historyToggle', () => this.toggleSection('historyToggle', 'historyContent'));

    // 快捷模板事件（使用事件委托处理动态生成的模板）
    document.addEventListener('click', (e) => {
      if (e.target.closest('.template-btn')) {
        const btn = e.target.closest('.template-btn');
        this.applyTemplate(btn.dataset.url);
      }
    });

    // 历史记录事件（使用事件委托）
    this.loadUrlHistory();
    document.addEventListener('click', (e) => {
      // 处理左侧历史记录点击（非复制功能）
      if (e.target.closest('.history-item') &&
          !e.target.classList.contains('detection-copy-btn') &&
          !e.target.classList.contains('detection-path')) {
        const historyItem = e.target.closest('.history-item');
        const copyPath = historyItem.querySelector('.detection-path');
        if (copyPath && copyPath.dataset.copyUrl) {
          document.getElementById('bucketUrlInput').value = copyPath.dataset.copyUrl;
        }
      }
    });

    // 工具栏事件
    this.bindButton('refreshBtn', () => this.refreshData());
    this.bindButton('exportBtn', () => this.exportData());

    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });

    // 过滤和搜索
    this.bindButton('categoryFilter', () => this.applyFilters(), 'change');
    this.bindButton('searchInput', () => this.applyFilters(), 'input');
    this.bindButton('searchBtn', () => this.applyFilters());

    // 排序
    this.bindButton('sortBy', () => this.applySorting(), 'change');
    this.bindButton('sortOrderBtn', () => this.toggleSortOrder());

    // 分页
    this.bindButton('firstPageBtn', () => this.goToPage(1));
    this.bindButton('prevPageBtn', () => this.goToPage(this.currentPage - 1));
    this.bindButton('nextPageBtn', () => this.goToPage(this.currentPage + 1));
    this.bindButton('lastPageBtn', () => this.goToPage(this.totalPages));

    // PUT覆盖功能事件绑定
    this.bindPutOverrideEvents();

    // 绑定复制功能事件
    this.bindCopyEvents();

    // 文件操作事件委托（处理网格和列表中的文件操作按钮）
    this.bindFileActionEvents();

    // 图片预览模态框 - 使用事件委托确保动态绑定
    this.bindModalEvents();

    // 键盘事件
    document.addEventListener('keydown', (e) => this.handleKeydown(e));

    // 错误重试
    this.bindButton('retryBtn', () => this.refreshData());

    // 表格排序
    document.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const sortBy = th.dataset.sort;
        this.setSorting(sortBy);
      });
    });
  }

  async loadData() {
    try {
      this.showLoading(true);
      console.log('[Viewer] Starting data loading...');
      console.log('[Viewer] Bucket ID:', this.bucketId);
      console.log('[Viewer] Bucket URL:', this.bucketUrl);

      let result;
      if (this.bucketId) {
        console.log('[Viewer] Loading existing bucket data for ID:', this.bucketId);
        result = await this.sendMessage({ type: 'getBucketData', bucketId: this.bucketId });
      } else if (this.bucketUrl) {
        console.log('[Viewer] Parsing new bucket URL:', this.bucketUrl);
        result = await this.sendMessage({ type: 'parseBucket', url: this.bucketUrl });
        console.log('[Viewer] Parse result:', result);

        if (result.success) {
          console.log('[Viewer] Parse successful, bucket ID:', result.bucketId);
          this.bucketId = result.bucketId;
          result = await this.sendMessage({ type: 'getBucketData', bucketId: this.bucketId });
          console.log('[Viewer] Get bucket data result:', result);
        }
      }

      if (result && result.success) {
        console.log('[Viewer] Data load successful');
        console.log('[Viewer] Files array length:', result.files ? result.files.length : 'undefined');
        console.log('[Viewer] Files array:', result.files);

        this.files = result.files || [];
        this.filteredFiles = [...this.files];

        console.log('[Viewer] Final files count:', this.files.length);
        this.updateBucketInfo(result.bucket);
        this.hideError();

        // 如果没有文件，显示提示
        if (this.files.length === 0) {
          console.log('[Viewer] No files found in bucket');
          this.showEmptyState();
        } else {
          console.log('[Viewer] Files found, rendering them');
          // 有文件时，应用默认的过滤和排序，然后渲染
          this.applyFilters();
          this.applySorting();
        }
      } else {
        console.error('[Viewer] Load failed:', result);
        throw new Error(result?.error || 'Failed to load bucket data');
      }

    } catch (error) {
      console.error('[Viewer] Load error:', error);
      console.error('[Viewer] Error stack:', error.stack);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  async refreshData() {
    await this.loadData();
    this.applyFilters();
    this.applySorting();
    this.render();
  }

  updateBucketInfo(bucket) {
    if (bucket) {
      document.getElementById('bucketUrl').textContent = bucket.url || 'Unknown';
      document.getElementById('fileCount').textContent = `${this.files.length} 个文件`;
    }
  }

  // 显示空状态
  showEmptyState() {
    // 确保其他状态已隐藏
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');

    // 显示空状态
    const emptyState = document.getElementById('emptyState');
    emptyState.classList.remove('hidden');

    // 隐藏文件列表视图
    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('listView').classList.add('hidden');

    // 隐藏工具栏
    document.querySelector('.toolbar').classList.add('hidden');

    // 隐藏分页
    document.getElementById('pagination').classList.add('hidden');
  }

  // 隐藏空状态
  hideEmptyState() {
    // 确保加载状态也隐藏
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('gridView').classList.remove('hidden');
    document.getElementById('listView').classList.remove('hidden');
    document.querySelector('.toolbar').classList.remove('hidden');
    document.getElementById('pagination').classList.remove('hidden');
  }

  applyFilters() {
    this.categoryFilter = document.getElementById('categoryFilter').value;
    this.searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();

    this.filteredFiles = this.files.filter(file => {
      // 分类过滤
      if (this.categoryFilter && file.category !== this.categoryFilter) {
        return false;
      }

      // 搜索过滤
      if (this.searchQuery) {
        const key = (file.Key || '').toLowerCase();
        if (!key.includes(this.searchQuery)) {
          return false;
        }
      }

      return true;
    });

    this.currentPage = 1;
    this.applySorting();
    this.render();
  }

  applySorting() {
    this.sortBy = document.getElementById('sortBy').value;

    this.filteredFiles.sort((a, b) => {
      let aVal, bVal;

      switch (this.sortBy) {
        case 'name':
          aVal = a.Key || '';
          bVal = b.Key || '';
          break;
        case 'size':
          aVal = parseInt(a.Size) || 0;
          bVal = parseInt(b.Size) || 0;
          break;
        case 'modified':
          aVal = new Date(a.LastModified || 0);
          bVal = new Date(b.LastModified || 0);
          break;
        case 'type':
          aVal = a.file_type || '';
          bVal = b.file_type || '';
          break;
        default:
          aVal = a.Key || '';
          bVal = b.Key || '';
      }

      if (typeof aVal === 'string') {
        return this.sortOrder === 'asc' ?
          aVal.localeCompare(bVal) :
          bVal.localeCompare(aVal);
      } else {
        return this.sortOrder === 'asc' ?
          aVal - bVal :
          bVal - aVal;
      }
    });

    this.render();
  }

  toggleSortOrder() {
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    const btn = document.getElementById('sortOrderBtn');
    btn.querySelector('.icon').textContent = this.sortOrder === 'asc' ? '↑' : '↓';
    this.applySorting();
  }

  setSorting(sortBy) {
    this.sortBy = sortBy;
    document.getElementById('sortBy').value = sortBy;
    this.applySorting();
  }

  switchView(view) {
    this.currentView = view;

    // 更新按钮状态
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // 切换视图
    document.getElementById('gridView').classList.toggle('hidden', view !== 'grid');
    document.getElementById('listView').classList.toggle('hidden', view !== 'list');

    this.renderCurrentPage();
  }

  render() {
    console.log('[Viewer] Rendering UI...');
    console.log('[Viewer] Files count:', this.files.length);
    console.log('[Viewer] Filtered files count:', this.filteredFiles.length);

    // 如果没有文件，显示空状态
    if (this.files.length === 0) {
      console.log('[Viewer] No files to render, showing empty state');
      this.showEmptyState();
      return;
    }

    // 有文件时显示正常的UI
    this.hideEmptyState();
    this.updatePaginationInfo();
    this.renderPagination();
    this.renderCurrentPage();
  }

  updatePaginationInfo() {
    this.totalPages = Math.ceil(this.filteredFiles.length / this.pageSize);
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.filteredFiles.length);
    const total = this.filteredFiles.length;

    document.getElementById('paginationInfo').textContent =
      `显示 ${start}-${end} 条，共 ${total} 条`;
  }

  renderPagination() {
    const container = document.getElementById('pageNumbers');
    container.innerHTML = '';

    const maxVisible = 7;
    let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      const btn = document.createElement('button');
      btn.className = 'page-number';
      btn.textContent = i;
      btn.classList.toggle('active', i === this.currentPage);
      btn.addEventListener('click', () => this.goToPage(i));
      container.appendChild(btn);
    }

    // 更新按钮状态
    document.getElementById('firstPageBtn').disabled = this.currentPage === 1;
    document.getElementById('prevPageBtn').disabled = this.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = this.currentPage === this.totalPages;
    document.getElementById('lastPageBtn').disabled = this.currentPage === this.totalPages;
  }

  renderCurrentPage() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageFiles = this.filteredFiles.slice(start, end);

    if (this.currentView === 'grid') {
      this.renderGridView(pageFiles);
    } else {
      this.renderListView(pageFiles);
    }

    // 显示/隐藏空状态
    const hasFiles = this.filteredFiles.length > 0;
    document.getElementById('gridView').classList.toggle('hidden', !hasFiles || this.currentView !== 'grid');
    document.getElementById('listView').classList.toggle('hidden', !hasFiles || this.currentView !== 'list');
    document.getElementById('emptyState').classList.toggle('hidden', hasFiles);
  }

  renderGridView(files) {
    const container = document.getElementById('fileGrid');
    container.innerHTML = '';

    files.forEach(file => {
      const item = this.createGridItem(file);
      container.appendChild(item);
    });
  }

  createGridItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const isImage = file.category === 'images';
    const fileUrl = file.url || '';
    const fileName = file.Key || 'Unknown';
    const fileSize = this.formatFileSize(file.Size);

    item.innerHTML = `
      <div class="file-preview">
        ${isImage ?
          `<img src="${fileUrl}" alt="${fileName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="file-icon" style="display: none;">📄</div>` :
          `<div class="file-icon">${this.getFileIcon(file.file_type)}</div>`
        }
      </div>
      <div class="file-info">
        <div class="file-name" title="${fileName}">${fileName}</div>
        <div class="file-meta">
          <span class="file-size">${fileSize}</span>
          <span class="file-type">${file.file_type || 'folder'}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-action-btn" data-action="download" data-url="${fileUrl}" title="下载">
          <span>📥</span>
        </button>
        ${isImage ?
          `<button class="file-action-btn" data-action="preview" data-index="${this.getImageIndex(fileUrl)}" title="预览">
            <span>👁️</span>
          </button>` :
          file.category === 'documents' ?
          `<button class="file-action-btn preview-doc-btn" data-action="preview-document" data-url="${fileUrl}" data-name="${fileName}" title="预览文档">
            <span>📄</span>
          </button>` :
          `<button class="file-action-btn" data-action="open" data-url="${fileUrl}" title="打开">
            <span>🔗</span>
          </button>`
        }
      </div>
    `;

    return item;
  }

  renderListView(files) {
    const tbody = document.getElementById('fileListBody');
    tbody.innerHTML = '';

    files.forEach(file => {
      const row = this.createListRow(file);
      tbody.appendChild(row);
    });
  }

  createListRow(file) {
    const row = document.createElement('tr');

    const fileName = file.Key || 'Unknown';
    const fileSize = this.formatFileSize(file.Size);
    const modifiedDate = this.formatDate(file.LastModified);
    const fileType = file.file_type || 'folder';
    const fileUrl = file.url || '';

    row.innerHTML = `
      <td>
        <a href="${fileUrl}" class="file-link" target="_blank" rel="noopener noreferrer">
          ${fileName}
        </a>
      </td>
      <td>${fileSize}</td>
      <td>${modifiedDate}</td>
      <td>
        <span class="file-type-badge ${file.category}">${fileType}</span>
      </td>
      <td>
        <button class="btn btn-secondary btn-icon" data-action="download" data-url="${fileUrl}" title="下载">
          <span class="icon">📥</span>
        </button>
        ${file.category === 'images' ?
          `<button class="btn btn-secondary btn-icon" data-action="preview" data-index="${this.getImageIndex(fileUrl)}" title="预览">
            <span class="icon">👁️</span>
          </button>` : ''
        }
        ${file.category === 'documents' ?
          `<button class="btn btn-secondary btn-icon preview-doc-btn" data-action="preview-document" data-url="${fileUrl}" data-name="${fileName}" title="预览文档">
            <span class="icon">📄</span>
          </button>` : ''
        }
      </td>
    `;

    return row;
  }

  getImageIndex(imageUrl) {
    this.imageFiles = this.filteredFiles.filter(f => f.category === 'images');
    return this.imageFiles.findIndex(f => f.url === imageUrl);
  }

  previewImage(index) {
    console.log('[Bucket Viewer] previewImage called with index:', index);

    this.currentImageIndex = index;
    const imageFiles = this.filteredFiles.filter(f => f.category === 'images');

    console.log('[Bucket Viewer] Found image files:', imageFiles.length);

    if (index >= 0 && index < imageFiles.length) {
      const image = imageFiles[index];
      console.log('[Bucket Viewer] Previewing image:', image);

      const modal = document.getElementById('imagePreviewModal');
      const img = document.getElementById('previewImage');
      const title = document.getElementById('previewTitle');
      const info = document.getElementById('imageInfo');

      // 检查元素是否存在
      if (!modal) {
        console.error('[Bucket Viewer] Modal element not found!');
        return;
      }
      if (!img) {
        console.error('[Bucket Viewer] Preview image element not found!');
        return;
      }

      // 设置图片源
      img.src = image.url;
      img.style.transform = 'scale(1)';
      title.textContent = image.Key || 'Image Preview';

      const size = this.formatFileSize(image.Size);
      const modified = this.formatDate(image.LastModified);
      info.innerHTML = `
        <strong>文件名:</strong> ${image.Key}<br>
        <strong>大小:</strong> ${size}<br>
        <strong>类型:</strong> ${image.file_type}<br>
        <strong>修改时间:</strong> ${modified}
      `;

      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      console.log('[Bucket Viewer] Modal opened for image preview');

      // 添加图片加载事件处理
      img.onload = () => {
        console.log('[Bucket Viewer] Image loaded successfully');
      };
      img.onerror = (e) => {
        console.error('[Bucket Viewer] Failed to load image:', e);
        // 可以在这里显示错误信息或占位图
      };
    } else {
      console.error('[Bucket Viewer] Invalid image index:', index, 'Total images:', imageFiles.length);
    }
  }

  closeImagePreview() {
    console.log('[Bucket Viewer] Closing image preview');
    const modal = document.getElementById('imagePreviewModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    } else {
      console.error('[Bucket Viewer] Modal element not found in closeImagePreview');
    }
  }

  showPrevImage() {
    const imageFiles = this.filteredFiles.filter(f => f.category === 'images');
    if (this.currentImageIndex > 0) {
      this.previewImage(this.currentImageIndex - 1);
    } else {
      this.previewImage(imageFiles.length - 1);
    }
  }

  showNextImage() {
    const imageFiles = this.filteredFiles.filter(f => f.category === 'images');
    if (this.currentImageIndex < imageFiles.length - 1) {
      this.previewImage(this.currentImageIndex + 1);
    } else {
      this.previewImage(0);
    }
  }

  zoomImage(factor) {
    console.log('[Bucket Viewer] Zooming image with factor:', factor);
    const img = document.getElementById('previewImage');

    if (!img) {
      console.error('[Bucket Viewer] Preview image element not found');
      return;
    }

    const currentTransform = img.style.transform || 'scale(1)';
    const currentScale = parseFloat(currentTransform.replace(/[^\d.]/g, '')) || 1;
    const newScale = Math.max(0.1, Math.min(5, currentScale * factor));

    console.log('[Bucket Viewer] Zoom:', { currentScale, factor, newScale });
    img.style.transform = `scale(${newScale})`;
  }

  downloadCurrentImage() {
    const imageFiles = this.filteredFiles.filter(f => f.category === 'images');
    if (this.currentImageIndex >= 0 && this.currentImageIndex < imageFiles.length) {
      const image = imageFiles[this.currentImageIndex];
      this.downloadFile(image.url);
    }
  }

  downloadFile(url) {
    console.log('[Bucket Viewer] Downloading file:', url);

    // 获取文件名
    const fileName = url.split('/').pop() || 'download';

    // 在Chrome扩展中使用chrome.downloads API
    if (chrome && chrome.downloads) {
      chrome.downloads.download({
        url: url,
        filename: fileName,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[Bucket Viewer] Download error:', chrome.runtime.lastError);
          // 如果扩展API失败，回退到传统方法
          this.fallbackDownload(url, fileName);
        } else {
          console.log('[Bucket Viewer] Download started:', downloadId);
        }
      });
    } else {
      // 回退到传统的下载方法
      this.fallbackDownload(url, fileName);
    }
  }

  fallbackDownload(url, fileName) {
    console.log('[Bucket Viewer] Using fallback download method');
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.target = '_blank';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  openFile(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  goToPage(page) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.render();
    }
  }

  exportData() {
    const csvContent = this.generateCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `bucket_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  generateCSV() {
    const headers = ['Name', 'Size', 'Last Modified', 'Type', 'URL'];
    const rows = this.filteredFiles.map(file => [
      file.Key || '',
      file.Size || '',
      file.LastModified || '',
      file.file_type || '',
      file.url || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  handleKeydown(e) {
    // 模态框打开时的键盘事件
    if (!document.getElementById('imagePreviewModal').classList.contains('hidden')) {
      switch (e.key) {
        case 'Escape':
          this.closeImagePreview();
          break;
        case 'ArrowLeft':
          this.showPrevImage();
          break;
        case 'ArrowRight':
          this.showNextImage();
          break;
        case '+':
        case '=':
          this.zoomImage(1.2);
          break;
        case '-':
          this.zoomImage(0.8);
          break;
      }
    }
  }

  // 工具方法
  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  formatDate(dateString) {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN');
    } catch {
      return 'Invalid Date';
    }
  }

  getFileIcon(fileType) {
    const iconMap = {
      // 图片
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', webp: '🖼️', svg: '🖼️',
      // 文档
      pdf: '📄', doc: '📝', docx: '📝', txt: '📄', rtf: '📄', odt: '📝',
      // 视频
      mp4: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬', mkv: '🎬',
      // 音频
      mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', wma: '🎵',
      // 压缩包
      zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
      // 代码
      js: '📜', css: '📜', html: '🌐', json: '📋', xml: '📋',
      // 默认
      default: '📄'
    };

    return iconMap[fileType?.toLowerCase()] || iconMap.default;
  }

  showLoading(show) {
    const loadingState = document.getElementById('loadingState');
    loadingState.classList.toggle('hidden', !show);
  }

  hideLoading() {
    this.showLoading(false);
    // 隐藏所有文件展示相关的状态，避免在没有数据时显示加载状态
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('listView').classList.add('hidden');
    document.getElementById('pagination').classList.add('hidden');
  }

  showError(message) {
    const errorState = document.getElementById('errorState');
    const errorMessage = document.getElementById('errorMessage');

    errorMessage.textContent = message;
    errorState.classList.remove('hidden');

    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('listView').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
  }

  hideError() {
    document.getElementById('errorState').classList.add('hidden');
  }

  async sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // 解析用户输入的URL
  async parseUrlInput() {
    const urlInput = document.getElementById('bucketUrlInput');
    const url = urlInput.value.trim();

    if (!url) {
      this.showMessage('请输入存储桶URL', 'error');
      urlInput.focus();
      return;
    }

    // 简单的URL格式检查
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.showMessage('请输入有效的URL，必须以 http:// 或 https:// 开头', 'error');
      urlInput.focus();
      return;
    }

    // 检查URL格式
    if (!this.isBucketUrl(url)) {
      const confirmResult = confirm('URL格式可能不正确，是否继续解析？\n\n常见格式：\n- http://minio.example.com/bucket/\n- https://bucket.s3.amazonaws.com/');
      if (!confirmResult) {
        urlInput.focus();
        return;
      }
    }

    // 添加到历史记录
    this.addToHistory(url);

    this.bucketUrl = url;
    this.bucketId = null;

    // 切换显示状态
    this.showUrlInputSection(false);
    this.showMessage('正在解析存储桶...', 'info');

    await this.loadData();
  }

  // 显示消息（替代alert）
  showMessage(message, type = 'info') {
    // 创建临时消息提示
    const messageDiv = document.createElement('div');
    messageDiv.className = `temp-message ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      animation: slideIn 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;

    // 根据类型设置颜色
    const colors = {
      error: { bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' },
      info: { bg: '#d1ecf1', color: '#0c5460', border: '#bee5eb' },
      success: { bg: '#d4edda', color: '#155724', border: '#c3e6cb' }
    };

    const color = colors[type] || colors.info;
    messageDiv.style.background = color.bg;
    messageDiv.style.color = color.color;
    messageDiv.style.border = `1px solid ${color.border}`;

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(messageDiv);

    // 3秒后自动移除
    setTimeout(() => {
      messageDiv.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        document.body.removeChild(messageDiv);
        document.head.removeChild(style);
      }, 300);
    }, 3000);
  }

  // 安全的按钮绑定方法
  bindButton(elementId, handler, eventType = 'click') {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener(eventType, handler);
      console.log(`[Bucket Viewer] Successfully bound ${eventType} event to ${elementId}`);
    } else {
      console.warn(`[Bucket Viewer] Element not found: ${elementId} - will retry later`);
      // 将未绑定的按钮存储起来，稍后重试
      if (!this.pendingBindings) this.pendingBindings = [];
      this.pendingBindings.push({ elementId, handler, eventType });
    }
  }

  // 重试绑定待处理的按钮
  retryPendingBindings() {
    if (!this.pendingBindings) return;

    console.log(`[Bucket Viewer] Retrying ${this.pendingBindings.length} pending bindings`);

    this.pendingBindings = this.pendingBindings.filter(binding => {
      const element = document.getElementById(binding.elementId);
      if (element) {
        element.addEventListener(binding.eventType, binding.handler);
        console.log(`[Bucket Viewer] Successfully bound retry event to ${binding.elementId}`);
        return false; // 移除已绑定的
      }
      return true; // 保留未找到的
    });
  }

  // 绑定文件操作事件
  bindFileActionEvents() {
    console.log('[Bucket Viewer] Binding file action events');

    // 使用事件委托处理文件操作按钮
    document.addEventListener('click', (e) => {
      const button = e.target.closest('.file-action-btn, .btn[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const url = button.dataset.url;
      const index = button.dataset.index;
      const name = button.dataset.name;

      console.log('[Bucket Viewer] File action clicked:', { action, url, index, name });

      e.preventDefault();
      e.stopPropagation();

      switch (action) {
        case 'download':
          if (url) {
            this.downloadFile(url);
          } else {
            console.error('[Bucket Viewer] No URL provided for download action');
          }
          break;

        case 'preview':
          if (index !== undefined) {
            this.previewImage(parseInt(index));
          } else {
            console.error('[Bucket Viewer] No index provided for preview action');
          }
          break;

        case 'preview-document':
          if (url && name) {
            this.previewDocument(url, name);
          } else {
            console.error('[Bucket Viewer] No URL or name provided for document preview action');
          }
          break;

        case 'open':
          if (url) {
            this.openFile(url);
          } else {
            console.error('[Bucket Viewer] No URL provided for open action');
          }
          break;

        default:
          console.warn('[Bucket Viewer] Unknown file action:', action);
      }
    });
  }

  // 添加按钮测试监听器（用于调试）
  addButtonTestListeners() {
    console.log('[Bucket Viewer] Adding button test listeners');

    // 测试所有按钮的点击事件
    const buttonIds = [
      'parseUrlBtn', 'refreshBtn', 'exportBtn', 'searchBtn', 'sortOrderBtn',
      'firstPageBtn', 'prevPageBtn', 'nextPageBtn', 'lastPageBtn', 'retryBtn',
      'zoomInBtn', 'zoomOutBtn', 'downloadBtn', 'prevImageBtn', 'nextImageBtn'
    ];

    buttonIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('click', (e) => {
          console.log(`[Bucket Viewer Test] Button clicked: ${id}`, e.target);
        });
        console.log(`[Bucket Viewer Test] Added test listener to: ${id}`);
      } else {
        console.log(`[Bucket Viewer Test] Button not found: ${id}`);
      }
    });

    // 测试输入框事件
    const inputIds = ['bucketUrlInput', 'searchInput', 'categoryFilter', 'sortBy'];
    inputIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('change', (e) => {
          console.log(`[Bucket Viewer Test] Input changed: ${id}`, e.target.value);
        });
        console.log(`[Bucket Viewer Test] Added test listener to input: ${id}`);
      } else {
        console.log(`[Bucket Viewer Test] Input not found: ${id}`);
      }
    });
  }

  // 绑定模态框事件
  bindModalEvents() {
    console.log('[Bucket Viewer] Binding modal events');

    // 使用事件委托，在document上监听点击事件
    document.addEventListener('click', (e) => {
      // 检查是否点击了模态框内的按钮或图标
      const target = e.target.closest('button') || e.target.closest('.modal-close');
      if (!target) return;

      const elementId = target.id;
      console.log(`[Bucket Viewer] Modal button clicked: ${elementId}`, target);

      switch (elementId) {
        case 'modalClose':
          this.closeImagePreview();
          break;
        case 'zoomInBtn':
          // 只在图片预览模式下处理
          if (this.currentImageIndex >= 0) {
            this.zoomImage(1.2);
          }
          break;
        case 'zoomOutBtn':
          // 只在图片预览模式下处理
          if (this.currentImageIndex >= 0) {
            this.zoomImage(0.8);
          }
          break;
        case 'downloadBtn':
          this.downloadCurrentImage();
          break;
        case 'prevImageBtn':
          this.showPrevImage();
          break;
        case 'nextImageBtn':
          this.showNextImage();
          break;
      }

      // 处理modal-close类的元素
      if (target.classList.contains('modal-close')) {
        this.closeImagePreview();
      }
    });

    // 处理背景点击
    document.getElementById('modalBackdrop')?.addEventListener('click', () => {
      this.closeImagePreview();
    });

    console.log('[Bucket Viewer] Modal events bound using delegation');
  }

  
  // 折叠式组件切换
  toggleSection(toggleId, contentId) {
    const toggle = document.getElementById(toggleId);
    const content = document.getElementById(contentId);

    if (!toggle || !content) return;

    const isExpanded = toggle.classList.contains('expanded');

    if (isExpanded) {
      // 收起
      toggle.classList.remove('expanded');
      content.classList.add('hidden');
    } else {
      // 展开
      toggle.classList.add('expanded');
      content.classList.remove('hidden');
    }

    console.log(`[Bucket Viewer] Toggled section ${toggleId}: ${isExpanded ? 'collapsed' : 'expanded'}`);
  }

  // 控制URL输入区域的显示
  showUrlInputSection(show) {
    console.log('[Bucket Viewer] showUrlInputSection() - show:', show);

    const urlSection = document.getElementById('urlInputSection');
    const bucketInfo = document.getElementById('bucketInfo');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');

    console.log('[Bucket Viewer] Elements found:', {
      urlSection: !!urlSection,
      bucketInfo: !!bucketInfo,
      refreshBtn: !!refreshBtn,
      exportBtn: !!exportBtn
    });

    // URL输入区域始终显示
    console.log('[Bucket Viewer] Always showing URL input section');
    if (urlSection) {
      urlSection.classList.remove('hidden');
      urlSection.style.display = 'flex';
      console.log('[Bucket Viewer] URL input section display set to flex');
    } else {
      console.error('[Bucket Viewer] urlInputSection element not found!');
    }

    // 根据show参数控制其他元素的显示
    if (show) {
      console.log('[Bucket Viewer] Input mode - hiding other elements');
      if (bucketInfo) {
        bucketInfo.classList.add('hidden');
        bucketInfo.style.display = 'none';
      }
      if (refreshBtn) {
        refreshBtn.classList.add('hidden');
        refreshBtn.style.display = 'none';
      }
      if (exportBtn) {
        exportBtn.classList.add('hidden');
        exportBtn.style.display = 'none';
      }
    } else {
      console.log('[Bucket Viewer] Data mode - showing other elements');
      if (bucketInfo) {
        bucketInfo.classList.remove('hidden');
        bucketInfo.style.display = 'flex';
      }
      if (refreshBtn) {
        refreshBtn.classList.remove('hidden');
        refreshBtn.style.display = 'inline-flex';
      }
      if (exportBtn) {
        exportBtn.classList.remove('hidden');
        exportBtn.style.display = 'inline-flex';
      }
    }

    // 重试绑定待处理的按钮（显示/隐藏元素后可能需要重新绑定）
    setTimeout(() => {
      this.retryPendingBindings();
    }, 100);
  }

  // 检查URL是否为存储桶格式
  isBucketUrl(url) {
    const bucketPatterns = [
      /.*s3.*\.amazonaws\.com/,
      /.*\.s3-.*\.amazonaws\.com/,
      /.*s3.*\.aliyuncs\.com/,
      /.*obs.*\.myhuaweicloud\.com/,
      /.*cos.*\.myqcloud\.com/,
      /.*\.oss-.*\.aliyuncs\.com/,
      /.*storage\.googleapis\.com/,
      // MinIO 服务器支持
      /.*minio\..*/,
      // 通用对象存储模式
      /^[a-z]+:\/\/[a-z0-9.-]+\/[a-z0-9-_]+\/?$/i,
      /\/[a-z0-9-_]+\/?$/i
    ];

    return bucketPatterns.some(pattern => pattern.test(url));
  }

  // 应用URL模板
  applyTemplate(template) {
    const input = document.getElementById('bucketUrlInput');

    // 简单的模板应用 - 直接填入模板供用户修改
    input.value = template;
    input.focus();

    // 如果模板包含占位符，选中第一个占位符
    if (template.includes('{')) {
      const start = template.indexOf('{');
      const end = template.indexOf('}');
      if (start !== -1 && end !== -1) {
        input.setSelectionRange(start, end + 1);
      }
    }
  }

  // 加载URL历史记录
  loadUrlHistory() {
    try {
      const history = localStorage.getItem('bucket-viewer-url-history');
      if (history) {
        const urls = JSON.parse(history);
        this.renderUrlHistory(urls);
      }
    } catch (error) {
      console.error('Error loading URL history:', error);
    }
  }

  // 渲染URL历史记录
  renderUrlHistory(urls) {
    const historyList = document.getElementById('historyList');

    if (!urls || urls.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      return;
    }

    historyList.innerHTML = urls.map((item, index) => {
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="history-item">
          <div class="detection-info">
            <span class="detection-icon">🔍</span>
            <span class="detection-path"
                  title="点击复制URL: ${item.url}"
                  data-copy-url="${item.url}">${this.truncatePath(item.url, 50)}</span>
            <button class="detection-copy-btn"
                    title="复制URL"
                    data-copy-url="${item.url}">
              📋
            </button>
          </div>
          <span class="detection-time">${timeStr}</span>
        </div>
      `;
    }).join('');
  }

  // 添加URL到历史记录
  addToHistory(url) {
    try {
      let history = localStorage.getItem('bucket-viewer-url-history');
      history = history ? JSON.parse(history) : [];

      // 移除重复的URL
      history = history.filter(item => item.url !== url);

      // 添加到开头
      history.unshift({
        url: url,
        timestamp: new Date().toISOString()
      });

      // 只保留最近10条记录
      history = history.slice(0, 10);

      localStorage.setItem('bucket-viewer-url-history', JSON.stringify(history));
      this.renderUrlHistory(history);
    } catch (error) {
      console.error('Error saving URL history:', error);
    }
  }

  // 截断URL显示
  truncateUrl(url, maxLength) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  }

  // 文档预览功能
  async previewDocument(url, fileName) {
    console.log('[Bucket Viewer] previewDocument called:', { url, fileName });

    const fileExtension = this.getFileExtension(fileName);

    // 检查文件大小限制（50MB）
    try {
      const headResponse = await fetch(url, { method: 'HEAD' });
      const contentLength = headResponse.headers.get('content-length');
      const fileSize = contentLength ? parseInt(contentLength) : 0;

      if (fileSize > 50 * 1024 * 1024) { // 50MB
        this.showMessage('文件大小超过50MB限制，无法预览', 'error');
        return;
      }
    } catch (error) {
      console.warn('[Bucket Viewer] Could not check file size:', error);
    }

    // 根据文件类型选择预览方式
    if (fileExtension === 'pdf') {
      this.previewPDF(url, fileName);
    } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(fileExtension)) {
      this.previewOfficeDocument(url, fileName);
    } else {
      this.showMessage('暂不支持此类型文档的预览', 'warning');
    }
  }

  // PDF预览 - 浏览器原生预览
  async previewPDF(url, fileName) {
    console.log('[Bucket Viewer] previewPDF called:', { url, fileName });

    // 检查文件大小
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const fileSize = parseInt(contentLength);
        if (fileSize > 50 * 1024 * 1024) { // 50MB
          this.showMessage('文件大小超过50MB限制，无法预览', 'error');
          return;
        }
      }
    } catch (error) {
      console.warn('[Bucket Viewer] Could not check file size:', error);
    }

    // 直接使用浏览器预览
    this.previewPDFInBrowser(url, fileName);
  }

  // 浏览器原生PDF预览
  previewPDFInBrowser(url, fileName) {
    this.showModal('PDF预览', `
      <div class="pdf-browser-preview">
        <div class="pdf-browser-controls">
          <div class="pdf-browser-info">
            <span class="pdf-browser-title">${fileName}</span>
            <span class="pdf-browser-url">${url}</span>
          </div>
          <div class="pdf-browser-actions">
            <button class="btn btn-secondary" onclick="window.open('${url}', '_blank')">
              <span class="icon">🔗</span>
              新标签页打开
            </button>
            <button class="btn btn-primary" onclick="window.location.href='${url}'">
              <span class="icon">⬇️</span>
              下载PDF
            </button>
          </div>
        </div>
        <div class="pdf-browser-frame">
          <iframe src="${url}"
                  width="100%"
                  height="600px"
                  style="border: 1px solid #e5e7eb; border-radius: 8px;"
                  onload="console.log('[Bucket Viewer] PDF iframe loaded successfully')"
                  onerror="console.error('[Bucket Viewer] PDF iframe failed to load')">
            <p>您的浏览器不支持PDF预览，请尝试点击上方"新标签页打开"按钮。</p>
          </iframe>
        </div>
        <div class="pdf-browser-fallback">
          <p>如果无法显示PDF，请确保浏览器支持PDF预览或尝试点击上方按钮。</p>
        </div>
      </div>
    `, 'large');
  }

  // Office文档预览
  previewOfficeDocument(url, fileName) {
    console.log('[Bucket Viewer] previewOfficeDocument called:', { url, fileName });

    const fileExtension = this.getFileExtension(fileName);
    const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;

    console.log('[Bucket Viewer] Office viewer URL:', viewerUrl);

    // 显示模态框
    this.showModal('Office文档预览', `
      <div class="office-preview">
        <div class="office-loading" id="officeLoading">
          <div class="office-loading-spinner"></div>
          <div>正在加载Office文档...</div>
        </div>
        <iframe
          class="office-frame"
          src="${viewerUrl}"
        ></iframe>
        <div class="document-error" id="officeError" style="display: none;">
          <div class="document-error-icon">❌</div>
          <div class="document-error-message">Office文档加载失败</div>
          <div class="document-error-details">
            可能原因：<br>
            • 文档无法通过公网访问<br>
            • 文档格式不受支持<br>
            • 网络连接问题
          </div>
          <button class="btn btn-primary" onclick="window.open('${viewerUrl}', '_blank')">
            在新窗口中打开
          </button>
        </div>
      </div>
    `, 'large');

    // 设置多种检测机制来隐藏加载动画
    setTimeout(() => {
      this.hideOfficeLoading();
    }, 8000); // 8秒后隐藏加载动画

    // 添加iframe事件监听
    setTimeout(() => {
      const iframe = document.querySelector('.office-frame');
      const loading = document.getElementById('officeLoading');

      if (iframe && loading) {
        // 监听iframe加载事件
        iframe.addEventListener('load', () => {
          console.log('[Bucket Viewer] Office iframe loaded');
          setTimeout(() => this.hideOfficeLoading(), 1000);
        });

        // 定期检查iframe是否加载完成
        const checkInterval = setInterval(() => {
          try {
            // 尝试访问iframe内容来判断是否加载完成
            if (iframe.contentWindow && iframe.contentWindow.document.readyState === 'complete') {
              console.log('[Bucket Viewer] Office iframe document complete');
              clearInterval(checkInterval);
              setTimeout(() => this.hideOfficeLoading(), 500);
            }
          } catch (e) {
            // 跨域情况下无法访问，但通常意味着iframe已加载
            console.log('[Bucket Viewer] Office iframe likely loaded (cross-origin)');
            clearInterval(checkInterval);
            setTimeout(() => this.hideOfficeLoading(), 2000);
          }
        }, 2000);

        // 30秒后强制清除检测
        setTimeout(() => {
          clearInterval(checkInterval);
          this.hideOfficeLoading();
        }, 30000);
      }
    }, 100);
  }

  // 隐藏Office文档加载提示
  hideOfficeLoading() {
    const loading = document.getElementById('officeLoading');
    if (loading && loading.style.display !== 'none') {
      console.log('[Bucket Viewer] Hiding Office loading animation');
      loading.style.display = 'none';
    }
  }

  // 获取文件扩展名
  getFileExtension(fileName) {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  // 显示模态框（扩展现有功能）
  showModal(title, content, size = 'medium') {
    console.log('[Bucket Viewer] showModal called:', { title, size });

    // 移除现有模态框
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content modal-${size}">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="modalCloseBtn">&times;</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 绑定关闭事件
    const closeBtn = document.getElementById('modalCloseBtn');
    closeBtn.addEventListener('click', () => this.closeModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });

    // ESC键关闭
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 显示模态框
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);
  }

  // 关闭模态框
  closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.remove();
        // 清理PDF实例
        if (this.currentPDF) {
          this.currentPDF = null;
          this.currentPDFPage = null;
          this.currentPDFScale = null;
        }
      }, 300);
    }
  }

  // === PUT覆盖功能相关方法 ===

  // 绑定PUT覆盖功能事件
  bindPutOverrideEvents() {
    console.log('[Bucket Viewer] Binding PUT override events');

    const detectBtn = document.getElementById('detectPutPermissionBtn');
    const uploadBtn = document.getElementById('uploadOverrideBtn');
    const pathInput = document.getElementById('overridePathInput');
    const fileInput = document.getElementById('overrideFileInput');

    if (detectBtn && pathInput) {
      detectBtn.addEventListener('click', () => this.detectPutPermission());
      pathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.detectPutPermission();
        }
      });
    }

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => this.uploadFile());
      fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
    }

    console.log('[Bucket Viewer] PUT override events bound successfully');
  }

  // 检测PUT权限
  async detectPutPermission() {
    const pathInput = document.getElementById('overridePathInput');
    const path = pathInput.value.trim();

    if (!path) {
      this.showDetectionResult('请输入要检测的路径', 'error');
      return;
    }

    if (!this.bucketUrl && !this.bucketId) {
      this.showDetectionResult('请先解析存储桶URL', 'error');
      return;
    }

    console.log('[Bucket Viewer] Detecting PUT permission for path:', path);

    // 显示检测中状态
    this.showDetectionResult('正在检测PUT权限...', 'pending');

    try {
      const result = await this.performPutDetection(path);
      this.handleDetectionResult(path, result);
    } catch (error) {
      console.error('[Bucket Viewer] PUT detection error:', error);
      this.showDetectionResult(`检测失败: ${error.message}`, 'error');
    }
  }

  // 执行PUT权限检测
  async performPutDetection(path) {
    const testUrl = this.buildTestUrl(path);
    const testData = {
      test: true,
      timestamp: Date.now(),
      path: path,
      source: 'bucket-viewer-extension'
    };

    console.log('[Bucket Viewer] Performing PUT test to:', testUrl);

    try {
      const response = await fetch(testUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'BucketViewer'
        },
        body: JSON.stringify(testData)
      });

      console.log('[Bucket Viewer] PUT test response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: testUrl,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Bucket Viewer] PUT test fetch error:', error);
      return {
        success: false,
        error: error.message,
        url: testUrl,
        timestamp: Date.now()
      };
    }
  }

  // 构建测试URL
  buildTestUrl(path) {
    let baseUrl = this.bucketUrl;

    // 如果没有bucketUrl，尝试从bucketInfo获取
    if (!baseUrl) {
      const bucketInfo = document.getElementById('bucketUrl');
      if (bucketInfo && bucketInfo.textContent) {
        baseUrl = bucketInfo.textContent;
      }
    }

    if (!baseUrl) {
      throw new Error('无法获取存储桶URL');
    }

    // 确保URL格式正确
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }

    // 确保路径不以/开头
    const normalizedPath = path.startsWith('/') ? path.substring(1) : path;

    return baseUrl + normalizedPath;
  }

  // 显示检测结果
  showDetectionResult(message, type) {
    const resultDiv = document.getElementById('putDetectionResult');
    if (!resultDiv) {
      console.error('[Bucket Viewer] Detection result element not found');
      return;
    }

    resultDiv.className = `detection-result ${type}`;

    if (type === 'pending') {
      resultDiv.innerHTML = `
        <div class="detection-loading">
          <div class="detection-spinner"></div>
          <span>${message}</span>
        </div>
      `;
    } else {
      const icon = type === 'success' ? '✅' : '❌';
      resultDiv.innerHTML = `
        <div class="detection-message">
          <span class="result-icon">${icon}</span>
          <span class="result-text">${message}</span>
        </div>
      `;
    }

    resultDiv.classList.remove('hidden');
  }

  // 处理检测结果
  handleDetectionResult(path, result) {
    const timestamp = new Date().toISOString();

    console.log('[Bucket Viewer] Handling detection result:', result);

    if (result.success) {
      this.showDetectionResult(
        `✅ PUT权限检测成功！可以对路径 "${path}" 进行写入操作`,
        'success'
      );
    } else {
      const errorMsg = result.error || `HTTP ${result.status}: ${result.statusText}`;
      this.showDetectionResult(
        `❌ PUT权限检测失败！无法对路径 "${path}" 进行写入操作 (${errorMsg})`,
        'error'
      );
    }

    // 添加到检测历史
    this.addToDetectionHistory({
      path: path,
      result: result,
      timestamp: timestamp,
      bucketUrl: this.bucketUrl || this.getCurrentBucketUrl()
    });
  }

  // 获取当前存储桶URL
  getCurrentBucketUrl() {
    const bucketInfo = document.getElementById('bucketUrl');
    return bucketInfo ? bucketInfo.textContent : null;
  }

  // 添加到检测历史
  addToDetectionHistory(detection) {
    this.putDetectionHistory.unshift(detection);
    // 只保留最近20条记录
    this.putDetectionHistory = this.putDetectionHistory.slice(0, 20);

    // 保存到localStorage
    try {
      localStorage.setItem('bucket-put-detection-history',
        JSON.stringify(this.putDetectionHistory));
    } catch (error) {
      console.error('[Bucket Viewer] Error saving detection history:', error);
    }

    this.renderDetectionHistory();
  }

  // 渲染检测历史
  renderDetectionHistory() {
    const historyList = document.getElementById('putHistoryList');
    if (!historyList) {
      console.error('[Bucket Viewer] PUT history list element not found');
      return;
    }

    if (this.putDetectionHistory.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无检测记录</div>';
      return;
    }

    historyList.innerHTML = this.putDetectionHistory.map(item => {
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleDateString('zh-CN') + ' ' +
        date.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });

      const successIcon = item.result.success ? '✅' : '❌';
      const statusClass = item.result.success ? 'success' : 'error';

      return `
        <div class="detection-history-item ${statusClass}">
          <div class="detection-info">
            <span class="detection-icon">${successIcon}</span>
            <span class="detection-path" title="${item.path}">${this.truncatePath(item.path, 30)}</span>
          </div>
          <span class="detection-time">${timeStr}</span>
        </div>
      `;
    }).join('');
  }

  // 截断路径显示
  truncatePath(path, maxLength) {
    if (path.length <= maxLength) return path;

    // 如果是URL，优先保留域名部分，截断路径部分
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const urlParts = path.split('/');
      if (urlParts.length >= 3) {
        const protocol = urlParts[0] + '//';
        const domain = urlParts[2];
        const rest = urlParts.slice(3).join('/');

        const domainLength = protocol.length + domain.length;
        if (domainLength < maxLength - 10) {
          // 保留完整域名，截断路径部分
          const remainingLength = maxLength - domainLength - 6; // 6 for "..." + "/"
          if (remainingLength > 0 && rest.length > remainingLength) {
            return protocol + domain + '/' + rest.substring(0, remainingLength) + '...';
          }
        }
      }
    }

    // 普通截断
    return path.substring(0, maxLength - 3) + '...';
  }

  // 清空localStorage历史数据（插件启动时调用）
  clearLocalStorageHistory() {
    try {
      console.log('[Bucket Viewer] Clearing localStorage history on startup...');

      // 清空URL历史记录
      localStorage.removeItem('bucket-viewer-url-history');
      console.log('[Bucket Viewer] Cleared URL history from localStorage');

      // 清空PUT检测历史记录
      localStorage.removeItem('bucket-put-detection-history');
      console.log('[Bucket Viewer] Cleared PUT detection history from localStorage');

      // 重置内存中的历史数据
      this.putDetectionHistory = [];

      console.log('[Bucket Viewer] All localStorage history cleared successfully');
    } catch (error) {
      console.error('[Bucket Viewer] Error clearing localStorage history:', error);
    }
  }

  // 加载检测历史
  loadDetectionHistory() {
    try {
      const history = localStorage.getItem('bucket-put-detection-history');
      if (history) {
        this.putDetectionHistory = JSON.parse(history);
        console.log('[Bucket Viewer] Loaded detection history:', this.putDetectionHistory.length, 'items');
        this.renderDetectionHistory();
      }
    } catch (error) {
      console.error('[Bucket Viewer] Error loading detection history:', error);
    }
  }

  // === 复制功能相关方法 ===

  // 绑定复制功能事件
  bindCopyEvents() {
    console.log('[Bucket Viewer] Binding copy events');

    // 使用事件委托处理复制按钮点击
    document.addEventListener('click', (e) => {
      // 处理复制按钮点击
      if (e.target.classList.contains('detection-copy-btn') || e.target.closest('.detection-copy-btn')) {
        const button = e.target.classList.contains('detection-copy-btn') ? e.target : e.target.closest('.detection-copy-btn');
        const url = button.dataset.copyUrl;
        if (url) {
          this.copyToClipboard(url, button);
        }
        return;
      }

      // 处理路径文本点击
      if (e.target.classList.contains('detection-path') && e.target.dataset.copyUrl) {
        const url = e.target.dataset.copyUrl;
        if (url) {
          this.copyToClipboard(url, e.target);
        }
        return;
      }
    });
  }

  // 复制到剪贴板
  async copyToClipboard(text, element) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('[Bucket Viewer] Copied to clipboard:', text);

      // 显示复制成功反馈
      this.showCopyFeedback(element, true);

      // 显示成功消息
      this.showMessage('URL已复制到剪贴板', 'success');
    } catch (error) {
      console.error('[Bucket Viewer] Failed to copy to clipboard:', error);

      // 回退方法
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);

        this.showCopyFeedback(element, true);
        this.showMessage('URL已复制到剪贴板', 'success');
      } catch (fallbackError) {
        console.error('[Bucket Viewer] Fallback copy also failed:', fallbackError);
        this.showMessage('复制失败，请手动复制', 'error');
      }
    }
  }

  // 显示复制反馈
  showCopyFeedback(element, success) {
    const originalText = element.textContent;

    if (success) {
      // 如果是按钮，显示勾号
      if (element.classList.contains('detection-copy-btn')) {
        element.textContent = '✓';
        element.classList.add('copied');
      } else {
        // 如果是路径文本，暂时改变颜色
        element.style.color = '#4caf50';
      }
    }

    // 1秒后恢复原状
    setTimeout(() => {
      if (element.classList.contains('detection-copy-btn')) {
        element.textContent = originalText;
        element.classList.remove('copied');
      } else {
        element.style.color = '';
      }
    }, 1500);
  }

  // === 文件上传相关方法 ===

  // 处理文件选择
  handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log('[Bucket Viewer] File selected:', file);

    // 显示文件信息
    const fileName = file.name;
    const fileSize = this.formatFileSize(file.size);

    document.getElementById('selectedFileName').textContent = fileName;
    document.getElementById('selectedFileSize').textContent = fileSize;
    document.getElementById('fileInputText').textContent = fileName;

    const fileInfo = document.getElementById('selectedFileInfo');
    fileInfo.style.display = 'flex';

    // 存储文件引用
    this.selectedFile = file;
  }

  // 上传文件
  async uploadFile() {
    if (!this.selectedFile) {
      this.showDetectionResult('请先选择要上传的文件', 'error');
      return;
    }

    const pathInput = document.getElementById('overridePathInput');
    const path = pathInput.value.trim();

    if (!path) {
      this.showDetectionResult('请输入要覆盖的路径', 'error');
      return;
    }

    if (!this.bucketUrl && !this.bucketId) {
      this.showDetectionResult('请先解析存储桶URL', 'error');
      return;
    }

    console.log('[Bucket Viewer] Uploading file:', this.selectedFile.name, 'to path:', path);

    // 显示上传状态
    this.showDetectionResult('正在上传文件...', 'pending');

    try {
      const result = await this.performFileUpload(this.selectedFile, path);
      this.handleUploadResult(this.selectedFile, path, result);
    } catch (error) {
      console.error('[Bucket Viewer] File upload error:', error);
      this.showDetectionResult(`上传失败: ${error.message}`, 'error');
    }
  }

  // 执行文件上传
  async performFileUpload(file, path) {
    const uploadUrl = this.buildTestUrl(path);

    console.log('[Bucket Viewer] Uploading file to:', uploadUrl);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': this.getContentType(file),
          'X-Requested-With': 'BucketViewer'
        },
        body: file
      });

      console.log('[Bucket Viewer] Upload response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: uploadUrl,
        fileName: file.name,
        fileSize: file.size,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Bucket Viewer] Upload fetch error:', error);
      return {
        success: false,
        error: error.message,
        url: uploadUrl,
        fileName: file.name,
        fileSize: file.size,
        timestamp: Date.now()
      };
    }
  }

  // 获取文件Content-Type
  getContentType(file) {
    const type = file.type;
    if (type) return type;

    // 根据文件扩展名推断Content-Type
    const extension = this.getFileExtension(file.name);
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'pdf': 'application/pdf',
      'json': 'application/json',
      'txt': 'text/plain',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  // 处理上传结果
  handleUploadResult(file, path, result) {
    const timestamp = new Date().toISOString();

    console.log('[Bucket Viewer] Handling upload result:', result);

    if (result.success) {
      this.showDetectionResult(
        `✅ 文件上传成功！${file.name} 已覆盖到路径 "${path}"`,
        'success'
      );

      // 清空文件选择
      this.clearFileSelection();
    } else {
      const errorMsg = result.error || `HTTP ${result.status}: ${result.statusText}`;
      this.showDetectionResult(
        `❌ 文件上传失败！无法将 ${file.name} 上传到路径 "${path}" (${errorMsg})`,
        'error'
      );
    }

    // 添加到操作历史，包含完整的上传路径信息
    this.addToDetectionHistory({
      path: path,
      fileName: file.name,
      fileSize: file.size,
      result: result,
      type: 'upload',
      timestamp: timestamp,
      bucketUrl: this.bucketUrl || this.getCurrentBucketUrl(),
      fullPath: this.buildTestUrl(path) // 添加完整URL路径
    });
  }

  // 清空文件选择
  clearFileSelection() {
    this.selectedFile = null;

    const fileInput = document.getElementById('overrideFileInput');
    if (fileInput) {
      fileInput.value = '';
    }

    const fileInfo = document.getElementById('selectedFileInfo');
    if (fileInfo) {
      fileInfo.style.display = 'none';
    }

    const fileInputText = document.getElementById('fileInputText');
    if (fileInputText) {
      fileInputText.textContent = '选择要上传的文件';
    }
  }

  // 更新操作历史渲染，包含上传记录
  renderDetectionHistory() {
    const historyList = document.getElementById('putHistoryList');
    if (!historyList) {
      console.error('[Bucket Viewer] PUT history list element not found');
      return;
    }

    if (this.putDetectionHistory.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无操作记录</div>';
      return;
    }

    historyList.innerHTML = this.putDetectionHistory.map(item => {
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleDateString('zh-CN') + ' ' +
        date.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });

      const isUpload = item.type === 'upload';
      const icon = isUpload ? '⬆️' : (item.result.success ? '✅' : '❌');
      const statusClass = item.result.success ? 'success' : 'error';

      // 对于上传操作，显示完整的上传路径；对于检测操作，显示检测路径
      let displayPath, tooltipPath, pathClass, copyUrl;
      if (isUpload) {
        // 显示实际的上传路径
        displayPath = item.fullPath || `${item.bucketUrl}${item.path}`;
        tooltipPath = `文件: ${item.fileName}\n大小: ${this.formatFileSize(item.fileSize)}\n完整路径: ${displayPath}`;
        copyUrl = displayPath; // 完整URL用于复制
        displayPath = `→ ${this.truncatePath(displayPath, 50)}`; // 增加显示长度
        pathClass = 'upload-path';
      } else {
        // 检测操作
        displayPath = item.path;
        tooltipPath = `检测路径: ${item.path}\n完整URL: ${item.bucketUrl}${item.path}`;
        copyUrl = `${item.bucketUrl}${item.path}`; // 完整URL用于复制
        displayPath = `🔍 ${this.truncatePath(displayPath, 50)}`; // 增加显示长度
        pathClass = '';
      }

      return `
        <div class="detection-history-item ${statusClass}">
          <div class="detection-info">
            <span class="detection-icon">${icon}</span>
            <span class="detection-path ${pathClass}"
                  title="${tooltipPath}\n点击复制完整URL"
                  data-copy-url="${copyUrl}">${displayPath}</span>
            <button class="detection-copy-btn"
                    title="复制URL"
                    data-copy-url="${copyUrl}">
              📋
            </button>
          </div>
          <span class="detection-time">${timeStr}</span>
        </div>
      `;
    }).join('');
  }
}


// 确保DOM完全加载后再初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Bucket Viewer] DOM loaded, initializing viewer');
    const viewer = new BucketViewer();
    window.viewer = viewer;
  });
} else {
  console.log('[Bucket Viewer] DOM already loaded, initializing viewer immediately');
  const viewer = new BucketViewer();
  window.viewer = viewer;
}