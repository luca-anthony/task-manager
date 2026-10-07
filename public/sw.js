self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(d.title || 'Task Manager', {
    body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => (l.length ? l[0].focus() : clients.openWindow(e.notification.data.url))))
})
