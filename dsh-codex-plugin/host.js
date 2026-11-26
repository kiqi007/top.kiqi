import { randomUUID } from 'node:crypto'
import { localEndpoint, connectEndpoint } from './local-endpoint.js'
import WebSocket from 'ws'
import { workspaceFile, attachmentImage } from './workspace-file.js'

const approvalKinds = new Map([
  ['item/commandExecution/requestApproval', '命令执行'],
  ['item/fileChange/requestApproval', '文件修改'],
])
const methods = new Set(['list', 'watch', 'snapshot', 'details', 'send', 'edit', 'decide', 'close'])
const editingThreads = new Set()
const desktopOriginators = new Set(['Codex Desktop', 'codex_work_desktop'])
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i

function summary(t) {
  return { id: t.id, title: (t.name || t.preview || '未命名会话').slice(0, 120),
    cwd: t.cwd, model: t.model, status: t.status, updated: t.updatedAt, recencyAt: t.recencyAt ?? t.updatedAt ?? t.createdAt }
}

function promptParts(text) {
  const start = /^\s*# Files mentioned by the user:[\s\S]*?\n## My request:\s*\n/.exec(text)
  return {prefix:start?.[0] || '', body:text.slice(start?.[0].length || 0)}
}

function message(item) {
  const entry = messageContent(item)
  return entry && {...entry, timeMs:item.startedAtMs ?? item.completedAtMs ?? undefined}
}

function messageContent(item) {
  switch (item.type) {
    case 'userMessage': {
      const images = [], text = []
      for (const input of item.content) {
        if (input.type === 'localImage' && input.path) images.push({path:input.path})
        else if (input.type === 'image' && /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(input.url || '')) images.push({url:input.url})
        else text.push(input.text ?? (input.type === 'image' ? '［图片附件］' : '[' + input.type + ']'))
      }
      const textParts = item.content.filter(part => part.type === 'text')
      const editText = promptParts(textParts[0]?.text || '').body
      const body = promptParts(text.join('\n')).body
      return {role:'user',text:body,...(editText !== body && {editText}),...(images.length && {images})}
    }
    case 'agentMessage': return { role: 'agent', phase: item.phase ?? null, text: item.text }
    case 'plan': return { role: 'step', label: '计划', text: item.text }
    case 'commandExecution': return { role: 'tool', label: '执行命令', text: item.command, output: item.aggregatedOutput || '', status: item.status }
    case 'fileChange': return { role: 'tool', label: '修改文件', text: item.changes.map(x => x.path).join('\n'), status: item.status }
    case 'dynamicToolCall': case 'mcpToolCall': case 'collabAgentToolCall':
      return { role: 'tool', label: '调用工具', text: [item.server || item.namespace, item.tool].filter(Boolean).join('.'), status: item.status }
    case 'webSearch': return { role: 'step', label: '搜索', text: item.query || '搜索网页' }
    default: return null
  }
}

function recordTurn(card, turn) {
  const previous = card.turns.get(turn.id)
  const meta = { ...previous, id: turn.id, status: turn.status, durationMs: turn.durationMs ?? previous?.durationMs,
    completedAt: turn.completedAt ?? previous?.completedAt,
    startedAt: turn.startedAt ?? previous?.startedAt, error: turn.error?.message ?? previous?.error,
    detailsLoaded: previous?.detailsLoaded ?? false }
  card.turns.set(turn.id, meta)
  for (const item of turn.items ?? []) put(card, turn.id, item.id, message(item))
  if (card.turns.size > 12) {
    const oldest = card.turns.keys().next().value
    card.turns.delete(oldest)
    for (const [id, m] of card.messages) if (m.turnId === oldest) card.messages.delete(id)
  }
}

function put(card, turnId, id, entry) {
  if (!entry || !turnId) return
  if (!card.turns.has(turnId)) recordTurn(card, { id: turnId, status: card.turn === turnId ? 'inProgress' : 'completed' })
  const main = entry.role === 'user' || (entry.role === 'agent' && entry.phase !== 'commentary')
  const row = { ...entry, timeMs:entry.timeMs ?? card.messages.get(id)?.timeMs, id, turnId, text:main ? entry.text : entry.text.slice(-16000) }
  if (row.output) row.output = row.output.slice(-3000)
  card.messages.set(id, row)
  // Bound noisy tool streams separately so the opening prompt and final reply survive.
  if (card.messages.size > 100) {
    const details = [...card.messages.values()].filter(m => m.role === 'tool' || m.role === 'step' || m.phase === 'commentary')
    if (details.length > 80) card.messages.delete(details[0].id)
  }
}

