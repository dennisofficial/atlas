import {
  appendEventsInputSchema,
  importEventsInputSchema,
  podEventsReplySchema,
  readEventsInputSchema,
  replaceEventsInputSchema,
  threadHeadReplySchema,
  threadEventsLiveInputSchema,
  threadEventsLiveOutputSchema,
  threadEventsSnapshotInputSchema,
  threadEventsSnapshotOutputSchema,
  type ThreadEventsLiveInput,
  type ThreadEventsSnapshotInput,
  type ThreadEventsSnapshot,
  threadIdInputSchema,
  threadStreamInputSchema,
  threadStreamOutputSchema,
  wireEventSchema,
  type AppendEventsInput,
  type ImportEventsInput,
  type PodEventsReply,
  type ReadEventsInput,
  type ReplaceEventsInput,
  type ThreadHeadReply,
  type ThreadIdInput,
  type ThreadStreamFrame,
  type ThreadStreamInput,
} from '@dltech/atlas-wire'
import { ServiceUnavailableException } from '@nestjs/common'
import {
  Ctx,
  Input,
  Mutation,
  Options,
  type ProcedureOptions,
  Query,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { DrainStateService } from '../health/drain-state.service'
import { EventsService } from './events.service'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import type { EventDto } from './sessions.types'
import { ThreadSignalsService } from './thread-signals.service'
import { attachThreadStream } from './thread-stream'
import { threadStreamFrames } from './thread-stream.frames'
import { readThreadEventsSnapshot } from './thread-events-snapshot'
import { orderedThreadEvents } from './thread-events-live'

const readMeta = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })
const unthrottledMeta = meta({ throttle: false })

@Router({ alias: 'threadEvents' })
@UseMiddlewares(SessionMiddleware)
export class ThreadEventsRouter {
  constructor(
    private readonly events: EventsService,
    private readonly signals: ThreadSignalsService,
    private readonly drain: DrainStateService,
  ) {}

  @Mutation({ input: appendEventsInputSchema, output: z.array(wireEventSchema), meta: readMeta })
  append(@Input() input: AppendEventsInput, @Ctx() ctx: SessionTrpcCtx): Promise<EventDto[]> {
    return this.events.append({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: replaceEventsInputSchema, output: z.array(wireEventSchema), meta: readMeta })
  replace(@Input() input: ReplaceEventsInput, @Ctx() ctx: SessionTrpcCtx): Promise<EventDto[]> {
    return this.events.replace({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Query({ input: readEventsInputSchema, output: z.array(wireEventSchema), meta: unthrottledMeta })
  read(@Input() input: ReadEventsInput, @Ctx() ctx: SessionTrpcCtx): Promise<EventDto[]> {
    const args = {
      userId: ctx.auth.userId,
      threadId: input.threadId,
      fromSeq: input.fromSeq,
      upTo: input.upTo,
    }
    if (input.own === true) return this.events.readOwn(args)
    return this.events.read(args)
  }

  @Query({
    input: threadEventsSnapshotInputSchema,
    output: threadEventsSnapshotOutputSchema,
    meta: unthrottledMeta,
  })
  snapshot(
    @Input() input: ThreadEventsSnapshotInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ThreadEventsSnapshot> {
    return readThreadEventsSnapshot({ ...input, userId: ctx.auth.userId })
  }

  @Subscription({
    input: threadEventsLiveInputSchema,
    output: threadEventsLiveOutputSchema,
    meta: readMeta,
  })
  async live(
    @Input() input: ThreadEventsLiveInput,
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ) {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    await this.events.head({
      userId: ctx.auth.userId,
      threadId: input.threadId,
    })
    return orderedThreadEvents({
      threadId: input.threadId,
      lastEventId: input.lastEventId,
      signal: opts.signal,
      signals: this.signals,
      readSnapshot: (options) =>
        readThreadEventsSnapshot({
          ...options,
          threadId: input.threadId,
          userId: ctx.auth.userId,
        }),
    })
  }

  @Mutation({ input: importEventsInputSchema, output: podEventsReplySchema, meta: readMeta })
  async import(
    @Input() input: ImportEventsInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<PodEventsReply> {
    return this.events.importEvents({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      events: input.events,
    })
  }

  @Query({ input: threadIdInputSchema, output: threadHeadReplySchema, meta: readMeta })
  head(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadHeadReply> {
    return this.events.head({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Subscription({
    input: threadStreamInputSchema,
    output: threadStreamOutputSchema,
    meta: readMeta,
  })
  async stream(
    @Input() input: ThreadStreamInput,
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): Promise<AsyncGenerator<ThreadStreamFrame>> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const { threadId } = input
    const readHead = async (): Promise<number> =>
      (
        await this.events.head({
          userId: ctx.auth.userId,
          threadId,
        })
      ).head
    await readHead()
    return threadStreamFrames({
      signal: opts.signal,
      attach: (sink) => attachThreadStream({ signals: this.signals, threadId, readHead, sink }),
    })
  }
}
