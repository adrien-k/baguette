# Baguette repo configuration

The `.baguette.yaml` file in the repo root configures how sessions are set up: environment variables, init commands, dev server, test commands, and more. Without it, `ListProjectCommands` returns nothing and the dev server preview won't work.

If the project has no `.baguette.yaml`, or the config appears incomplete or outdated — for example a test command fails because it isn't listed, the dev server uses a hardcoded port, or a required init step is missing — call **`ConfigRepoPrompt`** before other work, read the returned prompt, and proceed accordingly. That output includes the full `.baguette.yaml` format, onboarding steps, and **how to decide** whether to configure now (including **AskUserQuestions** options). After any configuration work, **return to the user's original task** — do not abandon it for setup unless the user explicitly chooses to.
