import { useState } from 'react'

import { Context } from '@dltech/atlas-ui/ai/context'
import { EEffort, ModelSelector } from '@dltech/atlas-ui/ai/model-selector'
import { MODELS } from '@dltech/atlas-ui/fixtures/agent'

import { ThreadComposer } from '@/features/threads/thread-composer'

import { ERuntime, RuntimeMenu } from './runtime-menu'

const meta = {
  title: 'Sessions/Runtime menu',
  parameters: { layout: 'padded' },
}

export default meta

const FAST_MODELS = MODELS.map((model) =>
  model.id === 'claude-opus' ? { ...model, fast: true } : model,
)

const Composer = ({ initial }: { initial: ERuntime }) => {
  const [runtime, setRuntime] = useState(initial)
  const [model, setModel] = useState('claude-opus')
  const [effort, setEffort] = useState(EEffort.Medium)
  const [fast, setFast] = useState(false)
  return (
    <div className="max-w-xl">
      <ThreadComposer
        value=""
        onValueChange={() => undefined}
        onSubmit={() => undefined}
        sending={false}
        placeholder="Describe a task for Atlas…"
      >
        <ModelSelector
          models={FAST_MODELS}
          value={model}
          onValueChange={setModel}
          effort={effort}
          onEffortChange={setEffort}
          fast={fast}
          onFastChange={setFast}
        />
        <div className="ml-auto flex min-w-0">
          <Context used={52_000} limit={200_000} />
          <RuntimeMenu value={runtime} onValueChange={setRuntime} />
        </div>
      </ThreadComposer>
    </div>
  )
}

export const Default = { render: () => <Composer initial={ERuntime.Agent37} /> }
export const Vercel = { render: () => <Composer initial={ERuntime.Vercel} /> }
