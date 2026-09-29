import React, { useState, useEffect } from 'react';
import { Send, Loader2, Check, AlertTriangle, Trash2, X } from 'lucide-react';
import Modal from './ui/Modal';
import { apiJson } from '../lib/api';

// The Telegram mark of a clip. Sends run on the server in the background, so
// it is "sending" (spinner), then sent (links to the message when the chat
// has one) or failed (the reason on hover). onDelete deletes the message from
// the chat, or drops a failed mark.
export function TelegramMark({ mark, className = '', onDelete }) {
    const [busy, setBusy] = useState(false);
    if (!mark) return null;
    const status = mark.status || 'sent';  // marks from before background sends have none
    if (status === 'sending') {
        return (
            <span className={`badge-brass inline-flex items-center gap-1 ${className}`} title={`Sending to ${mark.chat}…`}>
                <Loader2 size={11} className="animate-spin" /> telegram…
            </span>
        );
    }
    const failed = status === 'failed';
    const shrunk = mark.compressedFromMb ? ` · compressed ${mark.compressedFromMb} → ${mark.sentMb} MB` : '';
    const tip = failed ? `Not sent: ${mark.error || 'unknown error'}` : `Sent to ${mark.chat}${shrunk}`;
    const body = <><Send size={11} /> telegram {failed ? <X size={11} /> : <Check size={11} />}</>;
    const cls = `${failed ? 'badge-danger' : 'badge-ok'} inline-flex items-center gap-1`;
    return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
            {mark.url && !failed
                ? <a href={mark.url} target="_blank" rel="noopener noreferrer" title={tip} className={cls}>{body}</a>
                : <span title={tip} className={cls}>{body}</span>}
            {onDelete && (
                <button type="button" disabled={busy} title={failed ? 'Remove this mark' : 'Delete it from the Telegram chat'}
                    className={`${failed ? 'badge-danger' : 'badge-ok'} inline-flex items-center px-1.5 hover:text-warn`}
                    onClick={async (e) => { e.preventDefault(); setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>
                    {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
            )}
        </span>
    );
}

// Self-host: send one clip to the Telegram chat set in Settings, with the
// user's own bot. The server sends it in the background, so the dialog closes
// at once (the tab can close too); onSent gets the "sending" mark to show.
export default function TelegramSendModal({ isOpen, onClose, clip, jobId, index, inputFilename, onOpenSettings, sent = null, onSent }) {
    const [status, setStatus] = useState(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
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
            onSent?.(res);
            onClose();
        } catch (e) {
            setError(e.detail || e.message || 'Send failed');
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
            ) : (
                <div className="space-y-3">
                    <p className="text-xs text-muted">
                        To: <span className="text-ink">{status.chatTitle || status.chatId}</span> · via @{status.bot}
                    </p>
                    {sent && sent.status !== 'failed' && (
                        <p className="text-xs text-muted flex flex-wrap items-center gap-2">
                            Already {sent.status === 'sending' ? 'on its way' : 'sent'}: <TelegramMark mark={sent} /> Sending again posts it again.
                        </p>
                    )}
                    <input className="input-field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <textarea className="input-field min-h-[90px]" placeholder="Caption" value={description}
                        onChange={(e) => setDescription(e.target.value)} />
                    <p className="text-[0.7rem] text-muted">Title and caption go together, up to 1,024 characters. A clip over 50 MB is sent as a
                        compressed copy under 49 MB (same size on screen, lower bitrate); your clip keeps its full quality.</p>
                    {error && (
                        <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}
                    <button onClick={send} disabled={busy || sent?.status === 'sending'} className="btn-primary w-full py-2 text-sm">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} send in background
                    </button>
                    <p className="text-[0.7rem] text-muted text-center">You can close this, or the tab: the server keeps sending. The clip shows its status.</p>
                </div>
            )}
        </Modal>
    );
}
