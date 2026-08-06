-- Agent-reported hardware/system metrics (cpu, ram, disks, uptime).
-- Additive, non-destructive.
ALTER TABLE "computers" ADD COLUMN "metrics" JSONB;
ALTER TABLE "computers" ADD COLUMN "metricsAt" TIMESTAMP(3);
