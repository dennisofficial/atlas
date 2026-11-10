import { CalendarClock, Plus } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

export function RoutinesEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <CalendarClock className="size-6 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm font-medium">No routines yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        A routine is a prompt on a schedule. When it fires, Atlas starts a normal session on this
        project — it boots a sandbox in about 34 seconds, runs the prompt unattended, and lands in
        your thread list like any other session.
      </p>
      <Button size="sm" className="mt-1" onClick={onCreate}>
        <Plus data-icon="inline-start" />
        New routine
      </Button>
    </div>
  )
}
