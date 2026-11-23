const backend = document.documentElement.dataset.backend ?? '';
let accessCode = '';
try { localStorage.removeItem('mundo-b-d-access'); } catch {}
const mediaFiles = new Map();
const $ = selector => document.querySelector(selector);
const editor = $('#editor');
const form = $('#memory-form');
const noteForm = $('#note-form');
const noteEditor = $('#note-editor');
const coverEditor = $('#cover-editor');
const coverForm = $('#cover-form');
const timeline = $('#timeline');
const timelineToggle = $('#timeline-toggle');
let timelineExpanded = location.hash.startsWith('#memory-');

timelineToggle.addEventListener('click',()=>{
  timelineExpanded = !timelineExpanded;
  renderTimeline();
});
window.addEventListener('hashchange',()=>{
  if (!location.hash.startsWith('#memory-')) return;
  timelineExpanded = true;
  renderTimeline();
  document.getElementById(location.hash.slice(1))?.scrollIntoView();
});
const dateFormat = new Intl.DateTimeFormat('pt-BR',{dateStyle:'long',timeZone:'UTC'});
const localDate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
const format = date => dateFormat.format(new Date(date));
let album = {memories:[],letters:[],plans:[],cover:[],today:localDate()};
let editing;
let turningPlan;
let noteType;
let installPrompt;

function make(tag,value,className) {
  const result = document.createElement(tag);
  if (value) result.textContent = value;
  if (className) result.className = className;
  return result;
}
function action(label,handler,className='btn outline') {
  const button = make('button',label,className);
  button.type = 'button';
  button.addEventListener('click',handler);
  return button;
}
function showError(form,message='') {
  const feedback = form.querySelector('.error');
  feedback.textContent = message;
  feedback.hidden = !message;
}
async function api(path,options) {
  const headers = new Headers(options?.headers);
  if (accessCode) headers.set('X-Album-Code',accessCode);
  const response = await fetch(backend+'/api/'+path,{...options,headers});
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Não foi possível acessar o álbum. Confira sua conexão e tente novamente.'); }
  if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir.');
  return data;
}
const send = (path,body) => api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function open(dialog,form) {
  if (form) showError(form);
  dialog.showModal();
}

document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click',()=>button.closest('dialog').close());
});
document.querySelectorAll('[data-add]').forEach(button=>button.addEventListener('click',()=>openMemory()));
document.querySelectorAll('[data-note]').forEach(button=>button.addEventListener('click',()=>openNote(button.dataset.note)));
[editor,noteEditor,coverEditor].forEach(dialog=>dialog.addEventListener('cancel',event=>{
  if (dialog.querySelector('button[type=submit]').disabled) event.preventDefault();
}));

function mediaUrl(path) {
  if (!mediaFiles.has(path)) {
    mediaFiles.set(path,fetch(backend+path).then(response=>{
      if (!response.ok) throw new Error('Não foi possível abrir o arquivo.');
      return response.blob();
    }).then(blob=>URL.createObjectURL(blob)).catch(error=>{
      mediaFiles.delete(path);
      throw error;
    }));
  }
  return mediaFiles.get(path);
}
function loadImage(image,path) {
  mediaUrl(path).then(url=>{ image.src = url; }).catch(()=>{});
}
function photoButton(src,label,lazy=false,illustration=false) {
  const button = action('',()=>{
    const preview = $('#viewer-photo');
    if (illustration) preview.src = src;
    else loadImage(preview,src);
    preview.alt = label;
    $('#viewer-download').replaceChildren(downloadButton(src,label,illustration));
    $('#viewer').showModal();
  },'photo-button');
  button.setAttribute('aria-label','Ampliar foto · '+label);
  const image = make('img');
  if (illustration) image.src = src;
  else loadImage(image,src);
  image.alt = label;
  if (lazy) image.loading = 'lazy';
  button.append(image);
  return button;
}

function downloadButton(src,label,illustration=false) {
  const button = action('Baixar foto',async ()=>{
    button.disabled = true;
    try {
      const url = illustration ? './cover.webp' : await mediaUrl(src);
      const link = make('a');
      link.href = url;
      const type = illustration ? 'webp' : (await fetch(url)).headers.get('Content-Type')?.split('/')[1];
      const extensions = {jpeg:'jpg', 'svg+xml':'svg'};
      const filename = label.replace(/[^\p{L}\p{N} -]/gu,'').trim() || 'foto';
      link.download = filename+(type ? '.'+(extensions[type] ?? type) : '');
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      button.textContent = 'Tentar baixar novamente';
    } finally {
      button.disabled = false;
    }
  },'photo-download');
  button.setAttribute('aria-label','Baixar foto · '+label);
  return button;
}

