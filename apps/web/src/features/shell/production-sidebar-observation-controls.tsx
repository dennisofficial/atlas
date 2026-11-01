import { useSyncExternalStore } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import type { FixtureSource } from './production-sidebar-fixture-source'

export function FixtureObservationControls({
  source,
  paneHidden,
  rowsMounted,
  onTogglePane,
  onToggleRows,
}: {
  source: FixtureSource
  paneHidden: boolean
  rowsMounted: boolean
  onTogglePane: () => void
  onToggleRows: () => void
}) {
  const snapshot = useSyncExternalStore(
    source.subscribeDiagnostics,
    source.snapshot,
    source.snapshot,
  )
  return (
    <section
      aria-label="PR observation fixture diagnostics"
      data-fixture-observation-keys={JSON.stringify(snapshot.observedKeys)}
      data-fixture-active-channels={snapshot.activeChannels}
      data-fixture-maximum-channels={snapshot.maximumChannels}
      data-fixture-open-count={snapshot.opens}
      data-fixture-close-count={snapshot.closes}
      data-fixture-maximum-targets={snapshot.maximumRequestedTargets}
      data-fixture-state-frames={snapshot.stateFrames}
      data-fixture-empty-channel-frames={snapshot.emptyChannelStateFrames}
      data-fixture-channel-events={JSON.stringify(snapshot.events)}
      data-fixture-unavailable={snapshot.unavailable}
      className="flex max-w-xl flex-col gap-3"
    >
      <output className="text-xs text-muted-foreground">
        {`Observed PRs: ${snapshot.observedKeys.length}; active channels: ${snapshot.activeChannels}; opens: ${snapshot.opens}; closes: ${snapshot.closes}; state frames: ${snapshot.stateFrames}.`}
      </output>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={source.repeat}>
          Repeat current CI
        </Button>
        <Button variant="outline" onClick={source.failObservation}>
          Simulate unavailable observation
        </Button>
        <Button variant="outline" onClick={source.recoverObservation}>
          Recover observation
        </Button>
        <Button variant="outline" onClick={onTogglePane}>
          {paneHidden ? 'Show preview pane' : 'Hide preview pane'}
        </Button>
        <Button variant="outline" onClick={onToggleRows}>
          {rowsMounted ? 'Unmount preview rows' : 'Mount preview rows'}
        </Button>
      </div>
    </section>
  )
}
