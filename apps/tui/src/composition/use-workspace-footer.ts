import { useMemo } from 'react'

import type { ModelSelection } from '@dltech/atlas-harness'

import { withCloud, withContainer, withSections } from '../store/sidebar-model'
import type { FooterItem } from '../ui/footer-item'
import { footerLayout } from '../ui/footer-layout'
import type { DraftControls } from '../ui/hooks/use-draft'
import { modelLabel } from '../ui/model-label'
import { servicesSurface } from './services-surface'
import { shellsSurface } from './shells-surface'
import { subagentsSurface } from './agents-surface'
import type { AtlasApp } from './compose'
import type { AgentsControl } from './use-agents'
import type { AgentsPickerControl } from './use-agents-picker'
import type { ContainerPills } from './use-container-pill'
import { useFooterStrip } from './use-footer-strip'
import { usePluginSurfaces } from './use-plugin-surfaces'
import type { ServicesControl } from './use-services'
import type { ShellsControl } from './use-shells'
import type { useViewedAgent } from './use-workspace-models'

export function useWorkspaceFooter(args: {
  app: AtlasApp
  draft: DraftControls
  shells: ShellsControl
  services: ServicesControl
  agents: AgentsControl
  agentsPicker: AgentsPickerControl
  chromeWidth: number
  selection: ModelSelection
  viewed: Pick<ReturnType<typeof useViewedAgent>, 'viewedSelection' | 'viewedCard' | 'readout'>
  locationItems: readonly FooterItem[]
  containerPill: ContainerPills
}) {
  const {
    app,
    draft,
    shells,
    services,
    agents,
    agentsPicker,
    chromeWidth,
    selection,
    viewed,
    locationItems,
    containerPill,
  } = args
  const { viewedSelection, viewedCard, readout } = viewed

  const surfaces = usePluginSurfaces({
    surfaces: [
      ...app.pluginSurfaces,
      shellsSurface({ shells }),
      servicesSurface({ services }),
      subagentsSurface({ agents, picker: agentsPicker }),
    ],
  })

  const footerModelLabel =
    viewedCard?.label ??
    (viewedSelection === null ? '' : modelLabel(viewedSelection.ref.modelId))
  const footerRow = useMemo(
    () =>
      footerLayout({
        width: chromeWidth,
        model: footerModelLabel,
        effort: viewedSelection?.effort ?? selection.effort,
        items: [...locationItems, ...surfaces.footerItems],
        context: readout,
      }),
    [chromeWidth, footerModelLabel, locationItems, readout, selection.effort, surfaces.footerItems, viewedSelection],
  )

  const footerStrip = useFooterStrip({ items: footerRow.instruments.items, draft })

  const sidebarModel = useMemo(
    () =>
      withSections({
        model: withCloud({
          model: withContainer({ model: agents.sidebar, container: containerPill.container }),
          cloud: containerPill.cloud,
        }),
        sections: surfaces.sidebarSections,
      }),
    [agents.sidebar, containerPill, surfaces.sidebarSections],
  )

  return { footerModelLabel, footerRow, footerStrip, sidebarModel }
}

export type WorkspaceFooter = ReturnType<typeof useWorkspaceFooter>
