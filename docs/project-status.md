# Project Status

**Date:** 2026-09-14

## Completed phases
- Phase 0 — Architecture & Governance ✅
- Phase 1 — Source Registry ✅

## Active phase
**Phase 2 — Dynamic Library & Ingestion**

Status: **IN PROGRESS — deployed, BOOK-002 lifecycle validation reached version swap, runtime fix committed**

## Live infrastructure
- D1: `ai-knowledge-catalog` ✅
- Vectorize: `ai-knowledge-index` — 1024 dimensions, cosine ✅
- Worker: `https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev` ✅
- ADMIN_TOKEN: configured ✅
- R2: optional for MVP; not activated

## Live data verification
- source catalog seeded: 13 sources ✅
- D1 migration 0002 applied ✅
- `content_text` column present ✅
- health endpoint passed ✅

## BOOK-002 pilot
Prepared from EPUB:
- extracted text: 417,835 characters
- chunks: 194
- chunking: structure-aware heuristic, target ~2600 chars, overlap ~350 chars

Lifecycle results:
- v1 ingest ✅
- active -> searchable ✅
- disabled -> excluded ✅
- re-enabled -> searchable ✅
- v2 ingest ✅
- version swap search ❌ initially failed

## Root cause found
The version swap exposed a real retrieval bug:
- D1 archived the previous version correctly.
- Prior-version vectors remained in Vectorize.
- Because v1 and v2 content are near-identical, stale v1 vectors could dominate the nearest-neighbor candidate set.
- D1 then rejected those stale candidates, leaving too few current-version results.

## Fix committed
- version activation now requests deletion of stale prior-version vectors from Vectorize
- search candidate pool widened to 100
- D1 remains the final runtime eligibility authority
- search results now include `version_id`

Cloudflare Vectorize deletion is asynchronous, so validation retries are expected immediately after a version swap.

## Definition of Done remaining
1. Pull/redeploy latest runtime fix.
2. Re-complete BOOK-002 v2 to trigger stale-vector cleanup.
3. Confirm v2 searchable.
4. Confirm archived source excluded.
5. Restore BOOK-002 active.
6. Commit/push any remaining validated local deployment config.
7. Close Issue #3 and start Phase 3 — Agent Core.
