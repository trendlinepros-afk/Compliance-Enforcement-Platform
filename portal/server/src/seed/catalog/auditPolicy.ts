import { auditSub, type SeedEntry } from '../types';

/**
 * Full advanced audit policy subcategory set. GUIDs are the stable
 * Microsoft-published subcategory identifiers ({0CCE92xx-69AE-11D9-BED3-505054503030}).
 * Values: 0 none, 1 success, 2 failure, 3 success+failure.
 * Recommended values follow CIS; subcategories CIS leaves unconfigured default
 * to 0 (explicitly no auditing) to keep noise down — raise per policy if a
 * framework or SIEM needs them.
 */

const g = (xx: string) => `{0CCE92${xx}-69AE-11D9-BED3-505054503030}`;

const AL = 'Advanced Audit Policy > Account Logon';
const AM = 'Advanced Audit Policy > Account Management';
const DT = 'Advanced Audit Policy > Detailed Tracking';
const DS = 'Advanced Audit Policy > DS Access';
const LL = 'Advanced Audit Policy > Logon/Logoff';
const OA = 'Advanced Audit Policy > Object Access';
const PC = 'Advanced Audit Policy > Policy Change';
const PU = 'Advanced Audit Policy > Privilege Use';
const SY = 'Advanced Audit Policy > System';

const NOISE = 'Log volume only — auditing never blocks operations. Size the Security log (see Event Log settings) before turning on chatty subcategories.';
const AUDIT_MAPS = { n171: ['3.3.1!', '3.3.2'], n53: ['AU-2!', 'AU-12!'], hipaa: ['164.312(b)!', '164.308(a)(1)(ii)(D)'], soc2: ['CC7.2!'] };
const AUDIT_MAPS_LOGON = { n171: ['3.3.1!', '3.3.2', '3.1.8'], n53: ['AU-2!', 'AU-12!', 'AC-7'], hipaa: ['164.312(b)!', '164.308(a)(5)(ii)(C)!'], soc2: ['CC7.2!'] };

