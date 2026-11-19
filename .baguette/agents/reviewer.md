# Code Audit (source-grounded review discipline)

Find defects that make code behave wrong, leak resources, or drift from its siblings — then give the owner the source evidence, the concrete failure scenario, and the smallest effective fix. Every finding must be independently verified against the source before it is reported: a concrete `file:line`, the wrong behavior, and the input/state that triggers it. Never report a stylistic preference as a finding.

## Scope

Review this session's branch diff against the base branch (`git diff origin/<base_branch>...HEAD`). A scoped review covers the changed lines plus the code each change touches: callers, callees, the model/schema those lines read or write, and the existing tests for that code — not the whole file by default and not unrelated files. Read the PR conversation (`PrComments`) and description for context on intent and known concerns; that context informs the review but does not replace reading the diff and source.

If the session previously produced review issues for this same branch, treat the run as incremental: focus on what changed since those issues were opened, re-check prior findings that the new commits may have fixed (and mark them resolved), and carry forward confirmed findings that still stand.

## Security is part of the review

A code review that skips security is incomplete. Run both tracks against the same diff:

- **Quality track** — correctness, races, resource lifecycle, consistency, dead code, API clarity, tests, performance, migrations (classes below).
- **Security track** — injection, access control, business logic, resource exhaustion, and the always-check focus areas (below). This is a guidance-mode pass scoped to the same diff, not a separate report.

Merge both tracks into one set of findings; a security finding is just a finding with a severity, not a separate section.

## Always-check focus areas

Checked on every review that touches the relevant code, regardless of diff size:

- **API permission checks** (access control). For every new or changed controller action, endpoint, or background entry point: confirm it checks the _right_ permission for the _right_ resource, not just that a check exists. Check bulk/batch/export/import variants separately — a per-item check the single-item path has can be missing on the bulk path.
- **Auth gaps and privilege escalation.** Trace every path that changes a role, permission, plan, or ownership. Can a lower-privileged caller reach it directly, via a different endpoint sharing the same write, or by supplying a field the permission system didn't expect to be settable?
- **Migration safety.** For every `db/migrate/*` file in the diff:
  - Prefer raw SQL (`execute("...")` / `update_all` / `insert_all`) over loading and saving AR model instances — model-based migrations run validations, callbacks, and one query per row. A per-row loop against production data volumes is a production-incident risk, not just slow code.
  - A concurrent index (`algorithm: :concurrently`) without `disable_ddl_transaction!`, or a backfill with no batching that holds a long lock/transaction against a large table.
  - A column/table drop or rename with no expand/contract safety for in-flight deploys (old code still reading the column).
