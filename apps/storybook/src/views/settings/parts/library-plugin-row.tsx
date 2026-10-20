import { Badge } from "@dltech/atlas-ui/components/badge";
import { Switch } from "@dltech/atlas-ui/components/switch";

import type { LibraryPlugin } from "../../../fixtures/settings-library";
import { Mono } from "../settings-layout";
import { LibraryRowMenu } from "./library-row-menu";

function pluralize({ count, noun }: { count: number; noun: string }) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function contributionChips(plugin: LibraryPlugin): string[] {
  return [
    plugin.hooks > 0 ? pluralize({ count: plugin.hooks, noun: "hook" }) : null,
    plugin.tools > 0 ? pluralize({ count: plugin.tools, noun: "tool" }) : null,
    plugin.promptFragments > 0
      ? pluralize({ count: plugin.promptFragments, noun: "prompt fragment" })
      : null,
  ].filter((chip): chip is string => chip !== null);
}

export function PluginRow({
  plugin,
  onToggle,
  onConfigure,
  onUninstall,
}: {
  plugin: LibraryPlugin;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onUninstall: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
        {plugin.name.charAt(0)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {plugin.name}
          <Mono className="text-muted-foreground">v{plugin.version}</Mono>
        </div>
        <p className="text-sm text-muted-foreground">{plugin.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {contributionChips(plugin).map((chip) => (
            <Badge key={chip} variant="outline">
              {chip}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <Switch
          aria-label={`Enable ${plugin.name}`}
          checked={plugin.enabled}
          onCheckedChange={onToggle}
        />
        <LibraryRowMenu
          label={plugin.name}
          actions={[
            { label: "Configure", onSelect: onConfigure },
            { label: "Uninstall", onSelect: onUninstall, destructive: true },
          ]}
        />
      </div>
    </div>
  );
}
