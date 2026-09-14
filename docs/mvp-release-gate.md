# MVP Release Gate

The MVP is releasable only when all mandatory gates pass.

## Mandatory gates

1. Golden set
   - At least 95% pass rate across the approved golden question set.
   - Any critical safety or no-evidence case must pass 100%.

2. No-evidence behavior
   - Unsupported questions return evidence_status=no_evidence.
   - No sources are returned for no-evidence answers.
   - Confidence is 0 for no-evidence answers.

3. Citation integrity
   - Every displayed source must be cited in the answer.
   - Every citation must resolve to returned source metadata.
   - Source IDs, version IDs, chunk IDs, and locations must come from active D1 records.

4. Retrieval relevance
   - Retrieved evidence must materially support the question.
   - Weakly related chunks must not be displayed as supporting sources.

5. Conflict handling
   - When approved sources materially disagree, evidence_status=conflict.
   - The answer must surface the disagreement instead of silently choosing a side.

6. Channel parity
   - Web, Telegram, and direct API must use the same Agent Core and central knowledge base.
   - Evidence status and source semantics must remain consistent across channels.

7. Reliability
   - Production p95 response latency target: under 8 seconds for the MVP test set.
   - CI, Worker deploy, and Website deploy must be green.

## Current baseline — 2026-09-14

- Initial live golden set: 6/6 passed.
- Pass rate: 100%.
- p95 latency: 4.266 seconds.
- No-evidence test: passed.
- Source display was tightened so only sources actually cited by the generated answer are returned to clients.

## Remaining before final Phase 7 close

- Add explicit hallucination-focused cases.
- Add a real conflicting-source case after at least two active sources cover the same claim.
- Expand retrieval relevance judgments beyond source-level checks to chunk-level support.


## Scope note
- Shared GPT is deferred by product decision and is not a current MVP release blocker.
- Its readiness artifacts remain preserved for later activation.
