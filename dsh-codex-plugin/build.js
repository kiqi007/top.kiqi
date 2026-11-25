import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

await build({entryPoints:['src/client.js'], bundle:true, loader:{'.svg':'text','.jpg':'dataurl'},
  format:'iife', target:'es2022', minify:true, legalComments:'inline', outfile:'client.js'})
const [template,client,guide] = await Promise.all(
  ['src/preview.html','client.js','README.md'].map(path => readFile(path,'utf8')))
const inline = text => JSON.stringify(text).replace(/</g,'\\u003c')
const preview = template
  .replace('<!-- bundled-client -->',() => '<script src="data:text/javascript;base64,'+Buffer.from(client).toString('base64')+'"></script>')
  .replace('/* plugin-readme */ null',() => inline(guide))
await writeFile('preview.html',preview)