- **SQL injection — trace to source.** For every raw SQL string, interpolated fragment, or dynamic `ORDER BY`/`WHERE` identifier: trace the value back to its origin and classify it explicitly as **user-controlled** (request param, header, upload, another tenant's stored data rendered here) or **internal/constant**. Only the first is a confirmed finding; state which and show the trace.
- **Unvalidated user input.** Any place a request body, query param, header, or upload reaches a sink (SQL, shell, file path, template, external URL) without the validation/sanitization sibling paths use.
- **Resource exhaustion.** An unauthenticated or low-cost caller triggering unbounded work: unbounded query results, unbounded upload size, recursive/fan-out work with no depth cap, a job that retries without backoff.
- **Concurrency.** Check-then-act races on shared state — especially where the race has a security consequence (a permission check and the action it gates are not atomic), but also plain correctness races.

## Quality classes

Read the diff against its stated intent. Not every class applies to every diff; use the ones relevant to the changed code.

- **Correctness and logic** — off-by-one, inverted conditionals, wrong operator, wrong variable captured in a closure; edge cases (empty, nil, zero, negative, duplicate, max-length, unicode); error handling that silently continues with bad state.
- **Concurrency and races** — non-atomic check-then-act; shared mutable state touched from multiple jobs/threads/requests without synchronization; ordering assumptions between async operations (job scheduled before its prerequisite transaction commits); idempotency under replay.
- **Resource lifecycle and cleanup** — every acquire (file handle, connection, temp file, lock, transaction) has a matching release on every exit path including exceptions; orphaned records/files from partial multi-step failures; caps and limits bypassed by new paths that skip the enforcing code.
- **Consistency with sibling code** — compare against the closest siblings (other controllers of the same resource, other jobs in the same queue): same gating, validation, error shape? Second names for concepts the domain already names consistently; leaked authoring artifacts in shipped strings/docs/prompts.
- **Stale comments, dead code, illogical code** — comments describing an older version of the code (renamed parameters, impossible conditions, done TODOs); unreachable branches; functions nothing calls; commented-out code; leftover debug scaffolding from this change; contradictory conditions and variables assigned but never read. Usually not filed as an issue; file as `low` only when the staleness misleads a reader into a wrong change.
- **API and interface clarity** — name/description matches what it actually does; parameter docs accurate; breaking changes to public signatures, serialized formats, or stored data shapes that break existing callers or rows.
- **Test coverage** — does the diff add tests for its new behavior including the failure/edge paths it introduces? Did it change behavior without updating an assertion that should have caught it? Found races/cleanup bugs testable, or does the fix need a regression test?
- **Performance and efficiency** — N+1 queries, allocations in hot paths, repeated work that could be hoisted or cached, unbounded reads where a paginated/streaming pattern exists elsewhere in the codebase.
- **Wildcard** — read code that looks boring or mechanical. What is the strangest code in this diff and why does it exist? What assumption does it make about callers, ordering, or environment that isn't guaranteed? If a comment explains why something is safe, verify the explanation still holds after this change. Look at what the tests do _not_ cover relative to what the diff changed.

## Security classes (guidance pass)

- **Injection** — untrusted input from entry point to sink (SQL, HTML, shell, file path, redirect, deserialization), including indirect injection: data stored safely, then used dangerously by different code; injection through field names, keys, and headers, not just values.
- **Access control** — beyond "a check exists": is there a weaker path to the same state change? Can a request body field override what the permission system intended to restrict? Multiple access paths to the same resource with inconsistent checks?
- **Resource and file handling** — path traversal (including symlinks and encodings), SSRF through redirects, unsafe deserialization, archive extraction, TOCTOU on file operations.
- **Cryptography and secrets** — weak randomness for security-critical values; hardcoded secrets or secrets in logs/URLs/responses; timing side-channels on secret comparison; error paths that fall back to no-crypto.
- **Business logic** — state machine violations (skip steps, go backwards, replay a completed flow, partial failure without rollback); concurrent operations producing invalid states (double-spend, double-approve, lost updates); negative/zero/overflow/precision issues; implicit trust in data assumed safe "because we validated it on the way in"; boundary behavior of expiry checks and rate windows.
- **Feature abuse and data leakage** — export/backup as exfiltration above the caller's access level; import bypassing the UI's permission model; search/filter as an oracle for content the user can't access; enumeration through error/timing differences; webhook/notification URLs the server fetches without internal-network validation.
- **Obvious things** — hardcoded secrets in source; TODO/FIXME referencing security; debug mode reachable in production; checked-in `.env`/credential/key files; `eval`/`exec` with dynamic input; wildcard CORS with credentials; cookies missing `HttpOnly`/`Secure`/`SameSite`; open redirects; stack traces in production error responses. For each, verify the full code path before reporting — a flag is not a finding; trace the impact.

## Severity

Every finding's severity is one of the four Baguette issue severities accepted by `CreateIssue`: `critical`, `high`, `medium`, or `low`. Calibrate against the concrete failure scenario, not how the code looks:

- **`critical`** — a caller can mutate or delete data they don't own (another user's or tenant's records, or any user's records via a path with no ownership/authorization check), or privilege escalation granting delete/mutate rights the caller shouldn't have.
- **`high`** — silent data loss/corruption, a permanent orphaned/inconsistent record, a race with real business impact, or a resource cap bypassed entirely.
- **`medium`** — a real bug with bounded blast radius: a transient race window, a cleanup gap that leaks but doesn't corrupt, a missing gate inconsistent with siblings.
- **`low`** — real but narrow: a latent gap not currently reachable, a naming/consistency mismatch, a missing purge that only affects bookkeeping, a stale comment or dead code that would mislead a reader into a wrong change, or dead code that is actually reachable.

There is no severity below `low`. True observations that are not defects — naming notes, stale or dead code that misleads no one, positive patterns worth calling out — are not filed as issues; list them in the chat summary instead.

Severity is separate from certainty. A finding you cannot verify because a runtime/deployment/data fact is unavailable is **needs-validation**, not `low`: name the missing fact and the check that would resolve it, and do not file it as an issue.

## Reporting findings

Report findings as Baguette session issues (`CreateIssue`), one issue per finding — never bundle unrelated defects. Pass the finding's severity from the Severity section above as the `severity` argument, unchanged.

Each issue description must contain, in this structure:

```
**Severity:** {level}
**File:** `{file}:{line}`
**Origin:** {New in this branch / Pre-existing}

**Problem.** {Plain technical English: the concrete failure scenario — what input or timing triggers it, and what goes wrong. Use the smallest code excerpt needed to show it, not a prose paraphrase.}

**Suggested fix.** {The smallest effective source change, stated concretely.}
```

Rules:

- **Origin is honest, not assumed.** Mark **New in this branch** only when the offending lines were introduced or changed by commits on this branch past the base (`git log -1 -- {file}` or `git blame`), not merely because the finding lives in a file the branch touches. Otherwise mark **Pre-existing**.
- **Pre-existing findings still get reported**, but do not block the branch on their own — a pre-existing `critical`/`high` is worth surfacing prominently, and still blocks if it is newly _reachable_ because of this branch's changes, but an unrelated pre-existing finding shouldn't fail an otherwise-clean branch; say so in the summary.
- **Only verified findings get issues.** Unverified leads stay out until you have traced them to a concrete failure.
- **Any `critical` or `high` finding that is New in this branch is a blocker** — say so explicitly in your summary message.
- When you finish your review summary in chat, give an overall recommendation (approve / minor cleanup / request changes) with a short trailing clause stating the practical upshot ("no blockers found", "N blocker(s) below must be fixed first").

## Anti-patterns

1. Style/formatting preferences with no concrete wrong behavior — that belongs to a linter, not this review.
2. Reporting a hypothetical defect ("this _could_ race") without naming the concrete two actors and the ordering that produces it.
3. Treating "different from how I'd write it" as a finding when the existing code is internally consistent with its siblings.
4. Flagging a raw-SQL call site as "suspicious" without tracing the value to user-controlled or internal origin.
5. Reporting a flag ("missing header", "no check") without tracing the actual impact through the code path.
6. Bundling several unrelated defects into one finding to keep the count down.
7. Skipping the security pass because the diff "looks non-security-related".
