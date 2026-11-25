import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'

const imageTypes = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.avif':'image/avif', '.ico':'image/x-icon' }
const mediaTypes = {'.pdf':'application/pdf','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'}
function looksLikeText(bytes) {
  const sample = bytes.subarray(0,8192)
  if (sample.some(n => (n < 32 && ![9,10,12,13].includes(n)) || n === 127)) return false
  try { new TextDecoder('utf-8',{fatal:true}).decode(sample,{stream:bytes.length > sample.length}); return true }
  catch { return false }
}

const textTypes = new Set(['.md','.txt','.json','.yaml','.yml','.toml','.go','.js','.ts','.css','.py','.log','.html','.sh'])

// Check the lexical Windows path before touching a share or a device. The
// canonical workspace check below also covers junctions and symbolic links.
export function windowsPreviewPath(cwd, path) {
  // Rust can report canonical workspace roots in Windows extended-length form.
  cwd = cwd.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\(?=[a-z]:\\)/i,'')
  path = path.replace(/^\/([a-z]:[\\/])/i,'$1').replaceAll('/','\\')
  if (/^\\\\[?.]\\|^[a-z]:(?!\\)/i.test(path)) return null
  const parts = path.replace(/^[a-z]:/i,'').split('\\')
  if (parts.some(p => p.includes(':') || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])(?:\.|$)/i.test(p))) return null
  const target = win32.resolve(cwd,path)
  const within = win32.relative(cwd,target)
  return within && !win32.isAbsolute(within) && within !== '..' && !within.startsWith('..\\') ? target : null
}

export async function workspaceFile(cwd, href) {
  let file
  try {
    const path = decodeURIComponent(href.split(/[?#]/,1)[0]).replace(/:\d+(?::\d+)?$/,'')
    if (!path || !isAbsolute(cwd)) return new Response('无效的文件路径',{status:400})
    const root = await realpath(cwd)
    const candidate = process.platform === 'win32' ? windowsPreviewPath(cwd,path) : resolve(root,path)
    if (!candidate) return new Response('文件位于会话工作区之外或路径无效',{status:403})
    const target = await realpath(candidate)
    const inside = relative(root,target)
    if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith('..'+sep)) return new Response('文件位于会话工作区之外',{status:403})
    file = await open(target,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await file.stat()
    if (!stat.isFile()) return new Response('请选择文件',{status:404})
    if (stat.size > 16*1024*1024) return new Response('文件超过 16 MiB',{status:413})
    const ext = extname(target).toLowerCase()
    const bytes = await file.readFile()
    const type = imageTypes[ext] || mediaTypes[ext] || (textTypes.has(ext) || looksLikeText(bytes) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
    const disposition = type === 'application/octet-stream' ? 'attachment' : 'inline'
    return new Response(bytes,{headers:{
      'content-type':type, 'cache-control':'private, no-store', 'x-content-type-options':'nosniff',
      'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'",
      'content-disposition':disposition+"; filename*=UTF-8''"+encodeURIComponent(basename(target)).replace(/'/g,'%27'),
    }})
  } catch { return new Response('找不到工作区文件',{status:404}) }
  finally { await file?.close() }
}

// Only an attachment recorded on a user message may be read outside its cwd.
export async function attachmentImage(cwd, image) {
  if (image?.path && imageTypes[extname(image.path).toLowerCase()]) {
    const path = resolve(cwd,image.path)
    try {
      const actual = await realpath(path)
      if (relative(actual,resolve(await realpath(dirname(path)),basename(path))) !== '') return new Response('无效的图片路径',{status:403})
      return workspaceFile(dirname(actual),encodeURIComponent(basename(actual)))
    } catch { return new Response('找不到图片附件',{status:404}) }
  }
  const data = /^data:(image\/(?:png|jpeg|jpg|gif|webp|avif));base64,([A-Za-z\d+/=\s]+)$/i.exec(image?.url || '')
  if (data) return new Response(Buffer.from(data[2],'base64'),{headers:{'content-type':data[1],'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
  return new Response('找不到图片附件',{status:404})
}
