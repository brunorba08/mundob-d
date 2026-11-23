const pushRoles = ['Bruno', 'Dênifer'];
const pushHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const pushEncoder = new TextEncoder();

function pushBase64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

function pushBytes(value) {
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), char=>char.charCodeAt(0));
}

function pushConcat(...parts) {
  const bytes = new Uint8Array(parts.reduce((size,part)=>size+part.length,0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part,offset);
    offset += part.length;
  }
  return bytes;
}

async function pushDerive(secret,salt,info,length) {
  const key = await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));
}

async function pushPayload(subscription,message) {
  const receiver = pushBytes(subscription.keys.p256dh);
  const auth = pushBytes(subscription.keys.auth);
  const pair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const sender = new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const publicKey = await crypto.subtle.importKey('raw',receiver,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared = await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},pair.privateKey,256);
  const input = await pushDerive(shared,auth,pushConcat(pushEncoder.encode('WebPush: info\0'),receiver,sender),32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await pushDerive(input,salt,pushEncoder.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce = await pushDerive(input,salt,pushEncoder.encode('Content-Encoding: nonce\0'),12);
  const key = await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const plaintext = pushConcat(pushEncoder.encode(JSON.stringify(message)),Uint8Array.of(2));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plaintext);
  return pushConcat(salt,Uint8Array.of(0,0,16,0,sender.length),sender,new Uint8Array(encrypted));
}

function pushEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    const windows = url.hostname.endsWith('.notify.windows.com') && url.hostname.length > '.notify.windows.com'.length;
    return pushHosts.has(url.hostname) || windows ? url : null;
  } catch { return null; }
}

async function savePushSubscription(request,env) {
  const body = await request.json().catch(()=>null);
  const subscription = body?.subscription;
  const endpoint = pushEndpoint(subscription?.endpoint);
  if (!pushRoles.includes(body?.role) || !endpoint || endpoint.href.length > 2048 ||
      !/^[\w-]{87}$/.test(subscription?.keys?.p256dh ?? '') || !/^[\w-]{22}$/.test(subscription?.keys?.auth ?? '')) {
    return json({error:'Dados de notificação inválidos.'},400);
  }
  const id = pushBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',pushEncoder.encode(endpoint.href))));
  await env.BUCKET.put('push/'+id,JSON.stringify({id,role:body.role,endpoint:endpoint.href,keys:subscription.keys}));
  return json({ok:true});
}

async function sendPush(env,subscription,message) {
  const endpoint = pushEndpoint(subscription.endpoint);
  if (!endpoint) return;
  const claims = {aud:endpoint.origin,exp:Math.floor(Date.now()/1000)+3600,sub:pagesOrigin};
  const encode = value=>pushBase64(pushEncoder.encode(JSON.stringify(value)));
  const jwt = encode({typ:'JWT',alg:'ES256'})+'.'+encode(claims);
  const key = await crypto.subtle.importKey('jwk',JSON.parse(env.PUSH_PRIVATE_KEY),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,pushEncoder.encode(jwt)));
  const response = await fetch(endpoint,{
    method:'POST',redirect:'error',
    headers:{Authorization:'vapid t='+jwt+'.'+pushBase64(signature)+', k='+env.PUSH_PUBLIC_KEY,TTL:'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'},
    body:await pushPayload(subscription,message)
  });
  if (response.status === 404 || response.status === 410) await env.BUCKET.delete('push/'+subscription.id);
  else if (!response.ok) console.error('Push rejeitado',endpoint.hostname,response.status);
}

function pushMessage(path,method,author) {
  const update = method === 'PUT' || path === '/api/cover';
  const added = path === '/api/letters' ? 'escreveu uma cartinha para você' :
    path === '/api/plans' ? 'adicionou um plano para vocês' : 'guardou uma nova lembrança';
  return {title:'Mundo B + D ♡',body:author+' '+(update ? 'atualizou a nossa história' : added)+'. Vá conferir!'};
}

async function notifyOther(env,path,method,author) {
  if (!env.PUSH_PRIVATE_KEY || !env.PUSH_PUBLIC_KEY) return;
  const message = pushMessage(path,method,author);
  const subscriptions = await records(env.BUCKET,'push/');
  const results = await Promise.allSettled(subscriptions.filter(item=>item.role!==author).map(item=>sendPush(env,item,message)));
  for (const result of results) if (result.status === 'rejected') console.error('Falha no envio de uma notificação');
}
