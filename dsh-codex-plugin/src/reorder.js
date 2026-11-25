// Capture the pointer so a drag can finish outside the source without also clicking it.
export function enableReorder(frame, {handles,targets,keyboard,key}, ids, move) {
  let drag, target, suppressClick = false
  function clear() {
    target?.classList.remove('order-target')
    drag?.handle.classList.remove('order-source')
    target = drag = null
  }
  frame.addEventListener('pointerdown', e => {
    const handle = e.target.closest(handles)
    if (!handle || !e.isPrimary || e.button !== 0 || handle.matches(':disabled') ||
        (!handle.matches('button') && e.target.closest('button'))) return
    drag = {handle,id:handle.dataset[key],pointer:e.pointerId,x:e.clientX,y:e.clientY,active:false}
    handle.setPointerCapture(e.pointerId)
  })
  frame.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointer) return
    if (!drag.active && Math.hypot(e.clientX-drag.x,e.clientY-drag.y) < 6) return
    drag.active = true
    drag.handle.classList.add('order-source')
    const under = frame.getRootNode().elementFromPoint(e.clientX,e.clientY)
    const hit = under?.closest(targets)
    target?.classList.remove('order-target')
    target = hit?.dataset[key] && hit.dataset[key] !== drag.id ? hit : null
    target?.classList.add('order-target')
  })
  frame.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.pointer) return
    const {active,id} = drag, dest = target?.dataset[key]
    clear()
    if (active) {
      suppressClick = true
      setTimeout(() => { suppressClick = false },0)
      if (dest) move(id,dest)
    }
  })
  for (const type of ['lostpointercapture','pointercancel']) frame.addEventListener(type, e => {
    if (drag?.pointer === e.pointerId) clear()
  })
  frame.addEventListener('click', e => {
    if (suppressClick && e.detail && e.target.closest(handles)) { e.preventDefault(); e.stopImmediatePropagation() }
  },true)
  frame.addEventListener('keydown', e => {
    const tab = e.target.matches(keyboard) && e.target
    if (!tab || !e.altKey || !['ArrowLeft','ArrowRight'].includes(e.key)) return
    e.preventDefault()
    const order = ids(), index = order.indexOf(tab.dataset[key])
    const dest = order[index + (e.key === 'ArrowLeft' ? -1 : 1)]
    if (dest) { move(tab.dataset[key],dest); tab.focus() }
  })
}
