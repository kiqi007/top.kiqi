import { markdown, previewKind, workspaceHref, hasScheme } from './markdown.js'

function relativeTo(documentPath, href) {
  if (href.startsWith('\\\\')) return href
  if (/^(?:\/|[a-z][\w+.-]*:)/i.test(href)) return href
  const path = documentPath.split(/[?#]/,1)[0]
  return path.slice(0,path.lastIndexOf('/')+1) + href
}

async function read(url, signal) {
  const response = await fetch(url,{signal})
  if (!response.ok) {
    const reason = response.status === 403 ? '文件位于可访问工作区之外或缺少访问权限' :
      response.status === 404 ? '找不到文件或会话已断开' : response.status === 413 ? '文件超过预览大小限制' : '文件读取失败'
    throw Error(reason + '（HTTP ' + response.status + '）')
  }
  return response
}

async function dataURL(blob) {
  const reader = new FileReader()
  return new Promise((resolve,reject) => {
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Package local assets into an opaque sandbox. The embedded page never gets a
// board identifier or access to the DSH window and its authenticated API.
async function htmlDocument(source, fileURL, path, signal) {
  const doc = new DOMParser().parseFromString(source,'text/html')
  for (const el of doc.querySelectorAll('base,meta[http-equiv]')) el.remove()
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:"
  doc.head.prepend(policy)
  const assets = new Map()
  function localAsset(href, mime) {
    href = workspaceHref(href)
    if (!href || hasScheme(href) || /^(?:\/\/|#)/.test(href)) return
    const url = fileURL(relativeTo(path,href))
    const key = mime + url
    if (!assets.has(key)) assets.set(key,read(url,signal).then(async res =>
      dataURL(new Blob([await res.blob()],{type:mime || res.headers.get('content-type')}))))
    return assets.get(key)
  }
  await Promise.all([...doc.querySelectorAll('script[src],link[rel~="stylesheet"][href],img[src]')].map(async el => {
    const attr = el.tagName === 'LINK' ? 'href' : 'src'
    const value = localAsset(el.getAttribute(attr),{SCRIPT:'text/javascript',LINK:'text/css'}[el.tagName])
    if (value) el.setAttribute(attr,await value)
  }))
  // Route authored links through the parent viewer. Keep the frame sandboxed
  // and pass only an index into this document's link list.
  const links = []
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = workspaceHref(anchor.getAttribute('href'))
    if (href?.startsWith('#')) { anchor.removeAttribute('target'); continue }
    anchor.removeAttribute('target'); anchor.removeAttribute('download')
    if (!href || (hasScheme(href) && !/^https?:\/\/|^mailto:/i.test(href))) {
      anchor.removeAttribute('href'); continue
    }
    anchor.href = '#'
    anchor.dataset.previewIndex = String(links.length)
    links.push({href,title:anchor.textContent.trim() || href})
  }
  const bridge = doc.createElement('script')
  bridge.textContent = `function followFile(event) {
    const link = event.target.closest?.('a[data-preview-index]')
    if (!link || event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return
    event.preventDefault()
    parent.postMessage({codexPreviewLink:Number(link.dataset.previewIndex)},'*')
  }
  document.addEventListener('click',followFile)
  document.addEventListener('auxclick',followFile)`
  doc.body.append(bridge)
  return {source:'<!doctype html>\n'+doc.documentElement.outerHTML,links}
}

export function makePreview(dialog) {
  const body = dialog.querySelector('.preview-body'), title = dialog.querySelector('strong')
  const back = dialog.querySelector('.preview-back'), stack = []
  let loading, objectURL
  function release() {
    loading?.abort()
    if (objectURL) URL.revokeObjectURL(objectURL)
    objectURL = undefined
  }
  dialog.querySelector('.preview-close').onclick = () => dialog.close()
  dialog.onclose = () => {
    if (dialog.open) return
    release(); stack.length = 0; body.replaceChildren()
  }
  back.onclick = () => { stack.pop(); show(stack.at(-1)) }

  async function show(entry) {
    release()
    const controller = new AbortController()
    loading = controller
    const {item, fileURL, readDemo} = entry
    back.hidden = stack.length < 2
    title.textContent = item.title
    dialog.dataset.kind = item.kind
    body.textContent = '正在读取…'
    body.scrollTop = 0
    if (!dialog.open) dialog.showModal()
    try {
      if (item.kind === 'image') {
        const img = new Image()
        img.alt = item.title; img.referrerPolicy = 'no-referrer'
        img.onerror = () => { if (!controller.signal.aborted) body.textContent = '图片无法加载' }
        body.replaceChildren(img); img.src = item.url
        return
      }
      if (item.kind === 'external') {
        const box = document.createElement('div'), link = document.createElement('a')
        box.className = 'file-info'; link.href = item.url; link.rel = 'noopener noreferrer'
        link.target = '_blank'; link.textContent = '打开外部链接 · '+item.url
        box.append(link); body.replaceChildren(box); return
      }
      if (item.kind === 'file') {
        const demo = await readDemo?.(item.path)
        const response = demo == null ? await read(item.url,controller.signal) : new Response(demo)
        const blob = await response.blob()
        if (controller.signal.aborted) return
        if (blob.type.startsWith('text/') || /(?:json|xml|javascript)/i.test(blob.type)) {
          const pre = document.createElement('pre')
          pre.className = 'preview-source'; pre.textContent = await blob.text()
          if (!controller.signal.aborted) body.replaceChildren(pre)
          return
        }
        objectURL = URL.createObjectURL(blob)
        if (blob.type === 'application/pdf' && navigator.pdfViewerEnabled) {
          const pdf = document.createElement('object')
          pdf.type = blob.type; pdf.data = objectURL; pdf.setAttribute('aria-label',item.title)
          body.replaceChildren(pdf)
        } else if (/^(audio|video)\//.test(blob.type)) {
          const media = document.createElement(blob.type.split('/')[0])
          media.controls = true; media.className = 'file-media'; media.src = objectURL
          body.replaceChildren(media); return
        } else { body.replaceChildren() }
        const box = document.createElement('div'), save = document.createElement('a')
        const name = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''(.+)$/i)?.[1] || item.path.split(/[?#]/,1)[0].split('/').pop()
        let display = name
        try { display = decodeURIComponent(name) } catch {}
        box.className = 'file-info'; box.textContent = display+' · '+Math.ceil(blob.size/1024)+' KiB '
        save.className = 'file-save'; save.textContent = '保存文件'; save.href = objectURL; save.download = display
        box.append(save); body.append(box); return
      }
      const frame = item.kind === 'html' ? document.createElement('iframe') : null
      if (frame) {
        frame.title = item.title; frame.setAttribute('sandbox','allow-scripts'); frame.referrerPolicy = 'no-referrer'
        if (readDemo && item.url.startsWith('file:')) {
          frame.src = item.url; body.replaceChildren(frame); return
        }
      }
      const source = await readDemo?.(item.path) ?? await (await read(item.url,controller.signal)).text()
      if (controller.signal.aborted) return
      if (frame) {
        const packed = await htmlDocument(source,fileURL,item.path,controller.signal)
        if (controller.signal.aborted) return
        window.addEventListener('message',event => {
          if (event.source !== frame.contentWindow || !Number.isInteger(event.data?.codexPreviewLink)) return
          const link = packed.links[event.data.codexPreviewLink]
          if (!link) return
          const external = /^(?:https?:\/\/|\/\/|mailto:)/i.test(link.href)
          const path = relativeTo(item.path,link.href)
          open({path,title:link.title,kind:external ? 'external' : previewKind(path),url:external ? new URL(link.href,location.href).href : fileURL(path)},fileURL,readDemo)
        },{signal:controller.signal})
        frame.srcdoc = packed.source; body.replaceChildren(frame)
      } else {
        const base = href => relativeTo(item.path,href)
        const rich = markdown(source, href => fileURL(base(href)), nested =>
          open({...nested,path:nested.path && base(nested.path)},fileURL,readDemo))
        body.replaceChildren(rich)
        if (item.path.includes('#')) rich.querySelectorAll('[data-anchor]').forEach(el => {
          if ('#'+encodeURIComponent(el.dataset.anchor) === item.path.slice(item.path.indexOf('#'))) el.scrollIntoView({block:'start'})
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) body.textContent = error.message
    }
  }
  function open(item, fileURL, readDemo) {
    if (!dialog.open) stack.length = 0
    const entry = {item,fileURL,readDemo}
    stack.push(entry); show(entry)
  }
  open.dispose = release
  return open
}
