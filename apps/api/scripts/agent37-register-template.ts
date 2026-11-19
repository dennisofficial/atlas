const IMAGE = 'ghcr.io/dennisofficial/atlas-sandbox'
const REGISTRY = 'https://ghcr.io'
const TEMPLATE_NAME = 'atlas-sandbox'
const DEFAULT_PORT = 3000

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

const main = async (): Promise<number> => {
  const apiKey = process.env.AGENT37_API_KEY
  if (apiKey === undefined || apiKey.trim() === '') {
    process.stderr.write('AGENT37_API_KEY is not set\n')
    return 1
  }
  try {
    const digest = await registryDigestOf('latest')
    const answer = await fetch('https://api.agent37.com/v1/templates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: TEMPLATE_NAME,
        image_ref: `${IMAGE}@${digest}`,
        default_port: DEFAULT_PORT,
      }),
    })
    const body: unknown = await answer.json()
    if (!answer.ok) {
      process.stderr.write(
        `agent37 refused the template: ${answer.status} ${JSON.stringify(body)}\n`,
      )
      return 1
    }
    const template = body as { id?: string; name?: string }
    process.stdout.write(`${template.id ?? template.name ?? ''}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

process.exit(await main())