function allPhotos() {
  return album.memories.flatMap(memory=>memory.photos.map((src,index)=>({
    src,label:memory.captions?.[src] || memory.title+' · foto '+(index+1)
  })));
}
function renderCover() {
  const items = allPhotos();
  const selected = album.cover.map(src=>items.find(item=>item.src===src)).filter(Boolean);
  const featured = selected.length ? selected : items.slice(0,3);
  $('#choose-cover').hidden = !items.length;
  const cover = $('#cover');
  cover.className = featured.length ? 'cover-grid' : '';
  if (featured.length) {
    cover.replaceChildren(...featured.map(({src,label})=>{
      const photo = make('div');
      photo.append(photoButton(src,label));
      return photo;
    }));
    $('#cover-caption').textContent = 'Bruno & Dhennifer';
  } else {
    cover.replaceChildren(photoButton('./cover.webp','Praia ao pôr do sol',false,true));
  }
}

function renderAnniversary() {
  const box = $('#anniversary');
  const matches = album.memories.filter(memory=>memory.date < album.today && memory.date.slice(5)===album.today.slice(5));
  box.hidden = !matches.length;
  box.replaceChildren();
  if (!matches.length) return;
  box.append(make('h3','Nesse dia'));
  for (const memory of matches) {
    const years = Number(album.today.slice(0,4))-Number(memory.date.slice(0,4));
    const link = make('a',memory.title);
    link.href = '#memory-'+memory.id;
    const row = make('div','Há '+years+(years===1?' ano · ':' anos · '));
    row.append(link);
    box.append(row);
  }
}

function renderTimeline() {
  timeline.replaceChildren();
  timelineToggle.hidden = album.memories.length <= 1;
  timelineToggle.textContent = timelineExpanded ? 'Ver menos' : 'Ver todas as lembranças';
  timelineToggle.setAttribute('aria-expanded',String(timelineExpanded));
  if (!album.memories.length) {
    const empty = make('div',null,'empty');
    empty.append(make('strong','Toda história tem um começo.'),make('p','Que tal guardar um dia especial de vocês?'),action('Guardar primeira lembrança',()=>openMemory(),'btn'));
    timeline.append(empty);
  }
  for (const memory of (timelineExpanded ? album.memories : album.memories.slice(0,1))) {
    const card = make('article',null,'memory');
    card.id = 'memory-'+memory.id;
    const time = make('time',format(memory.date));
    time.dateTime = memory.date;
    card.append(time,make('h3',memory.title));
    if (memory.description) card.append(make('p',memory.description));
    if (memory.photos.length) {
      const grid = make('div',null,'photos');
      memory.photos.forEach((src,index)=>{
        const figure = make('figure');
        const caption = memory.captions?.[src];
        figure.append(photoButton(src,caption || memory.title+' · foto '+(index+1),true));
        if (caption) figure.append(make('figcaption',caption));
        grid.append(figure);
      });
      card.append(grid);
    }
    if (memory.video) {
      const video = make('video');
      video.controls = true;
      video.preload = 'none';
      video.playsInline = true;
      video.setAttribute('aria-label','Vídeo · '+memory.title);
      const play = action('Carregar vídeo',async ()=>{
        play.disabled = true;
        play.textContent = 'Carregando vídeo…';
        try {
          video.src = await mediaUrl(memory.video);
          video.hidden = false;
          play.remove();
          video.play().catch(()=>{});
        } catch {
          play.textContent = 'Tentar carregar o vídeo novamente';
          play.disabled = false;
        }
      });
      video.hidden = true;
      card.append(play,video);
    }
    card.append(action('Editar lembrança',()=>openMemory(memory),'btn outline edit'));
    timeline.append(card);
  }
}

function renderNotes() {
  const letters = $('#letters');
  const plans = $('#plans');
  letters.replaceChildren();
  plans.replaceChildren();
  if (!album.letters.length) letters.append(make('p','A primeira cartinha de vocês vai aparecer aqui.'));
  if (!album.plans.length) plans.append(make('p','Que sonho vocês querem viver juntos?'));
  for (const item of album.letters) {
    const card = make('article',null,'item');
    card.append(make('small','De '+item.author+' · '+format(item.date)),make('h3',item.title),make('p',item.text));
    letters.append(card);
  }
  for (const item of album.plans) {
    const card = make('article',null,'item');
    const memory = album.memories.find(entry=>entry.planId===item.id);
    card.append(make('h3',item.title));
    if (item.text) card.append(make('p',item.text));
    if (memory) {
      const link = make('a','Realizado · Ver lembrança','plan-link');
      link.href = '#memory-'+memory.id;
      card.append(link);
    } else card.append(action('Transformar em lembrança',()=>openMemory(null,item)));
    plans.append(card);
  }
}
function render() {
  renderCover();
  renderAnniversary();
  renderTimeline();
  renderNotes();
}
async function loadAlbum() {
  try {
    album = await api('album');
    render();
  } catch (error) {
    timeline.replaceChildren(make('p',error.message),action('Tentar novamente',loadAlbum));
  }
}

