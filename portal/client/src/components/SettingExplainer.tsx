import { AlertTriangle, Info } from 'lucide-react';
import type { Setting } from '../lib/types';
import { FrameworkBadges } from './ui';

/**
 * The plain-English explanation block that is the product's core differentiator:
 * "what it does" and "what it can break", surfaced everywhere a setting appears.
 */
export function SettingExplainer({ setting, compact }: { setting: Setting; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {setting.description && (
        <div className="flex gap-2 text-sm">
          <Info size={14} className="mt-0.5 flex-shrink-0 text-sky-400" />
          <div>
            <span className="font-medium text-slate-300">What it does: </span>
            <span className="text-slate-400">{setting.description}</span>
          </div>
        </div>
      )}
      {setting.riskNote && (
        <div className="flex gap-2 text-sm">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
          <div>
            <span className="font-medium text-slate-300">What it can break: </span>
            <span className="text-slate-400">{setting.riskNote}</span>
          </div>
        </div>
      )}
      {setting.needsDescription && (
        <div className="badge bg-amber-900 text-amber-300">Needs description</div>
      )}
      {!compact && <FrameworkBadges maps={setting.controlMaps} />}
    </div>
  );
}

export function MechanismBadge({ mechanism }: { mechanism: Setting['mechanism'] }) {
  const map = {
    REGISTRY_POL: { label: 'Registry.pol', cls: 'bg-indigo-900 text-indigo-300' },
    SECEDIT: { label: 'SecEdit', cls: 'bg-cyan-900 text-cyan-300' },
    AUDITPOL: { label: 'AuditPol', cls: 'bg-fuchsia-900 text-fuchsia-300' },
  }[mechanism];
  return <span className={`badge ${map.cls}`}>{map.label}</span>;
}

export function TargetPath({ setting }: { setting: Setting }) {
  let path = '';
  if (setting.mechanism === 'REGISTRY_POL') {
    path = `${setting.registryHive}\\${setting.registryKey}\\${setting.registryValueName} (${setting.registryValueType})`;
  } else if (setting.mechanism === 'SECEDIT') {
    path = `[${setting.seceditArea}] ${setting.seceditKey}`;
  } else {
    path = `${setting.auditSubcategory} ${setting.auditGuid ?? ''}`;
  }
  return <code className="block break-all font-mono text-xs text-slate-500">{path}</code>;
}
