import type { CSSProperties, ReactNode } from "react";

import {
  SidebarInset,
  SidebarProvider,
} from "@dltech/atlas-ui/components/sidebar";

import type { AppThread } from "../../fixtures/app";
import { AppSidebar } from "./app-sidebar";
import { AtlasMark } from "./atlas-mark";
import { EAppNav, type ShellDemoState } from "./shell-types";

export { EAppNav, type ShellDemoState };

export interface AppShellProps {
  children?: ReactNode;
  activeThreadId?: string;
  activeNav?: EAppNav;
  defaultOpen?: boolean;
  demo?: ShellDemoState;
  pendingThread?: AppThread;
}

const SIDEBAR_STYLE = { "--sidebar-width": "14rem" } as CSSProperties;

export function EmptyHome() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <AtlasMark className="size-64 text-foreground opacity-5" />
    </div>
  );
}

export function AppShell({
  children,
  activeThreadId,
  activeNav = EAppNav.Threads,
  defaultOpen = true,
  demo,
  pendingThread,
}: AppShellProps) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="h-svh min-h-0"
      style={SIDEBAR_STYLE}
    >
      <AppSidebar
        activeThreadId={activeThreadId}
        activeNav={activeNav}
        demo={demo}
        pendingThread={pendingThread}
      />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        {children ?? <EmptyHome />}
      </SidebarInset>
    </SidebarProvider>
  );
}
