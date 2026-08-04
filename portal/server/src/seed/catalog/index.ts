import type { SeedEntry } from '../types';
import { accountPolicyEntries } from './accountPolicies';
import { userRightsEntries } from './userRights';
import { securityOptionsEntries } from './securityOptions';
import { auditPolicyEntries } from './auditPolicy';
import { adminTemplatesNetworkEntries } from './adminTemplatesNetwork';
import { adminTemplatesSystemEntries } from './adminTemplatesSystem';

export const allCatalogEntries: SeedEntry[] = [
  ...accountPolicyEntries,
  ...userRightsEntries,
  ...securityOptionsEntries,
  ...auditPolicyEntries,
  ...adminTemplatesNetworkEntries,
  ...adminTemplatesSystemEntries,
];

// Guard against duplicate keys across seed files.
const seen = new Set<string>();
for (const e of allCatalogEntries) {
  if (seen.has(e.key)) throw new Error(`Duplicate catalog seed key: ${e.key}`);
  seen.add(e.key);
}
