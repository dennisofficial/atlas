import { afterEach, describe, expect, it } from 'bun:test'

import { EDefinitionOrigin, EFinishReason, EQualityReviewStatus, QualityReviewPort, TEAMMATE_AGENT_TYPE, toThreadId } from '@dltech/atlas-core'

import { buildChildRunner, drainedSteering } from '../../agents/registry/child-runner'
import type { AgentType } from '../../agents/types'
import { ChildRunnerDepsToken } from '../../container/create-harness-container'
import { portToken } from '../../container/injection'
import { AiSdkModelPort } from '../../model/ai-sdk-model-port'
import { scriptedModel } from '../../model/testing/scripted-model'
import { QualityRig, WIDGET_SOURCE, typesOf } from './quality-test-fixtures'

const rigs: QualityRig[] = []

afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.dispose()))
})

const rigFor = async (command: string): Promise<QualityRig> => {
  const rig = await QualityRig.create({ command })
  rigs.push(rig)
  return rig
}

const childType = (name: string): AgentType => ({
  name,
  whenToUse: 'quality parity spec',
  prompt: 'Write the file.',
  origin: EDefinitionOrigin.BuiltIn,
})

const writingModel = (rig: QualityRig) =>
  new AiSdkModelPort({
    model: scriptedModel({
      script: [
        {
          calls: [{ callId: 'child-write', name: 'write', input: { path: `${rig.project}/child.ts`, content: WIDGET_SOURCE } }],
          finishReason: EFinishReason.ToolCalls,
        },
        { text: 'done' },
      ],
    }),
  })

async function runChildWrite(args: { rig: QualityRig; agentType: AgentType }) {
  const { rig } = args
  const deps = rig.container.resolve(ChildRunnerDepsToken)()
  const created = await rig.app.threads.createWithFirstEvents({
    drafts: [{ type: 'user-said', text: 'write child.ts' }],
    runId: rig.app.ids.nextRunId(),
    agent: { spawnedBy: toThreadId('parent-thread'), type: args.agentType.name },
  })
  const threadId = created.thread.id
  const runner = await buildChildRunner({
    agentType: args.agentType,
    threadId,
    projectDirectory: rig.project,
    observe: () => undefined,
    observeContext: () => undefined,
    observeModel: () => undefined,
    steering: () => drainedSteering(() => []),
    deps: { ...deps, modelFor: async () => writingModel(rig) },
  })
  await runner.runTurn({ threadId })
  return { deps, events: await rig.app.log.read({ threadId }) }
}

describe.each([
  { surface: 'main', command: 'atlas-test' },
  { surface: 'serve', command: 'serve' },
])('quality parity on the $surface composition', ({ command }) => {
  it('hands the dispatcher root, sub-agents and teammates the one configured quality port', async () => {
    const rig = await rigFor(command)
    const port = rig.container.resolve(portToken(QualityReviewPort))

    expect(rig.container.resolve(ChildRunnerDepsToken)().quality).toBe(port)

    const threadId = await rig.newThread()
    rig.enableReview()
    const drafts = await rig.dispatchWrite({ threadId, relative: 'root.ts', content: WIDGET_SOURCE })
    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed', 'nudge'])
  })

  it.each([{ kind: 'sub-agent', name: 'child' }, { kind: 'teammate', name: TEAMMATE_AGENT_TYPE }])(
    'reviews a real write by a $kind through the same real policy and logs the record',
    async ({ name }) => {
      const rig = await rigFor(command)
      rig.enableReview()

      const { deps, events } = await runChildWrite({ rig, agentType: childType(name) })

      expect(deps.quality).toBe(rig.container.resolve(portToken(QualityReviewPort)))
      expect(await rig.onDisk('child.ts')).toBe(WIDGET_SOURCE)
      expect(rig.decisions.calls[0]?.questionKeys).toContain('single-responsibility:currentConcern')
      const record = events.find((event) => event.type === 'code-quality-reviewed')
      if (record?.type !== 'code-quality-reviewed') throw new Error('child write produced no review record')
      expect(record.status).toBe(EQualityReviewStatus.Completed)
      expect(events.some((event) => event.type === 'nudge')).toBe(true)
    },
  )

  it('keeps a child write quiet while the master setting is off', async () => {
    const rig = await rigFor(command)

    const { events } = await runChildWrite({ rig, agentType: childType('child') })

    expect(await rig.onDisk('child.ts')).toBe(WIDGET_SOURCE)
    expect(rig.decisions.calls).toHaveLength(0)
    expect(events.some((event) => event.type === 'code-quality-reviewed' || event.type === 'nudge')).toBe(false)
  })
})
