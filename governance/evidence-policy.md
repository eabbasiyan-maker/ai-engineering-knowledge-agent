# Evidence Policy v1

The agent must distinguish:
- Fact supported by retrieved source
- Claim made by a source
- Model inference
- Unknown / unsupported point

## Answer requirements
1. Use approved knowledge sources before unsupported model knowledge.
2. Cite source title and available chapter/section metadata.
3. Do not invent citations or page references.
4. When evidence is insufficient, say that the knowledge base does not currently support the claim.
5. When reliable sources disagree, present the disagreement.
6. Prefer stronger source classes when relevance is comparable.

## Minimum response evidence fields
- source_id
- title
- section/chapter when available
- source_grade
- confidence

## No-evidence behavior
The default must be:
> The current approved knowledge base does not provide sufficient evidence to answer this confidently.

The model may optionally provide a clearly labeled general explanation only if product policy explicitly enables it.
