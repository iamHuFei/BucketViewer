// Content Script for Bucket Viewer Extension
// 负责检测页面中的存储桶链接并提供交互功能

class BucketLinkDetector {
  constructor() {
    this.bucketPatterns = [
      /.*s3.*\.amazonaws\.com/,
      /.*\.s3-.*\.amazonaws\.com/,
      /.*s3.*\.aliyuncs\.com/,
      /.*obs.*\.myhuaweicloud\.com/,
      /.*cos.*\.myqcloud\.com/,
      /.*\.oss-.*\.aliyuncs\.com/,
      /.*storage\.googleapis\.com/,
      // MinIO 服务器支持
      /.*minio\..*/,
      // 通用对象存储模式 - 更宽松的检测
      /^[a-z]+:\/\/[a-z0-9.-]+\/[a-z0-9-_]+\/?$/i,
      // 检测是否包含常见的存储桶路径模式
      /\/[a-z0-9-_]+\/?$/i
    ];

    this.init();
  }

  init() {
    // 检测页面中的存储桶链接
    this.detectBucketLinks();

    // 检测当前页面是否是存储桶URL
    this.checkCurrentPage();

    // 监听动态内容变化
    this.observeContentChanges();

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'showNotification') {
        this.showNotification(message.message);
        sendResponse({ success: true });
      }
    });
  }

  detectBucketLinks() {
    const links = document.querySelectorAll('a[href]');
    const bucketLinks = [];

    links.forEach(link => {
      if (this.isBucketUrl(link.href)) {
        bucketLinks.push(link);
        this.addBucketLinkIndicator(link);
      }
    });

    if (bucketLinks.length > 0) {
      console.log(`[Bucket Viewer] Detected ${bucketLinks.length} bucket links on page`);
      this.highlightBucketLinks(bucketLinks);
    }
  }

  isBucketUrl(url) {
    try {
      const urlObj = new URL(url);
      return this.bucketPatterns.some(pattern => pattern.test(urlObj.hostname));
    } catch (e) {
      return false;
    }
  }

  addBucketLinkIndicator(link) {
    // 为存储桶链接添加视觉指示器
    if (!link.classList.contains('bucket-viewer-processed')) {
      link.classList.add('bucket-viewer-link', 'bucket-viewer-processed');

      // 添加小图标
      const indicator = document.createElement('span');
      indicator.className = 'bucket-viewer-indicator';
      indicator.innerHTML = ' 📦';
      indicator.title = '点击右键选择"View Bucket Contents"查看存储桶内容';

      // 将指示器插入到链接后面
      if (link.nextSibling) {
        link.parentNode.insertBefore(indicator, link.nextSibling);
      } else {
        link.parentNode.appendChild(indicator);
      }

      // 添加点击事件监听器（可选的快捷操作）
      link.addEventListener('click', (e) => {
        // 如果按住Ctrl/Cmd键，直接打开查看器
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.openBucketViewer(link.href);
        }
      });
    }
  }

  highlightBucketLinks(bucketLinks) {
    // 为存储桶链接添加特殊样式
    const style = document.createElement('style');
    style.textContent = `
      .bucket-viewer-link {
        position: relative;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: #667eea !important;
      }

      .bucket-viewer-indicator {
        font-size: 0.8em;
        opacity: 0.7;
        cursor: help;
        transition: opacity 0.2s ease;
      }

      .bucket-viewer-indicator:hover {
        opacity: 1;
      }

      .bucket-viewer-link:hover .bucket-viewer-indicator {
        opacity: 1;
      }
    `;

    if (!document.querySelector('#bucket-viewer-styles')) {
      style.id = 'bucket-viewer-styles';
      document.head.appendChild(style);
    }
  }

  observeContentChanges() {
    // 监听DOM变化以检测动态添加的链接
    const observer = new MutationObserver((mutations) => {
      let hasNewLinks = false;

      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查新添加的元素是否包含链接
            const links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
            links.forEach(link => {
              if (this.isBucketUrl(link.href) && !link.classList.contains('bucket-viewer-processed')) {
                this.addBucketLinkIndicator(link);
                hasNewLinks = true;
              }
            });

            // 如果新添加的节点本身就是链接
            if (node.tagName === 'A' && node.href && this.isBucketUrl(node.href)) {
              this.addBucketLinkIndicator(node);
              hasNewLinks = true;
            }
          }
        });
      });

      if (hasNewLinks) {
        console.log('[Bucket Viewer] Detected new bucket links');
      }
    });

    // 观察整个文档的变化
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observer = observer;
  }

  openBucketViewer(bucketUrl) {
    chrome.runtime.sendMessage({
      type: 'openBucketViewer',
      url: bucketUrl
    }).then(response => {
      if (response && response.success) {
        this.showNotification('正在打开存储桶查看器...', 'success');
      }
    }).catch(error => {
      console.error('[Bucket Viewer] Error opening viewer:', error);
      this.showNotification('打开查看器失败', 'error');
    });
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

  showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `bucket-viewer-notification bucket-viewer-${type}`;
    notification.textContent = message;

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      .bucket-viewer-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 1px solid #e1e5e9;
        border-radius: 6px;
        padding: 12px 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        max-width: 300px;
        word-wrap: break-word;
        transform: translateX(100%);
        transition: transform 0.3s ease;
      }

      .bucket-viewer-notification.bucket-viewer-success {
        border-color: #28a745;
        background-color: #d4edda;
        color: #155724;
      }

      .bucket-viewer-notification.bucket-viewer-error {
        border-color: #dc3545;
        background-color: #f8d7da;
        color: #721c24;
      }

      .bucket-viewer-notification.bucket-viewer-info {
        border-color: #17a2b8;
        background-color: #d1ecf1;
        color: #0c5460;
      }

      .bucket-viewer-notification.show {
        transform: translateX(0);
      }
    `;

    if (!document.querySelector('#bucket-viewer-notification-styles')) {
      style.id = 'bucket-viewer-notification-styles';
      document.head.appendChild(style);
    }

    // 添加到页面
    document.body.appendChild(notification);

    // 显示动画
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    // 3秒后自动移除
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  // 检测当前页面是否本身就是存储桶页面
  checkCurrentPage() {
    if (this.isBucketUrl(window.location.href)) {
      console.log('[Bucket Viewer] Current page is a bucket URL');

      // 可以在页面上添加一个浮动按钮
      this.addFloatingButton();
    }
  }

  addFloatingButton() {
    // 创建浮动按钮
    const button = document.createElement('div');
    button.className = 'bucket-viewer-floating-btn';
    button.innerHTML = '📦';
    button.title = '使用 Bucket Viewer 查看此存储桶';

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      .bucket-viewer-floating-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: white;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(102, 126, 234, 0.4);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        z-index: 9999;
      }

      .bucket-viewer-floating-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.6);
      }

      .bucket-viewer-floating-btn:active {
        transform: translateY(0);
      }
    `;

    if (!document.querySelector('#bucket-viewer-floating-styles')) {
      style.id = 'bucket-viewer-floating-styles';
      document.head.appendChild(style);
    }

    // 添加点击事件
    button.addEventListener('click', async () => {
      // 显示提示
      this.showNotification('正在解析存储桶...', 'info');

      // 直接发送解析请求给background
      try {
        const result = await this.sendMessage({
          type: 'parseBucket',
          url: window.location.href
        });

        if (result.success) {
          this.showNotification(`解析成功！发现 ${result.fileCount} 个文件`, 'success');

          // 打开查看器
          setTimeout(() => {
            chrome.tabs.create({
              url: chrome.runtime.getURL('viewer/viewer.html') + `?bucket=${result.bucketId}`
            });
          }, 1000);
        } else {
          this.showNotification(`解析失败: ${result.error}`, 'error');
        }
      } catch (error) {
        console.error('[Bucket Viewer] Error:', error);
        this.showNotification('解析过程中发生错误', 'error');
      }
    });

    // 添加到页面
    document.body.appendChild(button);
  }
}

// 初始化
new BucketLinkDetector();

console.log('[Bucket Viewer] Content script loaded');