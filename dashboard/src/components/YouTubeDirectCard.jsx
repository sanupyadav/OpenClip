import React, { useState, useEffect, useCallback } from 'react';
import { Youtube, Check, Copy, Loader2, AlertTriangle } from 'lucide-react';
import { apiJson } from '../lib/api';

const CALLBACK = '/api/youtube/callback';

// Self-host Settings: post straight to YouTube with the user's own Google OAuth
// client. Free (YouTube Data API quota: ~6 uploads a day). The secret and the
// login token stay on the server.
export default function YouTubeDirectCard() {
    const [status, setStatus] = useState(null);
    const [clientId, setClientId] = useState('');
    const [secret, setSecret] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const redirectUri = `${window.location.origin}${CALLBACK}`;

    const refresh = useCallback(() => apiJson('/api/youtube/status')
        .then((s) => { setStatus(s); setClientId((v) => v || s.clientId || ''); })
        .catch(() => setStatus(null)), []);

    useEffect(() => {
        refresh();
        const onMessage = (e) => { if (e.data?.type === 'youtube-auth') refresh(); };
        window.addEventListener('message', onMessage);
        window.addEventListener('focus', refresh);
        return () => { window.removeEventListener('message', onMessage); window.removeEventListener('focus', refresh); };
    }, [refresh]);

    const run = async (fn) => {
        setBusy(true);
        setError('');
        try { await fn(); } catch (e) { setError(e.detail || e.message || 'Request failed'); } finally { setBusy(false); }
    };

    const saveClient = () => run(async () => {
        setStatus(await apiJson('/api/youtube/client', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: secret }),
        }));
        setSecret('');
    });

    const connect = () => run(async () => {
        const { url } = await apiJson('/api/youtube/auth', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirect_uri: redirectUri }),
        });
        if (!window.open(url, 'youtube-auth', 'width=520,height=680')) window.location.href = url;
    });

    const disconnect = () => run(async () => {
        setStatus(await apiJson('/api/youtube/connection', { method: 'DELETE' }));
    });

    const copy = () => {
        navigator.clipboard?.writeText(redirectUri).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    };

    if (!status) return null;

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-paper3 rounded-input text-brass"><Youtube size={18} /></div>
                    <h2 className="font-display lowercase text-lg text-ink">YouTube (direct)</h2>
                </div>
                {status.connected
                    ? <span className="badge-ok">Connected{status.channel ? ` · ${status.channel}` : ''}</span>
                    : <span className="badge-warn">Not connected</span>}
            </div>

            <ol className="text-xs text-muted space-y-1.5 list-decimal list-inside mb-4 leading-relaxed">
                <li>In <a className="text-brass underline" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>, create a project and enable <b>YouTube Data API v3</b>.</li>
                <li><b>OAuth consent screen</b>: External, and add your Google account under <b>Test users</b>.</li>
                <li><b>Credentials → Create OAuth client ID → Web application</b>, with this <b>Authorized redirect URI</b>:</li>
            </ol>
            <div className="flex gap-2 mb-4">
                <code className="input-field font-mono text-xs break-all flex-1">{redirectUri}</code>
                <button onClick={copy} className="btn-quiet px-3 text-sm shrink-0" title="Copy">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
            </div>
            <p className="text-xs text-muted mb-3">
                The URI changes with the address you open the dashboard at (a new Kaggle tunnel is a new URL): add each one to the client.
            </p>

            <div className="space-y-2">
                <input className="input-field font-mono" placeholder="Client ID (…apps.googleusercontent.com)"
                    value={clientId} onChange={(e) => setClientId(e.target.value)} />
                <input className="input-field font-mono" type="password" autoComplete="off"
                    placeholder={status.hasSecret ? 'Client secret (saved, leave empty to keep it)' : 'Client secret'}
                    value={secret} onChange={(e) => setSecret(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={saveClient} disabled={busy || !clientId.trim() || (!secret.trim() && !status.hasSecret)}
                        className="btn-quiet px-4 py-2 text-sm">
                        <Check size={14} /> Save client
                    </button>
                    {status.configured && !status.connected && (
                        <button onClick={connect} disabled={busy} className="btn-primary px-4 py-2 text-sm">
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={14} />} Connect YouTube
                        </button>
                    )}
                    {status.connected && (
                        <button onClick={disconnect} disabled={busy} className="btn-ghost px-4 py-2 text-sm">Disconnect</button>
                    )}
                </div>
                {error && (
                    <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                    </p>
                )}
            </div>

            <p className="text-xs text-muted mt-4 leading-relaxed">
                Then every clip gets a <b>youtube</b> button. Free: the API allows ~6 uploads a day. Google keeps uploads from a
                project it has not audited <b>private</b>; make them public in YouTube Studio, or pass Google's free
                YouTube API audit to upload public directly.
            </p>
        </div>
    );
}
