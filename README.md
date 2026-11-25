# SentinelGrid

Infrastructure intelligence, security & resilience platform.

**Know what is happening. Prove what changed. Protect what matters.**

Energy/equipment value is the commercial entry; the product end-state includes cyber-physical evidence and AI agent accountability.

## Status

Phase 0 (Platform Foundation) is **in development** — schema and registry foundation only. Not complete until phase-gate evidence passes.

## Stack (Phase 0 foundation)

- PostgreSQL via Supabase
- Versioned SQL migrations under `supabase/migrations/`
- Row Level Security (RLS) for tenant isolation
- Preferred app stack (to be wired): Next.js / NestJS / Go edge connector

## Hierarchy

`Organisation → Facility → Zone → Asset → Device → Sensor`

## Phase 0 entities

Organisations, profiles, memberships, roles/permissions, facilities, zones, assets, devices, sensors, connectors, events (ledger), evidence records/checkpoints, audit logs.

## Local setup

```bash
# Requires Supabase CLI and a linked project
supabase link --project-ref <project-ref>
supabase db push
```

Or apply the SQL in `supabase/migrations/` through the Supabase SQL editor / Management API.

Copy `.env.example` to `.env.local` and fill from your Supabase project settings. Never commit secrets.

## Non-negotiables

- Tenant ID never trusted from the client
- Read-only OT by default (no write-capable industrial paths)
- Simulated / replayed / synthetic data must be labelled in storage and UI
- Evidence hash proves integrity of stored bytes — not sensor truthfulness
- Do not mark a phase COMPLETE without gate evidence

## License

Private until otherwise decided. Collaboration via this public repository for oversight partners as directed by the founder.
