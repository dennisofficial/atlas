import { Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { db, type Row } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { failureText, type SandboxWakeBoot } from './github-sandbox-wake-boot'
import { apiProvisionedEnvironment } from '../sandbox-provisioning/pod-telemetry-identity'
import { podVcpusOf } from '../sandbox-provisioning/pod-size'

export type WakeLaunchDeps = {
  env: EnvService
  cipher: SecretCipherService
  credentials: SandboxCredentials
  bootAdapter: SandboxWakeBoot
  signals: ThreadSignalsService
  logger: Logger
}

/** Boots a claimed sandbox, mirrors the Running state, and returns the serve URL. */
export async function bootClaimedSandbox(
  deps: WakeLaunchDeps,
  args: { row: Row<'CloudSandbox'>; threadId: string },
): Promise<void> {
  const { row, threadId } = args
  const freshToken = randomBytes(32).toString('hex')
  const { ownerCredential, userId, ...credentials } = await deps.credentials.forThread({ threadId })
  const { serveUrl, created } = await deps.bootAdapter.boot({
    credentials,
    vcpus: ownerCredential ? await podVcpusOf({ sessionId: row.sessionId, userId }) : undefined,
    ...(ownerCredential
      ? {
          injectVercelCredentials: false,
          environment: apiProvisionedEnvironment({
            userId,
            pepper: deps.env.get('ATLAS_TELEMETRY_PEPPER'),
          }),
        }
      : {}),
    name: row.name,
    threadId,
    image: deps.env.get('SANDBOX_IMAGE'),
    cloudUrl: deps.env.get('ATLAS_CLOUD_URL') ?? 'https://api.byatlas.io',
    serveVersion: row.serveVersion ?? undefined,
    freshToken,
    resumeToken: unsealedToken(deps, row),
    onFreshSandbox: () => adoptFreshSandbox(deps, { sessionId: row.sessionId, token: freshToken }),
  })
  const at = new Date()
  await db.orm.public.CloudSandbox.where({ sessionId: row.sessionId }).update({
    state: ESandboxState.Running,
    serveUrl,
    wakeFailedAt: null,
    lastActivityAt: at,
    updatedAt: at,
  })
  await deps.signals.podChanged({ threadId })
  deps.logger.log(
    `woke sandbox ${row.name} for thread ${threadId} (${created ? 'created fresh' : 'resumed from snapshot'}) — serve at ${serveUrl}`,
  )
}

/** The prior sandbox's lifecycle record died with it; the fresh serve mirrors from revision 1. */
async function adoptFreshSandbox(
  deps: WakeLaunchDeps,
  args: { sessionId: string; token: string },
): Promise<void> {
  await db.orm.public.CloudSandbox.where({ sessionId: args.sessionId }).update({
    tokenHash: hashSessionToken(args.token),
    sealedToken: deps.cipher.encrypt(args.token),
    runtimeCheckpoint: null,
    runtimeCheckpointRevision: null,
    updatedAt: new Date(),
  })
}

function unsealedToken(
  deps: WakeLaunchDeps,
  row: Pick<Row<'CloudSandbox'>, 'name' | 'sealedToken'>,
): string | undefined {
  if (row.sealedToken === null) return undefined
  try {
    return deps.cipher.decrypt(row.sealedToken)
  } catch (failure) {
    deps.logger.warn(
      `the sealed token on sandbox ${row.name} does not decrypt: ${failureText(failure)}`,
    )
    return undefined
  }
}
