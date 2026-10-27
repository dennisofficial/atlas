import { Spinner } from '@dltech/atlas-ui/components/spinner'
import type { PodStatus } from '@dltech/atlas-wire/web'
import type { ReactNode } from 'react'

import { TabPlaceholder } from '../tab-placeholder'
import { offlineCopyOf, type ETabSubject } from './offline-copy'

export function TabOffline(props: {
  pod: PodStatus | null
  subject: ETabSubject
  icon: ReactNode
}) {
  const { title, description } = offlineCopyOf({
    pod: props.pod,
    subject: props.subject,
  })
  return <TabPlaceholder icon={props.icon} title={title} description={description} />
}

export function TabLoading() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  )
}

export function TabFailed(props: { icon: ReactNode; title: string; message: string }) {
  return <TabPlaceholder icon={props.icon} title={props.title} description={props.message} />
}
