const backend = document.documentElement.dataset.backend ?? '';
let accessCode = '';
try { accessCode = localStorage.getItem('mundo-b-d-access') ?? ''; } catch {}
const mediaFiles = new Map();
const $ = selector => document.querySelector(selector);
const editor = $('#editor');
const form = $('#memory-form');
const noteForm = $('#note-form');
const noteEditor = $('#note-editor');
const coverEditor = $('#cover-editor');
const coverForm = $('#cover-form');
const timeline = $('#timeline');
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
  if (response.status === 401) {
    const dialog = $('#access-editor');
    if (!dialog.open) dialog.showModal();
  }
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
    mediaFiles.set(path,fetch(backend+path,{headers:{'X-Album-Code':accessCode}}).then(response=>{
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
function photoButton(src,label,lazy=false) {
  const button = action('',()=>{
    const preview = $('#viewer-photo');
    loadImage(preview,src);
    preview.alt = label;
    $('#viewer').showModal();
  },'photo-button');
  button.setAttribute('aria-label','Ampliar foto · '+label);
  const image = make('img');
  loadImage(image,src);
  image.alt = label;
  if (lazy) image.loading = 'lazy';
  button.append(image);
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
    cover.replaceChildren(...featured.map(({src,label})=>photoButton(src,label)));
    $('#cover-caption').textContent = 'Bruno & Dhennifer';
  } else if (!cover.firstElementChild || cover.querySelector('button')) {
    const img = make('img');
    img.src = './cover.webp';
    img.alt = 'Praia ao pôr do sol, imagem ilustrativa';
    cover.replaceChildren(img);
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
  if (!album.memories.length) {
    const empty = make('div',null,'empty');
    empty.append(make('strong','Toda história tem um começo.'),make('p','Que tal guardar um dia especial de vocês?'),action('Guardar primeira lembrança',()=>openMemory(),'btn'));
    timeline.append(empty);
  }
  for (const memory of album.memories) {
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
      await submit(new FormData(form));
      render();
      dialog.close();
    } catch (error) {
      showError(form,error.message);
    } finally {
      button.textContent = original;
      button.disabled = close.disabled = false;
    }
  });
}
onSubmit(form,async data=>{
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
const accessDialog = $('#access-editor');
const accessForm = $('#access-form');
accessDialog.addEventListener('cancel',event=>event.preventDefault());
accessForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit = accessForm.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  accessCode = accessForm.elements.code.value.trim();
  showError(accessForm);
  try {
    album = await api('album');
    try { localStorage.setItem('mundo-b-d-access',accessCode); } catch {}
    accessForm.reset();
    accessDialog.close();
    render();
  } catch (error) {
    showError(accessForm,error.message);
  } finally {
    submit.disabled = false;
  }
});
if (accessCode) loadAlbum();
else accessDialog.showModal();
