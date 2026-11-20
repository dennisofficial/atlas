const IMAGE = 'ghcr.io/dennisofficial/atlas-sandbox'
const REGISTRY = 'https://ghcr.io'
const TEMPLATE_NAME = 'atlas-sandbox'
const TEMPLATES = 'https://api.agent37.com/v1/templates'
const DEFAULT_PORT = 3000

type Template = { name?: string; revision?: number | null; image_ref?: string }

const DEFAULT_TAG = 'latest'

const valueAfter = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`)
  return value
}

/** The tag (or full `sha256:` digest) to pin: `--tag`, else `AGENT37_IMAGE_TAG`, else `latest`. */
export const sourceOf = (
  argv: readonly string[],
  env: Record<string, string | undefined>,
): string => valueAfter(argv, '--tag') ?? env.AGENT37_IMAGE_TAG?.trim() ?? DEFAULT_TAG

export const expectedRefOf = async (source: string): Promise<string> =>
  source.startsWith('sha256:') ? `${IMAGE}@${source}` : `${IMAGE}@${await registryDigestOf(source)}`

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

/** Reads the template back: the write is only done if the stored image is the one we meant. */
export const verifyTemplate = async (args: {
  apiKey: string
  expectedRef: string
}): Promise<Template> => {
  const existing = await callTemplate({
    apiKey: args.apiKey,
    path: `/${TEMPLATE_NAME}`,
    method: 'GET',
  })
  if (existing.status !== 200) {
    throw refusal({ step: 'read back', status: existing.status, body: existing.body })
  }
  const template = existing.body as Template
  if (template.image_ref !== args.expectedRef) {
    throw new Error(
      `template ${TEMPLATE_NAME} points at ${String(template.image_ref)}, expected ${args.expectedRef}`,
    )
  }
  return template
}

const main = async (): Promise<number> => {
  const apiKey = process.env.AGENT37_API_KEY
  if (apiKey === undefined || apiKey.trim() === '') {
    process.stderr.write('AGENT37_API_KEY is not set\n')
    return 1
  }
  try {
    const expectedRef = await expectedRefOf(sourceOf(process.argv, process.env))
    const written = await upsertTemplate({ apiKey, imageRef: expectedRef })
    const template = await verifyTemplate({ apiKey, expectedRef })
    process.stdout.write(
      `${template.name ?? TEMPLATE_NAME}@${String(template.revision ?? written.revision)} ${expectedRef}\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (import.meta.main) process.exit(await main())
