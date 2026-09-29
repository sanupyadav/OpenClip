import React, { useState, useEffect } from 'react';
import { Film, Download, Trash2, Loader2 } from 'lucide-react';
import { apiJson } from '../lib/api';
import { getApiUrl } from '../config';

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Self-host: everything finished in output/ (clip jobs and UGC videos), with
// delete per job. The cloud build has the History tab instead.
export default function LocalVideos({ onCount }) {
  const [jobs, setJobs] = useState(null);
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiJson('/api/local/videos')
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    if (jobs) onCount?.(jobs.reduce((n, j) => n + j.videos.length, 0));
  }, [jobs, onCount]);

  const remove = async (job) => {
    if (!window.confirm(`Delete all ${job.videos.length} clip(s) of this job? This cannot be undone.`)) return;
    setDeleting(job.job_id);
    setError('');
    try {
      await apiJson(`/api/local/videos/${encodeURIComponent(job.job_id)}`, { method: 'DELETE' });
      setJobs((js) => js.filter((j) => j.job_id !== job.job_id));
    } catch (e) {
      setError(e.message || 'Could not delete');
    } finally {
      setDeleting('');
    }
  };

  const removeClip = async (job, v, n) => {
    if (!window.confirm(`Delete clip ${n} ("${v.title}")? This cannot be undone.`)) return;
    const key = `${job.job_id}:${v.index}`;
    setDeleting(key);
    setError('');
    try {
      await apiJson(`/api/local/videos/${encodeURIComponent(job.job_id)}/clips/${v.index}`, { method: 'DELETE' });
      setJobs((js) => js
        .map((j) => (j.job_id === job.job_id ? { ...j, videos: j.videos.filter((x) => x.index !== v.index) } : j))
        .filter((j) => j.videos.length > 0));
    } catch (e) {
      setError(e.message || 'Could not delete');
    } finally {
      setDeleting('');
    }
  };

  if (!jobs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-brass" />
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="text-center py-16">
        <Film size={40} className="mx-auto text-muted opacity-40 mb-3" />
        <p className="text-sm text-muted lowercase">No videos yet. Clips and UGC videos you generate show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-warn">{error}</p>}
      {jobs.map((job) => (
        <div key={job.job_id}>
          <h3 className="text-base text-ink font-medium mb-1 truncate" title={job.source}>
            {job.source || (job.kind === 'ugc' ? 'UGC video' : 'Video')}
          </h3>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs text-muted">
              <span className="badge-ok mr-2">{job.kind === 'ugc' ? 'UGC' : 'Clips'}</span>
              {new Date(job.created * 1000).toLocaleString()} · {job.videos.length} clip(s)
            </p>
            <button
              onClick={() => remove(job)}
              disabled={deleting === job.job_id}
              className="btn-quiet px-3 py-1.5 text-xs text-warn"
            >
              {deleting === job.job_id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete all
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {job.videos.map((v, i) => (
              <div key={v.url} className="card overflow-hidden relative">
                <span className="absolute top-2 left-2 z-10 badge-brass font-mono">#{i + 1}</span>
                <video src={getApiUrl(v.url)} controls preload="metadata" className="w-full aspect-[9/16] bg-black object-contain" />
                <div className="p-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-ink line-clamp-2">Clip {i + 1} · {v.title}</p>
                    {v.start != null && v.end != null && (
                      <p className="text-[0.7rem] text-muted font-mono mt-0.5">{mmss(v.start)} – {mmss(v.end)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={getApiUrl(v.url)} download className="text-muted hover:text-ink" title="Download">
                      <Download size={14} />
                    </a>
                    {job.kind === 'clips' && v.index != null && (
                      <button
                        onClick={() => removeClip(job, v, i + 1)}
                        disabled={deleting === `${job.job_id}:${v.index}`}
                        className="text-muted hover:text-warn"
                        title={`Delete clip ${i + 1}`}
                      >
                        {deleting === `${job.job_id}:${v.index}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
