import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import WebSocket from 'ws'

export function connectEndpoint(endpoint) {
  const options = {handshakeTimeout:5000}
  if (typeof endpoint === 'string') return new WebSocket('ws://localhost/',{...options,createConnection:() => connect({path:endpoint})})
  if (endpoint.socketPath) {
    options.createConnection = () => {
      const child = spawn(endpoint.helper,['--dsh-socket-relay',endpoint.socketPath],{stdio:['pipe','pipe','ignore'],windowsHide:true})
      const stream = Duplex.from({readable:child.stdout,writable:child.stdin})
      child.on('error',error => stream.destroy(error))
      stream.once('close',() => child.kill())
      return stream
    }
    return new WebSocket('ws://localhost/',options)
  }
  return new WebSocket('ws://127.0.0.1:'+endpoint.port+'/',{...options,headers:{Authorization:'Bearer '+endpoint.token}})
}

export async function localEndpoint(config) {
  const path = process.env.CODEX_PROXY_SOCKET_PATH || config.socketPath
  if (path) {
    if (!isAbsolute(path)) throw Error('CODEX_PROXY_SOCKET_PATH 需要填写完整的 socket 文件路径')
    if (process.platform !== 'win32') return path
    const helper = process.env.CODEX_CLI_PATH
    if (!helper || !isAbsolute(helper)) throw Error('CODEX_CLI_PATH 需要填写 codex-proxy.exe 的完整路径')
    return {socketPath:path,helper}
  }
  const dir = process.env.CODEX_PROXY_SOCKET_DIR
  if (process.platform !== 'win32' && process.env.CODEX_PROXY_TRANSPORT !== 'websocket') {
    return join(dir || join(homedir(),'data/codex/socket'),'app.sock')
  }
  const cache = process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(),'AppData','Local')
    : process.platform === 'darwin' ? join(homedir(),'Library','Caches') : process.env.XDG_CACHE_HOME || join(homedir(),'.cache')
  const folder = dir || join(cache,'dsh-codex','connections')
  let names
  try { names = await readdir(folder) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const live = []
  for (const name of names || []) {
    const match = /^desktop-(\d+)\.json$/.exec(name)
    if (!match) continue
    const file = join(folder,name)
    try {
      process.kill(Number(match[1]),0)
      const {port,token} = JSON.parse(await readFile(file,'utf8'))
      if (Number.isInteger(port) && port > 0 && port <= 65535 && /^[a-f0-9]{64}$/.test(token)) {
        live.push({port,token,mtime:(await stat(file)).mtimeMs})
      }
    } catch (error) {
      if (!['ESRCH','ENOENT'].includes(error.code)) throw error
    }
  }
  if (!live.length) throw new Error('没有发现本机 Codex 连接。请确认已配置 codex-proxy，并以当前用户重新打开 Codex Desktop。')
  return live.sort((a,b) => b.mtime-a.mtime)[0]
}
