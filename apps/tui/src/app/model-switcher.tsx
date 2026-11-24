import React from 'react'

import { Switcher } from '../ui/components/switcher'
import { THREAD_TARGET } from '../ui/switcher-model'
import { SWITCHER_WIDTH } from './app-next-support'
import type { ModelChoiceControl } from './use-model-choice'

export function ModelSwitcher(props: {
  choice: ModelChoiceControl
  width: number
}): React.ReactNode {
  if (props.choice.state === null) return null

  return (
    <Switcher
      width={Math.min(SWITCHER_WIDTH, props.width)}
      rows={props.choice.rows}
      state={props.choice.state}
      active={props.choice.active}
      total={props.choice.total}
      query={props.choice.query}
      target={THREAD_TARGET}
      overlay
      onPick={props.choice.handlePick}
      onSelect={props.choice.handleSelect}
      onDismiss={props.choice.handleDismiss}
      onQueryChange={props.choice.handleQuery}
    />
  )
}
