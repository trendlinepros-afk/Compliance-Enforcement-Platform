-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TECH');

-- CreateEnum
CREATE TYPE "ComputerStatus" AS ENUM ('ACTIVE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "Mechanism" AS ENUM ('REGISTRY_POL', 'SECEDIT', 'AUDITPOL');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('MACHINE', 'USER');

-- CreateEnum
CREATE TYPE "MapConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('GLOBAL', 'SUB');

-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('TENANT', 'GROUP', 'COMPUTER');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('APPLY_POLICY', 'REAUDIT', 'UPDATE_NOW', 'UNINSTALL', 'ROLLBACK', 'PAUSE_ENFORCEMENT', 'RESUME_ENFORCEMENT');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACKED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReleaseSource" AS ENUM ('GITHUB_URL', 'UPLOADED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'TECH',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enrollToken" TEXT NOT NULL,
    "enforcementPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "osName" TEXT NOT NULL DEFAULT '',
    "osVersion" TEXT NOT NULL DEFAULT '',
    "osBuild" TEXT NOT NULL DEFAULT '',
    "agentVersion" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "enforcementPaused" BOOLEAN NOT NULL DEFAULT false,
    "status" "ComputerStatus" NOT NULL DEFAULT 'ACTIVE',
    "deviceTokenHash" TEXT,
    "reportedPolicyHash" TEXT NOT NULL DEFAULT '',
    "firstEnforcedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "computers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computer_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "groupId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("groupId","computerId")
);

-- CreateTable
CREATE TABLE "settings_catalog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "riskNote" TEXT NOT NULL DEFAULT '',
    "mechanism" "Mechanism" NOT NULL,
    "scope" "SettingScope" NOT NULL DEFAULT 'MACHINE',
    "registryHive" TEXT,
    "registryKey" TEXT,
    "registryValueName" TEXT,
    "registryValueType" TEXT,
    "seceditArea" TEXT,
    "seceditKey" TEXT,
    "auditSubcategory" TEXT,
    "auditGuid" TEXT,
    "dataType" TEXT NOT NULL DEFAULT 'dword',
    "allowedValues" JSONB,
    "defaultValue" JSONB NOT NULL,
    "minBuild" INTEGER,
    "cisRef" TEXT,
    "isSeeded" BOOLEAN NOT NULL DEFAULT false,
    "needsDescription" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frameworks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_controls" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "framework_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting_control_map" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "recommendedValue" JSONB,
    "confidence" "MapConfidence" NOT NULL DEFAULT 'MEDIUM',

    CONSTRAINT "setting_control_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "type" "PolicyType" NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSeeded" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "clonedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_settings" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "policy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "scope" "AssignmentScope" NOT NULL,
    "groupId" TEXT,
    "computerId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_results" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "currentValue" JSONB,
    "requiredValue" JSONB,
    "compliant" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_events" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "remediatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drift_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "type" "CommandType" NOT NULL,
    "payload" JSONB,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" "ReleaseSource" NOT NULL,
    "url" TEXT,
    "msiBlob" BYTEA,
    "sha256" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_enrollToken_key" ON "tenants"("enrollToken");

-- CreateIndex
CREATE UNIQUE INDEX "computers_deviceTokenHash_key" ON "computers"("deviceTokenHash");

-- CreateIndex
CREATE INDEX "computers_tenantId_idx" ON "computers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "computer_groups_tenantId_name_key" ON "computer_groups"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "settings_catalog_key_key" ON "settings_catalog"("key");

-- CreateIndex
CREATE INDEX "settings_catalog_category_idx" ON "settings_catalog"("category");

-- CreateIndex
CREATE INDEX "settings_catalog_mechanism_idx" ON "settings_catalog"("mechanism");

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_key_key" ON "frameworks"("key");

-- CreateIndex
CREATE UNIQUE INDEX "framework_controls_frameworkId_controlId_key" ON "framework_controls"("frameworkId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "setting_control_map_settingId_controlId_key" ON "setting_control_map"("settingId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "policies_seedKey_key" ON "policies"("seedKey");

-- CreateIndex
CREATE INDEX "policies_tenantId_idx" ON "policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_settings_policyId_settingId_key" ON "policy_settings"("policyId", "settingId");

-- CreateIndex
CREATE INDEX "assignments_tenantId_idx" ON "assignments"("tenantId");

-- CreateIndex
CREATE INDEX "snapshots_computerId_idx" ON "snapshots"("computerId");

-- CreateIndex
CREATE INDEX "audit_results_computerId_compliant_idx" ON "audit_results"("computerId", "compliant");

-- CreateIndex
CREATE UNIQUE INDEX "audit_results_computerId_settingId_key" ON "audit_results"("computerId", "settingId");

-- CreateIndex
CREATE INDEX "drift_events_computerId_idx" ON "drift_events"("computerId");

-- CreateIndex
CREATE INDEX "commands_computerId_status_idx" ON "commands"("computerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_releases_version_key" ON "agent_releases"("version");

-- AddForeignKey
ALTER TABLE "computers" ADD CONSTRAINT "computers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_groups" ADD CONSTRAINT "computer_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "computer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_controls" ADD CONSTRAINT "framework_controls_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_control_map" ADD CONSTRAINT "setting_control_map_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "settings_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_control_map" ADD CONSTRAINT "setting_control_map_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "framework_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_settings" ADD CONSTRAINT "policy_settings_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_settings" ADD CONSTRAINT "policy_settings_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "settings_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "computer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_results" ADD CONSTRAINT "audit_results_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_results" ADD CONSTRAINT "audit_results_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "settings_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "settings_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

