import type { CSSProperties, ReactNode } from "react";

export type ChatRole = "user" | "agent" | "harness";

export interface ChatAttachment {
  kind: "file" | "skill" | "image";
  label: string;
}

export interface ChatBubbleProps {
  role?: ChatRole;
  children?: ReactNode;
  attachments?: ChatAttachment[];
  takeBack?: boolean;
  author?: string;
  timestamp?: string;
  streaming?: boolean;
  style?: CSSProperties;
}

const ATTACHMENT_GLYPH: Record<ChatAttachment["kind"], string> = {
  file: "⬚",
  skill: "◆",
  image: "▣",
};

function AgentBubble({
  children,
  author,
  timestamp,
  streaming,
  style,
}: ChatBubbleProps) {
  return (
    <article className="flex min-w-0 gap-4" style={style}>
      <span className="w-[14px] shrink-0 text-center font-mono text-sm leading-5 text-primary">
        ⏺
      </span>
      <div className="min-w-0 flex-1">
        {author || timestamp ? (
          <div className="mb-1 flex items-baseline gap-4">
            {author ? (
              <span className="text-xs font-medium text-meta">{author}</span>
            ) : null}
            {timestamp ? (
              <span className="font-mono text-xs text-hint">{timestamp}</span>
            ) : null}
          </div>
        ) : null}
        <div className="text-base text-pretty text-secondary-foreground">
          {children}
          {streaming ? (
            <span
              aria-hidden
              className="ml-1 inline-block h-[1.05em] w-0.5 translate-y-0.5 animate-[atlas-caret-pulse_1s_var(--ease-standard)_infinite] bg-caret"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function HarnessBubble({ children, style }: ChatBubbleProps) {
  return (
    <article
      className="flex min-w-0 items-center gap-4 rounded-md bg-band-agent px-5 py-3 text-base leading-[18px] text-band-agent-foreground"
      style={style}
    >
      <span className="shrink-0 font-mono text-xs">✻</span>
      <span className="min-w-0 flex-1">{children}</span>
    </article>
  );
}

function UserBubble({
  children,
  attachments = [],
  takeBack,
  style,
}: ChatBubbleProps) {
  return (
    <article
      className="min-w-0 overflow-hidden rounded-r-md border-l-2 border-primary bg-bubble-user"
      style={style}
    >
      <div className="flex items-start gap-4 px-6 py-4">
        <div className="min-w-0 flex-1 text-base text-pretty text-bubble-user-foreground">
          {children}
        </div>
        {takeBack ? (
          <span className="shrink-0 font-mono text-xs leading-5 text-hint">
            ↑ to edit
          </span>
        ) : null}
      </div>
      {attachments.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border bg-bubble-user-band px-6 py-3">
          {attachments.map((attachment, i) => (
            <span
              key={i}
              className="inline-flex h-[18px] items-center gap-2 rounded-xs bg-selected px-3 font-mono text-xs text-secondary-foreground"
            >
              <span>{ATTACHMENT_GLYPH[attachment.kind]}</span>
              {attachment.label}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ChatBubble({ role = "user", ...props }: ChatBubbleProps) {
  if (role === "agent") return <AgentBubble {...props} />;
  if (role === "harness") return <HarnessBubble {...props} />;
  return <UserBubble {...props} />;
}
