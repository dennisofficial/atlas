'use client'

import { useSearchParams } from 'next/navigation'

import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { Subagent } from '@dltech/atlas-ui/ai/subagent'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'
import { WorkSummary } from '@dltech/atlas-ui/ai/work-summary'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { Composer } from '../composer'
import { SessionPane } from '../session-pane'
import { ERightTab, ESessionState } from '../session-types'
import { Steps } from '../transcript'
import {
  DEFAULT_SCENARIO,
  EFailureStatus,
  inFlight,
  isFailureScenarioId,
  scenarioOf,
  type FailureScenario,
} from './scenarios'
import { PrototypeSwitcher } from './switcher'
import { useFailureState, type FailureCardProps } from './use-failure-state'
import { NAME_A, VariantA } from './variant-a'
import { ComposerStrip, NAME_B, TurnMarkerB } from './variant-b'
import { NAME_C, VariantC } from './variant-c'

const VARIANTS = [
  { key: 'A', name: NAME_A },
  { key: 'B', name: NAME_B },
  { key: 'C', name: NAME_C },
]

const noop = () => undefined

function FailedSubagent({ scenario }: { scenario: FailureScenario }) {
  if (scenario.subAgent === undefined) return null
  return (
    <Subagent
      name={scenario.subAgent.name}
      elapsed="48s"
      model="claude-haiku"
      tools={[EToolKind.Web]}
      calls={[
        {
          kind: EToolKind.Web,
          label: 'ui.shadcn.com/docs/changelog',
          output: '200 OK',
          elapsed: '1.2s',
        },
        {
          kind: EToolKind.Web,
          label: 'ui.shadcn.com/docs/migration/base-nova',
          state: EToolState.Error,
          errorText: scenario.subAgent.cause,
          elapsed: '30s',
        },
      ]}
      result={<p className="text-destructive">{scenario.subAgent.cause}</p>}
      defaultOpen={false}
    />
  )
}

function FailureTranscript(props: FailureCardProps & { variant: string }) {
  const { scenario, status, variant } = props
  const live = inFlight(status)
  const card = status === EFailureStatus.Failed || live
  const Card = variant === 'C' ? VariantC : VariantA
  return (
    <Chat className="min-h-0 flex-1">
      <ChatItem id="u1">
        <UserMessage author="Dennis" timestamp="14:02">
          {scenario.prompt}
        </UserMessage>
      </ChatItem>
      <ChatItem id="a1">
        <div className="flex flex-col gap-4">
          {scenario.steps.length > 0 || live ? (
            <WorkSummary
              duration={scenario.elapsed}
              running={live}
              stepCount={scenario.steps.length}
              defaultOpen
            >
              <Steps steps={scenario.steps} onOpenFile={noop} />
            </WorkSummary>
          ) : null}
          <FailedSubagent scenario={scenario} />
          {scenario.partial === undefined ? null : (
            <AgentMessage author="Atlas" timestamp="14:04">
              {scenario.partial}
            </AgentMessage>
          )}
          {status === EFailureStatus.Recovered ? (
            <AgentMessage author="Atlas" timestamp="14:06">
              Done. The variables are mapped and the specs pass.
            </AgentMessage>
          ) : null}
          {card && variant === 'B' ? <TurnMarkerB elapsed={scenario.elapsed} /> : null}
          {card && variant !== 'B' ? <Card {...props} /> : null}
        </div>
      </ChatItem>
    </Chat>
  )
}

export function FailureView({ variant }: { variant: string }) {
  const params = useSearchParams()
  const raw = params.get('state')
  const scenario = scenarioOf(isFailureScenarioId(raw) ? raw : DEFAULT_SCENARIO)
  const { status, handleAction, handleDismiss } = useFailureState(scenario)
  const cardProps: FailureCardProps = {
    scenario,
    status,
    onAction: handleAction,
    onDismiss: handleDismiss,
  }
  const busy = inFlight(status) || scenario.busy === true
  const strip = variant === 'B' && (status === EFailureStatus.Failed || inFlight(status))

  const composer = (
    <>
      {strip ? <ComposerStrip {...cardProps} /> : null}
      <Composer busy={busy} onSend={noop} />
    </>
  )
  const header = {
    state: busy ? ESessionState.Running : ESessionState.Idle,
    title: 'Map shadcn variables',
  }

  return (
    <TooltipProvider>
      <SessionPane
        key={`${scenario.id}|${variant}`}
        state={header.state}
        header={header}
        agents={[]}
        teammates={[]}
        initialTab={ERightTab.Details}
        initialQueue={[]}
        renderTranscript={() => <FailureTranscript {...cardProps} variant={variant} />}
        composer={composer}
      />
      <PrototypeSwitcher variants={VARIANTS} current={variant} scenario={scenario.id} />
    </TooltipProvider>
  )
}
