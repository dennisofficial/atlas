# Prompt authoring

Use concise, affirmative instructions: say what the agent should do.
Keep each rule in one place. Put tool mechanics in tool contracts and corrective
instructions in refusals. Load task-specific procedures through skills.

Reserve the system prompt for stable behavior and high-level Atlas concepts.
Deliver changing directory, worktree, execution, and process facts through runtime
context so transitions preserve the cached conversation prefix.

Check each implementation claim against the code before adding or changing it.
Test applicability, current-state accuracy, and prefix stability across transitions.
Keep prompt tests focused on these contracts rather than copying whole essays.
