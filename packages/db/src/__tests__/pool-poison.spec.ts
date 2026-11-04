import { afterAll, describe, expect, it } from 'bun:test'
import net from 'node:net'
import { createDb, type Db } from '../client'
import { createPool, type Pool } from '../pool'

type SeveringProxy = {
  port: number
  severAll(): void
  stop(): Promise<void>
}

function startSeveringProxy(target: { host: string; port: number }): Promise<SeveringProxy> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((client) => {
    const upstream = net.connect({ host: target.host, port: target.port })
    sockets.add(client)
    sockets.add(upstream)
    client.on('close', () => sockets.delete(client))
    upstream.on('close', () => sockets.delete(upstream))
    client.on('error', () => {})
    upstream.on('error', () => {})
    client.pipe(upstream)
    upstream.pipe(client)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('proxy listen gave no port'))
        return
      }
      resolve({
        port: address.port,
        severAll() {
          for (const socket of [...sockets]) socket.destroy()
        },
        stop: () => {
          for (const socket of [...sockets]) socket.destroy()
          return new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
  })
}

function lane(): URL {
  return new URL(
    process.env.ATLAS_TEST_DATABASE_URL ?? 'postgresql://atlas:atlas@localhost:55441/atlas_test',
  )
}

async function selectOne(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(tx.raw.sql`SELECT 1 AS "ok"`.returnsRow({ ok: 'pg/int4@1' }).build())
  })
}

describe('pool recovery after a dropped link', () => {
  let pool: Pool | undefined
  let proxy: SeveringProxy | undefined

  afterAll(async () => {
    await pool?.end()
    await proxy?.stop()
  })

  it('fails at most one transaction after every pooled connection is severed', async () => {
    const target = lane()
    proxy = await startSeveringProxy({
      host: target.hostname,
      port: Number(target.port),
    })
    const proxied = new URL(target)
    proxied.hostname = '127.0.0.1'
    proxied.port = String(proxy.port)
    proxied.pathname = '/postgres'
    pool = createPool(proxied.toString())
    const db = createDb(pool)
    const poolMax = pool.options.max

    await Promise.all(Array.from({ length: poolMax }, () => pool!.query('SELECT pg_sleep(0.2)')))
    expect(pool.idleCount).toBe(poolMax)

    proxy.severAll()

    let failures = 0
    for (let attempt = 0; attempt < poolMax + 2; attempt += 1) {
      try {
        await selectOne(db)
      } catch {
        failures += 1
      }
    }
    expect(failures).toBeLessThanOrEqual(1)
  })
})
