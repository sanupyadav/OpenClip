import React, { useState, useEffect } from 'react';
import { Youtube, Loader2, Clock, ExternalLink, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiJson } from '../lib/api';

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

const BADGES = {
  queued: ['badge-warn', 'Queued'],
  uploading: ['badge-warn', 'Uploading'],
  failed: ['badge-danger', 'Failed'],
  scheduled: ['badge-warn', 'Scheduled'],
  deleted: ['badge-danger', 'Deleted on YouTube'],
};

// Self-host: every clip uploaded or queued for YouTube (Settings → YouTube
// direct → Auto-schedule), with its live state and a delete button.
export default function YouTubeUploadsTab() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => apiJson('/api/youtube/all')
      .then((d) => { if (alive) setRows(d.uploads || []); })
      .catch(() => { if (alive) setRows((r) => r || []); });
    load();
    const poll = setInterval(load, 15000);
    return () => { alive = false; clearInterval(poll); };
  }, []);

  const act = async (key, fn) => {
    setBusy(key);
    setError('');
    try { await fn(); } catch (e) { setError(e.detail || e.message || 'Request failed'); } finally { setBusy(''); }
  };

  const check = () => act('check', async () => {
    setRows((await apiJson('/api/youtube/check', { method: 'POST' })).uploads || []);
  });

  const remove = (u) => act(`${u.job_id}/${u.clip_index}`, async () => {
    const what = u.videoId ? 'Delete this video from your YouTube channel' : 'Cancel this queued upload';
    if (!window.confirm(`${what}? This cannot be undone.`)) return;
    await apiJson(`/api/youtube/uploads/${encodeURIComponent(u.job_id)}/${u.clip_index}`, { method: 'DELETE' });
    setRows((r) => r.filter((x) => !(x.job_id === u.job_id && x.clip_index === u.clip_index)));
  });

  const list = rows || [];
  const scheduled = list.filter((u) => u.live === 'scheduled' || (!u.live && u.publishAt && new Date(u.publishAt) > new Date())).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">07 · YOUTUBE</p>
          <h2 className="font-display lowercase text-2xl md:text-3xl text-ink">youtube uploads</h2>
          <p className="readout mt-2">{rows ? `${list.length} clip(s) · ${scheduled} scheduled` : '…'}</p>
        </div>
        <button onClick={check} disabled={!!busy || !list.length} className="btn-primary px-4 py-2 text-sm"
          title="Ask YouTube for each video's current state">
          {busy === 'check' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check scheduled videos
        </button>
      </div>

      {error && (
        <p className="text-sm text-warn flex items-start gap-1.5 break-words">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {!rows ? (
        <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-brass" /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-16">
          <Youtube size={40} className="mx-auto text-muted opacity-40 mb-3" />
          <p className="text-sm text-muted lowercase">Nothing uploaded yet. Turn on auto-schedule in Settings → YouTube.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((u) => {
            const key = `${u.job_id}/${u.clip_index}`;
            const state = u.live || (u.status === 'uploaded' && u.publishAt && new Date(u.publishAt) > new Date() ? 'scheduled' : u.status);
            const [cls, label] = BADGES[state] || ['badge-ok', state === 'uploaded' ? (u.privacy || 'uploaded') : state];
            return (
              <div key={key} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cls}>{state === 'uploading' ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />} {label}</span>
                    {u.publishAt && <span className="text-xs text-muted">publishes {when(u.publishAt)}</span>}
                    {u.checkedAt && <span className="text-xs text-muted">· checked {new Date(u.checkedAt * 1000).toLocaleTimeString()}</span>}
                  </div>
                  <p className="text-sm text-ink truncate" title={u.title}>{u.title || `Clip ${u.clip_index + 1}`}</p>
                  {u.error && <p className="text-xs text-warn mt-0.5 break-words">{u.error}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.url && (
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="btn-quiet px-3 py-1.5 text-xs">
                      <ExternalLink size={12} /> Open
                    </a>
                  )}
                  <button onClick={() => remove(u)} disabled={!!busy || u.status === 'uploading'} className="btn-quiet px-3 py-1.5 text-xs text-warn">
                    {busy === key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
