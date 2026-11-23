'use client'

import { readingClasses } from '@dltech/atlas-ui/tokens'

import { NotConfiguredAlert } from './not-configured-alert'
import { OperatorInputCard, type OperatorInputCardProps } from './operator-input-card'
import { ComposerContext, ComposerDock } from './composer-dock'
import { ModelPickerControls } from './model-picker'
import { RunAttentionDock } from './run-attention-dock'
import { ThreadComposer } from './thread-composer'
import { RewindDialog } from './transcript/rewind-dialog'
import { SummariseDialog } from './transcript/summarise-dialog'

type Props = React.ComponentProps<typeof ThreadComposer> & {
  notConfigured: { error: string } | null
  operator: {
    request: Omit<OperatorInputCardProps, 'submitting' | 'onSubmit'> | null
    submitting: boolean
    onSubmit: (value: string) => void
  }
  rewind: {
    pick: React.ComponentProps<typeof RewindDialog>['pick']
    applying: boolean
    onCancel: () => void
    onConfirm: () => void
  }
  summarise: React.ComponentProps<typeof SummariseDialog>
  dock: React.ComponentProps<typeof ComposerDock>['dock']
  strip: React.ComponentProps<typeof RunAttentionDock>['strip']
  usage: React.ComponentProps<typeof ComposerContext>['usage']
  modelPicker: React.ComponentProps<typeof ModelPickerControls>
}

export function ComposerFooter(props: Props) {
  const {
    notConfigured,
    operator,
    rewind,
    summarise,
    dock,
    strip,
    usage,
    modelPicker,
    ...composer
  } = props
  return (
    <div
      className={`mx-auto flex w-full ${readingClasses.measure} shrink-0 flex-col gap-2 px-3 pb-[max(0.75rem,var(--safe-area-bottom))] md:px-4 md:pb-[max(1rem,var(--safe-area-bottom))]`}
    >
      {notConfigured === null ? null : <NotConfiguredAlert error={notConfigured.error} />}
      {operator.request === null ? null : (
        <OperatorInputCard
          key={operator.request.requestId}
          {...operator.request}
          submitting={operator.submitting}
          onSubmit={operator.onSubmit}
        />
      )}
      <RewindDialog
        pick={rewind.pick}
        applying={rewind.applying}
        onCancel={rewind.onCancel}
        onConfirm={rewind.onConfirm}
      />
      <SummariseDialog {...summarise} />
      <ComposerDock dock={dock} />
      <RunAttentionDock strip={strip} />
      <ThreadComposer {...composer}>
        <ModelPickerControls {...modelPicker} />
        <ComposerContext usage={usage} />
      </ThreadComposer>
    </div>
  )
}
