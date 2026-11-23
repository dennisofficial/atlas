import {
  buildGithubSweeps,
  GithubConfig,
  githubRedisOf,
  setGithubLogSink,
  type GithubSweeps,
} from '@dltech/atlas-github'
import { SecretCipher } from '@dltech/atlas-pods'
import { triggerLog } from '../trigger-logger'

export type GithubSweepGraph = GithubSweeps

const configOf = (env: Record<string, string | undefined>): GithubConfig =>
  new GithubConfig({
    appId: env['GITHUB_APP_ID'],
    appPrivateKey: env['GITHUB_APP_PRIVATE_KEY'],
    appSlug: env['GITHUB_APP_SLUG'],
    clientId: env['GITHUB_CLIENT_ID'],
    publicApiUrl: env['BETTER_AUTH_URL'],
  })

const cipherOf = (env: Record<string, string | undefined>): SecretCipher => {
  const raw = env['SECRETS_ENCRYPTION_KEY']
  if (raw === undefined || raw === '') {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is missing from the worker tier; the GitHub sweeps cannot read stored installation secrets without it',
    )
  }
  return new SecretCipher(raw)
}

export function buildGithubSweepGraph(
  env: Record<string, string | undefined> = process.env,
): GithubSweepGraph {
  const redis = githubRedisOf({ url: env['REDIS_URL'] })
  if (!redis.isConfigured()) {
    triggerLog.warn(
      'Without Redis the GitHub request budget and PR frames stay in this process; the API and this worker cannot share them',
    )
  }
  setGithubLogSink(() => triggerLog)
  const sweeps = buildGithubSweeps({ config: configOf(env), cipher: cipherOf(env), redis })

  return {
    ...sweeps,
    dispose: async () => {
      await sweeps.dispose()
      await redis.close()
    },
  }
}

export async function withGithubSweeps<T>(args: {
  run: (graph: GithubSweepGraph) => Promise<T>
}): Promise<T> {
  const graph = buildGithubSweepGraph()
  try {
    return await args.run(graph)
  } finally {
    await graph.dispose()
  }
}
