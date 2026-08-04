/**
 * Compliance frameworks + control dictionaries. Every control id referenced by
 * catalog mappings must exist here — the seed runner validates and throws on
 * unknown ids so typos never silently drop a mapping.
 */

export interface FrameworkSeed {
  key: string;
  name: string;
  version: string;
  description: string;
}

export const frameworkSeeds: FrameworkSeed[] = [
  {
    key: 'cis',
    name: 'CIS Benchmark',
    version: 'Windows 10/11 + Server 2016-2025 (shared baseline)',
    description:
      'CIS Benchmark section references — the mapping backbone. Each catalog setting carries its CIS section, and this framework exposes them as controls.',
  },
  {
    key: 'cmmc',
    name: 'CMMC 2.0',
    version: '2.0 (Level 1 + Level 2)',
    description:
      'Cybersecurity Maturity Model Certification. Level 1 practices derive from FAR 52.204-21; Level 2 mirrors NIST SP 800-171 r2 (110 practices).',
  },
  {
    key: 'nist_800_171',
    name: 'NIST SP 800-171',
    version: 'Revision 2',
    description: 'Protecting Controlled Unclassified Information in Nonfederal Systems — 110 requirements in 14 families.',
  },
  {
    key: 'nist_800_53',
    name: 'NIST SP 800-53',
    version: 'Revision 5 (Moderate baseline)',
    description: 'Security and Privacy Controls for Information Systems — mapped against the Moderate baseline.',
  },
  {
    key: 'hipaa',
    name: 'HIPAA Security Rule',
    version: '45 CFR §164 Subpart C',
    description: 'Administrative (§164.308), physical (§164.310), and technical (§164.312) safeguards for ePHI.',
  },
  {
    key: 'soc2',
    name: 'SOC 2',
    version: 'TSC 2017 (with 2022 points of focus)',
    description: 'Trust Services Criteria — Common Criteria (CC) series relevant to endpoint/OS configuration.',
  },
];

// NIST SP 800-171 r2 requirement titles (referenced subset).
export const n171Controls: Record<string, string> = {
  '3.1.1': 'Limit system access to authorized users, processes, and devices',
  '3.1.2': 'Limit system access to the types of transactions and functions that authorized users are permitted to execute',
  '3.1.5': 'Employ the principle of least privilege, including for specific security functions and privileged accounts',
  '3.1.6': 'Use non-privileged accounts or roles when accessing nonsecurity functions',
  '3.1.7': 'Prevent non-privileged users from executing privileged functions and audit the execution of such functions',
  '3.1.8': 'Limit unsuccessful logon attempts',
  '3.1.9': 'Provide privacy and security notices consistent with applicable CUI rules',
  '3.1.10': 'Use session lock with pattern-hiding displays to prevent access and viewing of data after a period of inactivity',
  '3.1.11': 'Terminate (automatically) a user session after a defined condition',
  '3.1.12': 'Monitor and control remote access sessions',
  '3.1.13': 'Employ cryptographic mechanisms to protect the confidentiality of remote access sessions',
  '3.1.16': 'Authorize wireless access prior to allowing such connections',
  '3.1.20': 'Verify and control/limit connections to and use of external systems',
  '3.1.21': 'Limit use of portable storage devices on external systems',
  '3.3.1': 'Create and retain system audit logs and records to enable monitoring, analysis, investigation, and reporting',
  '3.3.2': 'Ensure that the actions of individual system users can be uniquely traced to those users',
  '3.3.4': 'Alert in the event of an audit logging process failure',
  '3.3.7': 'Provide a system capability that compares and synchronizes internal system clocks with an authoritative source',
  '3.3.8': 'Protect audit information and audit logging tools from unauthorized access, modification, and deletion',
  '3.3.9': 'Limit management of audit logging functionality to a subset of privileged users',
  '3.4.2': 'Establish and enforce security configuration settings for information technology products',
  '3.4.6': 'Employ the principle of least functionality by configuring systems to provide only essential capabilities',
  '3.4.8': 'Apply deny-by-exception (blacklisting) policy or deny-all, permit-by-exception (whitelisting) policy for software execution',
  '3.4.9': 'Control and monitor user-installed software',
  '3.5.1': 'Identify system users, processes acting on behalf of users, and devices',
  '3.5.2': 'Authenticate (or verify) the identities of users, processes, or devices as a prerequisite to allowing access',
  '3.5.4': 'Employ replay-resistant authentication mechanisms for network access to privileged and non-privileged accounts',
  '3.5.5': 'Prevent reuse of identifiers for a defined period',
  '3.5.7': 'Enforce a minimum password complexity and change of characters when new passwords are created',
  '3.5.8': 'Prohibit password reuse for a specified number of generations',
  '3.5.10': 'Store and transmit only cryptographically-protected passwords',
  '3.8.1': 'Protect (physically control and securely store) system media containing CUI',
  '3.8.7': 'Control the use of removable media on system components',
  '3.13.1': 'Monitor, control, and protect communications at external and key internal boundaries',
  '3.13.4': 'Prevent unauthorized and unintended information transfer via shared system resources',
  '3.13.5': 'Implement subnetworks for publicly accessible system components that are separated from internal networks',
  '3.13.6': 'Deny network communications traffic by default and allow by exception',
  '3.13.8': 'Implement cryptographic mechanisms to prevent unauthorized disclosure of CUI during transmission',
  '3.13.9': 'Terminate network connections associated with communications sessions at the end of the sessions or after a defined period of inactivity',
  '3.13.11': 'Employ FIPS-validated cryptography when used to protect the confidentiality of CUI',
  '3.13.15': 'Protect the authenticity of communications sessions',
  '3.13.16': 'Protect the confidentiality of CUI at rest',
  '3.14.1': 'Identify, report, and correct system flaws in a timely manner',
  '3.14.2': 'Provide protection from malicious code at designated locations within the system',
  '3.14.4': 'Update malicious code protection mechanisms when new releases are available',
  '3.14.5': 'Perform periodic scans of the system and real-time scans of files from external sources',
  '3.14.6': 'Monitor the system, including inbound and outbound communications traffic, to detect attacks and indicators of potential attacks',
};

