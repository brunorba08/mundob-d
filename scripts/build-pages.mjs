import { mkdir, writeFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';

const backend = 'https://nosso-album-bruno-dhennifer.brunoou.chatgpt.site';
const directory = process.argv[2] ?? 'docs';
const asset = path => worker.fetch(new Request(backend+path),{});
await mkdir(directory,{recursive:true});
const response = await asset('/');
const page = (await response.text()).replace('<html lang="pt-BR">','<html lang="pt-BR" data-backend="'+backend+'">');
await writeFile(directory+'/index.html',page);
for (const name of ['cover.webp','icon-192.png','icon-512.png','sw.js']) {
  const file = await asset('/'+name);
  if (!file.ok) throw new Error('Asset unavailable: '+name);
  await writeFile(directory+'/'+name,new Uint8Array(await file.arrayBuffer()));
}
const manifest = await (await asset('/manifest.webmanifest')).json();
for (const key of ['id','scope','start_url']) manifest[key] = './';
for (const icon of manifest.icons) icon.src = '.'+icon.src;
await writeFile(directory+'/manifest.webmanifest',JSON.stringify(manifest));
await writeFile(directory+'/.nojekyll','');
