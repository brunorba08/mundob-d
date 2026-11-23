const page = /*__PAGE__*/ null;
const cover = /*__COVER__*/ null;
const icons = /*__ICONS__*/ null;
const pagesOrigin = 'https://brunorba08.github.io';
const mb = 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const videoTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const idPattern = '[0-9a-f-]{36}';
const safeHeaders = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json = (value, status = 200) => Response.json(value, {status,headers:{...safeHeaders,'Cache-Control':'no-store'}});
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());

function validDate(date) {
  const value = new Date(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(+value) && value.toISOString().slice(0,10) === date;
}

async function records(bucket, prefix) {
  const entries = [];
  let cursor;
  do {
    const result = await bucket.list({prefix,cursor,limit:50});
    const batch = await Promise.all(result.objects.map(async ({key}) => (await bucket.get(key))?.json()));
    entries.push(...batch.filter(Boolean));
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return entries;
}

async function readMemory(bucket, id, originalDate) {
  let key = 'memories/' + id;
  let object = await bucket.get(key);
  if (!object && validDate(originalDate)) {
    key = 'memories/' + originalDate + '/' + id;
    object = await bucket.get(key);
  }
  return {key,object,value:object ? await object.json() : null};
}

async function saveMemory(request, bucket, id) {
  if (Number(request.headers.get('Content-Length')) > 61 * mb) return json({error:'O envio excede o tamanho permitido.'},413);
  let form;
  try { form = await request.formData(); }
  catch { return json({error:'Não foi possível ler os arquivos enviados.'},400); }
  const field = name => String(form.get(name) ?? '').trim();
  const title = field('title');
  const date = field('date');
  const description = field('description');
  const originalDate = field('originalDate');
  const planId = field('planId');
  if (!title || title.length > 90 || !validDate(date) || description.length > 3000) return json({error:'Confira o título, a data e o texto.'},400);
  const previous = id ? await readMemory(bucket,id,originalDate) : null;
  if (id && !previous.value) return json({error:'Lembrança não encontrada.'},404);
  if (previous && field('revision') !== (previous.value.revision ?? '')) return json({error:'A lembrança foi alterada. Recarregue a página para editar a versão mais recente.'},409);
  if (!previous && planId) {
    if (!new RegExp('^'+idPattern+'$').test(planId) || !await bucket.head('plans/'+planId)) return json({error:'Plano não encontrado.'},404);
  }
  const kept = (previous?.value.photos ?? []).filter((_,index) => form.has('keep'+index));
  const photos = form.getAll('photos').filter(file => file instanceof File ? file.size > 0 : true);
  const video = form.get('video');
  const newVideo = video instanceof File && video.size > 0;
  if (photos.length + kept.length > 5 || photos.some(file => !(file instanceof File) || !imageTypes.has(file.type) || file.size > 8*mb)) {
    return json({error:'Use até cinco fotos de até 8 MB nos formatos indicados.'},400);
  }
  if (newVideo && (!videoTypes.has(video.type) || video.size > 20*mb)) return json({error:'Use um vídeo MP4, MOV ou WebM de até 20 MB.'},400);
  const captions = Object.fromEntries(kept.map(path => {
    const index = previous.value.photos.indexOf(path);
    return [path,field('caption'+index)];
  }));
  const newCaptions = photos.map((_,index) => field('newCaption'+index));
  if ([...Object.values(captions),...newCaptions].some(value => value.length > 160)) return json({error:'Use até 160 caracteres por legenda.'},400);

  // Publish the record only after all new media is available.
  const uploadId = crypto.randomUUID();
  const uploaded = [];
  const saveFile = async (file, key) => {
    uploaded.push(key);
    await bucket.put(key,file,{httpMetadata:{contentType:file.type}});
    return '/api/'+key;
  };
  const recordId = id || planId || crypto.randomUUID();
  const key = previous?.key ?? 'memories/'+recordId;
  let memory;
  try {
    for (const [index,file] of photos.entries()) {
      const path = await saveFile(file,'photos/'+uploadId+'/'+index);
      kept.push(path);
      captions[path] = newCaptions[index];
    }
    const videoPath = newVideo ? await saveFile(video,'videos/'+uploadId) : form.has('keepVideo') ? previous?.value.video ?? null : null;
    memory = {id:recordId,originalDate:previous?.value.originalDate ?? previous?.value.date ?? date,revision:crypto.randomUUID(),title,date,description,photos:kept,captions,video:videoPath,planId:previous?.value.planId ?? (planId || null)};
    const onlyIf = previous ? {etagMatches:previous.object.etag} : {etagDoesNotMatch:'*'};
    const saved = await bucket.put(key, JSON.stringify(memory), {onlyIf});
    if (!saved) {
      if (uploaded.length) await bucket.delete(uploaded).catch(console.error);
      return json({error:'O álbum foi atualizado. Recarregue a página antes de tentar novamente.'},409);
    }
  } catch (error) {
    if (uploaded.length) await bucket.delete(uploaded).catch(console.error);
    throw error;
  }
  const obsolete = [...(previous?.value.photos ?? []),previous?.value.video].filter(path => path && !kept.includes(path) && path !== memory.video);
  if (obsolete.length) await bucket.delete(obsolete.map(path => path.slice(5))).catch(console.error);
  return json(memory,previous ? 200 : 201);
}

async function serveMedia(request,bucket,key) {
  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  const info = rangeHeader ? await bucket.head(key) : null;
  if (rangeHeader && !info) return json({error:'Arquivo não encontrado.'},404);
  let offset, length;
  if (info) {
    const size = info.size;
    offset = range?.[1] ? Number(range[1]) : Math.max(0,size-Number(range?.[2]));
    const last = range?.[1] && range[2] ? Math.min(size-1,Number(range[2])) : size-1;
    length = last-offset+1;
    if (!range || !Number.isSafeInteger(offset) || offset >= size || length <= 0) {
      return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    }
  }
  const media = await bucket.get(key,info ? {range:{offset,length}} : undefined);
  if (!media) return json({error:'Arquivo não encontrado.'},404);
  const headers = {...safeHeaders,'Content-Type':media.httpMetadata.contentType,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=300','Content-Length':String(info ? length : media.size)};
  if (info) headers['Content-Range'] = 'bytes '+offset+'-'+(offset+length-1)+'/'+info.size;
  return new Response(media.body,{status:info ? 206 : 200,headers});
}

const manifest = {
  id:'/',name:'Mundo B + D',short_name:'Mundo B + D',lang:'pt-BR',start_url:'/',scope:'/',display:'standalone',
  background_color:'#fcf6ef',theme_color:'#fcf6ef',
  icons:[192,512].map(size => ({src:'/icon-'+size+'.png',sizes:size+'x'+size,type:'image/png',purpose:'any maskable'}))
};

async function secretMatches(expected,provided) {
  if (!expected || !provided || provided.length > 256) return false;
  const encoder = new TextEncoder();
  const digests = await Promise.all([expected,provided].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
  const left = new Uint8Array(digests[0]);
  const right = new Uint8Array(digests[1]);
  return left.reduce((difference,byte,index)=>difference | (byte ^ right[index]),0) === 0;
}

const app = {
  async fetch(request,env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const bucket = env.BUCKET;
    const read = request.method === 'GET';
    const asset = (value,type) => new Response(value,{headers:{...safeHeaders,'Content-Type':type,'Cache-Control':'no-cache'}});
    const binary = value => Uint8Array.from(atob(value),char => char.charCodeAt(0));
    try {
      if (read && path === '/') return asset(page,'text/html; charset=utf-8');
      if (read && path === '/cover.webp' && cover) return asset(binary(cover),'image/webp');
      if (read && path === '/manifest.webmanifest') return asset(JSON.stringify(manifest),'application/manifest+json');
      if (read && path === '/sw.js') return asset("self.addEventListener('install',()=>self.skipWaiting()); self.addEventListener('activate',event=>event.waitUntil(self.clients.claim())); self.addEventListener('fetch',()=>{});",'text/javascript');
      const icon = /^\/icon-(192|512)\.png$/.exec(path);
      if (read && icon) return asset(binary(icons[icon[1]]),'image/png');
      if (read && new RegExp('^/api/(photos/'+idPattern+'/[0-4]|videos/'+idPattern+')$').test(path)) return await serveMedia(request,bucket,path.slice(5));
      if (read && path === '/api/album') {
        const [memories,letters,plans,coverObject] = await Promise.all([records(bucket,'memories/'),records(bucket,'letters/'),records(bucket,'plans/'),bucket.get('settings/cover')]);
        return json({memories:memories.sort((a,b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),letters:letters.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),plans:plans.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),cover:coverObject ? await coverObject.json() : [],today:today()});
      }
      if (read && path === '/api/memories') return json((await records(bucket,'memories/')).sort((a,b)=>b.date.localeCompare(a.date)));
      if (!read && ![url.origin,pagesOrigin].includes(request.headers.get('Origin'))) return json({error:'Envie pela página do álbum.'},403);
      if (request.method === 'POST' && path === '/api/memories') return await saveMemory(request,bucket);
      const memory = new RegExp('^/api/memories/('+idPattern+')$').exec(path);
      if (request.method === 'PUT' && memory) return await saveMemory(request,bucket,memory[1]);
      if (request.method === 'POST' && ['/api/letters','/api/plans','/api/cover'].includes(path)) {
        if (Number(request.headers.get('Content-Length')) > 24_000) return json({error:'O texto está muito longo.'},413);
        const body = await request.json().catch(()=>null);
        if (!body || typeof body !== 'object') return json({error:'Dados inválidos.'},400);
        if (path === '/api/cover') {
          const selected = body.photos;
          const valid = new Set((await records(bucket,'memories/')).flatMap(item=>item.photos));
          if (!Array.isArray(selected) || selected.length > 3 || new Set(selected).size !== selected.length || selected.some(item=>!valid.has(item))) return json({error:'Escolha até três fotos do álbum.'},400);
          await bucket.put('settings/cover',JSON.stringify(selected));
          return json(selected);
        }
        const letter = path === '/api/letters';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const author = letter ? body.author : null;
        if (!title || title.length > 90 || text.length > 3000 || (letter && (!text || !['Bruno','Dhennifer'].includes(author)))) {
          return json({error:'Confira os campos e tente novamente.'},400);
        }
        const id = crypto.randomUUID();
        const item = {id,title,text,author,date:today(),createdAt:new Date().toISOString()};
        await bucket.put((letter ? 'letters/' : 'plans/')+id,JSON.stringify(item));
        return json(item,201);
      }
      return json({error:'Página não encontrada.'},404);
    } catch (error) {
      console.error(error);
      return json({error:'Não foi possível acessar o álbum agora. Tente novamente.'},500);
    }
  }
};

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return app.fetch(request,env);
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin':pagesOrigin,
      'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers':'X-Album-Code, Content-Type, Range',
      'Vary':'Origin'
    };
    if (request.method === 'OPTIONS' && origin === pagesOrigin) return new Response(null,{status:204,headers:cors});
    const token = request.headers.get('X-Album-Code');
    const allowed = request.method === 'GET' || await secretMatches(env.ALBUM_ACCESS_CODE,token);
    const result = allowed ? await app.fetch(request,env) : json({error:'Senha incorreta. Confira a senha para salvar.'},401);
    const headers = new Headers(result.headers);
    headers.set('Cache-Control','no-store');
    if (origin === pagesOrigin) Object.entries(cors).forEach(([key,value])=>headers.set(key,value));
    return new Response(result.body,{status:result.status,headers});
  }
};
