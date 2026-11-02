// Tiny Bun WebSocket tool-server for the sandbox under test.
// Protocol: JSON {id, op, ...} -> JSON {id, ok, out?, err?}
const root = '/tmp/gtree'
const port = Number(process.env.PORT ?? 3000)

async function handle(msg) {
  if (msg.op === 'exec') {
    const proc = Bun.spawn(msg.cmd, { stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return { out: out.trim() }
  }
  if (msg.op === 'read') {
    return { out: await Bun.file(`${root}/${msg.path}`).text() }
  }
  if (msg.op === 'write') {
    await Bun.write(`${root}/${msg.path}`, msg.data)
    return { out: 'ok' }
  }
  if (msg.op === 'grep') {
    const proc = Bun.spawn(['rg', '--files-with-matches', msg.pattern, root], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return { out: out.trim() }
  }
  if (msg.op === 'ping') {
    return { out: 'pong' }
  }
  throw new Error(`unknown op ${msg.op}`)
}

Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch(req, server) {
    if (server.upgrade(req)) return
    return new Response('ws only', { status: 426 })
  },
  websocket: {
    async message(ws, raw) {
      const msg = JSON.parse(String(raw))
      try {
        const { out } = await handle(msg)
        ws.send(JSON.stringify({ id: msg.id, ok: true, out }))
      } catch (err) {
        ws.send(JSON.stringify({ id: msg.id, ok: false, err: String(err) }))
      }
    },
  },
})
console.log(`ws server on ${port}`)
