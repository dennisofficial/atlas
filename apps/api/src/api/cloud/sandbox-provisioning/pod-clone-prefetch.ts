import type { Sandbox } from '@vercel/sandbox'
import { githubCloneUrlOf, startClonePrefetch } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'

import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

type ClonePlan = { remoteUrl: string; credentialedUrl: string; baseBranch: string | null }

const credentialedOf = (args: { remoteUrl: string; token: string | undefined }): string =>
  args.token === undefined
    ? args.remoteUrl
    : args.remoteUrl.replace('https://', `https://x-access-token:${args.token}@`)

async function planOf(args: {
  userId: string
  projectId: string | null
  cipher: SecretCipherService
}): Promise<ClonePlan | undefined> {
  if (args.projectId === null) return undefined
  const project = await db.orm.public.Project.first({ id: args.projectId })
  if (project === null || project.ownerUserId !== args.userId || project.repo === null)
    return undefined
  const connection = await db.orm.public.GithubConnection.first({ userId: args.userId })
  const remoteUrl = githubCloneUrlOf(project.repo)
  return {
    remoteUrl,
    credentialedUrl: credentialedOf({
      remoteUrl,
      token: connection === null ? undefined : args.cipher.decrypt(connection.sealedToken),
    }),
    baseBranch: project.baseBranch,
  }
}

export function clonePrefetcherOf(args: {
  userId: string
  projectId: string | null
  cipher: SecretCipherService
  log: (line: string) => void
}): (sandbox: Sandbox) => Promise<void> {
  const plan = planOf(args)
  plan.catch(() => undefined)
  return async (sandbox) => {
    const resolved = await plan.catch((failure: unknown) => {
      args.log(
        `clone prefetch plan failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
      return undefined
    })
    if (resolved === undefined) return
    await startClonePrefetch({ sandbox, ...resolved, log: args.log })
  }
}
