import { PlugZapIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";

export function ConnectGithub({ onConnect }: { onConnect: () => void }) {
  return (
    <Empty className="rounded-xl border border-dashed border-border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>Connect GitHub to continue</EmptyTitle>
        <EmptyDescription>
          Atlas needs your GitHub connection to list repositories and clone the one you choose.
        </EmptyDescription>
      </EmptyHeader>
      <Button onClick={onConnect}>Connect GitHub</Button>
    </Empty>
  );
}
