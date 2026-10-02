import React, { useState, useEffect } from 'react';
import { Music, AlertTriangle } from 'lucide-react';
import { apiJson } from '../lib/api';
import Switch from './Switch';

// Self-host Settings: background music on every new clip (music.py).
export default function MusicCard() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        apiJson('/api/music/settings').then(setStatus).catch(() => setStatus(null));
    }, []);

    const save = async (body) => {
        setError('');
        try {
            setStatus(await apiJson('/api/music/settings', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            }));
        } catch (e) {
            setError(e.detail || e.message || 'Request failed');
        }
    };

    if (!status) return null;

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-paper3 rounded-input text-brass"><Music size={18} /></div>
                    <h2 className="font-display lowercase text-lg text-ink">Background music</h2>
                </div>
                {!status.available ? <span className="badge-warn">Not installed</span>
                    : !status.tokenSet ? <span className="badge-warn">HF_TOKEN missing</span>
                        : <span className="badge-ok">Ready</span>}
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm text-ink">Add music to new clips</p>
                        <p className="text-xs text-muted">Every clip of a finished job gets its own instrumental track, designed for that clip.</p>
                    </div>
                    <Switch checked={!!status.auto} disabled={!status.available} onChange={(on) => save({ auto: on })} label="Add music to new clips" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <select className="input-field !w-auto text-xs py-1.5" value={status.style}
                        onChange={(e) => save({ style: e.target.value })} aria-label="music style">
                        {status.styles.map((s) => <option key={s} value={s}>{s === 'auto' ? 'auto (made for each clip)' : s}</option>)}
                    </select>
                    <span className="text-xs text-muted">volume</span>
                    <input type="range" min="2" max="60" step="1" defaultValue={Math.round(status.volume * 100)}
                        onMouseUp={(e) => save({ volume: parseInt(e.target.value, 10) / 100 })}
                        onTouchEnd={(e) => save({ volume: parseInt(e.target.value, 10) / 100 })}
                        onKeyUp={(e) => save({ volume: parseInt(e.target.value, 10) / 100 })}
                        className="flex-1 min-w-[120px] accent-[var(--color-accent)]" aria-label="music volume" />
                </div>
                {error && (
                    <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                    </p>
                )}
            </div>

            <p className="text-xs text-muted mt-4 leading-relaxed">
                Made by <a className="text-brass underline" href="https://huggingface.co/stabilityai/stable-audio-open-1.0" target="_blank" rel="noopener noreferrer">Stable Audio Open</a>:
                instrumental, and commercial use is allowed under the Stability Community License (free under $1M a year in revenue).
                The model is gated: accept its license on that page once and set <code>HF_TOKEN</code>. Each clip also gets a <b>music</b> button to change or remove it.
            </p>
        </div>
    );
}