/** CMMC 2.0 Level 1 practice ids (FAR 52.204-21 subset of 800-171). */
export const cmmcL1Set = new Set([
  '3.1.1', '3.1.2', '3.1.20', '3.1.22', '3.5.1', '3.5.2', '3.8.3',
  '3.10.1', '3.10.3', '3.10.4', '3.10.5', '3.13.1', '3.13.5',
  '3.14.1', '3.14.2', '3.14.4', '3.14.5',
]);

const n171FamilyPrefix: Record<string, string> = {
  '3.1': 'AC', '3.2': 'AT', '3.3': 'AU', '3.4': 'CM', '3.5': 'IA', '3.6': 'IR', '3.7': 'MA',
  '3.8': 'MP', '3.9': 'PS', '3.10': 'PE', '3.11': 'RA', '3.12': 'CA', '3.13': 'SC', '3.14': 'SI',
};

/** 3.1.1 -> AC.L1-3.1.1 or AC.L2-3.1.1 depending on the L1 practice set. */
export function cmmcPracticeId(n171Id: string): string {
  const fam = n171FamilyPrefix[n171Id.split('.').slice(0, 2).join('.')] ?? 'XX';
  const level = cmmcL1Set.has(n171Id) ? 'L1' : 'L2';
  return `${fam}.${level}-${n171Id}`;
}

// NIST SP 800-53 r5 control titles (referenced subset, Moderate baseline).
export const n53Controls: Record<string, string> = {
  'AC-2': 'Account Management',
  'AC-3': 'Access Enforcement',
  'AC-6': 'Least Privilege',
  'AC-7': 'Unsuccessful Logon Attempts',
  'AC-8': 'System Use Notification',
  'AC-11': 'Device Lock',
  'AC-12': 'Session Termination',
  'AC-17': 'Remote Access',
  'AC-18': 'Wireless Access',
  'AU-2': 'Event Logging',
  'AU-3': 'Content of Audit Records',
  'AU-4': 'Audit Log Storage Capacity',
  'AU-5': 'Response to Audit Logging Process Failures',
  'AU-8': 'Time Stamps',
  'AU-9': 'Protection of Audit Information',
  'AU-12': 'Audit Record Generation',
  'CM-6': 'Configuration Settings',
  'CM-7': 'Least Functionality',
  'CM-11': 'User-Installed Software',
  'IA-2': 'Identification and Authentication (Organizational Users)',
  'IA-4': 'Identifier Management',
  'IA-5': 'Authenticator Management',
  'MP-7': 'Media Use',
  'SC-4': 'Information in Shared System Resources',
  'SC-7': 'Boundary Protection',
  'SC-8': 'Transmission Confidentiality and Integrity',
  'SC-10': 'Network Disconnect',
  'SC-13': 'Cryptographic Protection',
  'SC-20': 'Secure Name/Address Resolution Service (Authoritative Source)',
  'SC-23': 'Session Authenticity',
  'SC-28': 'Protection of Information at Rest',
  'SI-2': 'Flaw Remediation',
  'SI-3': 'Malicious Code Protection',
  'SI-4': 'System Monitoring',
  'SI-7': 'Software, Firmware, and Information Integrity',
  'SI-16': 'Memory Protection',
};

// HIPAA Security Rule cites.
export const hipaaControls: Record<string, string> = {
  '164.308(a)(1)(ii)(D)': 'Information system activity review',
  '164.308(a)(3)(i)': 'Workforce security',
  '164.308(a)(4)(i)': 'Information access management',
  '164.308(a)(5)(ii)(B)': 'Protection from malicious software',
  '164.308(a)(5)(ii)(C)': 'Log-in monitoring',
  '164.308(a)(5)(ii)(D)': 'Password management',
  '164.310(b)': 'Workstation use',
  '164.310(c)': 'Workstation security',
  '164.310(d)(1)': 'Device and media controls',
  '164.312(a)(1)': 'Access control',
  '164.312(a)(2)(i)': 'Unique user identification',
  '164.312(a)(2)(iii)': 'Automatic logoff',
  '164.312(a)(2)(iv)': 'Encryption and decryption',
  '164.312(b)': 'Audit controls',
  '164.312(c)(1)': 'Integrity',
  '164.312(d)': 'Person or entity authentication',
  '164.312(e)(1)': 'Transmission security',
  '164.312(e)(2)(ii)': 'Encryption (transmission)',
};

// SOC 2 Trust Services Criteria (CC series subset).
export const soc2Controls: Record<string, string> = {
  'CC5.2': 'Control activities over technology are selected and developed',
  'CC6.1': 'Logical access security software, infrastructure, and architectures',
  'CC6.2': 'User registration, authorization, and credential issuance',
  'CC6.3': 'Role-based access and least privilege',
  'CC6.6': 'Protections against threats from outside system boundaries',
  'CC6.7': 'Restriction and protection of information in transmission and movement',
  'CC6.8': 'Prevention and detection of unauthorized or malicious software',
  'CC7.1': 'Detection and monitoring of configuration changes and vulnerabilities',
  'CC7.2': 'Monitoring for anomalies indicative of malicious acts',
  'CC7.3': 'Evaluation of security events',
  'CC8.1': 'Change management over infrastructure, data, and software',
};
