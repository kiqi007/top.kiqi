import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { Board } from './host.js'

test('two subscribed threads isolate streamed text, steering and one-time approvals', async t => {
  const dir = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(),'dsh-wall-'))
  const server = createServer()
  const ws = new WebSocketServer({server})
  const path = dir + '/app.sock'
  if (process.platform === 'win32') server.listen(0,'127.0.0.1')
  else server.listen(path)
  await once(server,'listening')
  const seen = []
  const threads = ['a','b','c','d','e','f','g','h','i'].map((id,i) => ({ id, name:id, cwd:'/work', originator:i === 1 ? 'codex_work_desktop' : 'Codex Desktop',
    status:{ type:i ? 'active' : 'idle' }, updatedAt:1 }))
  let socket
  ws.on('connection', conn => {
    socket = conn
    conn.on('message', raw => {
      const m = JSON.parse(raw)
      seen.push(m)
      if (!m.method || m.id == null) return
      let result = {}
      if (m.method === 'thread/list') result = {data:[...threads, threads[0]]}
      if (m.method === 'model/list') result = {data:[{id:'gpt-test',model:'gpt-test',displayName:'GPT Test',defaultReasoningEffort:'low'}]}
      if (m.method === 'thread/resume') result = {thread:threads.find(c=>c.id===m.params.threadId),
        initialTurnsPage:{data:m.params.threadId === 'b' ? [{id:'working',status:'inProgress'}] : [
          {id:'finished',status:'completed',durationMs:42000,items:[
            {id:'u',type:'userMessage',content:[{type:'text',text:'历史问题'}]},
            {id:'reply',type:'agentMessage',phase:'final_answer',text:'历史答复'}]}
        ]}}
      if (m.method === 'thread/items/list') result = {data:m.params.turnId === 'finished'
        ? [{turnId:'finished',item:{id:'cmd',type:'commandExecution',command:'go test',status:'completed'}}] : []}
      conn.send(JSON.stringify({id:m.id,result}))
    })
  })
  const board = new Board(process.platform === 'win32' ? {port:server.address().port,token:'test'} : path)
  t.after(async () => { board.close(); await new Promise(r=>ws.close(r)); await new Promise(r=>server.close(r)); await rm(dir,{recursive:true,force:true}) })
  await board.ready
  assert.deepEqual((await board.list()).map(row => row.id), threads.map(row => row.id))
  await board.run('watch',{ids:['a','b']})
  const push = async m => { const received=once(board.socket,'message'); socket.send(JSON.stringify(m)); await received }
  const send = (threadId,turn) => board.run('send',{threadId,turn,text:'检查测试结果'})
  await send('a',null); await send('b','working')
  assert.deepEqual(seen.filter(m=>m.method?.startsWith('turn/')).map(m=>[m.method,m.params.threadId,m.params.expectedTurnId]),
    [['turn/start','a',undefined],['turn/steer','b','working']])
  const image = 'data:image/png;base64,iVBORw0KGgo='
  await board.run('send',{threadId:'a',turn:null,text:'',images:[image]})
  await board.run('send',{threadId:'b',turn:'working',text:'看图',images:[image]})
  assert.deepEqual(seen.findLast(m=>m.method==='turn/start').params.input,[{type:'image',url:image}])
  assert.deepEqual(seen.findLast(m=>m.method==='turn/steer').params.input.map(i=>i.type),['text','image'])
  await assert.rejects(board.run('send',{threadId:'a',turn:null,text:'',images:[]}))
  await assert.rejects(board.run('send',{threadId:'a',turn:null,text:'',images:['file:///tmp/no']}))
  await push({method:'thread/settings/updated',params:{threadId:'b',threadSettings:{model:'gpt-test',effort:'xhigh',serviceTier:'priority'}}})
  const updated = board.snapshot(-1).cards[1]
  assert.deepEqual([updated.model,updated.modelLabel,updated.effort,updated.tier],['gpt-test','GPT Test','xhigh','priority'])
  await assert.rejects(send('b','previous'))
  await push({method:'item/agentMessage/delta',params:{threadId:'b',itemId:'message',delta:'正在检查'}})
  await push({id:32,method:'item/commandExecution/requestApproval',params:{threadId:'b',turnId:'working',itemId:'cmd',command:'go test ./...',availableDecisions:['accept','decline']}})
  const [a,b] = board.snapshot(-1).cards
  assert.deepEqual(a.messages.map(m=>[m.turnId,m.role]),[['finished','user'],['finished','agent']])
  assert.equal(a.messages[1].phase,'final_answer')
  assert.equal(a.turns[0].durationMs,42000)
  assert.equal(seen.some(m=>m.method==='thread/items/list' && m.params.turnId==='finished'),false)
  assert.equal((await board.run('details',{threadId:'a',turnId:'finished'}))[0].label,'执行命令')
  await assert.rejects(board.run('details',{threadId:'b',turnId:'finished'}))
  assert.equal(a.approvals.length,0)
  assert.equal(b.messages[0].text,'正在检查'); assert.equal(b.approvals[0].command,'go test ./...')
  const token = b.approvals[0].token
  const decide = (threadId,decision) => board.run('decide',{threadId,token,decision})
  await assert.rejects(decide('a','accept'))
  await assert.rejects(decide('b','acceptForSession'))
  const response = once(socket,'message')
  await decide('b','decline')
  assert.deepEqual(JSON.parse((await response)[0]),{id:32,result:{decision:'decline'}})
  await assert.rejects(decide('b','accept'))
  await push({id:'f-1',method:'item/fileChange/requestApproval',params:{threadId:'a',turnId:'other',itemId:'file',grantRoot:'/tmp/example'}})
  const file = board.snapshot(-1).cards[0].approvals[0]
  await push({method:'serverRequest/resolved',params:{threadId:'a',requestId:'f-1'}})
  await assert.rejects(board.run('decide',{threadId:'a',token:file.token,decision:'accept'}))
  await push({id:33,method:'item/commandExecution/requestApproval',params:{threadId:'b',turnId:'working',itemId:'cmd'}})
  const second = board.snapshot(-1).cards[1].approvals[0]
  const accepted = once(socket,'message')
  await board.run('decide',{threadId:'b',token:second.token,decision:'accept'})
  assert.deepEqual(JSON.parse((await accepted)[0]),{id:33,result:{decision:'accept'}})
  await push({method:'item/completed',params:{threadId:'b',turnId:'working',item:{
    type:'agentMessage',id:'message',phase:'commentary',text:'正在检查'}}})
  await push({method:'turn/completed',params:{threadId:'b',turn:{
    id:'working',status:'completed',durationMs:1200,items:[
      {type:'agentMessage',id:'answer',phase:'final_answer',text:'已完成'}]}}})
  const done = board.snapshot(-1).cards[1]
  assert.equal(done.turn,null)
  assert.equal(done.turns[0].status,'completed')
  assert.deepEqual(done.messages.map(m=>m.phase),['commentary','final_answer'])

  const ids = threads.slice(0,5).map(t=>t.id)
  const resumes = () => seen.filter(m=>m.method==='thread/resume').length
  const four = await board.run('watch',{ids,visibleIds:ids.slice(0,4)})
  assert.equal(four.bound.length,5)
  assert.equal(four.cards.length,4)
  await push({method:'thread/status/changed',params:{threadId:'e',status:{type:'active',activeFlags:[]}}})
  const background = board.snapshot(-1)
  assert.equal(background.bound.find(c=>c.id==='e').status.type,'active')
  assert.equal(background.cards.some(c=>c.id==='e'),false)
  const switched = await board.run('watch',{ids,visibleIds:['e']})
  assert.deepEqual(switched.cards.map(c=>c.id),['e'])
  const hidden = await board.run('watch',{ids,visibleIds:[]})
  assert.equal(hidden.bound.length,5); assert.equal(hidden.cards.length,0)
  assert.equal(resumes(),5)
  await assert.rejects(board.run('watch',{ids,visibleIds:ids}))
  await assert.rejects(board.run('watch',{ids:['a'],visibleIds:['e']}))
  const catalogIds = threads.map(t=>t.id)
  const eight = await board.run('watch',{ids:catalogIds.slice(0,8),visibleIds:ids.slice(0,4)})
  assert.equal(eight.bound.length,8)
  await assert.rejects(board.run('watch',{ids:catalogIds,visibleIds:[]}),/最多绑定 8/)
  assert.deepEqual(board.snapshot(-1).cards.map(c=>c.id),ids.slice(0,4))

})

