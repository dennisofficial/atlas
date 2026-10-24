import { TriangleAlertIcon } from 'lucide-react'

import { ModelSelector, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'
import { Button } from '@dltech/atlas-ui/components/button'
import { InputGroup, InputGroupAddon } from '@dltech/atlas-ui/components/input-group'

import {
  AUTO_MODEL,
  ROLE_META,
  type EAgentRole,
  type ModelsConfig,
  type ProviderAccessMap,
} from '@dltech/atlas-ui/fixtures/settings-models'
import { SettingsRow } from '../settings-layout'
import { EReach } from './model-routes'
import {
  changeRoleModel,
  collapsedRouteLabels,
  effortFor,
  pinnedKeys,
  pinnedRefs,
  reconnectInfo,
  resolveRoleModel,
} from './model-state'

export function RoleRow({
  role,
  config,
  access,
  options,
  pinned,
  onConfigChange,
  onPinnedChange,
  defaultOpen = false,
  onOpenProviders,
}: {
  role: EAgentRole
  config: ModelsConfig
  access: ProviderAccessMap
  options: ModelOption[]
  pinned: string[]
  defaultOpen?: boolean
  onConfigChange: (next: ModelsConfig) => void
  onPinnedChange: (next: string[]) => void
  onOpenProviders: () => void
}) {
  const meta = ROLE_META[role]
  const setting = config[role]
  const resolved = resolveRoleModel({ role, config, access })
  const effort = effortFor({ resolved, effort: setting.effort })
  const reconnect = reconnectInfo(access)
  const isExpired = resolved?.route.reach === EReach.Expired && setting.model !== AUTO_MODEL

  const handleModelChange = (model: string) =>
    onConfigChange(changeRoleModel({ config, role, model, access }))
  const handleEffortChange = (next: typeof setting.effort) =>
    onConfigChange({ ...config, [role]: { ...setting, effort: next } })
  const handlePinnedChange = (refs: string[]) => onPinnedChange(pinnedKeys(refs))

  return (
    <SettingsRow
      title={meta.title}
      description={meta.description}
      control={
        <InputGroup className="w-[31rem] max-w-full">
          <InputGroupAddon className="min-w-0 flex-1 gap-0.5 py-0 pr-0.5 pl-0.5">
            <ModelSelector
              className="flex-1"
              defaultOpen={defaultOpen}
              models={options}
              value={setting.model}
              placeholder="Default"
              onValueChange={handleModelChange}
              effort={effort ?? undefined}
              onEffortChange={handleEffortChange}
              pinned={pinnedRefs({ pinned, access })}
              onPinnedChange={handlePinnedChange}
              reconnectProviders={reconnect.providers}
              reconnectNotes={reconnect.notes}
              collapsedProviders={collapsedRouteLabels(access)}
              onReconnect={onOpenProviders}
              onManageProviders={onOpenProviders}
            />
          </InputGroupAddon>
        </InputGroup>
      }
    >
      {isExpired && resolved ? (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {resolved.route.label} sign-in expired. {resolved.row.label} is unavailable until you
            reconnect.
          </span>
          <Button variant="outline" size="xs" onClick={onOpenProviders}>
            Reconnect
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  )
}