export const auditPolicyEntries: SeedEntry[] = [
  // Account Logon
  auditSub(AL)('aud_credential_validation', '17.1.1', 'Credential Validation', g('3F'), 3,
    'Records NTLM credential checks performed by this machine (event 4776) — the raw material for spotting spraying and stuffing.', NOISE, { maps: AUDIT_MAPS_LOGON }),
  auditSub(AL)('aud_kerberos_authsvc', '17.1.2', 'Kerberos Authentication Service', g('42'), 0,
    'TGT requests (DC-only events 4768/4771). Meaningful on domain controllers; no events on members.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AL)('aud_kerberos_svcticket', '17.1.3', 'Kerberos Service Ticket Operations', g('40'), 0,
    'Service ticket requests (DC-only event 4769, very high volume). Kerberoasting detection lives here on DCs.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AL)('aud_other_account_logon', '17.1.4', 'Other Account Logon Events', g('41'), 0,
    'Rarely-emitted miscellaneous account-logon events.', NOISE, { maps: AUDIT_MAPS }),

  // Account Management
  auditSub(AM)('aud_app_group_mgmt', '17.2.1', 'Application Group Management', g('39'), 3,
    'Changes to Authorization Manager application groups (rare; any event is interesting).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AM)('aud_computer_account_mgmt', '17.2.2', 'Computer Account Management', g('36'), 1,
    'Computer account create/change/delete (DC-relevant; event 4741-4743).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AM)('aud_distribution_group_mgmt', '17.2.3', 'Distribution Group Management', g('38'), 0,
    'Distribution (non-security) group changes — low security value.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AM)('aud_other_account_mgmt', '17.2.4', 'Other Account Management Events', g('3A'), 1,
    'Password-hash access and account-policy API events (4782/4793).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(AM)('aud_security_group_mgmt', '17.2.5', 'Security Group Management', g('37'), 1,
    'Security group membership changes (4727-4735) — who got added to Administrators, and by whom.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.3.2', '3.1.5'], n53: ['AU-2!', 'AU-12!', 'AC-2!'] } }),
  auditSub(AM)('aud_user_account_mgmt', '17.2.6', 'User Account Management', g('35'), 3,
    'User account create/enable/disable/delete/password-reset (4720-4738) — core identity audit trail.', NOISE, { maps: { ...AUDIT_MAPS, n53: ['AU-2!', 'AU-12!', 'AC-2!'] } }),

  // Detailed Tracking
  auditSub(DT)('aud_dpapi', '17.3.1', 'DPAPI Activity', g('2D'), 0,
    'DPAPI protect/unprotect calls; chatty and rarely actionable outside investigations.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DT)('aud_pnp', '17.3.2', 'Plug and Play Events', g('48'), 1,
    'Device arrivals (6416) — the event that catches rogue USB devices being plugged in.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.1.21'], n53: ['AU-2!', 'MP-7'] } }),
  auditSub(DT)('aud_process_creation', '17.3.3', 'Process Creation', g('2B'), 1,
    'Every process start (4688). With command-line capture enabled (separate setting) this is the single most valuable endpoint telemetry.', NOISE, { maps: { ...AUDIT_MAPS, soc2: ['CC7.2!', 'CC7.3'] } }),
  auditSub(DT)('aud_process_termination', '17.3.4', 'Process Termination', g('2C'), 0,
    'Process exit events; high volume, low standalone value.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DT)('aud_rpc', '17.3.5', 'RPC Events', g('2E'), 0,
    'RPC connection audit; rarely used.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DT)('aud_token_right_adjusted', '17.3.6', 'Token Right Adjusted Events', g('4A'), 1,
    'Token privilege adjustments (4703); catches privilege-escalation staging on Win10+/Server 2016+.', NOISE, { maps: AUDIT_MAPS }),

  // DS Access (DC-only; explicit 0 on members keeps parity with DCs separate)
  auditSub(DS)('aud_ds_access', '17.4.1', 'Directory Service Access', g('3B'), 2,
    'AD object access with SACLs (4662). Failure auditing catches probing; DC-only.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DS)('aud_ds_changes', '17.4.2', 'Directory Service Changes', g('3C'), 1,
    'AD object modifications with before/after values (5136-5141); DC-only.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DS)('aud_ds_replication', '17.4.3', 'Directory Service Replication', g('3D'), 0,
    'Replication start/stop; noise except when debugging replication.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(DS)('aud_ds_replication_detailed', '17.4.4', 'Detailed Directory Service Replication', g('3E'), 0,
    'Per-object replication detail; investigation-only volume.', NOISE, { maps: AUDIT_MAPS }),

  // Logon/Logoff
  auditSub(LL)('aud_account_lockout', '17.5.1', 'Account Lockout', g('17'), 2,
    'Lockout occurrences (4625 with lockout status). Failure-only per CIS.', NOISE, { maps: AUDIT_MAPS_LOGON }),
  auditSub(LL)('aud_user_device_claims', '17.5.2', 'User / Device Claims', g('47'), 0,
    'Claims-based access tokens; only meaningful with Dynamic Access Control deployments.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_group_membership', '17.5.3', 'Group Membership', g('49'), 1,
    'Records the token group membership at each logon (4627) — answers "what groups did they have at the time".', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_ipsec_extended', '17.5.4', 'IPsec Extended Mode', g('1A'), 0,
    'IPsec extended-mode negotiations; only with IPsec deployments.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_ipsec_main', '17.5.5', 'IPsec Main Mode', g('18'), 0,
    'IPsec main-mode negotiations; only with IPsec deployments.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_ipsec_quick', '17.5.6', 'IPsec Quick Mode', g('19'), 0,
    'IPsec quick-mode negotiations; only with IPsec deployments.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_logoff', '17.5.7', 'Logoff', g('16'), 1,
    'Session end events (4634/4647) — pairs with Logon for session-duration reconstruction.', NOISE, { maps: AUDIT_MAPS_LOGON }),
  auditSub(LL)('aud_logon', '17.5.8', 'Logon', g('15'), 3,
    'Every logon success and failure (4624/4625) with type, source address, and auth package — the backbone of intrusion detection.', NOISE, { maps: AUDIT_MAPS_LOGON }),
  auditSub(LL)('aud_network_policy_server', '17.5.9', 'Network Policy Server', g('43'), 0,
    'RADIUS/NPS decisions; only on NPS servers (there, set Success+Failure).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(LL)('aud_other_logon_logoff', '17.5.10', 'Other Logon/Logoff Events', g('1C'), 3,
    'Screen lock/unlock (4800/4801), RDP session connect/disconnect (4778/4779) — fills the session timeline between logon and logoff.', NOISE, { maps: AUDIT_MAPS_LOGON }),
  auditSub(LL)('aud_special_logon', '17.5.11', 'Special Logon', g('1B'), 1,
    'Logons that receive admin-equivalent privileges (4672) — every privileged session start.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.1.7!'], n53: ['AU-2!', 'AC-6'] } }),

  // Object Access
  auditSub(OA)('aud_application_generated', '17.6.1', 'Application Generated', g('22'), 0,
    'Events written by applications via the audit API; enable per application need.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_central_policy_staging', '17.6.2', 'Central Policy Staging', g('46'), 0,
    'Central Access Policy staging results; only with DAC deployments.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_certification_services', '17.6.3', 'Certification Services', g('21'), 0,
    'AD CS operations; on CA servers set Success+Failure.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_detailed_file_share', '17.6.4', 'Detailed File Share', g('44'), 2,
    'Per-file access within shares (5145). Failure-only per CIS — success auditing here floods logs on file servers.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_file_share', '17.6.5', 'File Share', g('24'), 3,
    'Share-level connections (5140), share create/modify/delete (5142-5144) — who touched which share from where.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_file_system', '17.6.6', 'File System', g('1D'), 2,
    'NTFS object access where SACLs are set (4663). Nothing logs until you place SACLs on specific files.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_fpc_connection', '17.6.7', 'Filtering Platform Connection', g('26'), 2,
    'WFP allowed/blocked connections (5156/5157). Failure-only per CIS: blocked-connection evidence without the firehose of allows.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.13.1'], n53: ['AU-2!', 'SC-7'] } }),
  auditSub(OA)('aud_fpc_packet_drop', '17.6.8', 'Filtering Platform Packet Drop', g('25'), 0,
    'Per-packet drops (5152) — extreme volume; use Connection failure auditing instead.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_handle_manipulation', '17.6.9', 'Handle Manipulation', g('23'), 0,
    'Handle open/close detail feeding other subcategories; investigation-only volume.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_kernel_object', '17.6.10', 'Kernel Object', g('1F'), 0,
    'Kernel object SACL hits; investigation-only.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_other_object_access', '17.6.11', 'Other Object Access Events', g('27'), 3,
    'Scheduled task create/update/delete (4698-4702) live here — a favorite persistence mechanism — plus COM+ object events.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_registry', '17.6.12', 'Registry', g('1E'), 2,
    'Registry access where SACLs are set (4657). Nothing logs until SACLs are placed on specific keys.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(OA)('aud_removable_storage', '17.6.13', 'Removable Storage', g('45'), 3,
    'Every file operation on removable media (4663 with removable class) — the audit side of USB data-exfiltration control.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.8.1', '3.1.21'], n53: ['AU-2!', 'MP-7!'], hipaa: ['164.312(b)!', '164.310(d)(1)'] } }),
  auditSub(OA)('aud_sam', '17.6.14', 'SAM', g('20'), 0,
    'Local SAM object access; very chatty, superseded by Remote SAM restriction + account-management auditing.', NOISE, { maps: AUDIT_MAPS }),

  // Policy Change
  auditSub(PC)('aud_audit_policy_change', '17.7.1', 'Audit Policy Change', g('2F'), 1,
    'Changes to the audit policy itself (4719, 4907) — the "who turned off the cameras" event.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.3.9!'], n53: ['AU-2!', 'AU-9!'] } }),
  auditSub(PC)('aud_authentication_policy_change', '17.7.2', 'Authentication Policy Change', g('30'), 1,
    'Kerberos/auth policy and trust changes (4713, 4716-4718).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(PC)('aud_authorization_policy_change', '17.7.3', 'Authorization Policy Change', g('31'), 1,
    'User-rights assignments granted/removed (4704/4705) — privilege changes in real time.', NOISE, { maps: { ...AUDIT_MAPS, n53: ['AU-2!', 'AC-6'] } }),
  auditSub(PC)('aud_fp_policy_change', '17.7.4', 'Filtering Platform Policy Change', g('33'), 0,
    'WFP filter add/remove; high volume on busy hosts.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(PC)('aud_mpssvc_policy_change', '17.7.5', 'MPSSVC Rule-Level Policy Change', g('32'), 3,
    'Windows Firewall rule changes (4946-4958) — catches malware punching holes in the firewall.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.13.1'], n53: ['AU-2!', 'SC-7'] } }),
  auditSub(PC)('aud_other_policy_change', '17.7.6', 'Other Policy Change Events', g('34'), 2,
    'Miscellaneous policy events including cryptographic ones; failure-only per CIS.', NOISE, { maps: AUDIT_MAPS }),

  // Privilege Use
  auditSub(PU)('aud_non_sensitive_privilege', '17.8.1', 'Non Sensitive Privilege Use', g('29'), 0,
    'Exercise of ordinary privileges; extreme volume, minimal value.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(PU)('aud_other_privilege_use', '17.8.2', 'Other Privilege Use Events', g('2A'), 0,
    'Reserved subcategory; effectively unused.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(PU)('aud_sensitive_privilege', '17.8.3', 'Sensitive Privilege Use', g('28'), 3,
    'Exercise of dangerous privileges — SeDebug, SeBackup, SeRestore, SeTcb (4673/4674). Credential dumpers trip this.', NOISE, { maps: { ...AUDIT_MAPS, n171: ['3.3.1!', '3.1.7!'], n53: ['AU-2!', 'AC-6!'] } }),

  // System
  auditSub(SY)('aud_ipsec_driver', '17.9.1', 'IPsec Driver', g('13'), 3,
    'IPsec driver integrity events (packet-integrity failures may indicate tampering).', NOISE, { maps: AUDIT_MAPS }),
  auditSub(SY)('aud_other_system_events', '17.9.2', 'Other System Events', g('14'), 3,
    'Firewall service start/stop and crypto self-tests (5024-5058) — catches the firewall being shut off.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(SY)('aud_security_state_change', '17.9.3', 'Security State Change', g('10'), 1,
    'System startup/shutdown and time changes affecting the security subsystem (4608, 4616).', NOISE, { maps: { ...AUDIT_MAPS, n53: ['AU-2!', 'AU-8'] } }),
  auditSub(SY)('aud_security_system_extension', '17.9.4', 'Security System Extension', g('11'), 1,
    'Authentication package and security service registrations (4610/4611/4614/4622) — rogue SSPs (password sniffers in LSASS) show up here.', NOISE, { maps: AUDIT_MAPS }),
  auditSub(SY)('aud_system_integrity', '17.9.5', 'System Integrity', g('12'), 3,
    'Audit-subsystem integrity violations (4612, 4615, 4618) — must always be on.', NOISE, { maps: { ...AUDIT_MAPS, n53: ['AU-2!', 'AU-9!', 'SI-7'] } }),
];
