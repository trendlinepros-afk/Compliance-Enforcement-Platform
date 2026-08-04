import type { Setting } from '../lib/types';

/** Editor for a single setting value, adapting to allowedValues / dataType. */
export function ValueEditor({ setting, value, onChange }: { setting: Setting; value: unknown; onChange: (v: unknown) => void }) {
  if (setting.allowedValues && setting.allowedValues.length > 0) {
    return (
      <select className="input" value={String(value ?? '')} onChange={(e) => onChange(coerce(e.target.value, setting.dataType))}>
        {setting.allowedValues.map((a) => (
          <option key={String(a.value)} value={String(a.value)}>
            {a.label} ({String(a.value)})
          </option>
        ))}
      </select>
    );
  }

  if (setting.dataType === 'multi') {
    const arr = Array.isArray(value) ? value : [];
    return (
      <textarea
        className="input font-mono text-xs"
        rows={Math.min(6, Math.max(2, arr.length))}
        value={arr.join('\n')}
        placeholder="One value per line"
        onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
      />
    );
  }

  if (setting.dataType === 'dword' || setting.dataType === 'qword') {
    return (
      <input
        className="input font-mono"
        type="number"
        value={value === null || value === undefined ? '' : Number(value)}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }

  return <input className="input font-mono" value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />;
}

function coerce(raw: string, dataType: string): unknown {
  if (dataType === 'dword' || dataType === 'qword') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}
