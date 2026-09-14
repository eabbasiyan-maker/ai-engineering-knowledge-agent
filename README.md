# AI Engineering Knowledge Agent

A shared, evidence-first AI engineering knowledge platform with one central knowledge backend and multiple access channels.

## Target channels
- Website
- Telegram
- Shared GPT

## Storage baseline
- Original books / master source files: Google Drive (private)
- Operational extracted artifacts: Cloudflare R2
- Source catalog and runtime metadata: Cloudflare D1
- Vector index: Cloudflare Vectorize
- Code, prompts, governance and tests: GitHub
- LLM runtime: Cloudflare Workers AI
- Backend/API: Cloudflare Workers
- Web/Admin UI: Cloudflare Pages

## Core principle
Website, Telegram and GPT are interfaces only. They must use the same Agent API, retrieval policy, source ranking and knowledge base.

## Evidence policy
Responses should prefer:
1. Official primary documentation
2. Approved Grade-A books
3. Peer-reviewed/validated sources
4. Approved Grade-B books
5. Supplemental sources

When evidence is insufficient or conflicting, the agent must say so explicitly.

## Project phases
See [docs/roadmap.md](docs/roadmap.md).

## Current status
Bootstrap started on 2026-09-14.
