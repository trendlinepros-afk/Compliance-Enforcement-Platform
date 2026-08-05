import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, RefreshCw, Check } from 'lucide-react';
import { api } from '../../lib/api';
import type { Tenant } from '../../lib/types';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';

export function DeployPanel({ tenant }: { tenant: Tenant }) {
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState(tenant.enrollToken);

  const publicUrl = tenant.publicUrl;
  const oneLiner = `powershell -ep bypass -c "iwr ${publicUrl}/api/enroll/${token}/agent.msi -OutFile $env:TEMP\\agent.msi; Start-Process msiexec -ArgumentList '/i',$env:TEMP\\agent.msi,'/qn','SERVERURL=${publicUrl}','ENROLLTOKEN=${token}' -Wait"`;

  const regenMut = useMutation({
    mutationFn: () => api.post<{ enrollToken: string }>(`/tenants/${tenant.id}/regenerate-token`),
    onSuccess: (r) => {
      setToken(r.enrollToken);
      qc.invalidateQueries({ queryKey: ['tenant', tenant.id] });
      show('Enrollment token regenerated — old install commands are now invalid');
    },
    onError: (e) => show(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const copy = async () => {
    await navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Deploy agent to this tenant</h3>
        {user?.role === 'ADMIN' && (
          <button className="btn-ghost text-xs text-slate-400" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>
            <RefreshCw size={13} /> Regenerate token
          </button>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Everything here has <b className="text-slate-300">{tenant.name}</b>&apos;s enrollment token baked in. Pick whichever fits:
        paste the one-liner into an elevated PowerShell, or download the ready-to-run installer and launch it on the target machine
        (approve the admin prompt, or push it through your RMM).
      </p>
      <div className="relative">
        <pre className="max-h-32 overflow-auto rounded bg-ink-950 p-3 pr-10 font-mono text-xs text-slate-300">{oneLiner}</pre>
        <button className="btn-ghost absolute right-1.5 top-1.5 p-1" onClick={copy} title="Copy">
          {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn-primary" href={`/api/enroll/${token}/install.cmd`} download>
          <Download size={14} /> Download installer
        </a>
        <a className="btn-secondary" href={`/api/enroll/${token}/install.ps1`} download title="PowerShell installer (token baked in)">
          <Download size={14} /> .ps1
        </a>
        <a className="btn-ghost text-slate-400" href={`/api/enroll/${token}/agent.msi`} download title="Raw MSI for RMM / Intune / GPO deployment (pass SERVERURL + ENROLLTOKEN yourself)">
          MSI only
        </a>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        The installer is a one-click <code className="text-slate-400">.cmd</code> that self-elevates, pulls the MSI, and enrolls to{' '}
        <b className="text-slate-300">{tenant.name}</b>. Your browser may warn about running a downloaded script — that&apos;s expected.
      </p>
      <div className="mt-2 font-mono text-xs text-slate-500">
        Enrollment token: <span className="text-slate-400">{token}</span>
      </div>
    </div>
  );
}
