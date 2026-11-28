'use client'

import { Button } from '@dltech/atlas-ui/components/button'

import { ChangeTotalsLabel } from './change-totals-label'
import { DESKTOP_PANE_TABS, ESessionPaneTab, PANE_TAB_LABEL } from './pane-tab'
import { PANE_TAB_ICON } from './pane-tab-strip'

export const TOOL_HINT: Partial<Record<ESessionPaneTab, string>> = {
  [ESessionPaneTab.Changes]: 'Diff of the branch',
  [ESessionPaneTab.Files]: 'Browse the checkout',
  [ESessionPaneTab.Terminal]: 'Shell in the pod',
  [ESessionPaneTab.Browser]: 'Preview a service',
}

export function ToolLauncher({ onPick }: { onPick: (tab: ESessionPaneTab) => void }) {
  return (
    <div data-tool-launcher className="flex h-full min-h-0 items-center justify-center p-6">
      <nav aria-label="Open a tool" className="flex w-full max-w-72 flex-col gap-1">
        <h2 className="mb-2 text-center text-sm font-medium">Open a tool</h2>
        {DESKTOP_PANE_TABS.map((tab) => {
          const Icon = PANE_TAB_ICON[tab]
          return (
            <Button
              key={tab}
              variant="ghost"
              className="h-auto justify-start"
              onClick={() => onPick(tab)}
            >
              <Icon aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span>{PANE_TAB_LABEL[tab]}</span>
                <span className="text-xs font-normal text-muted-foreground">{TOOL_HINT[tab]}</span>
              </span>
              {tab === ESessionPaneTab.Changes ? <ChangeTotalsLabel /> : null}
            </Button>
          )
        })}
      </nav>
    </div>
  )
}
