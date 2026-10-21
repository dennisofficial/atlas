import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@dltech/atlas-ui/components/sidebar";

import type { AppThread } from "../../fixtures/app";
import { AccountMenu } from "./account-menu";
import { ShellBottomNav } from "./shell-bottom-nav";
import { ShellTopBar } from "./shell-top-bar";
import { ThreadList } from "./shell-thread-list";
import type { EAppNav, ShellDemoState } from "./shell-types";

export interface AppSidebarProps {
  activeThreadId?: string;
  activeNav: EAppNav;
  demo?: ShellDemoState;
  pendingThread?: AppThread;
}

export function AppSidebar({ activeThreadId, activeNav, demo, pendingThread }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <ShellTopBar />
      <SidebarContent className="group-data-[collapsible=icon]:hidden">
        <ThreadList
          activeThreadId={activeThreadId}
          threadCardId={demo?.threadCardId}
          projectCardId={demo?.projectCardId}
          pendingThread={pendingThread}
        />
      </SidebarContent>
      <SidebarFooter className="gap-1 border-t border-sidebar-border p-2 group-data-[collapsible=icon]:mt-auto">
        <ShellBottomNav activeNav={activeNav} />
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu defaultOpen={demo?.accountMenuOpen} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
