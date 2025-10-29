// Background Service Worker for Bucket Viewer Extension

let db = null;
let dbInitialized = false;
let dbInitPromise = null;

// 确保数据库已初始化
function ensureDatabase() {
  if (dbInitialized && db) {
    return Promise.resolve(db);
  }

  if (!dbInitPromise) {
    dbInitPromise = new Promise((resolve, reject) => {
      // 如果数据库还没有初始化，等待初始化完成
      const checkInterval = setInterval(() => {
        if (dbInitialized && db) {
          clearInterval(checkInterval);
          resolve(db);
        }
      }, 100);

      // 10秒超时
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Database initialization timeout'));
      }, 10000);
    });
  }

  return dbInitPromise;
}

// 安全执行数据库操作的包装器
function withDatabase(operation) {
  return async (...args) => {
    try {
      await ensureDatabase();
      return await operation(...args);
    } catch (error) {
      console.error('[Bucket Viewer] Database operation failed:', error);
      throw error;
    }
  };
}

// 初始化数据库
async function initDatabase() {
  try {
    // 使用 IndexedDB 作为存储方案（比 SQLite WASM 更稳定）
    const request = indexedDB.open('BucketViewerDB', 2); // 增加版本号以触发数据库升级

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      const currentVersion = event.oldVersion;

      // 如果表已存在，需要删除旧的唯一索引
      if (currentVersion < 2 && db.objectStoreNames.contains('buckets')) {
        const bucketStore = event.target.transaction.objectStore('buckets');

        // 删除旧的唯一索引（如果存在）
        if (bucketStore.indexNames.contains('url')) {
          bucketStore.deleteIndex('url');
        }

        // 重新创建非唯一的索引
        bucketStore.createIndex('url', 'url', { unique: false });
      }

      // 创建存储桶表（如果不存在）
      if (!db.objectStoreNames.contains('buckets')) {
        const bucketStore = db.createObjectStore('buckets', { keyPath: 'id', autoIncrement: true });
        bucketStore.createIndex('url', 'url', { unique: false });
        bucketStore.createIndex('created_at', 'created_at');
      }

      // 创建文件表（如果不存在）
      if (!db.objectStoreNames.contains('files')) {
        const fileStore = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        fileStore.createIndex('bucket_id', 'bucket_id');
        fileStore.createIndex('key', 'key');
        fileStore.createIndex('file_type', 'file_type');
        fileStore.createIndex('category', 'category');
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      dbInitialized = true;
      console.log('[Bucket Viewer] Database initialized successfully');
    };

    request.onerror = (event) => {
      console.error('[Bucket Viewer] Database initialization failed:', event.target.error);
    };
  } catch (error) {
    console.error('[Bucket Viewer] Database initialization error:', error);
  }
}

// 检测存储桶链接的函数
function isBucketUrl(url) {
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
    // 通用对象存储模式 - 更宽松的检测
    /^[a-z]+:\/\/[a-z0-9.-]+\/[a-z0-9-_]+\/?$/i,
    // 检测是否包含常见的存储桶路径模式
    /\/[a-z0-9-_]+\/?$/i
  ];

  return bucketPatterns.some(pattern => pattern.test(url));
}