async function readItems(board, threadId, turnId) {
  const page = await board.call('thread/items/list', { threadId, turnId, sortDirection: 'desc', limit: 60,
    deferOutput: { commandExecution: true, mcpToolCall: true } })
  return page.data.reverse().map(({ item }) => {
    const entry = message(item)
    if (!entry) return null
    return { ...entry, id: item.id, turnId, text:entry.role === 'tool' ? entry.text.slice(-16000) : entry.text, output: entry.output?.slice(-3000) }
  }).filter(Boolean)
}

// One connection belongs to one open board. Approval IDs have meaning only on this socket.
export class Board {
  constructor(endpoint) {
    this.cards = new Map()
    this.visibleIds = []
    this.models = new Map()
    this.catalog = new Map()
    this.calls = new Map()
    this.waiting = new Map()
    this.revision = 0
    this.sequence = 0
    this.lastUse = Date.now()
    this.socket = connectEndpoint(endpoint)
    this.socket.on('error', () => {})
    this.socket.on('close', () => {
      for (const call of this.calls.values()) call.reject(new Error('Codex 连接已断开'))
      this.calls.clear()
      this.waiting.clear()
    })
    this.socket.on('message', data => this.receive(JSON.parse(data)))
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('error', reject)
      this.socket.once('open', resolve)
    }).then(async () => {
      await this.call('initialize', { clientInfo: { name: 'dsh_codex_wall', version: '0.8.0' },
        capabilities: { experimentalApi: true, requiredHumanApproval: true } })
      this.socket.send(JSON.stringify({ method: 'initialized' }))
    })
  }

  close() { this.socket.terminate() }

  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.calls.delete(id)
        reject(new Error('Codex 请求超时，请核对会话中的最新状态'))
      }, 20000)
      const finish = fn => value => { clearTimeout(timer); fn(value) }
      this.calls.set(id, { resolve: finish(resolve), reject: finish(reject) })
      this.socket.send(JSON.stringify({ id, method, params }), err => {
        if (err) { this.calls.get(id)?.reject(err); this.calls.delete(id) }
      })
    })
  }

  receive(m) {
    if (!m.method) {
      const call = this.calls.get(m.id)
      this.calls.delete(m.id)
      if (m.error) call?.reject(new Error(m.error.message))
      else call?.resolve(m.result)
      return
    }
    const p = m.params ?? {}
    const card = this.cards.get(p.threadId)
    if (!card) return
    if (card.loading) { card.buffer.push(m); return }
    if (m.method === 'thread/reverted') {
      card.dirty = true
      this.revision++
      return
    }
    if (approvalKinds.has(m.method) && m.id != null) {
      const token = randomUUID()
      const decisions = (p.availableDecisions ?? ['accept', 'decline']).filter(d => ['accept', 'decline', 'cancel'].includes(d))
      this.waiting.set(token, { request: m.id, threadId: p.threadId, turnId: p.turnId, token, decisions,
        kind: p.kind === 'writeStdin' ? '终端输入' : approvalKinds.get(m.method),
        command: p.command || card.messages.get(p.itemId)?.text || '', reason: p.reason ?? '',
        scope: [p.cwd, p.grantRoot, p.additionalPermissions && JSON.stringify(p.additionalPermissions),
          p.networkApprovalContext && JSON.stringify(p.networkApprovalContext)].filter(Boolean).join('\n') })
    } else if (m.method === 'serverRequest/resolved' || m.method === 'turn/completed') {
      for (const [key, a] of this.waiting) {
        if (a.threadId === card.id && (a.request === p.requestId || a.turnId === p.turn?.id)) this.waiting.delete(key)
      }
      if (m.method === 'turn/completed') {
        recordTurn(card, p.turn)
        if (card.turn === p.turn.id) card.turn = null
      }
    } else if (m.method === 'turn/started') {
      card.turn = p.turn.id
      recordTurn(card, p.turn)
      card.turns.get(p.turn.id).detailsLoaded = true
    }
    else if (m.method === 'thread/settings/updated') {
      const settings = p.threadSettings
      Object.assign(card,{model:settings.model, provider:settings.modelProvider ?? card.provider, effort:settings.effort, tier:settings.serviceTier})
      void this.loadModelLabels(card.provider)
    }
    else if (m.method === 'thread/status/changed') card.status = p.status
    else if (m.method === 'thread/name/updated') card.title = p.threadName || card.title
    else if (m.method === 'item/started' || m.method === 'item/completed') put(card, p.turnId ?? card.turn, p.item.id, message(p.item))
    else if (m.method === 'item/agentMessage/delta') {
      const previous = card.messages.get(p.itemId)
      put(card, p.turnId ?? card.turn, p.itemId, { ...previous, role: 'agent', text: (previous?.text ?? '') + p.delta })
    } else if (m.method === 'item/commandExecution/outputDelta' || m.method === 'item/mcpToolCall/progress') {
      const previous = card.messages.get(p.itemId)
      if (previous) put(card, p.turnId, p.itemId, { ...previous, output: (previous.output || '') + (p.delta ?? p.message + '\n') })
    } else return
    this.revision++
  }

  async threadPage(params) {
    const page = await this.call('thread/list', {
      currentAccountOnly:true, limit:100, sortKey:'recency_at', sortDirection:'desc', ...params,
    })
    const rows = page.data.filter(t => desktopOriginators.has(t.originator) || (!t.originator && t.source === 'vscode')).map(summary)
    return {rows, nextCursor:page.nextCursor ?? null}
  }

  async list(saved = [], paged = false, cursor = null) {
    const page = await this.threadPage({cursor})
    if (cursor) return page
    const catalog = new Map(page.rows.map(row => [row.id,row]))
    const missing = [...new Set(saved)].filter(id => !catalog.has(id) && uuid.test(id)).slice(0,8)
    if (missing.length) {
      const pinned = await this.threadPage({includedThreadIds:missing})
      for (const row of pinned.rows) catalog.set(row.id,row)
    }
    this.catalog = catalog
    const rows = [...catalog.values()]
    return paged ? {rows,nextCursor:page.nextCursor} : rows
  }

  async loadModelLabels(provider) {
    if (this.models.has(provider)) return
    const labels = new Map()
    this.models.set(provider,labels)
    try {
      let cursor
      do {
        const page = await this.call('model/list',{modelProvider:provider,includeHidden:true,limit:100,cursor})
        for (const model of page.data || []) {
          labels.set(model.model,model)
          labels.set(model.id,model)
        }
        cursor = page.nextCursor
      } while (cursor)
      this.revision++
    } catch { this.models.delete(provider) }
  }

  async attach(id) {
    const card = { ...this.catalog.get(id), loading: true, buffer: [], messages: new Map(), turns: new Map(), turn: null }
    this.cards.set(id, card)
    try {
      const res = await this.call('thread/resume', { threadId: id, excludeTurns: true,
        initialTurnsPage: { limit: 12, itemsView: 'summary', sortDirection: 'desc' } })
      Object.assign(card, summary(res.thread),{model:res.model ?? res.thread.model, provider:res.modelProvider, effort:res.reasoningEffort, tier:res.serviceTier})
      void this.loadModelLabels(card.provider)
      const turns = res.initialTurnsPage?.data.toReversed() ?? res.thread.turns ?? []
      card.turn = turns.findLast(t => t.status === 'inProgress')?.id ?? null
      for (const turn of turns) recordTurn(card, turn)
      if (card.turn) {
        for (const item of await readItems(this, id, card.turn)) put(card, card.turn, item.id, item)
        card.turns.get(card.turn).detailsLoaded = true
      }
      card.loading = false
      // The history read can already include a completed live item. Its completion
      // event replaces that item in full, including any buffered text deltas.
      for (const m of card.buffer) this.receive(m)
      card.buffer = []
    } catch (error) {
      this.cards.delete(id)
      await this.call('thread/unsubscribe', { threadId: id }).catch(() => {})
      throw error
    }
  }

  async refreshHistory(card) {
    if (card.refreshing) return card.refreshing
    card.refreshing = (async () => {
      card.loading = true
      card.dirty = false
      try {
        const {data} = await this.call('thread/turns/list',{threadId:card.id,limit:12,sortDirection:'desc',itemsView:'summary'})
        card.messages.clear(); card.turns.clear()
        card.turn = data.find(t => t.status === 'inProgress')?.id ?? null
        for (const turn of data.toReversed()) recordTurn(card,turn)
        if (card.turn) {
          for (const item of await readItems(this,card.id,card.turn)) put(card,card.turn,item.id,item)
          card.turns.get(card.turn).detailsLoaded = true
        }
        this.revision++
      } catch (error) { card.dirty = true; throw error }
      finally {
        card.loading = false
        for (const event of card.buffer.splice(0)) this.receive(event)
      }
    })()
    try { await card.refreshing } finally { card.refreshing = null }
  }

  async edit(card,p) {
    if (typeof p.text !== 'string' || !p.text.trim() || !uuid.test(p.editId)) throw new Error('编辑内容无效')
    if (editingThreads.has(card.id)) throw new Error('正在编辑此会话')
    editingThreads.add(card.id)
    try {
      const {data} = await this.call('thread/turns/list',{threadId:card.id,sortDirection:'desc',limit:13,itemsView:'summary'})
      const tail = data[0]?.id ?? null
      if (card.turn || card.status.type === 'active' || data.some(t => t.status === 'inProgress')) throw new Error('运行结束后可编辑消息')
      let edit = card.pendingEdit
      if (!edit || edit.id !== p.editId) {
        const index = data.findIndex(t => t.id === p.turnId)
        if (index < 0 || tail !== p.expectedTail) throw new Error('会话记录已变化，请重新打开编辑')
        const original = data[index].items.find(i => i.type === 'userMessage')
        if (!original || original.id !== p.messageId) throw new Error('未找到原始消息')
        // Keep the structured input (including images, mentions and file context)
        // from persisted history, never from an editable browser payload.
        edit = {id:p.editId, original:original.content, before:data[index+1]?.id ?? null}
        await this.call('thread/revert',{threadId:card.id,beforeTurnId:p.turnId})
        card.pendingEdit = edit
        card.dirty = true
        this.revision++
      } else if (tail !== edit.before) {
        throw new Error('会话已经继续，请核对最新消息')
      }
      const first = edit.original.findIndex(part => part.type === 'text')
      const input = edit.original.map((part,index) => index === first
        ? {...part,text:promptParts(part.text).prefix + p.text,text_elements:[]}
        : part)
      if (first < 0) input.unshift({type:'text',text:p.text,text_elements:[]})
      try {
        await this.call('turn/start',{threadId:card.id,clientUserMessageId:p.editId,turnTrigger:'edit_user_message',input})
        card.pendingEdit = null
      } catch (e) { throw new Error('会话已回退，编辑稿已保留。' + e.message) }
      return true
    } finally { editingThreads.delete(card.id) }
  }

  snapshot(revision) {
    if (this.revision === revision) return { revision }
    const pending = new Set([...this.waiting.values()].map(a => a.threadId))
    const bound = [...this.cards.values()].filter(c => !c.loading).map(c => ({
      id:c.id, title:c.title, status:c.status, awaitingApproval:pending.has(c.id),
    }))
    const cards = this.visibleIds.map(id => this.cards.get(id)).filter(c => c && !c.loading).map(c => ({
      id: c.id, title: c.title, cwd: c.cwd, model: c.model, modelLabel:this.models.get(c.provider)?.get(c.model)?.displayName,
      effort:c.effort ?? this.models.get(c.provider)?.get(c.model)?.defaultReasoningEffort, tier:c.tier, status: c.status, turn: c.turn,
      turns: [...c.turns.values()], messages: [...c.messages.values()].map(m => m.images ? {...m, images:m.images.map((image,index) => ({
        index, name:image.path?.split(/[\\/]/).pop() || '图片附件', url:/^https?:/i.test(image.url || '') ? image.url : undefined,
      }))} : m), approvals: [...this.waiting.values()].filter(a => a.threadId === c.id)
        .map(({request, ...a}) => a),
    }))
    return { revision: this.revision, bound, cards }
  }

  async run(op, p) {
    if (op === 'list') return this.list(Array.isArray(p.bound) ? p.bound : [], p.paged === true, p.cursor)
    if (op === 'snapshot') {
      for (const card of this.cards.values()) if (card.dirty || card.refreshing) await this.refreshHistory(card)
      return this.snapshot(p.revision)
    }
    if (op === 'watch') {
      if (this.changing) throw new Error('会话切换中')
      if (Array.isArray(p.ids) && p.ids.length > 8) throw new Error('最多绑定 8 个会话')
      if (!Array.isArray(p.ids) || new Set(p.ids).size !== p.ids.length) throw new Error('请选择列表中的会话')
      const visible = p.visibleIds ?? p.ids.slice(0,4)
      if (!Array.isArray(visible) || visible.length > 4 || new Set(visible).size !== visible.length || visible.some(id => !p.ids.includes(id))) {
        throw new Error('请选择最多四个已绑定会话显示')
      }
      this.changing = true
      try {
        const missing = p.ids.filter(id => !this.catalog.has(id) && !this.cards.has(id))
        if (missing.length) {
          if (!missing.every(id => uuid.test(id))) throw new Error('请选择列表中的会话')
          const page = await this.threadPage({includedThreadIds:missing})
          const available = new Map(page.rows.map(row => [row.id,row]))
          if (!missing.every(id => available.has(id))) throw new Error('所选会话已不可用，请重新选择')
          for (const id of missing) this.catalog.set(id,available.get(id))
        }
        for (const id of this.cards.keys()) {
          if (p.ids.includes(id)) continue
          await this.call('thread/unsubscribe', { threadId: id })
          this.cards.delete(id)
          for (const [key, a] of this.waiting) if (a.threadId === id) this.waiting.delete(key)
          this.revision++
        }
        for (const id of p.ids) if (!this.cards.has(id)) { await this.attach(id); this.revision++ }
        this.visibleIds = [...visible]
        this.revision++
        return this.snapshot(-1)
      } finally { this.changing = false }
    }
    const card = this.cards.get(p.threadId)
    if (!card || card.loading || this.changing) throw new Error('会话尚未就绪')
    if (op === 'edit') return this.edit(card,p)
    if (op === 'send' && editingThreads.has(card.id)) throw new Error('正在编辑此会话')
    if (op === 'details') {
      if (!card.turns.has(p.turnId)) throw new Error('这一轮已离开最近记录')
      return readItems(this, card.id, p.turnId)
    }
    if (op === 'send') {
      if (typeof p.text !== 'string' || p.text.length > 12000) throw new Error('指令最多 12000 字')
      const images = p.images ?? []
      if (!Array.isArray(images)) throw new Error('图片格式无效')
      const input = []
      if (p.text.trim()) input.push({type:'text',text:p.text.trim(),text_elements:[]})
      let bytes = 0
      for (const url of images) {
        if (typeof url !== 'string' || url.length > 22400000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new Error('仅支持本次附加的图片')
        const start = url.indexOf(',')+1
        bytes += Buffer.byteLength(url.slice(start),'base64')
        if (bytes > 16*1024*1024) throw new Error('图片合计超过 16 MiB')
        input.push({type:'image',url})
      }
      if (!input.length) throw new Error('请输入指令或添加图片')
      if (card.turn !== p.turn || (card.status.type === 'active' && !card.turn)) throw new Error('会话状态已改变，请查看最新消息再发送')
      const params = {threadId:card.id,input}
      if (card.turn) await this.call('turn/steer', { ...params, expectedTurnId: card.turn })
      else await this.call('turn/start', params)
      return true
    }
    const a = this.waiting.get(p.token)
    if (!a || a.threadId !== card.id || !a.decisions.includes(p.decision)) throw new Error('审批已处理或选项已失效')
    this.waiting.delete(p.token)
    await new Promise((resolve, reject) => this.socket.send(JSON.stringify({ id: a.request, result: { decision: p.decision } }),
      error => error ? reject(error) : resolve()))
    this.revision++
    return true
  }
}

