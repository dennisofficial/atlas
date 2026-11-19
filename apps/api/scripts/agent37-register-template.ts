const IMAGE = 'ghcr.io/dennisofficial/atlas-sandbox'
const REGISTRY = 'https://ghcr.io'
const TEMPLATE_NAME = 'atlas-sandbox'
const TEMPLATES = 'https://api.agent37.com/v1/templates'
const DEFAULT_PORT = 3000

type Template = { name?: string; revision?: number | null }

const registryDigestOf = async (tag: string): Promise<string> => {
  const tokenUrl = new URL(`${REGISTRY}/token`)
  tokenUrl.searchParams.set('scope', 'repository:dennisofficial/atlas-sandbox:pull')
  tokenUrl.searchParams.set('service', 'ghcr.io')
  const tokenAnswer = (await (await fetch(tokenUrl)).json()) as { token: string }
  const indexAnswer = await fetch(`${REGISTRY}/v2/dennisofficial/atlas-sandbox/manifests/${tag}`, {
    headers: {
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      Authorization: `Bearer ${tokenAnswer.token}`,
    },
  })
  if (!indexAnswer.ok) throw new Error(`ghcr answered ${indexAnswer.status} for ${tag}`)
  const digest = indexAnswer.headers.get('docker-content-digest')
  if (digest === null) throw new Error(`ghcr answered no digest for ${tag}`)
  const manifest = (await indexAnswer.json()) as {
    manifests?: Array<{ digest: string; platform?: { architecture?: string; os?: string } }>
  }
  const amd64 = manifest.manifests?.find(
    (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
  )
  return amd64?.digest ?? digest
}

const callTemplate = async (args: {
  apiKey: string
  path: string
  method: 'GET' | 'POST' | 'PATCH'
  body?: Record<string, unknown>
}): Promise<{ status: number; body: unknown }> => {
  const answer = await fetch(`${TEMPLATES}${args.path}`, {
    method: args.method,
    headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
  })
  return { status: answer.status, body: await answer.json() }
}

const refusal = (args: { step: string; status: number; body: unknown }): Error =>
  new Error(
    `agent37 refused to ${args.step} template ${TEMPLATE_NAME}: ${args.status} ${JSON.stringify(
      args.body,
    )}`,
  )

const upsertTemplate = async (args: { apiKey: string; imageRef: string }): Promise<Template> => {
  const existing = await callTemplate({
    apiKey: args.apiKey,
    path: `/${TEMPLATE_NAME}`,
    method: 'GET',
  })
  if (existing.status !== 200 && existing.status !== 404) {
    throw refusal({ step: 'read', status: existing.status, body: existing.body })
  }
  const creates = existing.status === 404
  const answer = creates
    ? await callTemplate({
        apiKey: args.apiKey,
        path: '',
        method: 'POST',
        body: { name: TEMPLATE_NAME, image_ref: args.imageRef, default_port: DEFAULT_PORT },
      })
    : await callTemplate({
        apiKey: args.apiKey,
        path: `/${TEMPLATE_NAME}`,
        method: 'PATCH',
        body: { image_ref: args.imageRef },
      })
  if (answer.status !== 200 && answer.status !== 201) {
    throw refusal({
      step: creates ? 'create' : 'update',
      status: answer.status,
      body: answer.body,
    })
  }
  return answer.body as Template
}

const main = async (): Promise<number> => {
  const apiKey = process.env.AGENT37_API_KEY
  if (apiKey === undefined || apiKey.trim() === '') {
    process.stderr.write('AGENT37_API_KEY is not set\n')
    return 1
  }
  try {
    const digest = await registryDigestOf('latest')
    const template = await upsertTemplate({ apiKey, imageRef: `${IMAGE}@${digest}` })
    process.stdout.write(`${template.name ?? TEMPLATE_NAME}@${String(template.revision)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

process.exit(await main())
