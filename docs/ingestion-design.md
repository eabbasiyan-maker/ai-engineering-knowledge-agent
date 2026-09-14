# Ingestion Design v1

## Goal
Allow a source to be added, updated, disabled, archived, replaced, and re-indexed without redeploying Website, Telegram, GPT, or the Agent API.

## Systems of record
- Original source: Google Drive
- Source catalog and lifecycle: D1
- MVP operational chunk text: D1\n- Optional derivative mirror: R2 (when activated)
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


## Free-tier execution decision

Cloudflare Workers Free currently has a very small CPU budget per request, so heavy PDF/EPUB parsing and chunk construction must not be coupled to the public Worker request path.

The MVP ingestion flow is therefore split into two parts:

```text
Private source file
   -> local/CI preparation tool
      -> extract PDF/EPUB
      -> preserve headings where possible
      -> semantic-ish chunking
      -> SHA-256 hashes
      -> prepared JSON (local only; gitignored)

Prepared JSON
   -> Admin Worker API in batches
      -> Workers AI embeddings
      -> R2 derivative chunk storage
      -> D1 catalog/chunk metadata
      -> Vectorize upsert
      -> activate version after validation
```

Repository tools:
- `scripts/prepare-source.mjs`
- `scripts/upload-prepared.mjs`

No raw PDF/EPUB and no prepared chunk payload is committed to GitHub.

### Format strategy
- PDF: prepared locally with PDF.js.
- EPUB: unpacked locally, spine order is read from the EPUB package document, XHTML is normalized to lightweight Markdown/text, then chunked.
- Cloudflare Markdown Conversion can be used later for PDF/HTML/XML/Office formats, but EPUB is not currently a supported direct input format.

### Runtime status semantics
Disabling or archiving a source updates D1 immediately. Search always re-checks current D1 source/version/chunk status after Vectorize returns candidates, so stale vectors cannot make a disabled source eligible for LLM context.


## R2 activation fallback decision — 2026-09-14

Live provisioning exposed a real account-level blocker: R2 requires subscription activation on the target Cloudflare account.

To preserve the zero-cost/no-surprise-billing MVP goal, R2 is no longer mandatory for Phase 2.

For the MVP:
- D1 stores chunk text and metadata.
- Vectorize stores only the semantic index.
- Google Drive remains the master source store.
- R2 is optional and can later mirror processed derivatives after activation.

This is viable for the current library because D1 Free supports up to 500 MB per database and 5 GB total account storage, while individual rows may be up to 2 MB. Our chunk sizes are far below the row limit.

Migration for the already-created database:
- `db/migrations/0002_d1_text_store.sql`

After migration, Phase 2 can continue without R2:
```text
Google Drive
  -> local PDF/EPUB preparation
  -> Worker batch upload
  -> D1 chunk text + metadata
  -> Workers AI embeddings
  -> Vectorize
```
