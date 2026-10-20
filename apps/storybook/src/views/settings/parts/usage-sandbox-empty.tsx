import { ServerIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";

export function UsageSandboxEmpty() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ServerIcon />
        </EmptyMedia>
        <EmptyTitle>No sandboxes running</EmptyTitle>
        <EmptyDescription>
          Sandboxes start when a cloud thread needs one and show up here while they run.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
