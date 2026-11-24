const SCRIPT_NAME = 'install-byatlas-io'
const WORKER_PATH = new URL('./worker.js', import.meta.url)

const METADATA = {
  main_module: 'worker.js',
  compatibility_date: '2026-09-22',
  bindings: [{ type: 'r2_bucket', name: 'RELEASES', bucket_name: 'atlas-releases' }],
}

async function main(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (token === undefined || token === '') {
    throw new Error('CLOUDFLARE_API_TOKEN is not set')
  }
  if (accountId === undefined || accountId === '') {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is not set')
  }

  const form = new FormData()
  form.append(
    'metadata',
    new Blob([JSON.stringify(METADATA)], { type: 'application/json' }),
    'metadata',
  )
  form.append(
    'worker.js',
    new Blob([await Bun.file(WORKER_PATH).text()], { type: 'application/javascript+module' }),
    'worker.js',
  )

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const reply = (await response.json()) as {
    success: boolean
    errors: Array<{ code: number; message: string }>
  }
  if (!reply.success) throw new Error(`${url} answered ${JSON.stringify(reply.errors)}`)

  const served = await fetch('https://install.byatlas.io/releases/tags')
  if (!served.ok)
    throw new Error(`https://install.byatlas.io/releases/tags answered ${served.status}`)
  console.log(`deployed ${SCRIPT_NAME}: ${await served.text()}`)
}

if (import.meta.main) await main()