test('editing verifies history and preserves attachments across a failed regeneration', async () => {
  const board = Object.create(Board.prototype)
  const card = {id:'edit-test',status:{type:'idle'},turn:null}
  const info = {path:'/test/design.png',type:'localImage'}
  const prefix = '# Files mentioned by the user:\nimage.png\n\n## My request:\n'
  const turns = [{id:'later',items:[]},{id:'target',items:[{type:'userMessage',id:'message',content:[
    {type:'text',text:prefix+'old',text_elements:[]},info,{type:'text',text:'extra context',text_elements:[]}
  ]}]},{id:'earlier',items:[]}]
  const params = {text:'new',editId:'12345678-abcd-abcd-abcd-123456789012',expectedTail:'later',turnId:'target',messageId:'message'}
  let reverts = 0, attempts = 0
  board.call = async (method,p) => {
    if (method === 'thread/turns/list') return {data:turns}
    if (method === 'thread/revert') { assert.equal(p.beforeTurnId,'target'); reverts++; turns.splice(0,2); return {} }
    assert.equal(method,'turn/start');assert.equal(p.turnTrigger,'edit_user_message')
    assert.deepEqual(p.input.map(x=>x.text || x.path),[prefix+'new',info.path,'extra context'])
    if (!attempts++) throw Error('fixture unavailable')
    return {}
  }
  await assert.rejects(board.edit(card,{...params,expectedTail:'stale'}),/记录已变化/)
  await assert.rejects(board.edit({...card,turn:'live'},params),/运行结束/)
  assert.equal(reverts,0)
  await assert.rejects(board.edit(card,params),/编辑稿已保留/)
  await board.edit(card,params)
  assert.equal(attempts,2); assert.equal(reverts,1)
  assert.equal(card.pendingEdit,null)
})

