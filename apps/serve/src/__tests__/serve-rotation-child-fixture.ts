import { randomUUID } from 'node:crypto'

import {
  defaultPipeline, EAgentStart, EAgentStatus, EDefinitionOrigin, EFinishReason, EMPTY_PROMPT,
  toCallId, toEventId, toRunId, toThreadId, type IdPort,
} from '@dltech/atlas-core'
import {
  activateTransferredChildren, adoptTransferredChildren, AgentSupervisor, buildHarness,
  persistSandboxRotationReceipt, PublishingTurnRunner,
} from '@dltech/atlas-harness'

import { ERuntimePhase } from '@dltech/atlas-wire'
import { createRuntimeCheckpointCapture } from '../runtime-checkpoint'
import { childId, gate, rotationFixture, sourceSession, threadId, token } from './serve-rotation-fixture'
import type { FakeServeApp } from './fakes'
import type { TranscriptStore } from './transcript-store-fixture'

const clock = { now: () => new Date().toISOString() }
const ids: IdPort = {
  nextThreadId: () => toThreadId(randomUUID()),
  nextEventId: () => toEventId(randomUUID()),
  nextRunId: () => toRunId(randomUUID()),
  nextCallId: () => toCallId(randomUUID()),
}

export async function rotationChildFixture() {
  const fixture = await rotationFixture()
  const harness = await buildHarness({ home: fixture.home, model: 'unused/model' })
  const threads = harness.threads
  await threads.create({ id: threadId, workspace: '/workspace' })
  await threads.create({ id: childId, workspace: '/workspace', agent: { spawnedBy: threadId, type: 'explore' } })
  await harness.log.append({ threadId, runId: ids.nextRunId(), drafts: [
    { type: 'agent-spawned', agentId: childId, agentType: 'explore', intent: 'finish child work', mode: EAgentStart.Fresh },
    { type: 'agent-ended', agentId: childId, agentType: 'explore', intent: 'finish child work', status: EAgentStatus.Finished,
      prose: 'first job complete', turns: 1, toolCalls: 0 },
  ] })
  await harness.log.append({ threadId: childId, runId: ids.nextRunId(), drafts: [
    { type: 'user-said', text: 'first child job' },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'first job complete' }] },
    { type: 'user-said', text: 'queued child follow-up' },
  ] })
  const checkpoint = await createRuntimeCheckpointCapture({
    threadId, atlasHome: fixture.home, env: { ATLAS_SANDBOX_SESSION_ID: sourceSession },
    token, transcript: harness.log, log: () => undefined,
  }).capture({ phase: ERuntimePhase.Rotating })
  if (checkpoint === null) throw new Error('the child fixture requires a rotation checkpoint')
  const receipt = { ...fixture.receipt, checkpoint, resumeParent: false, resumeChildren: [childId] }
  await persistSandboxRotationReceipt({ atlasHome: fixture.home, receipt })
  await harness.close()
  const boot = async (modelGate = gate()) => {
    let steps = 0
    let supervisor: AgentSupervisor | undefined
    const configure = async ({ app, disk }: { app: FakeServeApp; disk: TranscriptStore }) => {
      const bootHarness = await buildHarness({ home: fixture.home, model: 'unused/model' })
      const store = bootHarness.threads
      const live = new AgentSupervisor({
        log: disk.log, threads: store, ids, clock, launchDirectory: '/workspace',
        agentTypes: [{ name: 'explore', whenToUse: 'look around', prompt: 'look around', origin: EDefinitionOrigin.BuiltIn }],
        runners: () => new PublishingTurnRunner({ channel: app.channel, deps: {
          log: disk.log, ids,
          assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/workspace' }),
          model: { identity: { id: 'scripted', modelId: 'scripted' }, step: async () => {
            steps += 1
            await modelGate.promise
            return { parts: [{ type: 'text', text: 'queued job complete' }], toolCalls: [], finishReason: EFinishReason.Stop }
          } },
        } }),
      })
      supervisor = live
      app.threads = store
      app.roster = {
        snapshot: () => ({ agents: [...live.listEverywhere()], shells: [], services: [] }),
        subscribe: (listener) => live.onChange(listener),
      }
      app.adoptChildren = async ({ threadId: root, resumeChildren }) => {
        await adoptTransferredChildren({ agents: live, threadId: root })
        return activateTransferredChildren({ agents: live, log: disk.log, threadId: root, resumeChildren })
      }
      app.whenChildrenSettled = (given) => live.whenChildrenSettled(given)
      app.runningChildren = () => live.listEverywhere().filter((child) => child.status === EAgentStatus.Running).length
      const close = app.close
      app.close = async () => { await live.closeAll(); await bootHarness.close(); app.intake?.dispose(); await close() }
    }
    const started = await fixture.boot({ configure })
    return { ...started, modelGate, steps: () => steps, supervisor: () => supervisor }
  }
  return { ...fixture, receipt, boot }
}
