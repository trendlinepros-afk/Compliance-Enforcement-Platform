-- Staged deployment gate + rollback quarantine.
-- Additive, non-destructive: existing rows get the defaults.

-- Per-tenant: hold enforcement until an admin reviews impact and deploys.
ALTER TABLE "tenants" ADD COLUMN "requireDeploymentApproval" BOOLEAN NOT NULL DEFAULT true;

-- Per-computer: the effective-policy hash approved for enforcement on this machine.
ALTER TABLE "computers" ADD COLUMN "approvedPolicyHash" TEXT NOT NULL DEFAULT '';
