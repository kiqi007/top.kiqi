import { enableReorder } from './reorder.js'
import morning from './backgrounds/morning.jpg'
import sunset from './backgrounds/sunset.jpg'
import moonlight from './backgrounds/moonlight.jpg'

const starterBackgrounds = [
  ['鲸鱼娘 · 海风手记', morning],
  ['鲸鱼娘 · 落日灯塔', sunset],
  ['鲸鱼娘 · 月下航行', moonlight],
]

export const imageAccept = 'image/png,image/jpeg,image/webp,image/gif'
const imageTypes = imageAccept.split(',')
export const maxImageBytes = 16 * 1024 * 1024

export function checkImage(file) {
  if (!imageTypes.includes(file.type)) throw Error('支持 PNG、JPEG、WebP 和 GIF 图片')
  if (!file.size || file.size > maxImageBytes) throw Error('单张图片须在 16 MiB 以内')
}

function dataURL(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export function composeImages(form, draft, changed, error) {
  const picker = form.querySelector('.image-picker'), strip = form.querySelector('.image-drafts')
  picker.accept = imageAccept
  function paint() {
    strip.replaceChildren()
    for (const image of draft.images) {
      const btn = document.createElement('button'), thumb = new Image()
      btn.type = 'button'; btn.className = 'draft-image'; btn.title = '移除 '+image.name
      btn.setAttribute('aria-label',btn.title); thumb.alt = image.name; thumb.src = image.url
      btn.append(thumb)
      btn.onclick = () => { draft.images = draft.images.filter(i => i !== image); paint(); changed() }
      strip.append(btn)
    }
  }
  async function add(files) {
    if (!files.length || draft.reading) return
    draft.reading = true; changed()
    try {
      files.forEach(checkImage)
      const bytes = [...draft.images,...files].reduce((sum,f) => sum+f.size,0)
      if (bytes > maxImageBytes) throw Error('单条消息的图片合计须在 16 MiB 以内')
      const images = await Promise.all(files.map(async f => ({name:f.name,size:f.size,url:await dataURL(f)})))
      draft.images.push(...images); paint(); error('')
    } catch(e) { error(e.message) }
    finally { draft.reading = false; changed() }
  }
  form.querySelector('.attach').onclick = () => picker.click()
  picker.onchange = () => { add([...picker.files]); picker.value = '' }
  form.onpaste = event => {
    const files = [...event.clipboardData.files]
    if (files.length) { event.preventDefault(); add(files) }
  }
  form.ondragover = event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }
  form.ondrop = event => {
    if (event.dataTransfer.files.length) { event.preventDefault(); add([...event.dataTransfer.files]) }
  }
  paint()
  return paint
}

