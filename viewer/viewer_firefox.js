// Firefox兼容版本的图片预览功能

// 在原viewer.js的基础上，替换previewImage方法中的图片显示逻辑

// Firefox兼容的图片预览方法
window.BucketViewerFirefoxImageFix = function() {
  // 保存原始的previewImage方法
  const originalPreviewImage = window.bucketViewer.previewImage;

  // 重写previewImage方法
  window.bucketViewer.previewImage = function(index) {
    console.log('[Bucket Viewer Firefox] previewImage called with index:', index);

    this.currentImageIndex = index;
    const imageFiles = this.filteredFiles.filter(f => f.category === 'images');

    console.log('[Bucket Viewer Firefox] Found image files:', imageFiles.length);

    if (index >= 0 && index < imageFiles.length) {
      const image = imageFiles[index];
      console.log('[Bucket Viewer Firefox] Previewing image:', image);

      const modal = document.getElementById('imagePreviewModal');
      const img = document.getElementById('previewImage');
      const title = document.getElementById('previewTitle');
      const info = document.getElementById('imageInfo');

      // 检查元素是否存在
      if (!modal) {
        console.error('[Bucket Viewer Firefox] Modal element not found!');
        return;
      }
      if (!img) {
        console.error('[Bucket Viewer Firefox] Preview image element not found!');
        return;
      }

      // 检测是否为Firefox
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

      // 显示模态框
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      console.log('[Bucket Viewer Firefox] Modal opened for image preview');

      // 设置标题和信息
      title.textContent = image.Key || 'Image Preview';
      const size = this.formatFileSize(image.Size);
      const modified = this.formatDate(image.LastModified);
      info.innerHTML = `
        <strong>文件名:</strong> ${image.Key}<br>
        <strong>大小:</strong> ${size}<br>
        <strong>类型:</strong> ${image.file_type}<br>
        <strong>修改时间:</strong> ${modified}
      `;

      if (isFirefox) {
        // Firefox特殊处理
        console.log('[Bucket Viewer Firefox] Firefox detected, using object tag');

        // 创建包装容器
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f8f9fa;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
        `;

        // 使用object标签避免直接下载
        const objectElement = document.createElement('object');
        objectElement.data = image.url;
        objectElement.type = this.getMimeType(image.file_type);
        objectElement.style.cssText = `
          max-width: 100%;
          max-height: 100%;
          border: none;
          border-radius: 4px;
        `;

        // 添加错误处理
        objectElement.onerror = () => {
          console.error('[Bucket Viewer Firefox] Object tag failed, using fallback');
          this.createFallbackDisplay(wrapper, image);
        };

        objectElement.onload = () => {
          console.log('[Bucket Viewer Firefox] Object tag loaded successfully');
        };

        wrapper.appendChild(objectElement);

        // 替换img元素
        img.parentNode.replaceChild(wrapper, img);
        this.currentImageWrapper = wrapper;

      } else {
        // Chrome和其他浏览器：正常使用img标签
        img.src = image.url;
        img.style.transform = 'scale(1)';

        img.onload = () => {
          console.log('[Bucket Viewer Firefox] Image loaded successfully');
        };

        img.onerror = (e) => {
          console.error('[Bucket Viewer Firefox] Failed to load image:', e);
          this.createFallbackDisplay(img.parentNode, image);
        };
      }
    } else {
      console.error('[Bucket Viewer Firefox] Invalid image index:', index, 'Total images:', imageFiles.length);
    }
  };

  // 保存原始的zoomImage方法
  this.originalZoomImage = this.zoomImage;

  // 重写zoomImage方法以处理包装元素
  this.zoomImage = function(factor) {
    const currentTransform = this.currentImageWrapper ?
      this.currentImageWrapper.style.transform || 'scale(1)' :
      (document.getElementById('previewImage')?.style.transform || 'scale(1)');

    const currentScale = parseFloat(currentTransform.replace(/[^\d.]/g, '')) || 1;
    const newScale = Math.max(0.1, Math.min(5, currentScale * factor));

    console.log('[Bucket Viewer Firefox] Zoom:', { currentScale, factor, newScale });

    if (this.currentImageWrapper) {
      this.currentImageWrapper.style.transform = `scale(${newScale})`;
    } else {
      const img = document.getElementById('previewImage');
      if (img) img.style.transform = `scale(${newScale})`;
    }
  };

  // 添加MIME类型获取方法
  this.getMimeType = function(fileType) {
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml'
    };
    return mimeTypes[fileType.toLowerCase()] || 'image/jpeg';
  };

  // 创建回退显示
  this.createFallbackDisplay = function(container, image) {
    console.log('[Bucket Viewer Firefox] Creating fallback display');

    const fallbackDiv = document.createElement('div');
    fallbackDiv.style.cssText = `
      width: 100%;
      height: 400px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #f8f9fa;
      border: 2px dashed #dee2e6;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
    `;

    fallbackDiv.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">🖼️</div>
      <div style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 8px;">
        图片预览
      </div>
      <div style="font-size: 14px; color: #6b7280; margin-bottom: 16px;">
        ${image.Key}
      </div>
      <div style="display: flex; gap: 12px;">
        <button onclick="window.open('${image.url}', '_blank')"
                style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
          在新标签页打开
        </button>
        <button onclick="window.location.href='${image.url}'"
                style="padding: 8px 16px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer;">
          下载图片
        </button>
      </div>
      <div style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
        Firefox安全策略：如无法预览，请点击上方按钮在新标签页中查看
      </div>
    `;

    // 清空容器并添加回退显示
    if (container.tagName === 'DIV') {
      container.innerHTML = '';
      container.appendChild(fallbackDiv);
    } else {
      container.replaceChild(fallbackDiv, container.firstChild);
    }

    this.currentImageWrapper = fallbackDiv;
  };

  console.log('[Bucket Viewer Firefox] Firefox image fix applied');
};

// 自动应用Firefox修复
if (typeof window.bucketViewer !== 'undefined') {
  window.BucketViewerFirefoxImageFix();
} else {
  // 如果bucketViewer还未加载，等待加载完成
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (typeof window.bucketViewer !== 'undefined') {
        window.BucketViewerFirefoxImageFix();
      }
    }, 1000);
  });
}