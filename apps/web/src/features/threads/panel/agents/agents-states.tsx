import { BotIcon, WifiOffIcon } from 'lucide-react'

import { TabPlaceholder } from '../tab-placeholder'

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
