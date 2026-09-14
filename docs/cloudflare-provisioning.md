# Cloudflare Provisioning — Phase 2

This document is the provisioning checklist for the Cloudflare runtime.

## Required resources

- D1 database: `ai-knowledge-catalog`
- R2 bucket: `ai-knowledge-processed`
- Vectorize index: `ai-knowledge-index`
- Workers AI binding: `AI`
- Worker secret: `ADMIN_TOKEN`

## Vector configuration

Embedding model:
`@cf/baai/bge-m3`

Vectorize configuration:
- dimensions: 1024
- metric: cosine

## Wrangler commands

```bash
npx wrangler@latest d1 create ai-knowledge-catalog
npx wrangler@latest r2 bucket create ai-knowledge-processed
npx wrangler@latest vectorize create ai-knowledge-index --dimensions=1024 --metric=cosine
```

After D1 creation, copy its generated database ID into the Worker binding configuration.

## Database initialization

```bash
npx wrangler@latest d1 execute ai-knowledge-catalog --remote --file=db/schema.sql
npx wrangler@latest d1 execute ai-knowledge-catalog --remote --file=db/seed.sql
```

## Secret

Set a random admin token as a Cloudflare Worker secret. Do not commit it to GitHub.

## Bindings expected by code

```text
DB             -> D1
KNOWLEDGE_R2   -> R2
VECTORIZE      -> Vectorize
AI             -> Workers AI
ADMIN_TOKEN    -> secret
EMBEDDING_MODEL -> @cf/baai/bge-m3
```

## Deployment gate

Do not deploy until:
1. D1 ID is known.
2. R2 bucket exists.
3. Vectorize index exists with 1024 dimensions and cosine metric.
4. ADMIN_TOKEN is configured.
5. D1 schema and seed have been applied.

## End-to-end validation

Use one Grade-A source first.

Preferred pilot:
`BOOK-002 — Build an AI Agent (From Scratch)`

Prepare locally:
```bash
npm run prepare -- --file "<path-to-book.epub>" --source BOOK-002 --version v1
```

Upload prepared chunks:
```bash
KNOWLEDGE_ADMIN_TOKEN="<secret>" npm run upload -- --file prepared/BOOK-002-v1.json --api "<worker-url>"
```

Then validate retrieval:
```text
GET /admin/search?q=What is ReAct?
```

Lifecycle validation:
```text
active -> search returns BOOK-002
disabled -> search must not return BOOK-002
active -> search returns it again
reindex new version -> new version active
archive -> search must not return BOOK-002
```
