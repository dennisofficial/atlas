'use client'

import { TabPlaceholder } from '@/features/threads/panel/tab-placeholder'

import { paneEmptyCopyOf } from './pane-empty'
import { type ESessionPaneTab, PANE_TAB_LABEL } from './pane-tab'
import { PANE_TAB_ICON } from './pane-tab-strip'

export function PaneEmptyBody({ tab }: { tab: ESessionPaneTab }) {
  const copy = paneEmptyCopyOf(tab)
  const Icon = PANE_TAB_ICON[tab]
  return (
    <section data-pane-empty={tab} aria-label={PANE_TAB_LABEL[tab]}>
      <TabPlaceholder
        icon={<Icon aria-hidden />}
        title={copy.title}
        description={copy.description}
      />
    </section>
  )
}
