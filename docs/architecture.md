# Baseline Architecture v1

## Goal
One central AI Engineering Knowledge Agent served through three interfaces: Website, Telegram and Shared GPT.

## Logical architecture

```text
Website ─┐
Telegram ├──> Agent API / Cloudflare Worker
GPT ─────┘              |
                        +--> Retrieval Policy
                        +--> Source Ranking
                        +--> Guardrails
                        +--> Workers AI
                        |
                        +--> D1 Catalog / Runtime Metadata
                        +--> Vectorize Search Index
                        +--> R2 Processed Artifacts

Google Drive (private)
    |
    +--> Master / Original Books
            |
            +--> 01-Incoming
            +--> 02-Approved
            +--> 03-Archived
```

## Source of truth by data type

| Data | System of record |
|---|---|
| Original source PDFs | Google Drive |
| Code | GitHub |
| Prompts | GitHub |
| Governance policies | GitHub |
| Source catalog/runtime metadata | D1 |
| Extracted operational artifacts | R2 |
| Vector embeddings/index | Vectorize |
| Secrets | Cloudflare Secrets |

## Architectural rules
1. Raw commercial PDFs are never committed to GitHub.
2. Website, Telegram and GPT must not maintain separate knowledge bases.
3. A source can be Active, Disabled or Archived without redeploying the application.
4. Every retrieved chunk must retain source_id and location metadata.
5. Vectorize is an index, not the authoritative knowledge store.
6. Source deletion must remove or disable its corresponding searchable vectors.
7. Unknown or unsupported claims must not be presented as sourced facts.

## Non-functional constraints for MVP
1. **Zero end-user cost:** users must not need a paid account or API key for Website/Telegram access.
2. **No surprise billing:** architecture should remain on free tiers where practical; when a hard quota is reached, fail closed instead of silently incurring spend.
3. **Single knowledge brain:** Web, Telegram and GPT must return from the same backend policy and knowledge state.
4. **Evidence-first:** answers must include source metadata when knowledge is retrieved.
5. **Safe no-evidence behavior:** unsupported questions must not be fabricated.
6. **Admin protection:** library-management endpoints and Admin UI must require authentication even if the public chat is anonymous.
7. **Source privacy:** raw commercial books remain private and are never exposed as public download assets.
8. **Rebuildability:** the vector index must be reproducible from approved source artifacts and catalog metadata.
9. **Updateability:** adding, disabling, archiving or replacing a source must not require a frontend redeploy.
10. **Channel parity:** the same question against the same knowledge state should produce materially consistent answers across Web, Telegram and GPT.

## API baseline

```http
POST /api/v1/ask
```

Example request:

```json
{
  "question": "When should GraphRAG be preferred over standard RAG?",
  "channel": "web"
}
```

Response contract should include:
- answer
- sources
- confidence
- evidence status
- request_id
