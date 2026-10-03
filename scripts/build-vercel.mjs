import {cp,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'dist-vercel');
await mkdir(out,{recursive:true});
await cp(path.join(root,'public'),out,{recursive:true});
await mkdir(path.join(out,'vendor'),{recursive:true});
await build({stdin:{contents:"export {upload} from '@vercel/blob/client';",resolveDir:root,sourcefile:'blob-client-entry.js'},outfile:path.join(out,'vendor/blob-client.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
for(const name of ['u2netp.onnx','ort-1.22.0/ort-wasm-simd-threaded.wasm'])if((await stat(path.join(out,'vendor',name))).size<1000000)throw new Error('Browser segmentation artifact incomplete: '+name);
console.log('Built Vercel static assets with private upload client and local segmentation models.');