// 解析存储桶数据（移植自 ossx.py 的核心逻辑）
async function parseBucketData(bucketUrl, baseUrl = null) {
  try {
    console.log('[Bucket Viewer] Starting to parse bucket:', bucketUrl);

    if (!baseUrl) {
      const url = new URL(bucketUrl);
      baseUrl = `${url.protocol}//${url.host}/`;
    }

    console.log('[Bucket Viewer] Base URL:', baseUrl);

    // 发送初始请求获取存储桶信息
    console.log('[Bucket Viewer] Sending fetch request to:', bucketUrl);

    let response;
    try {
      // 添加超时处理
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 30000); // 30秒超时

      response = await fetch(bucketUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Bucket Viewer Extension/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log('[Bucket Viewer] Response received:', response.status, response.statusText);

    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        throw new Error('请求超时 - 请检查网络连接或URL是否正确');
      } else {
        throw new Error('网络请求失败: ' + fetchError.message);
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log('[Bucket Viewer] Received XML response, length:', xmlText.length);

    // 检查响应内容
    if (!xmlText || xmlText.length === 0) {
      throw new Error('服务器返回空响应');
    }

    if (!xmlText.includes('<?xml') && !xmlText.includes('<ListBucketResult') && !xmlText.includes('<Contents')) {
      console.log('[Bucket Viewer] Response does not appear to be XML:', xmlText.substring(0, 500));
      throw new Error('服务器响应不是有效的XML格式');
    }

    // 使用正则表达式解析XML（兼容Service Worker环境）
    console.log('[Bucket Viewer] Parsing XML response...');
    const parsedData = parseXMLWithRegex(xmlText);

    if (!parsedData.success) {
      console.error('[Bucket Viewer] XML parsing failed:', parsedData.error);
      throw new Error('XML parsing failed: ' + parsedData.error);
    }

    console.log('[Bucket Viewer] XML parsing successful');
    console.log('[Bucket Viewer] Found child tags:', Array.from(parsedData.childTags));

    // 获取基本信息
    const maxKeys = parsedData.maxKeys || '1000';
    const nextMarker = parsedData.nextMarker;
    const childTags = parsedData.childTags;

    console.log('[Bucket Viewer] MaxKeys:', maxKeys);
    console.log('[Bucket Viewer] NextMarker:', nextMarker);

    // 创建存储桶记录
    const bucketData = {
      url: bucketUrl,
      base_url: baseUrl,
      max_keys: parseInt(maxKeys),
      has_pagination: nextMarker !== null,
      child_tags: Array.from(childTags),
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString()
    };

    const bucketId = await safeSaveBucket(bucketData);

    // 递归获取所有数据
    await fetchAllPages(bucketUrl, baseUrl, maxKeys, bucketId, childTags);

    return { success: true, bucketId, fileCount: await getFileCount(bucketId) };

  } catch (error) {
    console.error('[Bucket Viewer] Error parsing bucket:', error);
    return { success: false, error: error.message };
  }
}

// DOM 解析函数已移除，现在使用正则表达式解析XML以兼容Service Worker环境

// 递归获取所有分页数据
async function fetchAllPages(bucketUrl, baseUrl, maxKeys, bucketId, childTags, marker = '', page = 0) {
  try {
    const url = marker ? `${bucketUrl}?max-keys=${maxKeys}&marker=${marker}` : `${bucketUrl}?max-keys=${maxKeys}`;

    const response = await fetch(url);
    const xmlText = await response.text();

    // 使用正则表达式解析XML
    const parsedData = parseXMLWithRegex(xmlText);

    if (!parsedData.success) {
      console.error('[Bucket Viewer] Error parsing page XML:', parsedData.error);
      return;
    }

    const files = [];

    // 处理解析到的内容
    parsedData.contents.forEach(contentData => {
      const fileData = {};

      // 提取所有字段
      childTags.forEach(tag => {
        fileData[tag] = contentData[tag] || '';
      });

      // 构建完整URL - 修复：使用bucketUrl而不是baseUrl来确保包含存储桶路径
      const key = fileData.Key || '';
      if (key) {
        fileData.url = bucketUrl + key;
        console.log('[Bucket Viewer] Building file URL:', {
          bucketUrl: bucketUrl,
          key: key,
          fullUrl: fileData.url
        });

        // 提取文件类型
        const parts = key.split('.');
        fileData.file_type = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
        fileData.category = getFileCategory(fileData.file_type);
      }

      files.push(fileData);
    });

    // 保存文件数据
    await safeSaveFiles(bucketId, files);

    page += 1;
    console.log(`[Bucket Viewer] Page ${page}: Found ${files.length} files`);

    // 检查是否还有下一页
    const nextMarker = parsedData.nextMarker;

    if (nextMarker) {
      await fetchAllPages(bucketUrl, baseUrl, maxKeys, bucketId, childTags, nextMarker, page);
    }

  } catch (error) {
    console.error('[Bucket Viewer] Error fetching page:', error);
  }
}

// 根据文件类型获取分类
function getFileCategory(fileType) {
  const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
  const documentTypes = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx', 'ods', 'odp'];
  const videoTypes = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
  const audioTypes = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'];
  const archiveTypes = ['zip', 'rar', '7z', 'tar', 'gz'];

  if (imageTypes.includes(fileType)) return 'images';
  if (documentTypes.includes(fileType)) return 'documents';
  if (videoTypes.includes(fileType)) return 'videos';
  if (audioTypes.includes(fileType)) return 'audio';
  if (archiveTypes.includes(fileType)) return 'archives';
  if (!fileType) return 'folders';
  return 'others';
}

// 保存存储桶信息
async function saveBucket(bucketData) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['buckets'], 'readwrite');
    const store = transaction.objectStore('buckets');

    // 首先检查是否已存在相同URL的存储桶
    const index = store.index('url');
    const request = index.get(bucketData.url);

    request.onsuccess = () => {
      const existingBucket = request.result;

      if (existingBucket) {
        // 如果已存在，更新记录并删除旧文件
        const updatedBucket = {
          ...bucketData,
          id: existingBucket.id,
          created_at: existingBucket.created_at, // 保持原始创建时间
          last_updated: new Date().toISOString()
        };

        const updateRequest = store.put(updatedBucket);
        updateRequest.onsuccess = async () => {
          // 删除旧的文件记录
          await safeDeleteFilesForBucket(existingBucket.id);
          resolve(existingBucket.id);
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        // 如果不存在，创建新记录
        const addRequest = store.add(bucketData);
        addRequest.onsuccess = () => resolve(addRequest.result);
        addRequest.onerror = () => reject(addRequest.error);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// 删除指定存储桶的所有文件
async function deleteFilesForBucket(bucketId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['files'], 'readwrite');
    const store = transaction.objectStore('files');
    const index = store.index('bucket_id');

    // 获取所有要删除的记录
    const request = index.getAll(bucketId);

    request.onsuccess = () => {
      const files = request.result;

      // 删除所有文件记录
      let deleted = 0;
      const total = files.length;

      if (total === 0) {
        resolve();
        return;
      }

      files.forEach(file => {
        const deleteRequest = store.delete(file.id);
        deleteRequest.onsuccess = () => {
          deleted++;
          if (deleted === total) {
            resolve();
          }
        };
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
    };

    request.onerror = () => reject(request.error);
  });
}

// 保存文件信息
async function saveFiles(bucketId, files) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['files'], 'readwrite');
    const store = transaction.objectStore('files');

    let completed = 0;
    const total = files.length;

    files.forEach(fileData => {
      const fileWithBucketId = { ...fileData, bucket_id: bucketId };
      const request = store.add(fileWithBucketId);

      request.onsuccess = () => {
        completed++;
        if (completed === total) {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  });
}

// 获取文件数量
async function getFileCount(bucketId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['files'], 'readonly');
    const store = transaction.objectStore('files');
    const index = store.index('bucket_id');
    const request = index.count(bucketId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 清空历史数据（插件启动时调用）
async function clearHistoryData() {
  try {
    await ensureDatabase();

    if (!db) {
      console.log('[Bucket Viewer] Database not initialized, skipping history cleanup');
      return;
    }

    console.log('[Bucket Viewer] Clearing history data on startup...');

    // 清空buckets表
    const bucketTransaction = db.transaction(['buckets'], 'readwrite');
    const bucketStore = bucketTransaction.objectStore('buckets');
    const clearBucketRequest = bucketStore.clear();

    clearBucketRequest.onsuccess = () => {
      console.log('[Bucket Viewer] Cleared all bucket data from IndexedDB');
    };

    clearBucketRequest.onerror = () => {
      console.error('[Bucket Viewer] Error clearing bucket data:', clearBucketRequest.error);
    };

    // 清空files表
    const fileTransaction = db.transaction(['files'], 'readwrite');
    const fileStore = fileTransaction.objectStore('files');
    const clearFileRequest = fileStore.clear();

    clearFileRequest.onsuccess = () => {
      console.log('[Bucket Viewer] Cleared all file data from IndexedDB');
    };

    clearFileRequest.onerror = () => {
      console.error('[Bucket Viewer] Error clearing file data:', clearFileRequest.error);
    };

  } catch (error) {
    console.error('[Bucket Viewer] Error clearing history data:', error);
  }
}

// 插件启动时清空历史数据
chrome.runtime.onStartup.addListener(() => {
  console.log('[Bucket Viewer] Extension startup detected, clearing history...');
  clearHistoryData();
});

// 扩展安装/更新时也清空历史数据
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Bucket Viewer] Extension installed/updated, clearing history...');
  clearHistoryData();

  // 右键菜单创建
  chrome.contextMenus.create({
    id: 'bucket-viewer',
    title: 'View Bucket Contents',
    contexts: ['link'],
    documentUrlPatterns: ['*://*/*']
  });
});