function captionField(name,value,placeholder) {
  const label = make('label','Legenda');
  const input = make('input');
  input.name = name;
  input.maxLength = 160;
  input.placeholder = placeholder;
  input.value = value ?? '';
  label.append(input);
  return label;
}
function openMemory(memory,plan) {
  editing = memory;
  turningPlan = plan;
  form.reset();
  $('#dialog-title').textContent = memory ? 'Editar lembrança' : 'Nova lembrança';
  form.elements.title.value = memory?.title ?? plan?.title ?? '';
  form.elements.date.value = memory?.date ?? localDate();
  form.elements.description.value = memory?.description ?? plan?.text ?? '';
  $('#keep-video').hidden = !memory?.video;
  form.elements.keepVideo.checked = Boolean(memory?.video);
  const existing = $('#existing-photos');
  existing.replaceChildren();
  $('#new-captions').replaceChildren();
  (memory?.photos ?? []).forEach((src,index)=>{
    const row = make('div',null,'caption-row');
    const keep = make('label');
    const checkbox = make('input',null,'check');
    checkbox.type = 'checkbox';
    checkbox.name = 'keep'+index;
    checkbox.checked = true;
    const thumbnail = make('img');
    loadImage(thumbnail,src);
    thumbnail.alt = '';
    const caption = captionField('caption'+index,memory.captions?.[src],'O que essa foto lembra?');
    checkbox.addEventListener('change',()=>{ caption.hidden = !checkbox.checked; });
    keep.append(checkbox,thumbnail,document.createTextNode('Manter foto '+(index+1)));
    row.append(keep,caption);
    existing.append(row);
  });
  open(editor,form);
}
form.elements.photos.addEventListener('change',()=>{
  const fields = [...form.elements.photos.files].slice(0,5).map((file,index)=>captionField('newCaption'+index,'',file.name));
  $('#new-captions').replaceChildren(...fields);
});

function openNote(type) {
  noteType = type;
  const letter = type==='letters';
  noteForm.reset();
  $('#note-title').textContent = letter ? 'Escrever cartinha' : 'Adicionar plano';
  $('#note-label').textContent = letter ? 'Mensagem' : 'Detalhes';
  $('#note-author').hidden = !letter;
  noteForm.elements.text.required = letter;
  open(noteEditor,noteForm);
}

$('#choose-cover').addEventListener('click',()=>{
  const selected = new Set(album.cover);
  const options = allPhotos().sort((a,b)=>Number(selected.has(b.src))-Number(selected.has(a.src)));
  $('#cover-options').replaceChildren(...options.map(({src,label})=>{
    const row = make('label',null,'cover-option');
    const checkbox = make('input',null,'check');
    checkbox.type = 'checkbox';
    checkbox.name = 'photo';
    checkbox.value = src;
    checkbox.checked = selected.has(src);
    const image = make('img');
    loadImage(image,src);
    image.alt = '';
    image.loading = 'lazy';
    row.append(checkbox,image,make('span',label));
    return row;
  }));
  open(coverEditor,coverForm);
});

