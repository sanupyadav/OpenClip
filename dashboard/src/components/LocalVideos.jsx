import React, { useState, useEffect } from 'react';
import { Film, Download, Trash2, Loader2, Youtube, Send } from 'lucide-react';
import { apiJson } from '../lib/api';
import { getApiUrl } from '../config';
import YouTubeUploadModal, { YouTubeMark } from './YouTubeUploadModal';
import TelegramSendModal, { TelegramMark } from './TelegramSendModal';
import { unsendTelegram, sendToTelegram, fetchTelegramSends } from '../lib/telegram';

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Self-host: everything finished in output/ (clip jobs and UGC videos), with
// delete per job. The cloud build has the History tab instead.
export default function LocalVideos({ onCount, onOpenSettings }) {
  const [jobs, setJobs] = useState(null);
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');
  const [ytTarget, setYtTarget] = useState(null); // { job, v }
  const [tgTarget, setTgTarget] = useState(null); // { job, v }

  useEffect(() => {
    apiJson('/api/local/videos')
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    if (jobs) onCount?.(jobs.reduce((n, j) => n + j.videos.length, 0));
  }, [jobs, onCount]);

  const setTelegramMarks = (jobId, marks) => setJobs((js) => js && js.map((j) => (j.job_id !== jobId ? j : {
    ...j, videos: j.videos.map((x) => (x.index == null ? x : { ...x, telegram: marks[String(x.index)] || null })),
  })));

  // Sends run on the server in the background: poll the jobs that have one on its way.
  const sendingJobs = (jobs || [])
    .filter((j) => j.videos.some((v) => ['sending', 'queued'].includes(v.telegram?.status))).map((j) => j.job_id).join(',');
  useEffect(() => {
    if (!sendingJobs) return;
    const t = setInterval(() => {
      sendingJobs.split(',').forEach((id) => fetchTelegramSends(id).then((m) => setTelegramMarks(id, m)));
    }, 4000);
    return () => clearInterval(t);
  }, [sendingJobs]);

  // "Send all": every clip of the job that is not sent or on its way yet.
  const sendAll = async (job) => {
    const todo = job.videos.filter((v) => v.index != null && !['sent', 'sending', 'queued'].includes(v.telegram?.status || (v.telegram ? 'sent' : '')));
    if (!todo.length) { setError('Every clip of this video is already sent or on its way.'); return; }
    if (!window.confirm(`Send ${todo.length} clip(s) to Telegram? They go in the background, two at a time.`)) return;
    setError('');
    for (const v of todo) {
      try {
        const mark = await sendToTelegram({ jobId: job.job_id, index: v.index, inputFilename: v.url.split('/').pop(),
          title: v.title, description: v.description });
        setJobs((js) => js.map((j) => (j.job_id !== job.job_id ? j : {
          ...j, videos: j.videos.map((x) => (x.index === v.index ? { ...x, telegram: mark } : x)),
        })));
      } catch (e) {
        setError(e.detail || e.message || 'Could not send');
        if (e.status === 400) break;  // not set up: the rest would fail the same way
      }
    }
  };

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
      <YouTubeUploadModal
        isOpen={!!ytTarget}
        onClose={() => setYtTarget(null)}
        clip={ytTarget && {
          title: ytTarget.v.title, video_description_for_instagram: ytTarget.v.description,
          video_description_for_youtube: ytTarget.v.youtube_description, youtube_tags: ytTarget.v.youtube_tags,
        }}
        jobId={ytTarget?.job.job_id}
        index={ytTarget?.v.index}
        inputFilename={ytTarget?.v.url.split('/').pop()}
        uploaded={ytTarget?.v.youtube}
        onOpenSettings={onOpenSettings}
        onUploaded={(mark) => {
          const { job, v } = ytTarget;
          setJobs((js) => js.map((j) => (j.job_id !== job.job_id ? j : {
            ...j, videos: j.videos.map((x) => (x.index === v.index ? { ...x, youtube: mark } : x)),
          })));
          setYtTarget((t) => t && { ...t, v: { ...t.v, youtube: mark } });
        }}
      />
      <TelegramSendModal
        isOpen={!!tgTarget}
        onClose={() => setTgTarget(null)}
        clip={tgTarget && { title: tgTarget.v.title, video_description_for_instagram: tgTarget.v.description }}
        jobId={tgTarget?.job.job_id}
        index={tgTarget?.v.index}
        inputFilename={tgTarget?.v.url.split('/').pop()}
        sent={tgTarget?.v.telegram}
        onOpenSettings={onOpenSettings}
        onSent={(mark) => {
          const { job, v } = tgTarget;
          setJobs((js) => js.map((j) => (j.job_id !== job.job_id ? j : {
            ...j, videos: j.videos.map((x) => (x.index === v.index ? { ...x, telegram: mark } : x)),
          })));
          setTgTarget((t) => t && { ...t, v: { ...t.v, telegram: mark } });
        }}
      />
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
            {job.kind === 'clips' && (
              <button onClick={() => sendAll(job)} className="btn-quiet px-3 py-1.5 text-xs ml-auto"
                title="Send every clip of this video to your Telegram chat">
                <Send size={12} /> Send all to Telegram
              </button>
            )}
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
                <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
                  <YouTubeMark mark={v.youtube} />
                  <TelegramMark mark={v.telegram} onDelete={async () => {
                    if (!(await unsendTelegram(job.job_id, v.index))) return;
                    setJobs((js) => js.map((j) => (j.job_id !== job.job_id ? j : {
                      ...j, videos: j.videos.map((x) => (x.index === v.index ? { ...x, telegram: null } : x)),
                    })));
                  }} />
                </div>
                <video src={getApiUrl(v.url)} controls preload="metadata" className="w-full aspect-[9/16] bg-black object-contain" />
                <div className="p-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-ink line-clamp-2">Clip {i + 1} · {v.title}</p>
                    {v.start != null && v.end != null && (
                      <p className="text-[0.7rem] text-muted font-mono mt-0.5">{mmss(v.start)} – {mmss(v.end)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.kind === 'clips' && v.index != null && (
                      <button onClick={() => setYtTarget({ job, v })}
                        className={v.youtube ? 'text-ok hover:text-brass' : 'text-muted hover:text-brass'}
                        title={v.youtube ? 'On YouTube: upload again' : 'Upload to YouTube'}>
                        <Youtube size={14} />
                      </button>
                    )}
                    {job.kind === 'clips' && v.index != null && (
                      <button onClick={() => setTgTarget({ job, v })}
                        className={v.telegram ? 'text-ok hover:text-brass' : 'text-muted hover:text-brass'}
                        title={v.telegram ? 'Sent to Telegram: send again' : 'Send to Telegram'}>
                        <Send size={14} />
                      </button>
                    )}
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
