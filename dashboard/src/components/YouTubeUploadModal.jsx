import React, { useState, useEffect } from 'react';
import { Youtube, Loader2, Check, ExternalLink, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import { apiJson } from '../lib/api';

// The "already on YouTube" mark, linking to the video.
export function YouTubeMark({ mark, className = '' }) {
    if (!mark?.url) return null;
    return (
        <a href={mark.url} target="_blank" rel="noopener noreferrer" title={`On YouTube (${mark.privacy})`}
            className={`badge-ok inline-flex items-center gap-1 ${className}`}>
            <Youtube size={11} /> on youtube <Check size={11} />
        </a>
    );
}

// Self-host: upload one clip straight to the user's YouTube channel with their
// own Google OAuth client (Settings → YouTube direct). Separate from the
// Upload-Post "post" flow on purpose. onUploaded gets the saved mark.
export default function YouTubeUploadModal({ isOpen, onClose, clip, jobId, index, inputFilename, onOpenSettings, uploaded = null, onUploaded }) {
    const [status, setStatus] = useState(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState('');
    const [privacy, setPrivacy] = useState('public');
    const [schedule, setSchedule] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setResult(null);
        setError('');
        setTitle(clip?.video_title_for_youtube_short || clip?.title || '');
        setDescription(clip?.video_description_for_instagram || clip?.video_description_for_tiktok || '');
        apiJson('/api/youtube/status').then(setStatus).catch(() => setStatus({ connected: false }));
    }, [isOpen, clip]);

    const upload = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await apiJson('/api/youtube/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId, clip_index: index, input_filename: inputFilename,
                    title, description, privacy,
                    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
                    publish_at: schedule ? new Date(schedule).toISOString() : null,
                }),
            });
            setResult(res);
            onUploaded?.(res);
        } catch (e) {
            setError(e.detail || e.message || 'Upload failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} eyebrow="YOUTUBE DIRECT" title="upload to youtube">
            {!status ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
            ) : !status.connected ? (
                <div className="space-y-3 text-sm">
                    <p className="text-muted">Connect your YouTube channel first. It is free and uses your own Google project.</p>
                    <button onClick={() => { onClose(); onOpenSettings?.(); }} className="btn-primary px-4 py-2 text-sm">
                        Open Settings
                    </button>
                </div>
            ) : result ? (
                <div className="space-y-3 text-sm">
                    <p className="text-ok flex items-center gap-2"><Check size={16} /> Uploaded to {status.channel || 'your channel'}.</p>
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-brass hover:underline inline-flex items-center gap-1">
                        {result.url} <ExternalLink size={12} />
                    </a>
                    {result.privacy === 'private' && (
                        <p className="text-xs text-muted">It is private{schedule ? ' until the scheduled time' : ''}. Google keeps uploads from a
                            project it has not audited private: make it public in YouTube Studio.</p>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-xs text-muted">Channel: <span className="text-ink">{status.channel || 'connected'}</span></p>
                    {uploaded?.url && (
                        <p className="text-xs text-muted flex flex-wrap items-center gap-2">
                            Already uploaded: <YouTubeMark mark={uploaded} /> Uploading again makes a second video.
                        </p>
                    )}
                    <input className="input-field" maxLength={100} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <textarea className="input-field min-h-[90px]" placeholder="Description (#Shorts is added)" value={description}
                        onChange={(e) => setDescription(e.target.value)} />
                    <input className="input-field" placeholder="Tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                        <select className="input-field" value={privacy} onChange={(e) => setPrivacy(e.target.value)} disabled={!!schedule}>
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                        </select>
                        <input type="datetime-local" className="input-field" title="Schedule (optional)" value={schedule}
                            onChange={(e) => setSchedule(e.target.value)} />
                    </div>
                    {error && (
                        <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}
                    <button onClick={upload} disabled={busy || !title.trim()} className="btn-primary w-full py-2 text-sm">
                        {busy ? <><Loader2 size={14} className="animate-spin" /> uploading…</> : <><Youtube size={14} /> {schedule ? 'schedule on youtube' : 'upload now'}</>}
                    </button>
                </div>
            )}
        </Modal>
    );
}
