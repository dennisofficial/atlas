import { paneValueFixture, populatedPaneValue } from './__tests__/fixture'
import { SessionDetailsTab } from './details-tab'
import { SessionPaneProvider } from './pane-value'

const meta = {
  title: 'Sessions/Pane details',
  parameters: { layout: 'fullscreen' },
}

export default meta

const pane = (value: ReturnType<typeof populatedPaneValue>) => (
  <div className="h-[36rem] w-full max-w-sm border-r bg-card">
    <SessionPaneProvider value={value}>
      <SessionDetailsTab />
    </SessionPaneProvider>
  </div>
)

export const Populated = {
  render: () => pane(populatedPaneValue()),
}

export const Empty = {
  render: () => pane(paneValueFixture()),
}
