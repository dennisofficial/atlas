import {
  EXPOSURE_HOST_SUFFIX,
  EXPOSURE_REFUSED_LEAD,
  EXPOSURE_REFUSED_TAIL,
  exposureInfoPage,
} from '@dltech/atlas-core'

// The script runs on the sandbox image's plain Node with no workspace, so it is self-contained;
// the URL grammar constants come from core at template time, never redeclared by hand.
export function proxyScriptSource(args: { hostPort: number; containerPort: number }): string {
  return `import { createConnection, createServer } from 'node:net'

const suffix = ${JSON.stringify(EXPOSURE_HOST_SUFFIX)}
const target = process.env.ATLAS_PROXY_TARGET
const listenPort = ${args.containerPort}
const infoPage = ${JSON.stringify(exposureInfoPage({ hostPort: args.hostPort }))}
const refusedLead = ${JSON.stringify(EXPOSURE_REFUSED_LEAD)}
const refusedTail = ${JSON.stringify(EXPOSURE_REFUSED_TAIL)}

if (target === undefined || target === '') {
  console.error('ATLAS_PROXY_TARGET is required')
  process.exit(1)
}

const textReply = (socket, status, body) => {
  socket.end(
    'HTTP/1.1 ' + status + '\\r\\n' +
    'content-type: text/plain; charset=utf-8\\r\\n' +
    'connection: close\\r\\n' +
    'content-length: ' + Buffer.byteLength(body) + '\\r\\n' +
    '\\r\\n' + body,
  )
}

const portFromHost = (host) => {
  const hostname = host.split(':')[0] ?? ''
  if (!hostname.endsWith(suffix)) return undefined
  const prefix = hostname.slice(0, hostname.length - suffix.length)
  if (!/^\\d{1,5}$/.test(prefix)) return undefined
  const port = Number(prefix)
  return port >= 1 && port <= 65535 ? port : undefined
}

createServer((client) => {
  let head = Buffer.alloc(0)

  const onData = (chunk) => {
    head = Buffer.concat([head, chunk])
    if (head.length > 65536) {
      client.removeListener('data', onData)
      textReply(client, '431 Request Header Fields Too Large', 'headers too large\\n')
      return
    }
    const headerEnd = head.indexOf('\\r\\n\\r\\n')
    if (headerEnd === -1) return

    client.pause()
    client.removeListener('data', onData)
    client.setTimeout(0)

    const hostMatch = /^host:[ \\t]*(\\S+)[ \\t]*$/im.exec(head.toString('latin1', 0, headerEnd))
    const port = portFromHost(hostMatch?.[1] ?? '')
    if (port === undefined) {
      textReply(client, '200 OK', infoPage)
      return
    }

    const upstream = createConnection({ host: target, port })
    let connected = false
    upstream.on('connect', () => {
      connected = true
      upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
      client.resume()
    })
    upstream.on('error', () => {
      if (!connected) textReply(client, '502 Bad Gateway', refusedLead + port + refusedTail)
      else client.destroy()
    })
    upstream.on('close', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
  }

  client.setTimeout(15000, () => client.destroy())
  client.on('data', onData)
  client.on('error', () => {})
}).listen(listenPort, '0.0.0.0', () => {
  console.log('atlas expose proxy: *' + suffix + ' -> ' + target)
})
`
}
