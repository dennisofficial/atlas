import type { PlanRow } from '@dltech/atlas-harness'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import React from 'react'

import { PushPicker } from './push-picker'
import type { PickerOutcome } from './push-picker-model'

export async function runPushPicker({ rows, showAll }: { rows: readonly PlanRow[]; showAll: boolean }): Promise<PickerOutcome> {
  const renderer = await createCliRenderer({ useMouse: true, exitOnCtrlC: false })
  renderer.setMaxListeners(0)
  const root = createRoot(renderer)

  const outcome = await new Promise<PickerOutcome>((resolve) => {
    root.render(<PushPicker rows={rows} showAll={showAll} onDone={resolve} />)
  })

  root.unmount()
  renderer.destroy()
  return outcome
}
