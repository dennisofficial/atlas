import { agentTypeSettingId, defaultPipeline, EPromptAgent, ESettingId, parseRef, promptModelOf, textValueOf, TelemetryPort, type ModelCard } from '@dltech/atlas-core'

import { subAgentPrompt } from '../agents/registry/child-prompt'
import type { ChildRunnerDeps } from '../agents/registry/child-runner'
import { isTeammateType } from '../agents/types'
import { ChildRunnerDepsToken } from '../container/create-harness-container'
import { portToken } from '../container/injection'
import { HookChainToken } from '../container/tokens'
import type { MessageIntake } from '../intake'
import type { TurnDeps } from '../loop/run-turn'
import { ToolRegistry } from '../tools/registry'
import { childModelSource } from './model-bindings'
import type { TurnSetup } from './turn-setup'

type ChildBinding = Pick<TurnSetup, 'container' | 'models' | 'model' | 'modelPort' | 'settings' | 'channel' | 'prompts' | 'workspace' | 'executionLocation' | 'mounts' | 'capabilities'> & {
  turn: TurnDeps
  intake: MessageIntake
  runningShells: Parameters<typeof defaultPipeline>[0]['runningShells']
  runningServices: Parameters<typeof defaultPipeline>[0]['runningServices']
}

export function bindChildRunner(args: ChildBinding): void {
  const { container, models, model, modelPort, prompts, workspace, executionLocation, mounts } = args
  const modelFor = childModelSource({
    models, model, modelPort, hooks: () => container.resolve(HookChainToken), settings: args.settings,
  })
  const cardPinnedTo = (pinned: string | undefined): ModelCard | undefined => {
    if (pinned === undefined) return models.cardFor(model.choice().ref)
    const ref = parseRef(pinned)
    return ref === undefined ? undefined : models.cardFor(ref)
  }
  const subagentSetting = (id: string): string | undefined => {
    const held = textValueOf({ resolution: args.settings.snapshot().resolution, id })
    return held.length === 0 ? undefined : held
  }
  container.register(ChildRunnerDepsToken, {
    useValue: (): ChildRunnerDeps => ({
      turn: args.turn,
      tools: container.resolve(portToken(ToolRegistry)),
      hooks: container.resolve(HookChainToken),
      channel: args.channel,
      drainNotices: (request) => args.intake.prepare(request),
      intake: args.intake,
      modelFor,
      telemetry: container.resolve(portToken(TelemetryPort)),
      assemblyFor: ({ agentType, projectDirectory: working }) =>
        defaultPipeline({
          prompt: ({ projectDirectory }) => subAgentPrompt({
            prompts, agentType,
            agent: isTeammateType(agentType.name) ? EPromptAgent.Main : EPromptAgent.Sub,
            provider: modelPort.identity,
            model: promptModelOf(cardPinnedTo(
              subagentSetting(agentTypeSettingId(agentType.name)) ?? agentType.model ?? subagentSetting(ESettingId.SubagentModel),
            )),
            projectDirectory,
          }),
          launchDirectory: working ?? workspace.workspace,
          repoRoot: workspace.repo ?? undefined,
          runningShells: args.runningShells,
          runningServices: args.runningServices,
          executionLocation: ({ threadId }) => ({
            location: executionLocation.of(threadId) ?? executionLocation.current(), mounts,
          }),
          capabilities: args.capabilities,
        }),
    }),
  })
}
