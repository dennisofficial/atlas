# Atlas glossary

Use these words in code, prompts, docs and endpoints. A name that means one of these concepts uses
the term below, never a synonym.

## Session

The top-level unit of work the operator opens: one pod, one repository clone, and every thread that
runs in it. The sidebar lists sessions.

_Avoid_: workspace (that is the clone on disk), chat, conversation, run.

## Thread

One agent's conversation inside a session: its messages, tool calls and events, in order. A session
holds one main thread and any number of sub-agent threads.

_Avoid_: conversation, agent conversation, chat, session.

## Main thread

The thread the operator talks to when they open a session. It is created with the session.

## Sub-agent

An agent started by another thread. It runs in its own thread inside the same session and reports
to the thread that started it.

## Teammate

A full session nested under another session. It has its own worktree, its own main thread and its
own sub-agents. The operator can talk to it directly.

## Transcript

The rendered rows a client shows for a thread. A transcript is a view of a thread, not the thread.
