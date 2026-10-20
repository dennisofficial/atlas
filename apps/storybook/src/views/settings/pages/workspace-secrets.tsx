import { Mono } from "../settings-layout";
import { CURRENT_USER } from "../../../fixtures/settings";
import { ELibraryScope, WORKSPACE_SECRETS, type LibrarySecret } from "../../../fixtures/settings-library";
import { SecretsView } from "../parts/library-secrets-view";

export function WorkspaceSecretsPage({ initial = WORKSPACE_SECRETS }: { initial?: LibrarySecret[] }) {
  return (
    <SecretsView
      scope={ELibraryScope.Workspace}
      description={
        <>
          Shared values for DL Tech. Project values override these, and a member's personal values
          override both. Manage them from the terminal with{" "}
          <Mono className="rounded bg-muted px-1.5 py-0.5">atlas secrets --workspace</Mono>.
        </>
      }
      sectionDescription="Available to every member's threads."
      initial={initial}
      currentMember={{ name: CURRENT_USER.name, initials: CURRENT_USER.initials }}
    />
  );
}
