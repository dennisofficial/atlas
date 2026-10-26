import { BotIcon, WifiOffIcon } from 'lucide-react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { TabPlaceholder } from '../tab-placeholder'

export function AgentsLoading() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  )
}

export function AgentsFailed(props: { message: string }) {
  return (
    <TabPlaceholder icon={<BotIcon />} title="Agents unavailable" description={props.message} />
  )
}

export function AgentsOffline(props: { title: string; description: string }) {
  return (
    <TabPlaceholder icon={<WifiOffIcon />} title={props.title} description={props.description} />
  )
}
