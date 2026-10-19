-- Market Intelligence evidence tables (additive). CreateDate: 2026-09-26

CREATE TABLE "market_intelligence_documents" (
    "id" TEXT NOT NULL,
    "instrument_id" TEXT,
    "symbol" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT 'NSE',
    "asset_class" TEXT NOT NULL DEFAULT 'EQUITY',
    "source_type" TEXT NOT NULL,
    "evidence_kind" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "published_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "content_hash" TEXT,
    "parser_version" TEXT,
    "raw_reference" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_intelligence_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_intelligence_facts" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "instrument_id" TEXT,
    "symbol" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT 'NSE',
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "sources_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_intelligence_facts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_intelligence_events" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "event_id" TEXT,
    "instrument_id" TEXT,
    "symbol" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT 'NSE',
    "event_type" TEXT NOT NULL,
    "headline" TEXT,
    "category" TEXT,
    "sentiment_label" TEXT,
    "sentiment_score" DOUBLE PRECISION,
    "relevance" DOUBLE PRECISION,
    "published_at" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_intelligence_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_intelligence_source_links" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "source_doc_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_intelligence_source_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "market_intelligence_documents_symbol_venue_available_at_idx" ON "market_intelligence_documents"("symbol", "venue", "available_at");
CREATE INDEX "market_intelligence_documents_evidence_kind_available_at_idx" ON "market_intelligence_documents"("evidence_kind", "available_at");
CREATE INDEX "market_intelligence_documents_content_hash_idx" ON "market_intelligence_documents"("content_hash");

CREATE INDEX "market_intelligence_facts_symbol_metric_available_at_idx" ON "market_intelligence_facts"("symbol", "metric", "available_at");
CREATE INDEX "market_intelligence_facts_available_at_idx" ON "market_intelligence_facts"("available_at");

CREATE INDEX "market_intelligence_events_symbol_event_type_available_at_idx" ON "market_intelligence_events"("symbol", "event_type", "available_at");
CREATE INDEX "market_intelligence_events_event_id_idx" ON "market_intelligence_events"("event_id");
CREATE INDEX "market_intelligence_events_available_at_idx" ON "market_intelligence_events"("available_at");

CREATE INDEX "market_intelligence_source_links_document_id_idx" ON "market_intelligence_source_links"("document_id");

ALTER TABLE "market_intelligence_facts" ADD CONSTRAINT "market_intelligence_facts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "market_intelligence_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "market_intelligence_events" ADD CONSTRAINT "market_intelligence_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "market_intelligence_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "market_intelligence_source_links" ADD CONSTRAINT "market_intelligence_source_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "market_intelligence_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