// Pictures live in this browser. The host only receives images attached to a message.
export function backgroundLibrary(dialog, key, repaint) {
  const input = dialog.querySelector('input[type=file]'), grid = dialog.querySelector('.gallery'), status = dialog.querySelector('[role=status]')
  const add = dialog.querySelector('.add-background')
  const urls = new Map()
  let db, closed = false, busy = false, entries = [], slots = {}
  try { slots = JSON.parse(localStorage.getItem(key+'.slots')) || {} } catch {}
  const wall = dialog.closest('.wall'), range = dialog.querySelector('input[type=range]'), output = dialog.querySelector('output')
  let order = [], wash
  try {
    const stored = JSON.parse(localStorage.getItem(key+'.order'))
    if (Array.isArray(stored)) order = stored
    const value = JSON.parse(localStorage.getItem(key+'.wash'))
    if (Number.isInteger(value) && value >= 0 && value <= 100) wash = value
  } catch {}
  function syncWash() {
    if (wash != null) wall.style.setProperty('--background-wash',wash+'%')
    range.value = wash ?? parseInt(getComputedStyle(wall).getPropertyValue('--default-wash'),10)
    output.value = range.value+'%'
  }
  range.oninput = () => {
    wash = range.valueAsNumber
    syncWash()
    try { localStorage.setItem(key+'.wash',String(wash)) } catch {}
  }
  syncWash()
  enableReorder(grid,{handles:'.gallery-tile',targets:'.gallery-tile',keyboard:'.gallery-tile',key:'imageId'},
    () => entries.map(pic => String(pic.id)),(id,dest) => {
      const from = entries.findIndex(pic => String(pic.id) === id), to = entries.findIndex(pic => String(pic.id) === dest)
      if (busy || from < 0 || to < 0 || from === to) return
      const tile = grid.children[from], target = grid.children[to]
      grid.insertBefore(tile,from < to ? target.nextSibling : target)
      entries.splice(to,0,...entries.splice(from,1))
      order = entries.map(pic => pic.id)
      try { localStorage.setItem(key+'.order',JSON.stringify(order)) } catch {}
      repaint()
    })
  input.accept = imageAccept
  const ready = new Promise((resolve,reject) => {
    const req = indexedDB.open(key,2)
    req.onupgradeneeded = event => {
      const store = event.oldVersion === 0 ? req.result.createObjectStore('images',{autoIncrement:true}) : req.transaction.objectStore('images')
      const count = store.count()
      count.onsuccess = () => {
        if (count.result || Object.keys(slots).length) return
        for (const [name,url] of starterBackgrounds) {
          const bytes = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0))
          store.add(new File([bytes],name+'.jpg',{type:'image/jpeg'}))
        }
      }
    }
    req.onblocked = () => { status.textContent = '关闭其他已打开的会话窗后，图库会自动更新。' }
    req.onsuccess = () => {
      db = req.result
      db.onversionchange = () => db.close()
      if (closed) db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  async function update(files = [], removeKey) {
    if (busy || closed) return
    busy = true; add.disabled = true; grid.inert = true
    try {
      files.forEach(checkImage)
      const database = await ready
      if (closed) return
      const tx = database.transaction('images',files.length || removeKey != null ? 'readwrite' : 'readonly')
      const store = tx.objectStore('images')
      let tooMany = false
      const records = []
      await new Promise((resolve,reject) => {
        tx.oncomplete = resolve
        tx.onabort = () => reject(tooMany ? Error('背景图库最多 8 张，请先移除一张') : tx.error || Error('图库未保存'))
        const count = store.count()
        count.onsuccess = () => {
          if (count.result + files.length > 8) { tooMany = true; tx.abort(); return }
          if (removeKey != null) store.delete(removeKey)
          for (const file of files) store.add(file)
          const cursor = store.openCursor()
          cursor.onsuccess = () => {
            const item = cursor.result
            if (item) { records.push([item.key,item.value]); item.continue() }
          }
        }
      })
      if (closed) return
      const rank = new Map(order.map((id,index) => [id,index]))
      records.sort(([a],[b]) => (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length))
      entries = records.map(([id,file]) => {
        if (!urls.has(id)) urls.set(id,URL.createObjectURL(file))
        return {id,name:file.name,url:urls.get(id)}
      })
      for (const [id,url] of urls) if (!entries.some(pic=>pic.id===id)) { URL.revokeObjectURL(url); urls.delete(id) }
      status.textContent = ''; repaint()
      grid.replaceChildren()
      for (const pic of entries) {
        const tile = document.createElement('div'), img = new Image(), remove = document.createElement('button')
        img.src = pic.url; img.alt = pic.name; img.draggable = false
        tile.className = 'gallery-tile'; tile.dataset.imageId = pic.id; tile.tabIndex = 0
        tile.setAttribute('role','group'); tile.setAttribute('aria-label',pic.name)
        tile.setAttribute('aria-keyshortcuts','Alt+ArrowLeft Alt+ArrowRight')
        tile.title = '拖动排序，或按 Alt + 左右方向键'
        remove.type = 'button'; remove.textContent = '×'; remove.title = '移除 '+pic.name
        remove.setAttribute('aria-label',remove.title); remove.onclick = () => update([],pic.id)
        tile.append(img,remove); grid.append(tile)
      }
    } catch (e) { status.textContent = e.message || '浏览器无法保存背景图库' }
    finally { busy = false; grid.inert = false; add.disabled = entries.length >= 8; dialog.querySelector('small').textContent = entries.length+' / 8' }
  }
  add.onclick = () => input.click()
  input.onchange = () => { update([...input.files]); input.value = '' }
  dialog.querySelector('.gallery-close').onclick = () => dialog.close()
  update()
  return {
    open() { syncWash(); dialog.showModal(); update() },
    apply(ids,views) {
      if (!entries.length) {
        for (const v of views.values()) { v.el.style.removeProperty('--wallpaper'); v.el.classList.remove('with-wallpaper') }
        return
      }
      const used = new Set(), old = JSON.stringify(slots)
      for (const id of ids) {
        if (!Number.isInteger(slots[id]) || used.has(slots[id])) {
          let slot = 0
          while (used.has(slot)) slot++
          slots[id] = slot
        }
        used.add(slots[id])
        const card = views.get(id)?.el
        card?.classList.add('with-wallpaper')
        card?.style.setProperty('--wallpaper','url("'+entries[slots[id]%entries.length].url+'")')
      }
      if (JSON.stringify(slots) !== old) { try { localStorage.setItem(key+'.slots',JSON.stringify(slots)) } catch {} }
    },
    close() { closed = true; db?.close(); for (const url of urls.values()) URL.revokeObjectURL(url) }
  }
}
