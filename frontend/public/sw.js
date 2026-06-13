// WorkTrack Service Worker
// 策略：Network First + 离线回退缓存（仅生产环境生效，dev 不注册）

const CACHE_NAME = 'worktrack-v2'; // 版本号提升 → 旧缓存自动失效
const PRE_CACHE = ['/', '/api/v1/settings/branding/manifest', '/api/v1/settings/branding/apple-touch-icon'];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRE_CACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 请求：仅走网络（不缓存动态数据）
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 仅缓存 GET 请求
  if (event.request.method !== 'GET') {
    return;
  }

  // HTML 文档：Network First，回退到缓存（离线场景）
  // JS/CSS/图片等静态资源：Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 仅缓存同源且成功的响应
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // 网络失败 → 返回缓存
        return caches.match(event.request).then((cached) => {
          return cached || new Response('离线模式', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
      })
  );
});
