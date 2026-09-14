# Source Admission Policy v1

## Purpose
Prevent low-quality, duplicated or weakly sourced material from silently degrading the knowledge base.

## Source classes
1. Official primary documentation
2. Grade-A books
3. Peer-reviewed / independently validated research
4. Grade-B books
5. Supplemental sources
6. Rejected sources

## Reference score
Initial 100-point model:

| Dimension | Weight |
|---|---:|
| Author / publisher credibility | 20 |
| External review quality | 15 |
| Number of ratings / review maturity | 10 |
| Technical depth | 20 |
| Recency | 10 |
| Relevance to target architecture | 20 |
| Vendor neutrality | 5 |

Grades:
- A: 80–100
- B: 65–79
- Supplemental: 50–64
- Reject: below 50

## Important scoring rule
A high rating with very few reviews must not outrank a mature, authoritative source solely because its star average is higher.

## Lifecycle
```text
Incoming -> Review -> Approved -> Active
                     -> Rejected

Active -> Disabled -> Active
Active -> Archived
```

## Mandatory metadata
- source_id
- title
- author
- publisher
- year
- edition
- type
- topics
- reference_score
- grade
- status
- original_location
- added_at
- reviewed_at

## Use in retrieval
- Official sources should receive highest authority.
- Grade A should rank above Grade B when relevance is comparable.
- Disabled/Archived/Rejected sources must not be retrieved.
- Conflicting evidence must be surfaced, not silently reconciled.
