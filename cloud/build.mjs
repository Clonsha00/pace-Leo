import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=root+'dist/';
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// Explicit publish list: firmware, documents, keys and raw tracks are never assets.
const files=['index.html','style.css','capture.css','capture-core.js','capture.js','core.js','app.js','tiles.js','review.html','review.js','precision.js','document.css','guide.html','handout.html','icon.svg','manifest.webmanifest','sw.js','vendor','assets'];
for(const name of files)await cp(root+name,out+name,{recursive:true});
console.log('PACE public assets prepared.');
