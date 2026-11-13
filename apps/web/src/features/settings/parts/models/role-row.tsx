'use client'

import { parentRoleOf, refKey, type ModelRole, type ResolvedModelChoice } from '@dltech/atlas-core'
import { HelpTip } from '@dltech/atlas-ui/ai/help-tip'
import { EModelSelectorVariant } from '@dltech/atlas-ui/ai/model-selector'
import { CardRow } from '@dltech/atlas-ui/components/card'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { ModelSelection } from '@/features/threads/data/model-selection'
import type { ModelPicker } from '@/features/threads/data/use-model-picker'
import { ModelPickerControls } from '@/features/threads/model-picker'

import { ownsModel } from '../../data/personal/model-roles'
import { roleTipOf, roleTitleOf } from './role-copy'

export type RoleRowActions = {
  chooseModel: (args: { role: ModelRole; model: string }) => void
  chooseEffort: (args: { role: ModelRole; effort: ModelSelection['effort'] }) => void
  toggleFast: (args: { role: ModelRole; fast: boolean }) => void
  follow: (args: { role: ModelRole }) => void
}

const ROW_CLASS = cn(
  'grid grid-cols-1 gap-x-3 gap-y-1.5',
  '@[30rem]:grid-cols-[0.875rem_minmax(0,15rem)_6.5rem_5rem_minmax(0,1fr)]',
  '@[40rem]:grid-cols-[minmax(0,1fr)_0.875rem_minmax(0,15rem)_6.5rem_5rem] @[40rem]:items-center',
)

const LABEL_CLASS = cn('flex min-w-0 items-center gap-1 @[30rem]:col-[1/-1] @[40rem]:col-[1]')

const CONTROLS_CLASS = cn(
  'grid grid-cols-[1rem_auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1',
  '[&>[data-slot=model-follow]]:col-[1] [&>[data-slot=model-follow]]:row-[1]',
  '[&>[data-slot=model-trigger]]:col-[2/-1] [&>[data-slot=model-trigger]]:row-[1]',
  '[&>[data-slot=model-trigger]]:max-w-full [&>[data-slot=model-trigger]]:justify-self-start',
  '[&>[data-slot=model-effort]]:col-[2] [&>[data-slot=model-effort]]:row-[2] [&>[data-slot=model-effort]]:justify-self-start',
  '[&>[data-slot=model-fast]]:col-[3] [&>[data-slot=model-fast]]:row-[2] [&>[data-slot=model-fast]]:justify-self-start',
  '@[30rem]:col-[1/-1] @[30rem]:grid-cols-subgrid @[30rem]:gap-x-3 @[30rem]:gap-y-0',
  '@[30rem]:[&>[data-slot=model-trigger]]:col-[2]',
  '@[30rem]:[&>[data-slot=model-effort]]:col-[3] @[30rem]:[&>[data-slot=model-effort]]:row-[1]',
  '@[30rem]:[&>[data-slot=model-fast]]:col-[4] @[30rem]:[&>[data-slot=model-fast]]:row-[1]',
  '@[40rem]:col-[2/-1] @[40rem]:row-[1]',
)

const idOf = (choice: ResolvedModelChoice): string =>
  choice.ref.providerId === '' ? '' : refKey(choice.ref)

const placeholderOf = (choice: ResolvedModelChoice): string =>
  choice.stale ? 'Unavailable' : 'Default'

const followNoteOf = (role: ModelRole): string | undefined => {
  const parent = parentRoleOf(role)
  return parent === undefined ? undefined : `Follows ${roleTitleOf(parent).toLowerCase()}`
}

export function RoleRow({
  role,
  choice,
  picker,
  actions,
}: {
  role: ModelRole
  choice: ResolvedModelChoice
  picker: ModelPicker
  actions: RoleRowActions
}) {
  const selection: ModelSelection = {
    id: idOf(choice),
    effort: choice.effort,
    fast: choice.fast,
  }
  const following = !ownsModel(choice)
  const parent = parentRoleOf(role)
  const follow =
    parent === undefined
      ? undefined
      : {
          label: `Follow ${roleTitleOf(parent).toLowerCase()}`,
          active: following,
          onFollow: () => actions.follow({ role }),
          ...(following ? { note: followNoteOf(role) } : {}),
        }

  const handleSelectionChange = (next: ModelSelection) => {
    if (next.id !== selection.id) actions.chooseModel({ role, model: next.id })
    else if (next.effort !== selection.effort) actions.chooseEffort({ role, effort: next.effort })
    else if (next.fast !== selection.fast) actions.toggleFast({ role, fast: next.fast })
  }

  return (
    <CardRow className="@container">
      <div className={ROW_CLASS}>
        <div className={LABEL_CLASS}>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {roleTitleOf(role)}
          </span>
          <HelpTip label={roleTitleOf(role)}>{roleTipOf(role)}</HelpTip>
        </div>
        <div className={CONTROLS_CLASS}>
          <ModelPickerControls
            picker={picker}
            selection={selection}
            onSelectionChange={handleSelectionChange}
            variant={EModelSelectorVariant.Field}
            effortReadOnly={following}
            showEffortLabel
            placeholder={placeholderOf(choice)}
            {...(follow === undefined ? {} : { follow })}
          />
        </div>
      </div>
    </CardRow>
  )
}
