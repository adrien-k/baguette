# Repository agent notes

## Troubleshooting agent turns

When a builder or reviewer turn misbehaves (missing tool calls, wrong dispatch, stream errors), inspect the **agent event logs** for that session. Baguette appends one JSONL file per turn with raw SDK events (separate from chat/review UI messages).

- **Repo sessions:** next to the worktree, under `../agent-events/` (the session directory parent). Files are named `chat-<turn_id>.jsonl` or `review-<turn_id>.jsonl`.
- **No worktree yet:** under the server data dir at `agent-events/<session_id>/` (same filename pattern).

Each line is `{ "at": "<iso>", "event": … }`. Use the latest file for the failing turn, or match `turn_id` from `session_messages` when debugging a specific user message.
