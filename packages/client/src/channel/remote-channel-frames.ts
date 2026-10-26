import { toThreadId } from '@dltech/atlas-core'
import { ERuntimePhase } from '@dltech/atlas-wire/web'

import {
  CHANNEL_PROTOCOL_VERSION,
  decodeServeFrame,
  EServeFrame,
  turnOutcomeFromWire,
  type ServeFrame,
} from './channel-wire'
import { checkpointFrom } from './remote-channel-checkpoint'
import { NOTHING_PENDING, type ChannelCore } from './remote-channel-core'
import { ESocketLiveness } from './connection-view'

const protocolMismatchOf = (protocol: number): string =>
  protocol > CHANNEL_PROTOCOL_VERSION
    ? `the sandbox's serve speaks a newer wire protocol (${protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
    : `the sandbox's serve speaks an older wire protocol (${protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`

export function createFrameHandler(core: ChannelCore) {
  const { state, on, facts, upstream, checkpoints, inFlight } = core

  const handleReady = (frame: Extract<ServeFrame, { kind: EServeFrame.Ready }>) => {
    if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
      const message = protocolMismatchOf(frame.protocol)
      state.abandoned = true
      on.failures.emit({ message })
      on.serverErrors.emit({ message })
      core.endStrandedStep()
      facts.update({ waking: false, rotating: false, failure: message })
      state.socket?.close()
      return
    }
    const accepted = checkpoints.accept(frame.checkpoint)
    state.attempt = 0
    upstream.attach({ write: core.write })
    const turnInFlight = frame.turnInFlight === true
    if (turnInFlight !== inFlight.working())
      core.deliver({ type: 'turn-working', working: turnInFlight })
    core.settlePending(NOTHING_PENDING)
    on.readies.emit({ turnInFlight, transcriptCurrent: frame.transcriptCurrent })
    facts.update({
      phase: accepted?.phase ?? ERuntimePhase.Serving,
      socket: ESocketLiveness.Open,
      waking: false,
      rotating: false,
      failure: null,
    })
    if (state.interruptPending && turnInFlight) core.requestInterrupt()
  }

  const handleSignal = (frame: Extract<ServeFrame, { kind: EServeFrame.Signal }>) => {
    if (state.channelCursor !== null && frame.seq > state.channelCursor + 1) {
      state.channelCursor = null
      core.endStrandedStep()
      const head = core.lastEventSeq()
      if (typeof head === 'number') on.reloads.emit({ sinceEventSeq: head })
      else void Promise.resolve(head).then((seq) => on.reloads.emit({ sinceEventSeq: seq }))
      return
    }
    core.deliver(frame.signal)
    state.channelCursor = frame.seq
  }

  const handleFrame = (frame: ServeFrame) => {
    if (frame.kind === EServeFrame.Ready) return handleReady(frame)
    if (frame.kind === EServeFrame.Signal) return handleSignal(frame)
    if (frame.kind === EServeFrame.Reply)
      return upstream.settleReply({ replyTo: frame.replyTo, ok: frame.ok, data: frame.data })
    if (frame.kind === EServeFrame.Reload) {
      state.channelCursor = null
      core.endStrandedStep()
      on.reloads.emit({ sinceEventSeq: frame.sinceEventSeq })
      return
    }
    if (frame.kind === EServeFrame.Parked) {
      checkpoints.accept(frame.checkpoint)
      core.endStrandedStep()
      facts.update({ phase: ERuntimePhase.Parked, waking: false })
      return
    }
    if (frame.kind === EServeFrame.Checkpoint) return core.acceptCheckpoint(frame.checkpoint)
    if (frame.kind === EServeFrame.TurnEnded) {
      state.interruptPending = false
      on.turnEndings.emit(turnOutcomeFromWire(frame.outcome))
      return
    }
    if (frame.kind === EServeFrame.InterruptAcked) {
      state.interruptPending = false
      on.interruptAcks.emit({ turnInFlight: true })
      return
    }
    if (frame.kind === EServeFrame.SendAcked) return upstream.ackSend({ sendId: frame.sendId })
    if (frame.kind === EServeFrame.Roster) return on.rosters.emit(frame.roster)
    if (frame.kind === EServeFrame.PrStates) return on.prStates.emit(frame.states)
    if (frame.kind === EServeFrame.TerminalOutput) {
      return on.terminalOutputs.emit({ terminalId: frame.terminalId, data: frame.data })
    }
    if (frame.kind === EServeFrame.TerminalExit) {
      return on.terminalExits.emit({
        terminalId: frame.terminalId,
        exitCode: frame.exitCode,
        signal: frame.signal,
      })
    }
    if (frame.kind === EServeFrame.ThreadRenamed) {
      return on.threadRenames.emit({ threadId: toThreadId(frame.threadId), title: frame.title })
    }
    if (frame.kind === EServeFrame.ThreadModelChanged) {
      return on.threadModelChanges.emit({
        threadId: toThreadId(frame.threadId),
        model: { ref: frame.model.ref, effort: frame.model.effort },
      })
    }
    if (frame.kind === EServeFrame.Error) {
      on.failures.emit({ message: frame.message })
      on.serverErrors.emit({ message: frame.message })
    }
  }

  const handleMessage = (data: string) => {
    const frame = decodeServeFrame(data)
    if (frame !== null) return handleFrame(frame)
    const checkpoint = checkpointFrom(data)
    core.acceptCheckpoint(checkpoint)
    if (checkpoint !== undefined) return
    on.failures.emit({ message: 'The sandbox sent a frame this client could not read.' })
  }

  return { handleMessage }
}
