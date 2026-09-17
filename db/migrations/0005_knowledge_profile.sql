-- Phase 9: knowledge coverage map + version-aware knowledge change tracking

CREATE TABLE IF NOT EXISTS source_version_domains (
  version_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  domain_label TEXT NOT NULL,
  evidence_chunk_count INTEGER NOT NULL DEFAULT 0,
  sample_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  sample_sections_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, domain_id),
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_version_domains_source
  ON source_version_domains(source_id, version_id);

CREATE INDEX IF NOT EXISTS idx_source_version_domains_domain
  ON source_version_domains(domain_id, version_id);

CREATE TABLE IF NOT EXISTS knowledge_changes (
  change_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  previous_version_id TEXT,
  version_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  added_chunk_count INTEGER NOT NULL DEFAULT 0,
  removed_chunk_count INTEGER NOT NULL DEFAULT 0,
  unchanged_chunk_count INTEGER NOT NULL DEFAULT 0,
  added_domains_json TEXT NOT NULL DEFAULT '[]',
  removed_domains_json TEXT NOT NULL DEFAULT '[]',
  sample_added_json TEXT NOT NULL DEFAULT '[]',
  sample_removed_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, version_id),
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_changes_created
  ON knowledge_changes(created_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_changes_source
  ON knowledge_changes(source_id, created_at);
