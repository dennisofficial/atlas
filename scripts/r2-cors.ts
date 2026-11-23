export type CorsRule = {
  allowed: { origins: string[]; methods: string[] }
  maxAgeSeconds: number
}

export type BucketCors = { bucket: string; rules: CorsRule[] }

export type R2CorsConfig = { accountId: string; buckets: BucketCors[] }

const CONFIG_PATH = new URL('../infra/r2/cors.json', import.meta.url)
const READ_METHODS = new Set(['GET', 'HEAD'])
const ORIGIN_PATTERN = /^https?:\/\/[^/*]*\*?[^/*]*$/

const ruleProblemsOf = (args: { bucket: string; rule: CorsRule }): string[] => [
  ...args.rule.allowed.origins
    .filter((origin) => origin === '*' || !ORIGIN_PATTERN.test(origin))
    .map(
      (origin) => `${args.bucket}: origin ${origin} is not one scheme://host with at most one *`,
    ),
  ...args.rule.allowed.methods
    .filter((method) => !READ_METHODS.has(method))
    .map((method) => `${args.bucket}: method ${method} is not a read`),
]

export const problemsOf = (config: R2CorsConfig): string[] =>
  config.buckets.flatMap((entry) =>
    entry.rules.flatMap((rule) => ruleProblemsOf({ bucket: entry.bucket, rule })),
  )

export const corsUrlOf = (args: { accountId: string; bucket: string }): string =>
  `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/r2/buckets/${args.bucket}/cors`

const canonicalOf = (rules: readonly CorsRule[]): string =>
  JSON.stringify(
    rules.map((rule) => ({
      origins: [...rule.allowed.origins].sort(),
      methods: [...rule.allowed.methods].sort(),
      maxAgeSeconds: rule.maxAgeSeconds,
    })),
  )

export const sameRules = (args: { wanted: readonly CorsRule[]; live: readonly CorsRule[] }) =>
  canonicalOf(args.wanted) === canonicalOf(args.live)

type CloudflareReply = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: { rules?: CorsRule[] } | null
}

const NO_CORS_CONFIGURATION = 10059

async function call(args: { url: string; token: string; body?: unknown }): Promise<CorsRule[]> {
  const response = await fetch(args.url, {
    method: args.body === undefined ? 'GET' : 'PUT',
    headers: { authorization: `Bearer ${args.token}`, 'content-type': 'application/json' },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  })
  const reply = (await response.json()) as CloudflareReply
  if (reply.errors.some((error) => error.code === NO_CORS_CONFIGURATION)) return []
  if (!reply.success) throw new Error(`${args.url} answered ${JSON.stringify(reply.errors)}`)
  return reply.result?.rules ?? []
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check')
  const token = process.env.CLOUDFLARE_ACCOUNT_TOKEN
  if (!token) throw new Error('set CLOUDFLARE_ACCOUNT_TOKEN to a token with R2 admin access')
  const config = (await Bun.file(CONFIG_PATH).json()) as R2CorsConfig
  const problems = problemsOf(config)
  if (problems.length > 0) throw new Error(problems.join('\n'))

  let drifted = false
  for (const entry of config.buckets) {
    const url = corsUrlOf({ accountId: config.accountId, bucket: entry.bucket })
    if (!checkOnly) await call({ url, token, body: { rules: entry.rules } })
    const live = await call({ url, token })
    const same = sameRules({ wanted: entry.rules, live })
    drifted ||= !same
    console.log(`${entry.bucket}: ${same ? 'matches infra/r2/cors.json' : 'DRIFTED'}`)
    if (!same) console.log(JSON.stringify(live, null, 2))
  }
  if (drifted) process.exit(1)
}

if (import.meta.main) await main()