function onSubmit(form,submit) {
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const dialog = form.closest('dialog');
    const button = form.querySelector('button[type=submit]');
    const close = dialog.querySelector('[data-close]');
    if (button.disabled) return;
    const original = button.textContent;
    button.textContent = 'Salvando…';
    button.disabled = close.disabled = true;
    showError(form);
    try {
      accessCode = form.elements.editPassword.value;
      const fields = new FormData(form);
      fields.delete('editPassword');
      await submit(fields);
      form.elements.editPassword.value = '';
      render();
      dialog.close();
    } catch (error) {
      showError(form,error.message);
    } finally {
      accessCode = '';
      button.textContent = original;
      button.disabled = close.disabled = false;
    }
  });
}
onSubmit(form,async data=>{
  if (!form.elements.photos.files.length) data.delete('photos');
  if (!form.elements.video.files.length) data.delete('video');
  if (editing) {
    data.set('originalDate',editing.originalDate ?? editing.date);
    data.set('revision',editing.revision ?? '');
  }
  if (turningPlan) data.set('planId',turningPlan.id);
  const memory = await api(editing ? 'memories/'+editing.id : 'memories',{method:editing ? 'PUT' : 'POST',body:data});
  album.memories = [...album.memories.filter(item=>item.id!==memory.id),memory].sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
  requestAnimationFrame(()=>document.getElementById('memory-'+memory.id)?.scrollIntoView());
});
onSubmit(noteForm,async data=>{
  const item = await send(noteType,Object.fromEntries(data));
  album[noteType].unshift(item);
});
onSubmit(coverForm,async data=>{
  const photos = data.getAll('photo');
  if (photos.length>3) throw new Error('Escolha até três fotos.');
  album.cover = await send('cover',{photos});
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled',()=>{ $('#install').hidden = true; });
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('#install').hidden = true;
$('#install').addEventListener('click',async ()=>{
  if (!installPrompt) return $('#install-help').showModal();
  const prompt = installPrompt;
  installPrompt = null;
  try { await prompt.prompt(); }
  catch { $('#install-help').showModal(); }
});
loadAlbum();

const defaultSong = {id:'5w11scFjudri4rCcfd1ik0',start:52};
const songStorage = 'mundo-b-d-song';
let currentSong = defaultSong;
try {
  const stored = JSON.parse(localStorage.getItem(songStorage));
  if (/^[a-zA-Z0-9]{22}$/.test(stored?.id) && Number.isInteger(stored.start) && stored.start >= 0) currentSong = stored;
} catch {}

const songForm = $('#song-form');
const songButton = $('#song-play');
const songLink = $('#song-link');
const songStatus = $('#song-status');
let spotify;
let spotifyApi;
let startPending = false;
let playing = false;
let clipEnded = false;

function songUri() { return 'spotify:track:'+currentSong.id; }
function spotifyLink() { return 'https://open.spotify.com/track/'+currentSong.id; }
function updateSongForm() {
  songLink.href = spotifyLink();
  songForm.elements.track.value = spotifyLink();
  songForm.elements.start.value = currentSong.start;
}

function playClip() {
  if (!spotify) return;
  startPending = true;
  clipEnded = false;
  spotify.seek(currentSong.start);
  spotify.play();
}

function updatePlayback({data}) {
  if (data.playingURI && data.playingURI !== songUri()) return;
  if (data.isBuffering) return;
  playing = !data.isPaused;
  songButton.textContent = playing ? 'Pausar música' : 'Tocar refrão';
  if (!playing) return;
  const hasFullTrack = data.duration > (currentSong.start + 1) * 1000;
  const start = hasFullTrack ? currentSong.start : 0;
  if (startPending) {
    startPending = false;
    if (hasFullTrack && data.position < start * 1000 - 500) spotify.seek(start);
  }
  if (!clipEnded && data.position >= (start + 30) * 1000) {
    clipEnded = true;
    spotify.pause();
  }
}

function mountSpotify() {
  songButton.disabled = true;
  playing = false;
  songButton.textContent = 'Tocar refrão';
  spotify?.destroy();
  spotify = undefined;
  const host = make('div');
  $('#spotify-player').replaceChildren(host);
  spotifyApi.createController(host,{uri:songUri(),width:'100%',height:152},controller=>{
    spotify = controller;
    spotify.addListener('playback_update',updatePlayback);
    spotify.addListener('ready',()=>{
      songButton.disabled = false;
      playClip();
    });
  });
}
window.onSpotifyIframeApiReady = api=>{
  spotifyApi = api;
  mountSpotify();
};

songButton.addEventListener('click',()=>{
  if (playing) spotify.pause();
  else playClip();
});
songForm.addEventListener('submit',event=>{
  event.preventDefault();
  let track;
  try { track = new URL(songForm.elements.track.value.trim()); } catch {}
  const match = track?.protocol === 'https:' && track.hostname === 'open.spotify.com'
    ? track.pathname.match(/^\/(?:intl-[a-z-]+\/)?track\/([a-zA-Z0-9]{22})\/?$/)
    : null;
  const start = songForm.elements.start.valueAsNumber;
  if (!match || !Number.isInteger(start) || start < 0) {
    songStatus.textContent = 'Cole o link de uma faixa do Spotify e informe o início em segundos.';
    return;
  }
  const changedTrack = currentSong.id !== match[1];
  currentSong = {id:match[1],start};
  try {
    localStorage.setItem(songStorage,JSON.stringify(currentSong));
    songStatus.textContent = 'Música salva neste navegador.';
  } catch { songStatus.textContent = 'Música alterada nesta visita.'; }
  updateSongForm();
  if (changedTrack && spotifyApi) mountSpotify();
  else playClip();
});
updateSongForm();
const spotifyScript = make('script');
spotifyScript.src = 'https://open.spotify.com/embed/iframe-api/v1';
spotifyScript.async = true;
document.body.append(spotifyScript);