export const inject = ['connection']
export function apply(ctx, config = {}) {
  const boards = new Map()
  const drop = key => { boards.get(key)?.close(); boards.delete(key) }
  ctx.effect(() => {
    const timer = setInterval(() => {
      for (const [key, board] of boards) if (Date.now() - board.lastUse > 90000) drop(key)
    }, 30000)
    return () => { clearInterval(timer); for (const key of boards.keys()) drop(key) }
  })
  ctx.connection.fetch.register({
    path: '/api/codex-wall-file', methods: ['GET'], requestBody: 'buffered',
    async fetch(request) {
      const params = new URL(request.url).searchParams
      const card = boards.get(params.get('board'))?.cards.get(params.get('threadId'))
      if (!card || card.loading) return new Response('会话未连接',{status:404})
      if (params.has('message')) {
        const image = card.messages.get(params.get('message'))?.images?.[Number(params.get('index'))]
        return attachmentImage(card.cwd,image)
      }
      return workspaceFile(card.cwd,params.get('path') || '')
    },
  })
  // DSH authenticates the request and allows only owner peers on exact fetch routes.
  ctx.connection.fetch.register({
    path: '/api/codex-wall', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const p = await request.json()
        const op = p?.op
        if (!methods.has(op) || !uuid.test(p?.board)) throw new Error('请求无效')
        if (op === 'close') { drop(p.board); return Response.json({ value: true }) }
        let board = boards.get(p.board)
        if (board?.socket.readyState === WebSocket.CLOSED) { drop(p.board); board = null }
        if (!board) {
          if (op !== 'list' || p.connect !== true) throw new Error('Codex 连接已断开，请重新连接')
          const endpoint = await localEndpoint(config)
          board = boards.get(p.board) || new Board(endpoint)
          boards.set(p.board, board)
        }
        board.lastUse = Date.now()
        await board.ready
        return Response.json({ value: await board.run(op, p) })
      } catch (error) {
        return Response.json({ error: error.message }, { status: 400 })
      }
    },
  })
}
