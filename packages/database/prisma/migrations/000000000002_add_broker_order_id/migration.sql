-- Add brokerOrderId field to Trade table for broker integration

ALTER TABLE "trades" ADD COLUMN "broker_order_id" TEXT;

-- Create unique constraint on brokerOrderId
CREATE UNIQUE INDEX "trades_broker_order_id_key" ON "trades"("broker_order_id");
