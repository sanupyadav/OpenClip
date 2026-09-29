import React, { useState, useEffect } from 'react';
import { Activity, Loader2, Clock, ExternalLink, Square, RotateCcw, AlertTriangle } from 'lucide-react';
import { apiJson } from '../lib/api';

const since = (t) => {
  if (!t) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

// Self-host: every queued / running clip and UGC job on this server, plus
// failed clip jobs that can be retried, polled.
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

  const [stopping, setStopping] = useState('');

  const stop = async (j) => {
    const what = j.status === 'processing' ? 'Stop this running job' : 'Remove this job from the queue';
    if (!window.confirm(`${what}? It will not be resumed or retried.`)) return;
    setStopping(j.job_id);
    try {
      await apiJson(`/api/local/queue/${encodeURIComponent(j.job_id)}/cancel`, { method: 'POST' });
      setData((d) => d && { ...d, jobs: d.jobs.filter((x) => x.job_id !== j.job_id) });
    } catch (e) {
      alert(e.message || 'Could not stop the job');
    } finally {
      setStopping('');
    }
  };

  const retry = async (j) => {
    setStopping(j.job_id);
    try {
      await apiJson(`/api/local/queue/${encodeURIComponent(j.job_id)}/retry`, { method: 'POST' });
      setData((d) => d && { ...d, jobs: d.jobs.map((x) => (x.job_id === j.job_id ? { ...x, status: 'queued' } : x)) });
    } catch (e) {
      alert(e.message || 'Could not retry the job');
    } finally {
      setStopping('');
    }
  };

  const jobs = data?.jobs || [];
  const running = jobs.filter((j) => j.status === 'processing').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">07 · QUEUE</p>
        <h2 className="font-display lowercase text-2xl md:text-3xl text-ink">queue</h2>
        <p className="readout mt-2">
          {data ? `${running} running · ${jobs.length - running - failed} waiting${failed ? ` · ${failed} failed` : ''} · ${data.max_concurrent} at a time` : '…'}
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
                  ) : j.status === 'failed' ? (
                    <span className="badge-danger"><AlertTriangle size={11} /> Failed</span>
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
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onOpenJob(j.job_id)} className="btn-quiet px-3 py-1.5 text-xs">
                    <ExternalLink size={12} /> Open
                  </button>
                  {j.status === 'failed' ? (
                    <button onClick={() => retry(j)} disabled={stopping === j.job_id} className="btn-quiet px-3 py-1.5 text-xs text-brass">
                      {stopping === j.job_id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Retry
                    </button>
                  ) : (
                    <button onClick={() => stop(j)} disabled={stopping === j.job_id} className="btn-quiet px-3 py-1.5 text-xs text-warn">
                      {stopping === j.job_id ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                      {j.status === 'processing' ? 'Stop' : 'Remove'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