test('workspace file responses distinguish readable source, media and opaque files', async t => {
  const {writeFile} = await import('node:fs/promises')
  const {workspaceFile} = await import('./workspace-file.js')
  const dir = await mkdtemp(join(tmpdir(),'dsh-file-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  for (const [name,data,type] of [
    ['query.sql','SELECT 1;','text/plain'],['Dockerfile','FROM scratch','text/plain'],
    ['notes.custom','开发记录','text/plain'],['sample.pdf','%PDF-1.7','application/pdf'],
    ['bundle.zip',Buffer.from([80,75,3,4,0,0]),'application/octet-stream'],
  ]) {
    await writeFile(dir+'/'+name,data)
    const res = await workspaceFile(dir,name)
    assert.equal(res.status,200); assert.equal(res.headers.get('content-type').split(';')[0],type)
  }
  assert.equal((await workspaceFile(dir,'missing.sql')).status,404)
  assert.equal((await workspaceFile(dir,'..')).status,403)
})

test('Windows drive, URI and UNC links stay within the thread workspace', async () => {
  const {windowsPreviewPath} = await import('./workspace-file.js')
  const {workspaceHref} = await import('./src/markdown.js')
  const root = 'D:\\项目 1'
  for (const link of ['file:///D:/%E9%A1%B9%E7%9B%AE%201/doc.md','D:%5C项目%201%5Cdoc.md','./doc.md','docs\\..\\doc.md']) {
    assert.equal(windowsPreviewPath(root,decodeURIComponent(workspaceHref(link))),root+'\\doc.md')
  }
  assert.equal(windowsPreviewPath('\\\\nas\\share\\repo',workspaceHref('file://nas/share/repo/a.md')),'\\\\nas\\share\\repo\\a.md')
  assert.equal(windowsPreviewPath('\\\\?\\'+root,root+'\\doc.md'),root+'\\doc.md')
  for(const path of ['C:/elsewhere','../private','D:relative','\\\\other\\share\\x','a.md:stream','NUL.txt','\\\\?\\D:\\项目 1\\x']) {
    assert.equal(windowsPreviewPath(root,path),null)
  }
})

test('older Desktop sessions remain selectable after a catalog refresh', async () => {
  const board = Object.create(Board.prototype)
  const recent = {id:'00000000-0000-4000-8000-000000000001',originator:'Codex Desktop',name:'recent',recencyAt:null,updatedAt:3}
  const older = {...recent,id:'00000000-0000-4000-8000-000000000002',originator:'codex_work_desktop',name:'older',recencyAt:1,updatedAt:9}
  const cli = {...recent,id:'00000000-0000-4000-8000-000000000003',originator:'cli'}
  board.cards = new Map()
  board.call = async (method,params) => {
    assert.equal(method,'thread/list')
    assert.equal(params.currentAccountOnly,true)
    assert.equal(params.sortKey,'recency_at')
    assert.equal(params.sortDirection,'desc')
    if (params.includedThreadIds) return {data:[older,cli].filter(t=>params.includedThreadIds.includes(t.id))}
    return params.cursor ? {data:[cli,older]} : {data:[recent],nextCursor:'older'}
  }
  board.attach = async id => board.cards.set(id,{id})
  board.snapshot = () => board.visibleIds
  const first = await board.run('list',{paged:true})
  assert.equal(first.rows[0].recencyAt,3)
  const next = await board.run('list',{paged:true,cursor:first.nextCursor})
  assert.equal(next.rows[0].recencyAt,1)
  assert.deepEqual(next.rows.map(t=>t.id),[older.id])
  assert.equal(next.nextCursor,null)
  await board.list()
  assert.deepEqual(await board.run('watch',{ids:[older.id]}),[older.id])
  await assert.rejects(board.run('watch',{ids:[cli.id]}),/不可用/)
  assert.equal(board.cards.has(older.id),true)
})
