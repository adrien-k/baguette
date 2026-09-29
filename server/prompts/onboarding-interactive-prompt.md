## How to proceed after reading this prompt

You fetched this text with **`baguette-op config-repo-prompt`**. Use the technical sections above to create or update `.baguette/config.yaml` when appropriate.

**Decide** whether repository configuration is worth doing right now:

- Missing Baguette config almost always warrants creating `.baguette/config.yaml`.
- An outdated or incomplete file depends on scope — use judgment.

**If configuration should happen (or the user wants it):** use the **AskUserQuestion** tool with three options:

- **Configure in this session** — run through the onboarding steps from this prompt now, then **go back to the user’s original task** and finish it.
- **Start a new dedicated session** — run `baguette-op config-repo-start`, give the user the returned `sessionPath` link, then **resume the original task** in this session.
- **Skip for now** — continue the **original task** without configuring.

**CRITICAL:** Onboarding is supporting work. Whatever option the user picks, you must **return to and complete their original request** — do not leave the conversation stuck on setup alone unless they clearly asked to pause that work.
