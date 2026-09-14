# Delivery Roadmap

## Phase 0 — Architecture & Governance
**Goal:** Lock system boundaries, storage ownership and evidence rules.

Deliverables:
- Baseline architecture
- Source admission policy
- Evidence policy
- Storage ownership map
- Initial backlog

Exit criteria:
- One central Agent API confirmed
- Google Drive selected as master source storage
- GitHub selected for code/governance
- No raw books stored in GitHub

## Phase 1 — Source Registry
**Goal:** Build the initial trusted source catalog.

Deliverables:
- Inventory of available books
- Duplicate detection
- Topic classification
- Reference score
- A / B / Supplemental / Reject classification
- Initial approved seed set

Exit criteria:
- Every candidate source has source_id, score, grade, topics and status
- Seed knowledge set approved

## Phase 2 — Dynamic Library & Ingestion
**Goal:** Add/update/disable/archive/re-index sources without redeploying the agent.

Capabilities:
- Add Source
- Edit Metadata
- Approve / Reject
- Disable
- Archive
- Replace edition
- Re-index

Exit criteria:
- Source lifecycle works end to end
- Disabled sources are excluded from retrieval

## Phase 3 — Agent Core
**Goal:** Evidence-grounded retrieval and answer generation.

Deliverables:
- /api/v1/ask
- Retrieval
- Source ranking
- Context builder
- Answer contract
- Confidence handling
- No-evidence behavior

## Phase 4 — Website MVP
Deliverables:
- Public/shared chat UI
- Sources
- Confidence
- Copy answer
- Feedback

## Phase 5 — Telegram
Deliverables:
- Telegram webhook
- Same Agent API
- Telegram-specific output formatting

## Phase 6 — Shared GPT (Deferred)
Status:
- Deferred by user decision on 2026-09-14
- OpenAPI/privacy/setup artifacts preserved for later activation

Deliverables when resumed:
- GPT Action/OpenAPI schema
- Same Agent API
- No independent GPT knowledge upload

## Phase 7 — Evaluation
Deliverables:
- Golden question set
- Retrieval evaluation
- Citation evaluation
- Hallucination/no-evidence tests
- Conflict-source tests

## Phase 8 — Analytics & Knowledge Gaps
Deliverables:
- Top questions
- Low-confidence answers
- Missing topics
- Channel usage
- Feedback trends

## Phase 9 — Library Curator Agent
Deliverables:
- Suggested topic classification
- Duplicate/overlap estimate
- Source conflict detection
- Suggested reference score
- Human approval remains mandatory

## Phase 10 — Internal Knowledge Platform
Possible future knowledge spaces:
- AI Engineering
- Async
- Chat
- AI Gateway

Each space remains logically isolated while using the same platform.
