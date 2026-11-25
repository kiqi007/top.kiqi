import MarkdownIt from 'markdown-it'
import { full as emoji } from 'markdown-it-emoji'

const parser = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(emoji)

// Resolve local file URIs through the same authenticated workspace reader as paths.
export function workspaceHref(href) {
  if (!href) return null
  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href)
      if (url.hostname && url.hostname !== 'localhost') return '\\\\' + url.hostname + url.pathname + url.hash
      href = url.pathname + url.hash
    } catch { return null }
  }
  if (/^sandbox:\/\//i.test(href)) return null
  if (/^sandbox:\//i.test(href)) href = href.slice('sandbox:'.length)
  if (/^(?:https?:|mailto:|data:|\/\/)/i.test(href)) return href
  const path = href.replace(/%5c/ig,'\\')
  if (path.startsWith('\\\\')) return '\\\\' + path.slice(2).replaceAll('\\','/')
  return path.replaceAll('\\','/').replace(/^\/([a-z]:\/)/i,'$1')
}
export function hasScheme(href) {
  return /^[a-z][\w+.-]*:/i.test(href) && !/^[a-z]:\//i.test(href)
}
// CommonMark treats two leading backslashes as one escaped backslash.
const parseDestination = parser.helpers.parseLinkDestination
parser.helpers.parseLinkDestination = (source,start,end) => {
  const result = parseDestination(source,start,end)
  if (result.ok && /^<?\\\\/.test(source.slice(start,start+3)) && /^\\[^\\]/.test(result.str)) result.str = '\\'+result.str
  return result
}
const validLink = parser.validateLink
parser.validateLink = href => /^file:/i.test(href) ? !!workspaceHref(href) : validLink(href)

function headingId(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s+/g,'-')
}

const raster = /\.(?:png|jpe?g|webp|gif|avif|svg|ico)$/i
const remote = /^(?:https?:\/\/|\/\/|mailto:)/i
export function previewKind(path) {
  const name = path.split(/[?#]/,1)[0].replace(/:\d+(?::\d+)?$/,'')
  if (raster.test(name)) return 'image'
  if (!remote.test(path) && /\.html?$/i.test(name)) return 'html'
  if (!remote.test(path) && /\.(md|markdown)$/i.test(name)) return 'markdown'
  if (!remote.test(path)) return 'file'
}
function activate(link, action) {
  const open = event => {
    if (event.type === 'auxclick' && event.button !== 1) return
    event.preventDefault()
    action()
  }
  link.addEventListener('click',open)
  link.addEventListener('auxclick',open)
}
export async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text) }
  catch {
    const field = document.createElement('textarea')
    field.value = text; field.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    button.after(field); field.select()
    const copied = document.execCommand('copy')
    field.remove(); button.focus()
    if (!copied) throw Error('复制失败')
  }
}

export function imageLink(img, url, openPreview) {
  const link = document.createElement('a')
  link.className = 'image-link'
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.title = img.alt || '放大图片'
  link.setAttribute('aria-label', '查看大图 · ' + (img.alt || '图片'))
  activate(link, () => openPreview({kind:'image', url, title:img.alt || '图片'}))
  link.append(img)
  return link
}

export function markdown(text, fileURL, openPreview, user = false) {
  const el = document.createElement('div')
  el.className = 'rich'
  const env = {}, tokens = parser.parse(text,env)
  if (user) {
    let lastEnd = 0
    for (const token of tokens) {
      if (token.level !== 0 || !token.map) continue
      if (token.map[0] - lastEnd >= 3) token.attrJoin('class','prompt-break')
      lastEnd = token.map[1]
    }
  }
  el.innerHTML = parser.renderer.render(tokens,parser.options,env)
  const headings = new Map()
  for (const heading of el.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const base = headingId(heading.textContent)
    let key = base
    for (let n = 1; headings.has(key); n++) key = base + '-' + n
    headings.set(key,heading); heading.dataset.anchor = key
  }
  for (const link of el.querySelectorAll('a')) {
    const href = workspaceHref(link.getAttribute('href'))
    if (!href) { link.replaceWith(...link.childNodes); continue }
    if (href.startsWith('#')) {
      link.onclick = event => {
        event.preventDefault()
        let key = href.slice(1)
        try { key = decodeURIComponent(key) } catch {}
        headings.get(key)?.scrollIntoView({block:'nearest'})
      }
      continue
    }
    let target = href
    const local = !remote.test(href)
    if (local) {
      if (hasScheme(href)) { link.replaceWith(...link.childNodes); continue }
      target = fileURL(href)
    }
    const kind = previewKind(href)
    link.className = local ? 'file-link' : 'external-link'
    if (local && !link.querySelector('img')) link.dataset.fileKind = kind || 'file'
    if (kind) {
      const title = link.textContent.trim() || link.querySelector('img')?.alt || href.split('/').pop()
      const item = {kind, path:href, url:target, title}
      activate(link, () => openPreview(item))

    }
    link.href = target
    if (!kind) link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  for (const img of el.querySelectorAll('img')) {
    if (img.closest('.image-link')) continue
    const src = workspaceHref(img.getAttribute('src'))
    if (!src) { img.replaceWith(img.alt); continue }
    if (!/^(?:https?:\/\/|\/\/|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(src)) {
      if (hasScheme(src)) { img.replaceWith(img.alt); continue }
      img.src = fileURL(src)
    }
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    if (!img.closest('a')) {
      const marker = document.createTextNode('')
      img.replaceWith(marker); marker.replaceWith(imageLink(img,img.src,openPreview))
    }
  }
  for (const pre of el.querySelectorAll('pre')) {
    const code = pre.querySelector('code')
    if (!code) continue
    const block = document.createElement('section'), header = document.createElement('div')
    block.className = 'code-block'; header.className = 'code-head'
    const language = document.createElement('span'), button = document.createElement('button')
    language.textContent = code.className.match(/(?:^|\s)language-(\S+)/)?.[1] || ''
    button.type = 'button'; button.textContent = '复制代码'
    button.onclick = async () => {
      try { await copyText(code.textContent,button); button.textContent = '已复制' }
      catch (error) { button.textContent = error.message }
      setTimeout(() => { button.textContent = '复制代码' },1500)
    }
    pre.replaceWith(block); header.append(language,button); block.append(header,pre)
  }
  for (const table of el.querySelectorAll('table')) {
    const box = document.createElement('div')
    box.className = 'table-scroll'
    table.replaceWith(box)
    box.append(table)
  }
  return el
}
