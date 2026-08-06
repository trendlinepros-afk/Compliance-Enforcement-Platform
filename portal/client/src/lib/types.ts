export type Role = 'ADMIN' | 'TECH';
export type Mechanism = 'REGISTRY_POL' | 'SECEDIT' | 'AUDITPOL';
export type AssignmentScope = 'TENANT' | 'GROUP' | 'COMPUTER';
export type CommandType =
  | 'APPLY_POLICY'
  | 'REAUDIT'
  | 'UPDATE_NOW'
  | 'UNINSTALL'
  | 'ROLLBACK'
  | 'PAUSE_ENFORCEMENT'
  | 'RESUME_ENFORCEMENT';

export interface Me {
  id: string;
  username: string;
  role: Role;
}

export interface User {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  enforcementPaused: boolean;
  createdAt: string;
  computerCount: number;
  onlineCount: number;
  policyCount: number;
  groupCount: number;
  avgCompliance: number | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  enrollToken: string;
  enforcementPaused: boolean;
  createdAt: string;
  publicUrl: string;
}

export interface ComplianceSummary {
  total: number;
  compliant: number;
  percent: number | null;
  lastCheckedAt: string | null;
}

export interface Computer {
  id: string;
  hostname: string;
  ipAddresses: string[];
  osName: string;
  osVersion: string;
  osBuild: string;
  agentVersion: string;
  lastSeenAt: string | null;
  online: boolean;
  status: 'ACTIVE' | 'DECOMMISSIONED';
  enforcementPaused: boolean;
  tenantEnforcementPaused: boolean;
  groups: { id: string; name: string }[];
  latestSnapshot: { id: string; createdAt: string } | null;
  compliance: ComplianceSummary | null;
  effectivePolicyNames: string[];
  effectiveSettingCount: number;
  policyUpToDate: boolean;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  members: { id: string; hostname: string; status: string }[];
  assignments: { id: string; priority: number; policy: { id: string; name: string } }[];
}

export interface FrameworkBadge {
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedValue: unknown;
  control: { controlId: string; title: string; framework: { key: string; name: string } };
}

export interface Setting {
  id: string;
  key: string;
  category: string;
  name: string;
  description: string;
  riskNote: string;
  mechanism: Mechanism;
  scope: 'MACHINE' | 'USER';
  registryHive?: string | null;
  registryKey?: string | null;
  registryValueName?: string | null;
  registryValueType?: string | null;
  seceditArea?: string | null;
  seceditKey?: string | null;
  auditSubcategory?: string | null;
  auditGuid?: string | null;
  dataType: string;
  allowedValues?: { value: unknown; label: string }[] | null;
  defaultValue: unknown;
  minBuild?: number | null;
  cisRef?: string | null;
  isSeeded: boolean;
  needsDescription: boolean;
  controlMaps?: FrameworkBadge[];
}

export interface PolicyListItem {
  id: string;
  type: 'GLOBAL' | 'SUB';
  tenantId: string | null;
  name: string;
  description: string;
  isSeeded: boolean;
  seedKey: string | null;
  clonedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { settings: number; assignments: number };
}

export interface PolicySettingRow {
  id: string;
  settingId: string;
  value: unknown;
  enabled: boolean;
  setting: Setting;
}

export interface PolicyDetail extends PolicyListItem {
  settings: PolicySettingRow[];
  assignments: AssignmentRow[];
}

export interface AssignmentRow {
  id: string;
  scope: AssignmentScope;
  priority: number;
  policyId: string;
  groupId: string | null;
  computerId: string | null;
  policy?: { id: string; name: string; type: string };
  group?: { id: string; name: string } | null;
  computer?: { id: string; hostname: string } | null;
}

export interface AuditResultRow {
  settingId: string;
  setting: { id: string; key: string; name: string; category: string; description: string; riskNote: string; mechanism: Mechanism };
  currentValue: unknown;
  requiredValue: unknown;
  compliant: boolean;
  checkedAt: string;
}

export interface DriftRow {
  id: string;
  beforeValue: unknown;
  afterValue: unknown;
  remediatedAt: string;
  setting: { key: string; name: string; category: string };
  computer?: { id: string; hostname: string; tenant?: { id: string; name: string } };
}

export interface SnapshotRow {
  id: string;
  sizeBytes: number;
  sha256: string;
  note: string;
  createdAt: string;
  computer?: { id: string; hostname: string; status: string };
}

export type CommandStatus = 'PENDING' | 'DELIVERED' | 'ACKED' | 'FAILED';

export interface DeploymentComputerImpact {
  computerId: string;
  hostname: string;
  currentValue: unknown;
}

export interface DeploymentSettingRow {
  settingId: string;
  key: string;
  name: string;
  category: string;
  description: string;
  riskNote: string;
  mechanism: string;
  requiredValue: unknown;
  nonCompliantCount: number;
  computers: DeploymentComputerImpact[];
}

export interface DeploymentPlan {
  requireApproval: boolean;
  totalComputers: number;
  pendingComputers: number;
  affectedComputers: number;
  auditedComputers: number;
  settings: DeploymentSettingRow[];
  lastCheckedAt: string | null;
}

export interface CommandRow {
  id: string;
  type: CommandType;
  payload: unknown;
  status: CommandStatus;
  error: string;
  createdBy: string;
  createdAt: string;
  deliveredAt: string | null;
  ackedAt: string | null;
}

export interface AgentRelease {
  id: string;
  version: string;
  source: 'GITHUB_URL' | 'UPLOADED';
  url: string | null;
  sha256: string;
  notes: string;
  isLatest: boolean;
  createdAt: string;
}

export interface EffectivePolicyEntry {
  settingKey: string;
  settingName: string;
  mechanism: Mechanism;
  scope: string;
  desiredValue: unknown;
  sourcePolicyName: string;
  sourceScope: AssignmentScope;
  registry?: { hive: string; key: string; valueName: string; valueType: string };
  secedit?: { area: string; key: string };
  audit?: { subcategory: string; guid: string };
}

export interface EffectivePolicyDoc {
  policyHash: string;
  generatedAt: string;
  entries: EffectivePolicyEntry[];
}

export interface DashboardData {
  tenantCount: number;
  computerCount: number;
  onlineCount: number;
  policyCount: number;
  avgCompliance: number | null;
  latestAgentVersion: string | null;
  outdatedAgentCount: number;
  worstComputers: { id: string; hostname: string; tenant: { id: string; name: string }; percent: number | null }[];
  recentDrift: DriftRow[];
}

export interface Framework {
  id: string;
  key: string;
  name: string;
  version: string;
  description: string;
  _count?: { controls: number };
}
