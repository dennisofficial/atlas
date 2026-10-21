import { CheckIcon, XIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { BrandMark } from "@dltech/atlas-ui/components/brand-mark";
import { Button } from "@dltech/atlas-ui/components/button";

import type { Integration } from "../../../fixtures/settings-account";
import { Mono, SettingsRow } from "../settings-layout";

export function AccountIntegrationRow({ integration }: { integration: Integration }) {
  const connected = integration.connectedAs !== undefined;

  return (
    <SettingsRow
      media={<BrandMark brand={integration.brand} />}
      title={
        <>
          {integration.name}
          {connected ? (
            <Badge variant="secondary">
              Connected as <Mono>{integration.connectedAs}</Mono>
            </Badge>
          ) : (
            <Badge variant="outline">Disconnected</Badge>
          )}
        </>
      }
      description={integration.description}
      control={
        connected ? (
          <>
            <Button variant="outline" size="sm">
              Configure
            </Button>
            <Button variant="outline" size="sm">
              Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm">Connect {integration.name}</Button>
        )
      }
    >
      <ul className="flex flex-wrap gap-x-5 gap-y-1 pl-12 text-xs">
        {integration.capabilities.map((capability) => (
          <li
            key={capability.label}
            className={
              capability.granted && connected ? "flex items-center gap-1" : "flex items-center gap-1 text-muted-foreground"
            }
          >
            {capability.granted && connected ? (
              <CheckIcon className="size-3.5 text-success" />
            ) : (
              <XIcon className="size-3.5" />
            )}
            {capability.label}
          </li>
        ))}
      </ul>
    </SettingsRow>
  );
}
