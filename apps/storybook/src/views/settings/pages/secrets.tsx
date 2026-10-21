import { Mono } from "../settings-layout";
import { CURRENT_USER } from "../../../fixtures/settings";
import { ELibraryScope, PERSONAL_SECRETS, type LibrarySecret } from "../../../fixtures/settings-library";
import { SecretsView } from "../parts/library-secrets-view";

export function SecretsPage({ initial = PERSONAL_SECRETS }: { initial?: LibrarySecret[] }) {
  return (
    <SecretsView
      scope={ELibraryScope.Personal}
      description={
        <>
          Delivered to your sandboxes as harness secrets. Workspace values apply first, your personal
          values override them, and project values override both. Manage them from the terminal with{" "}
          <Mono className="rounded bg-muted px-1.5 py-0.5">atlas secrets</Mono>.
        </>
      }
      sectionDescription="Only visible to you."
      initial={initial}
      currentMember={{ name: CURRENT_USER.name, initials: CURRENT_USER.initials }}
    />
  );
}