// 插件图标点击事件 - 直接打开查看器
chrome.browserAction.onClicked.addListener(async (tab) => {
  console.log('[Bucket Viewer] Extension icon clicked');

  try {
    // 检查当前页面是否是存储桶URL
    if (tab.url && isBucketUrl(tab.url)) {
      console.log('[Bucket Viewer] Current page is bucket URL, opening viewer with URL parameter');
      // 立即打开查看器页面并传递URL参数，让前端处理解析
      chrome.tabs.create({
        url: chrome.runtime.getURL('viewer/viewer.html') + `?url=${encodeURIComponent(tab.url)}`
      });
    } else {
      // 如果不是存储桶URL，打开普通的查看器页面
      console.log('[Bucket Viewer] Opening viewer for manual URL input');
      chrome.tabs.create({
        url: chrome.runtime.getURL('viewer/viewer.html')
      });
    }
  } catch (error) {
    console.error('[Bucket Viewer] Error handling icon click:', error);
    // 出错时也打开查看器页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('viewer/viewer.html')
    });
  }
});

// 右键菜单点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'bucket-viewer') {
    const url = info.linkUrl;

    if (isBucketUrl(url)) {
      // 打开查看器标签页
      chrome.tabs.create({
        url: chrome.runtime.getURL('viewer/viewer.html') + `?bucket=${encodeURIComponent(url)}`
      });
    } else {
      // 显示不支持的消息
      chrome.tabs.sendMessage(tab.id, {
        type: 'showNotification',
        message: 'This URL doesn\'t appear to be a supported bucket URL.'
      });
    }
  }
});

