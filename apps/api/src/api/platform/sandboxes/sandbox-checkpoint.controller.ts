import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'
import { runtimeCheckpointSchema } from '@dltech/atlas-wire'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { db, or, type Row } from '@dltech/atlas-db'
import { storedCheckpointOf } from './sandbox-checkpoint'
import type { SandboxAuthenticatedRequest } from './sandbox-token.guard'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { hashSessionToken } from './sandbox-tokens'
import { userIdOf } from '../sessions/session-user'

const CHECKPOINT_COLUMNS = ['userId', 'runtimeCheckpoint', 'runtimeCheckpointRevision'] as const

interface RuntimeCheckpointDto {
  checkpoint: RuntimeCheckpoint | null
}

@Controller({ path: 'sandboxes', version: '1' })
@Throttle({ default: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttl: 60_000 } })
export class SandboxCheckpointController {
  @Get(':threadId/checkpoint')
  @UseGuards(SessionAuthGuard)
  async handleGetCheckpoint(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<RuntimeCheckpointDto> {
    const row = await db.orm.public.CloudSandbox.where({ threadId, userId: userIdOf(request) })
      .select(...CHECKPOINT_COLUMNS)
      .first()
    if (row === null) throw new NotFoundException('sandbox not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: row.runtimeCheckpoint,
        revision: row.runtimeCheckpointRevision,
      }),
    }
  }

  @Put(':threadId/checkpoint')
  @UseGuards(SandboxTokenGuard)
  async handlePutCheckpoint(
    @Req() request: SandboxAuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ): Promise<RuntimeCheckpointDto> {
    const sandbox = request.sandbox
    if (sandbox === undefined || sandbox.threadId !== threadId) {
      throw new UnauthorizedException('the sandbox token reaches only its own thread')
    }
    const parsed = runtimeCheckpointSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('not a valid runtime checkpoint')
    if (parsed.data.threadId !== threadId) {
      throw new BadRequestException('the checkpoint names a different thread')
    }

    const token = checkpointBearerOf(request)
    if (token === undefined) throw new UnauthorizedException('a sandbox session token is required')
    const revision = parsed.data.revision
    const updated = await db.orm.public.CloudSandbox.where({
      threadId,
      userId: sandbox.userId,
      tokenHash: hashSessionToken(token),
    })
      .where((row) =>
        or(row.runtimeCheckpointRevision.isNull(), row.runtimeCheckpointRevision.lt(revision)),
      )
      .updateAndCount({
        runtimeCheckpoint: JSON.parse(JSON.stringify(parsed.data)) as Row<'CloudSandbox'>['runtimeCheckpoint'],
        runtimeCheckpointRevision: revision,
        updatedAt: new Date(),
      })
    if (updated === 1) return { checkpoint: parsed.data }

    const stored = await db.orm.public.CloudSandbox.where({ threadId, userId: sandbox.userId })
      .select(...CHECKPOINT_COLUMNS)
      .first()
    if (stored === null) throw new NotFoundException('sandbox not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: stored.runtimeCheckpoint,
        revision: stored.runtimeCheckpointRevision,
      }),
    }
  }
}

function checkpointBearerOf(request: SandboxAuthenticatedRequest): string | undefined {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
    return undefined
  }
  return value
}
