# Ingestion Design v1

## Goal
Allow a source to be added, updated, disabled, archived, replaced, and re-indexed without redeploying Website, Telegram, GPT, or the Agent API.

## Systems of record
- Original source: Google Drive
- Source catalog and lifecycle: D1
- Extracted/processed artifacts: R2
- Search index: Vectorize
- Code and policies: GitHub

## Source lifecycle

```text
Incoming
  -> Review
  -> Approved
  -> Active
  -> Disabled
  -> Active

Active -> Archived
Approved/Active -> New Version -> Re-index -> Active
```

## Ingestion job lifecycle

```text
queued
  -> fetching
  -> extracting
  -> structuring
  -> chunking
  -> indexing
  -> validating
  -> completed

Any state -> failed
```

## R2 layout

```text
processed/
  BOOK-001/
    v1/
      manifest.json
      extracted/
        full-text.txt
        structure.json
      chunks/
        CHUNK-000001.txt
        CHUNK-000002.txt
```

The raw commercial book is not copied to R2 in the baseline design. Google Drive remains the private master source. R2 stores operational derivatives only.

## Chunk metadata
Every chunk must retain:
- chunk_id
- source_id
- version_id
- chapter
- section
- heading_path
- chunk_index
- content_hash
- reference grade inherited from the source
- source status
- R2 text key
- vector id

## Retrieval eligibility
A chunk is eligible only when:
1. source.status is active or active_secondary;
2. source version is active;
3. chunk.status is active;
4. vector metadata matches current source/version state.

Archived or disabled sources must be excluded before LLM context building.

## Replace edition
1. Keep old source_id.
2. Create a new version_id.
3. Process and validate new edition.
4. Activate new version.
5. Mark prior version archived.
6. Remove/disable old vectors.
7. Preserve audit history.

## Delete
Hard delete is not the default operation.
Preferred order:
1. Disable
2. Archive
3. Hard delete only when explicitly required

Hard delete must remove:
- D1 chunk records
- Vectorize vectors
- R2 processed artifacts
- version records where policy allows

The original Drive file remains governed separately by the library owner.

## Phase-2 validation
Before Phase 2 closes, test at least:
- add one source
- disable it and confirm no retrieval
- re-enable it
- re-index it
- replace a version
- archive it
