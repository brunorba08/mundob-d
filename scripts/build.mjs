import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const page = await readFile('worker/page.html', 'utf8');
const script = await readFile('worker/browser.js', 'utf8');
const icons = Object.fromEntries(await Promise.all([192,512].map(async size => [size,(await readFile('worker/icon-'+size+'.png')).toString('base64')])));
const push = await readFile('worker/push.js', 'utf8');
const serviceWorker = await readFile('worker/sw.js', 'utf8');
const source = await readFile('worker/index.js', 'utf8');
let cover = '';
try { cover = (await readFile('worker/cover.webp')).toString('base64'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await writeFile('dist/server/index.js', source.replace('/*__PUSH__*/', () => push).replace('/*__SW__*/ null', () => JSON.stringify(serviceWorker)).replace('/*__PAGE__*/ null', () => JSON.stringify(page.replace('/*__BROWSER__*/', () => script))).replace('/*__COVER__*/ null', () => JSON.stringify(cover)).replace('/*__ICONS__*/ null', () => JSON.stringify(icons)));;
