import React, { useState, useEffect } from 'react';
import { Send, Check, Loader2, AlertTriangle, Search } from 'lucide-react';
import { apiJson } from '../lib/api';

// Self-host Settings: the user's own Telegram bot and the chat clips go to.
// The token stays on the server (write-only).
export default function TelegramCard() {
    const [status, setStatus] = useState(null);
    const [token, setToken] = useState('');
    const [chatId, setChatId] = useState('');
    const [chats, setChats] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        apiJson('/api/telegram/status')
            .then((s) => { setStatus(s); setChatId(s.chatId || ''); })
            .catch(() => setStatus(null));
    }, []);

    const run = async (fn) => {
        setBusy(true);
        setError('');
        try { await fn(); } catch (e) { setError(e.detail || e.message || 'Request failed'); } finally { setBusy(false); }
    };

    const save = (chat = chatId) => run(async () => {
        const s = await apiJson('/api/telegram/config', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_token: token, chat_id: chat }),
        });
        setStatus(s);
        setToken('');
        setChatId(s.chatId || '');
    });

    const findChats = () => run(async () => {
        setChats((await apiJson('/api/telegram/chats')).chats || []);
    });

    if (!status) return null;

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-paper3 rounded-input text-brass"><Send size={18} /></div>
                    <h2 className="font-display lowercase text-lg text-ink">Telegram</h2>
                </div>
                {status.ready
                    ? <span className="badge-ok">@{status.bot} → {status.chatTitle || status.chatId}</span>
                    : <span className="badge-warn">Not set up</span>}
            </div>

            <ol className="text-xs text-muted space-y-1.5 list-decimal list-inside mb-4 leading-relaxed">
                <li>In Telegram, open <a className="text-brass underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a>, send <code>/newbot</code> and copy the token.</li>
                <li>Send your bot any message, or add it to your group, or make it an admin of your channel.</li>
                <li>Save the token, press <b>Find my chat</b> and pick the chat (a public channel can also be typed as <code>@name</code>).</li>
            </ol>

            <div className="space-y-2">
                <input className="input-field font-mono" type="password" autoComplete="off"
                    placeholder={status.hasToken ? `Bot token (saved for @${status.bot}, leave empty to keep it)` : 'Bot token, e.g. 123456:ABC-…'}
                    value={token} onChange={(e) => setToken(e.target.value)} />
                <div className="flex gap-2">
                    <input className="input-field font-mono flex-1" placeholder="Chat ID or @channel"
                        value={chatId} onChange={(e) => setChatId(e.target.value)} />
                    <button onClick={findChats} disabled={busy || !status.hasToken} className="btn-quiet px-3 py-2 text-sm shrink-0"
                        title="List the chats your bot has seen">
                        <Search size={14} /> Find my chat
                    </button>
                </div>
                {chats && (chats.length ? (
                    <div className="flex flex-wrap gap-2">
                        {chats.map((c) => (
                            <button key={c.id} onClick={() => { setChatId(c.id); save(c.id); }}
                                className="btn-quiet px-3 py-1.5 text-xs">
                                {c.title} <span className="text-muted">({c.type})</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-warn">No chats yet: send your bot a message (or post in the group/channel), then try again.</p>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => save()} disabled={busy || (!token.trim() && !status.hasToken)} className="btn-primary px-4 py-2 text-sm">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                    </button>
                </div>
                {error && (
                    <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                    </p>
                )}
            </div>

            <p className="text-xs text-muted mt-4 leading-relaxed">
                Then every clip gets a <b>telegram</b> button. Free, no limit on the number of clips; a bot can send up to 50 MB per clip.
            </p>
        </div>
    );
}
