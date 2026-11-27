# SentinelGrid shared development workflow

## Canonical working branch

- The single shared working branch for ongoing SentinelGrid implementation is `work/sentinel-command-release-v2`.
- Do not create a parallel feature branch, switch to `main`, or continue work on `work/sentinel-command-integrated` / `work/sentinel-command-ui` unless the user explicitly changes this workflow.
- Do not create or retarget pull requests unless the user explicitly asks. Continue implementation directly on the canonical working branch. Do not merge to `main` or change production infrastructure without an explicit release decision.

## Mandatory sync-before-work protocol

Before inspecting, editing, testing, or committing any code:

1. Run `git status --short --branch` and preserve any uncommitted user work.
2. Run `git fetch origin --prune`.
3. Check out `work/sentinel-command-release-v2`.
4. Run `git pull --ff-only origin work/sentinel-command-release-v2`.
5. Confirm `git rev-parse HEAD` equals `git rev-parse origin/work/sentinel-command-release-v2`.
6. If the working tree is dirty or the branch cannot fast-forward, stop and reconcile; never reset, discard, force-push, or overwrite another agent's work.

The same protocol applies to Cursor, Codex, ChatGPT-connected GitHub edits, and any other implementation agent. The remote branch is the shared source of truth. One agent should finish and push a coherent commit before another agent starts editing the same files.

## Commit and push protocol

- Commit directly to `work/sentinel-command-release-v2` only after syncing.
- Before pushing, fetch again and verify the remote head has not advanced. If it has, rebase/merge safely and rerun relevant tests.
- Never force-push.
- After every push, verify the GitHub branch SHA and the matching Vercel deployment. Do not say a change is live based only on a successful commit or build.
- If Vercel does not automatically build a pushed commit, report the failure and trigger/repair the deployment rather than assuming it is live.

## Validation

- Run the narrow tests for changed packages, then the repository's required quality gate.
- Preserve authentication, tenant isolation, RLS, and energy-intelligence functionality.
- Never invent telemetry, equipment state, physical relationships, or engineering predictions.
- Distinguish a successful preview build from a production release.
