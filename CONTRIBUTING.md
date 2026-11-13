# Contributing

Thanks for your interest in Baguette!

## Early stage project

Baguette is in early development. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges, missing abstractions, and areas that need polish. Contributions are welcome, but please keep this context in mind: we prioritize correctness and simplicity over clever engineering.

## How to contribute

- **Bug reports** — Open an issue with steps to reproduce and what you expected to happen.
- **Feature requests** — Open an issue describing the use case before writing code. This avoids wasted effort on things that don't fit the project's direction.
- **Pull requests** — Keep PRs small and focused. One thing per PR. If you're making a larger change, open an issue first to discuss the approach.

## Development setup

See the [README](README.md) for prerequisites and setup instructions.

```bash
npm install
cp .env.example .env   # fill in your credentials
npm run migrate
npm run dev
```

### Live agent-SDK integration tests

Optional **live agent-SDK tests** (`*.live.test.js`) call a real model and skip unless set. Copy the `SDK_TESTS_*` block from `.env.example` (Claude / Cursor / Pi keys + model; `SDK_TESTS_MOCK=1` for the mock SDK). Do not set them in CI unless you intend to pay for those calls. The `agents-integration-test` Baguette task runs Pi, Claude, and Cursor live tests on cheap OpenCode Go / Cursor models using those secrets.

## Code style

- No framework, no unnecessary abstraction. Keep it simple.
- Run the linter before submitting: `npm run lint` (or `npm run lint:ci` to match CI, including unused-export checks)
- A Husky pre-commit hook runs Prettier on staged files (installed automatically by `npm install`). Skip it with `git commit --no-verify` if needed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
