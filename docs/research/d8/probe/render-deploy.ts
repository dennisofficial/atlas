import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OWNER_ID = 'tea-cvi2tf7noe9s73aqppe0'
const SERVICE_NAME = 'atlas-v2-rtt-probe'
const REGION = 'virginia'
const PLAN = 'starter'
const IMAGE = 'docker.io/oven/bun:1'
const RENDER_API = 'https://api.render.com/v1'
const DEPLOY_DIR = 'render-deploy'

const renderKey = process.env.RENDER_API_KEY
const vercelToken = process.env.VERCEL_TOKEN
const atlasDbUrl = process.env.ATLAS_DB_URL
if (!renderKey) throw new Error('RENDER_API_KEY unset')
if (!vercelToken) throw new Error('VERCEL_TOKEN unset')
if (!atlasDbUrl) throw new Error('ATLAS_DB_URL unset')

async function renderApi(path: string, init?: RequestInit) {
  const res = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${renderKey}`, 'content-type': 'application/json' },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: res.status, body, text: text.slice(0, 2000) }
}

function base64(file: string) {
  return readFileSync(file).toString('base64')
}

const runScript = `set -e
mkdir -p /tmp/probe
echo "$PROBE_RUN_B64" | base64 -d > /tmp/probe/render-run.ts
echo "$PROBE_WS_B64" | base64 -d > /tmp/probe/render-ws-server.ts
echo "$PROBE_PG_B64" | base64 -d > /tmp/probe/render-pg.ts
cd /tmp/probe
echo '{"name":"d8-render-rtt-probe","dependencies":{"@vercel/sandbox":"3.9.1","postgres":"^3.4.5"}}' > package.json
bun install --no-progress --silent
bun run render-run.ts || echo "WS_PROBE_EXIT code=$?"
bun run render-pg.ts || echo "PG_PROBE_EXIT code=$?"
echo "ALL_PROBES_DONE"
sleep infinity
`

const envVars = [
  { key: 'VERCEL_TOKEN', value: vercelToken },
  { key: 'PROBE_RUN_B64', value: base64('render-run.ts') },
  { key: 'PROBE_WS_B64', value: base64('render-ws-server.ts') },
  { key: 'PROBE_PG_B64', value: base64('render-pg.ts') },
  { key: 'ATLAS_DB_URL', value: atlasDbUrl },
  { key: 'HOME', value: '/tmp' },
]

mkdirSync(DEPLOY_DIR, { recursive: true })
writeFileSync(join(DEPLOY_DIR, 'run.sh'), runScript)

async function findService() {
  const res = await renderApi(`/services?name=${SERVICE_NAME}&limit=20`)
  const list = Array.isArray(res.body) ? res.body : []
  const hit = list.find((e) => (e as { service?: { name: string } }).service?.name === SERVICE_NAME)
  return (hit as { service: { id: string } } | undefined)?.service.id
}

let serviceId = await findService()
if (serviceId) {
  console.log(`updating existing service ${serviceId}…`)
  const ev = await renderApi(`/services/${serviceId}/env-vars`, {
    method: 'PUT',
    body: JSON.stringify(envVars),
  })
  if (ev.status >= 300) {
    console.error(`env-vars update FAILED ${ev.status}: ${ev.text}`)
    process.exit(1)
  }
} else {
  console.log(`creating ${SERVICE_NAME} (background_worker, ${PLAN}, ${REGION}, ${IMAGE})…`)
  const created = await renderApi('/services', {
    method: 'POST',
    body: JSON.stringify({
      type: 'background_worker',
      name: SERVICE_NAME,
      ownerId: OWNER_ID,
      autoDeploy: 'no',
      image: { ownerId: OWNER_ID, imagePath: IMAGE },
      envVars,
      serviceDetails: {
        runtime: 'image',
        region: REGION,
        plan: PLAN,
        envSpecificDetails: { dockerCommand: 'bash /etc/secrets/run.sh' },
        numInstances: 1,
      },
    }),
  })
  if (created.status >= 300) {
    console.error(`create FAILED ${created.status}: ${created.text}`)
    process.exit(1)
  }
  serviceId = (created.body as { service: { id: string } }).service.id
  console.log(`created ${serviceId}`)
}
writeFileSync(join(DEPLOY_DIR, 'service-id.txt'), serviceId)

const sf = await renderApi(`/services/${serviceId}/secret-files`, {
  method: 'PUT',
  body: JSON.stringify([{ name: 'run.sh', content: runScript }]),
})
if (sf.status >= 300) {
  console.error(`secret file FAILED ${sf.status}: ${sf.text}`)
  process.exit(1)
}
console.log(`secret file: ${sf.status}`)

const dep = await renderApi(`/services/${serviceId}/deploys`, {
  method: 'POST',
  body: '{}',
})
console.log(`deploy: ${dep.status} ${dep.text.slice(0, 300)}`)
console.log(`SERVICE_ID ${serviceId}`)
console.log(
  'cleanup when done: curl -X DELETE -H "Authorization: Bearer $RENDER_API_KEY"' +
    ` ${RENDER_API}/services/${serviceId}`,
)
