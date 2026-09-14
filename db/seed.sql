-- Phase 1 source catalog seed
-- Private Google Drive file IDs are intentionally not committed.

INSERT INTO sources
(source_id,title,author,publisher,publication_year,source_type,grade,reference_score,status,seed,original_provider,original_folder)
VALUES
('BOOK-001','Building Reliable AI Systems','Rush Shahani','Manning',2026,'book','A',86,'active',1,'google-drive','02-Approved'),
('BOOK-002','Build an AI Agent (From Scratch)','Jungjun Hur; Younghee Song','Manning',2026,'book','A',88,'active',1,'google-drive','02-Approved'),
('BOOK-003','An Illustrated Guide to AI Agents','Maarten Grootendorst; Jay Alammar','O''Reilly Media',2026,'book','A',89,'active',1,'google-drive','02-Approved'),
('BOOK-004','Agentic GraphRAG','Anthony Alcaraz; Sam Julien','O''Reilly Media',2026,'book','A',82,'active',1,'google-drive','02-Approved'),
('BOOK-005','Practical Multi-Agent AI Systems','Murali Kashaboina','Wiley',2026,'book','A',82,'active',1,'google-drive','02-Approved'),
('BOOK-006','Breaking the Model Context Protocol','Thejes sree Satheesh kumar; Srinivasan Sekar','Apress',2026,'book','A',81,'active',1,'google-drive','02-Approved'),
('BOOK-007','The Claude Code Operating Model','Jia Huang','Packt',2026,'book','B',68,'active_secondary',0,'google-drive','02-Approved'),
('BOOK-008','Architecting Production-Ready Gen AI and Agentic AI Systems','Srinivas Bommena','Leanpub',2026,'book','B',72,'active_secondary',0,'google-drive','02-Approved'),
('BOOK-009','Agentic AI in Enterprise','Sumit Ranjan; Divya Chembachere; Lanwin Lobo','Apress',2025,'book','Supplemental',61,'archived',0,'google-drive','03-Archived'),
('BOOK-010','Production-Grade Agentic AI','Ran Aroussi','Automaze Ltd. / Leanpub',2025,'book','B',78,'active_secondary',0,'google-drive','02-Approved'),
('BOOK-011','Design Multi-Agent AI Systems Using MCP and A2A','Gigi Sayfan','Packt',2026,'book','B',76,'active_secondary',0,'google-drive','02-Approved'),
('BOOK-012','Building LLM Agents with RAG, Knowledge Graphs, and Reflection','Mira S. Devlin','Richa Publishing Minds',2025,'book','Supplemental',58,'archived',0,'google-drive','03-Archived'),
('BOOK-013','Building AI-Powered Products','Marily Nika','O''Reilly Media',2025,'book','B',74,'active_secondary',0,'google-drive','02-Approved')
ON CONFLICT(source_id) DO UPDATE SET
  title=excluded.title,
  author=excluded.author,
  publisher=excluded.publisher,
  publication_year=excluded.publication_year,
  grade=excluded.grade,
  reference_score=excluded.reference_score,
  status=excluded.status,
  seed=excluded.seed,
  original_folder=excluded.original_folder,
  updated_at=CURRENT_TIMESTAMP;

DELETE FROM source_topics;

INSERT INTO source_topics (source_id,topic) VALUES
('BOOK-001','reliability'),('BOOK-001','agents'),('BOOK-001','rag'),('BOOK-001','evaluation'),('BOOK-001','production'),
('BOOK-002','agents'),('BOOK-002','tool-use'),('BOOK-002','memory'),('BOOK-002','planning'),('BOOK-002','reflection'),('BOOK-002','rag'),('BOOK-002','multi-agent'),
('BOOK-003','agents'),('BOOK-003','llm-foundations'),('BOOK-003','tools'),('BOOK-003','memory'),('BOOK-003','reasoning'),
('BOOK-004','rag'),('BOOK-004','graphrag'),('BOOK-004','knowledge-graphs'),('BOOK-004','retrieval'),('BOOK-004','agents'),
('BOOK-005','multi-agent'),('BOOK-005','architecture'),('BOOK-005','mcp'),('BOOK-005','security'),('BOOK-005','observability'),
('BOOK-006','mcp'),('BOOK-006','security'),('BOOK-006','prompt-injection'),('BOOK-006','tool-attacks'),('BOOK-006','red-teaming'),
('BOOK-007','coding-agents'),('BOOK-007','skills'),('BOOK-007','subagents'),('BOOK-007','mcp'),('BOOK-007','governance'),
('BOOK-008','architecture'),('BOOK-008','rag'),('BOOK-008','agents'),('BOOK-008','evaluation'),('BOOK-008','governance'),('BOOK-008','finops'),
('BOOK-009','enterprise-ai'),('BOOK-009','agents'),('BOOK-009','governance'),
('BOOK-010','agents'),('BOOK-010','production'),('BOOK-010','memory'),('BOOK-010','observability'),
('BOOK-011','multi-agent'),('BOOK-011','mcp'),('BOOK-011','a2a'),('BOOK-011','python'),
('BOOK-012','agents'),('BOOK-012','rag'),('BOOK-012','knowledge-graphs'),('BOOK-012','reflection'),
('BOOK-013','ai-product'),('BOOK-013','product-management'),('BOOK-013','strategy'),('BOOK-013','metrics');