// 处理来自popup和content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 确保数据库已初始化
  ensureDatabase().then(() => {
    if (request.type === 'parseBucket') {
      parseBucketData(request.url, request.baseUrl)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放
    }

    if (request.type === 'getBucketData') {
      safeGetBucketData(request.bucketId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.type === 'openBucketViewer') {
      chrome.tabs.create({
        url: chrome.runtime.getURL('viewer/viewer.html') + `?url=${encodeURIComponent(request.url)}`
      }).then(tab => {
        sendResponse({ success: true, tabId: tab.id });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (request.type === 'getRecentBuckets') {
      getRecentBuckets()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  }).catch(error => {
    console.error('[Bucket Viewer] Database not ready for operation:', error);
    sendResponse({ success: false, error: 'Database not initialized' });
  });

  return true; // 保持消息通道开启
});

// 获取存储桶数据
async function getBucketData(bucketId) {
  return new Promise((resolve, reject) => {
    // 获取存储桶信息
    const bucketTransaction = db.transaction(['buckets'], 'readonly');
    const bucketStore = bucketTransaction.objectStore('buckets');
    const bucketRequest = bucketStore.get(bucketId);

    bucketRequest.onsuccess = () => {
      const bucket = bucketRequest.result;
      if (!bucket) {
        reject(new Error('Bucket not found'));
        return;
      }

      // 获取文件数据
      const fileTransaction = db.transaction(['files'], 'readonly');
      const fileStore = fileTransaction.objectStore('files');
      const index = fileStore.index('bucket_id');
      const fileRequest = index.getAll(bucketId);

      fileRequest.onsuccess = () => {
        resolve({
          success: true,
          bucket,
          files: fileRequest.result
        });
      };

      fileRequest.onerror = () => reject(fileRequest.error);
    };

    bucketRequest.onerror = () => reject(bucketRequest.error);
  });
}

// 获取最近的存储桶记录
async function getRecentBuckets() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['buckets', 'files'], 'readonly');
    const bucketStore = transaction.objectStore('buckets');

    // 获取所有存储桶，按创建时间倒序
    const request = bucketStore.openCursor(null, 'prev');

    const buckets = [];

    request.onsuccess = async (event) => {
      const cursor = event.target.result;

      if (cursor) {
        const bucket = cursor.value;

        // 获取文件数量
        try {
          const fileCount = await getFileCount(bucket.id);
          bucket.file_count = fileCount;
          buckets.push(bucket);

          // 只返回最近10条记录
          if (buckets.length >= 10) {
            resolve({ success: true, buckets });
            return;
          }
        } catch (error) {
          console.error('[Bucket Viewer] Error getting file count:', error);
        }

        cursor.continue();
      } else {
        resolve({ success: true, buckets });
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// 使用正则表达式解析XML的函数（兼容Service Worker环境）
function parseXMLWithRegex(xmlText) {
  console.log('[Bucket Viewer] parseXMLWithRegex: Starting to parse XML');

  try {
    const result = {
      success: true,
      maxKeys: null,
      nextMarker: null,
      childTags: new Set(),
      contents: []
    };

    console.log('[Bucket Viewer] XML preview:', xmlText.substring(0, 200) + '...');

    // 提取MaxKeys
    const maxKeysMatch = xmlText.match(/<MaxKeys[^>]*>(.*?)<\/MaxKeys>/i);
    if (maxKeysMatch) {
      result.maxKeys = maxKeysMatch[1].trim();
      console.log('[Bucket Viewer] Found MaxKeys:', result.maxKeys);
    }

    // 提取NextMarker
    const nextMarkerMatch = xmlText.match(/<NextMarker[^>]*>(.*?)<\/NextMarker>/i);
    if (nextMarkerMatch) {
      result.nextMarker = nextMarkerMatch[1].trim();
      console.log('[Bucket Viewer] Found NextMarker:', result.nextMarker);
    }

    // 提取所有Contents元素
    const contentsRegex = /<Contents[^>]*>([\s\S]*?)<\/Contents>/gi;
    let contentsMatch;

    while ((contentsMatch = contentsRegex.exec(xmlText)) !== null) {
      const contentXML = contentsMatch[1];
      const contentData = {};

      // 提取所有子标签
      const tagRegex = /<([^!\/\s][^>\s]*)[^>]*>(.*?)<\/\1>/gi;
      let tagMatch;

      while ((tagMatch = tagRegex.exec(contentXML)) !== null) {
        const tagName = tagMatch[1];
        const tagValue = tagMatch[2].trim();

        // 清理标签名（移除命名空间前缀）
        const cleanTagName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
        contentData[cleanTagName] = tagValue;
        result.childTags.add(cleanTagName);
      }

      if (Object.keys(contentData).length > 0) {
        result.contents.push(contentData);
      }
    }

    console.log('[Bucket Viewer] Parsed', result.contents.length, 'contents');
    console.log('[Bucket Viewer] Found child tags:', Array.from(result.childTags));
    console.log('[Bucket Viewer] parseXMLWithRegex: Parsing completed successfully');

    return result;

  } catch (error) {
    console.error('[Bucket Viewer] XML parsing error:', error);
    console.error('[Bucket Viewer] Error stack:', error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// 已移除不再需要的getElementTextFromData函数
// 现在使用parseXMLWithRegex函数处理所有XML解析

// 创建安全的数据库操作函数
const safeSaveBucket = withDatabase(saveBucket);
const safeDeleteFilesForBucket = withDatabase(deleteFilesForBucket);
const safeSaveFiles = withDatabase(saveFiles);
const safeGetBucketData = withDatabase(getBucketData);

// 重写原函数以使用安全版本
async function saveBucketWrapper(bucketData) {
  return safeSaveBucket(bucketData);
}

async function deleteFilesForBucketWrapper(bucketId) {
  return safeDeleteFilesForBucket(bucketId);
}

async function saveFilesWrapper(bucketId, files) {
  return safeSaveFiles(bucketId, files);
}

async function getBucketDataWrapper(bucketId) {
  return safeGetBucketData(bucketId);
}


// 初始化数据库
initDatabase();

console.log('[Bucket Viewer] Background service worker initialized');