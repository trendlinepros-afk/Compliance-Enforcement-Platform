import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Computer, EffectivePolicyDoc } from '../../lib/types';
import { Modal, Spinner, ErrorBanner } from '../../components/ui';
import { MechanismBadge } from '../../components/SettingExplainer';
import { displayValue } from '../../lib/format';

export function EffectivePolicyModal({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['effective', computer.id],
    queryFn: () => api.get<EffectivePolicyDoc>(`/computers/${computer.id}/effective-policy`),
  });

  return (
    <Modal title={`Effective policy — ${computer.hostname}`} onClose={onClose} wide>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : data ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {data.entries.length} resolved settings · hash <code className="text-slate-400">{data.policyHash.slice(0, 16)}</code>
            </span>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded border border-ink-800">
            <table className="w-full">
              <thead className="sticky top-0 border-b border-ink-800 bg-ink-850">
                <tr>
                  <th className="th">Setting</th>
                  <th className="th">Mechanism</th>
                  <th className="th">Desired value</th>
                  <th className="th">Source policy</th>
                  <th className="th">Scope</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.settingKey} className="border-b border-ink-850 last:border-0">
                    <td className="td">
                      <div className="text-slate-200">{e.settingName}</div>
                      <code className="text-xs text-slate-500">{e.settingKey}</code>
                    </td>
                    <td className="td">
                      <MechanismBadge mechanism={e.mechanism} />
                    </td>
                    <td className="td font-mono text-xs text-slate-300">{displayValue(e.desiredValue)}</td>
                    <td className="td text-xs text-slate-400">{e.sourcePolicyName}</td>
                    <td className="td">
                      <span className="badge bg-ink-700 text-slate-300">{e.sourceScope}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
