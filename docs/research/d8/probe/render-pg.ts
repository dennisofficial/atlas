import postgres from 'postgres'

const DB_URL = process.env.ATLAS_DB_URL
if (!DB_URL) throw new Error('ATLAS_DB_URL unset')

const N_CONNECT = 3
const N_QUERY = 200

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN
}
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: +pct(xs, 50).toFixed(2),
  p90: +pct(xs, 90).toFixed(2),
  p99: +pct(xs, 99).toFixed(2),
  min: +Math.min(...xs).toFixed(2),
  max: +Math.max(...xs).toFixed(2),
  mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2),
})

function log(s: string) {
  console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${s}`)
}
const t0 = performance.now()

const host = new URL(DB_URL).host
const report: Record<string, unknown> = { dbHost: host, tls: 'verify-full (system roots)' }
log(`target db host: ${host} (ssl verify-full)`)

async function assertTlsActive(sql: ReturnType<typeof postgres>) {
  const badCa = '-----BEGIN CERTIFICATE-----\nMIIBogIBAAKBgQC7\n-----END CERTIFICATE-----'
  let rejected = false
  try {
    const probe = postgres(DB_URL, {
      ssl: { rejectUnauthorized: true, ca: badCa },
      max: 1,
      connect_timeout: 5,
    })
    await probe`SELECT 1`
    await probe.end()
  } catch {
    rejected = true
  }
  report.tlsVerifiedOnWire = rejected
  log(`tls on wire (bogus-CA rejected): ${rejected}`)
  if (!rejected) log('WARNING: bogus CA accepted — TLS may not be active')
  await sql`SELECT 1`
}

const connectMs: number[] = []
for (let i = 0; i < N_CONNECT; i++) {
  const t = performance.now()
  const sql = postgres(DB_URL, { ssl: 'verify-full', max: 1 })
  await sql`SELECT 1`
  connectMs.push(+(performance.now() - t).toFixed(2))
  log(`pg connect ${i + 1}/${N_CONNECT}: ${connectMs[i]}ms`)
  await sql.end()
}
report.pgConnectSamplesMs = connectMs

const sql = postgres(DB_URL, { ssl: 'verify-full', max: 1 })
await assertTlsActive(sql)
const queryMs: number[] = []
log(`running ${N_QUERY} sequential read-only SELECT 1…`)
for (let i = 0; i < N_QUERY; i++) {
  const t = performance.now()
  await sql.begin('read only', async (tx) => {
    await tx`SELECT 1`
  })
  queryMs.push(performance.now() - t)
}
await sql.end()

report.pgReadOnlySelect1 = stats(queryMs)
console.log(`RESULTS_JSON ${JSON.stringify(report)}`)
log('done')
