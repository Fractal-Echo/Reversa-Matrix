# Agentic Toolchain Fixture

Use AGENTS.md and CLAUDE.md as the authoritative workflow files.
The agentic directive requires read-only validation before destructive work.

Subagent workers must own disjoint files and report through agent_handoff.
Worktree task isolation is required for parallel feature branches.

