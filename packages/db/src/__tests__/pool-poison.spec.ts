import { afterAll, describe, expect, it } from 'bun:test'
import net from 'node:net'
import { createDb, type Db } from '../client'
import { retryOnConnectionLoss } from '../connection-retry'
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

type BlackHoleProxy = {
  port: number
  hold(): void
  release(): void
  stop(): Promise<void>
}

function startBlackHoleProxy(target: { host: string; port: number }): Promise<BlackHoleProxy> {
  let held = false
  const sockets = new Set<net.Socket>()
  const server = net.createServer((client) => {
    const upstream = net.connect({ host: target.host, port: target.port })
    sockets.add(client)
    sockets.add(upstream)
    client.on('close', () => sockets.delete(client))
    upstream.on('close', () => sockets.delete(upstream))
    client.on('error', () => {})
    upstream.on('error', () => {})
    client.on('data', (chunk) => {
      if (!held) upstream.write(chunk)
    })
    upstream.on('data', (chunk) => {
      if (!held) client.write(chunk)
    })
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
        hold() {
          held = true
        },
        release() {
          held = false
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

function proxiedLane(proxy: { port: number }): URL {
  const target = lane()
  const proxied = new URL(target)
  proxied.hostname = '127.0.0.1'
  proxied.port = String(proxy.port)
  proxied.pathname = '/postgres'
  return proxied
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Settled = { state: 'resolved' } | { state: 'rejected'; error: Error } | { state: 'pending' }

async function settleWithin(pending: Promise<unknown>, ms: number): Promise<Settled> {
  return Promise.race([
    pending.then(
      (): Settled => ({ state: 'resolved' }),
      (error: Error): Settled => ({ state: 'rejected', error }),
    ),
    sleep(ms).then((): Settled => ({ state: 'pending' })),
  ])
}

async function selectOne(db: Db): Promise<void> {
  await retryOnConnectionLoss(() =>
    db.transaction(async (tx) => {
      await tx.query(tx.raw.sql`SELECT 1 AS "ok"`.returnsRow({ ok: 'pg/int4@1' }).build())
    }),
  )
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

  it('rejects a black-holed query within queryTimeoutMs and recovers once the link returns', async () => {
    const target = lane()
    const blackHole = await startBlackHoleProxy({
      host: target.hostname,
      port: Number(target.port),
    })
    const proxied = proxiedLane(blackHole)
    const ownPool = createPool(proxied.toString(), { queryTimeoutMs: 500 })
    const client = await ownPool.connect()
    try {
      await client.query('SELECT 1')
      blackHole.hold()
      const started = Date.now()
      const settled = await settleWithin(client.query('SELECT 1'), 3_000)
      expect(settled.state).toBe('rejected')
      if (settled.state === 'rejected') {
        expect(Date.now() - started).toBeLessThan(2_000)
      }
      client.release()
      expect(ownPool.totalCount).toBe(0)
      blackHole.release()
      await ownPool.query('SELECT 1')
    } finally {
      await ownPool.end().catch(() => undefined)
      await blackHole.stop()
    }
  })

  it('without queryTimeoutMs a black-holed query never rejects on its own', async () => {
    const target = lane()
    const blackHole = await startBlackHoleProxy({
      host: target.hostname,
      port: Number(target.port),
    })
    const proxied = proxiedLane(blackHole)
    const ownPool = createPool(proxied.toString())
    const client = await ownPool.connect()
    try {
      await client.query('SELECT 1')
      blackHole.hold()
      const settled = await settleWithin(client.query('SELECT 1'), 2_000)
      expect(settled.state).toBe('pending')
      client.connection.stream.destroy()
      client.release(new Error('black-holed'))
    } finally {
      await ownPool.end().catch(() => undefined)
      await blackHole.stop()
    }
  })

  it('never replays a plain transaction callback after its connection dies mid-callback', async () => {
    const target = lane()
    const local = await startSeveringProxy({ host: target.hostname, port: Number(target.port) })
    const proxied = new URL(target)
    proxied.hostname = '127.0.0.1'
    proxied.port = String(local.port)
    proxied.pathname = '/postgres'
    const ownPool = createPool(proxied.toString())
    const db = createDb(ownPool)
    let entered = 0
    try {
      await expect(
        db.transaction(async (tx) => {
          entered += 1
          await tx.query(tx.raw.sql`SELECT 1 AS "ok"`.returnsRow({ ok: 'pg/int4@1' }).build())
          local.severAll()
          await tx.query(tx.raw.sql`SELECT 2 AS "ok"`.returnsRow({ ok: 'pg/int4@1' }).build())
        }),
      ).rejects.toThrow()
      expect(entered).toBe(1)
    } finally {
      await ownPool.end().catch(() => undefined)
      await local.stop()
    }
  })
})
