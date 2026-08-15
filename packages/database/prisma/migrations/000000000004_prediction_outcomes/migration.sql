-- Walk-forward / live scoring of ML advisories.

CREATE TABLE "prediction_outcomes" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "predicted" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "target" DOUBLE PRECISION,
    "stop_loss" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "actual_return" DOUBLE PRECISION,
    "correct" BOOLEAN,
    "predicted_at" BIGINT NOT NULL,
    "scored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prediction_outcomes_horizon_scored_at_idx" ON "prediction_outcomes"("horizon", "scored_at");
CREATE INDEX "prediction_outcomes_symbol_horizon_predicted_at_idx" ON "prediction_outcomes"("symbol", "horizon", "predicted_at");

ALTER TABLE "prediction_outcomes" ADD CONSTRAINT "prediction_outcomes_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "stocks"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;
