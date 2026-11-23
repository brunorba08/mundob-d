self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',event=>{
  let message;
  try { message = event.data?.json(); } catch {}
  event.waitUntil(self.registration.showNotification(message?.title || 'Mundo B + D ♡',{
    body:message?.body || 'Tem novidade na nossa história. Vá conferir!',
    icon:new URL('./icon-192.png',self.registration.scope).href
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async ()=>{
    const scope = self.registration.scope;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const album = windows.find(client=>client.url.startsWith(scope));
    if (album) await album.focus();
    else await self.clients.openWindow(scope);
  })());
});
