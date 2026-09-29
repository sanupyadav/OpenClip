import React, { useState, useEffect } from 'react';
import { Send, Loader2, Check, ExternalLink, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import { apiJson } from '../lib/api';

// The "already sent to Telegram" mark; links to the message when the chat has one.
export function TelegramMark({ mark, className = '' }) {
    if (!mark) return null;
    const body = <><Send size={11} /> telegram <Check size={11} /></>;
    const cls = `badge-ok inline-flex items-center gap-1 ${className}`;
    return mark.url
        ? <a href={mark.url} target="_blank" rel="noopener noreferrer" title={`Sent to ${mark.chat}`} className={cls}>{body}</a>
        : <span title={`Sent to ${mark.chat}`} className={cls}>{body}</span>;
}

// Self-host: send one clip to the Telegram chat set in Settings, with the
// user's own bot. onSent gets the saved mark.
export default function TelegramSendModal({ isOpen, onClose, clip, jobId, index, inputFilename, onOpenSettings, sent = null, onSent }) {
    const [status, setStatus] = useState(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setResult(null);
        setError('');
        setTitle(clip?.video_title_for_youtube_short || clip?.title || '');
        setDescription(clip?.video_description_for_instagram || clip?.video_description_for_tiktok || '');
        apiJson('/api/telegram/status').then(setStatus).catch(() => setStatus({ ready: false }));
    }, [isOpen, clip]);

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await apiJson('/api/telegram/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId, clip_index: index, input_filename: inputFilename, title, description }),
            });
            setResult(res);
            onSent?.(res);
        } catch (e) {
            setError(e.message || 'Send failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} eyebrow="TELEGRAM" title="send to telegram">
            {!status ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
            ) : !status.ready ? (
                <div className="space-y-3 text-sm">
                    <p className="text-muted">Set up your Telegram bot and chat first. It is free.</p>
                    <button onClick={() => { onClose(); onOpenSettings?.(); }} className="btn-primary px-4 py-2 text-sm">
                        Open Settings
                    </button>
                </div>
            ) : result ? (
                <div className="space-y-3 text-sm">
                    <p className="text-ok flex items-center gap-2"><Check size={16} /> Sent to {result.chat}.</p>
                    {result.url && (
                        <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-brass hover:underline inline-flex items-center gap-1">
                            {result.url} <ExternalLink size={12} />
                        </a>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-xs text-muted">
                        To: <span className="text-ink">{status.chatTitle || status.chatId}</span> · via @{status.bot}
                    </p>
                    {sent && (
                        <p className="text-xs text-muted flex flex-wrap items-center gap-2">
                            Already sent: <TelegramMark mark={sent} /> Sending again posts it again.
                        </p>
                    )}
                    <input className="input-field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <textarea className="input-field min-h-[90px]" placeholder="Caption" value={description}
                        onChange={(e) => setDescription(e.target.value)} />
                    <p className="text-[0.7rem] text-muted">Title and caption go together, up to 1,024 characters. Bots can send clips up to 50 MB.</p>
                    {error && (
                        <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}
                    <button onClick={send} disabled={busy} className="btn-primary w-full py-2 text-sm">
                        {busy ? <><Loader2 size={14} className="animate-spin" /> sending…</> : <><Send size={14} /> send now</>}
                    </button>
                </div>
            )}
        </Modal>
    );
}
