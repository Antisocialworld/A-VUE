-- ==============================================================================
-- A VUE Migration 009: RAG Chunks (Facts-File Embeddings)
-- Forward-only SQL migration. Idempotent.
--
-- This table holds A VUE facts-file chunks only.
-- TMDB data and any user data must never be stored here.
-- content_digest is BLAKE2s hex of the chunk text, used later to skip unchanged chunks.
-- ==============================================================================

-- 1. Enable pgvector extension (available locally; not yet created)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Rag chunks table
CREATE TABLE IF NOT EXISTS rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL, -- BLAKE2s hex of the chunk text; used later to skip unchanged chunks
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rag_chunks_source_chunk UNIQUE (source_file, chunk_index),
  CONSTRAINT ck_rag_chunks_content_nonempty CHECK (char_length(content) > 0)
);

-- 3. HNSW index on embedding using cosine distance
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

-- 4. Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('009_rag_chunks.sql')
ON CONFLICT (filename) DO NOTHING;
