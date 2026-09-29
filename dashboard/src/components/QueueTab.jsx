import React, { useState, useEffect } from 'react';
import { Activity, Loader2, Clock, ExternalLink } from 'lucide-react';
import { apiJson } from '../lib/api';

const since = (t) => {
  if (!t) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

// Self-host: every queued / running clip and UGC job on this server, polled.
export default function QueueTab({ onOpenJob }) {
  const [data, setData] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => apiJson('/api/local/queue')
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData((d) => d || { jobs: [] }); });
    load();
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
  }, []);

  const jobs = data?.jobs || [];
  const running = jobs.filter((j) => j.status === 'processing').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">07 · QUEUE</p>
        <h2 className="font-display lowercase text-2xl md:text-3xl text-ink">queue</h2>
        <p className="readout mt-2">
          {data ? `${running} running · ${jobs.length - running} waiting · ${data.max_concurrent} at a time` : '…'}
        </p>
      </div>

      {!data ? (
        <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-brass" /></div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16">
          <Activity size={40} className="mx-auto text-muted opacity-40 mb-3" />
          <p className="text-sm text-muted lowercase">Nothing is processing right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.job_id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {j.status === 'processing' ? (
                    <span className="badge-ok"><Loader2 size={11} className="animate-spin" /> Running</span>
                  ) : (
                    <span className="badge-warn"><Clock size={11} /> Queued{j.queue ? ` · #${j.queue.position}` : ''}</span>
                  )}
                  <span className="text-xs text-muted">{j.kind === 'ugc' ? 'UGC video' : 'Clips'}</span>
                  {j.started && <span className="text-xs text-muted">· {since(j.started)}</span>}
                  {j.queue?.eta_seconds != null && (
                    <span className="text-xs text-muted">· starts in ~{Math.ceil(j.queue.eta_seconds / 60)} min</span>
                  )}
                </div>
                <p className="text-sm text-ink truncate" title={j.source}>{j.source || j.job_id}</p>
                {j.step && <p className="text-xs text-muted truncate mt-0.5 font-mono" title={j.step}>{j.step}</p>}
              </div>
              {j.kind === 'clips' && (
                <button onClick={() => onOpenJob(j.job_id)} className="btn-quiet px-3 py-1.5 text-xs shrink-0">
                  <ExternalLink size={12} /> Open
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
