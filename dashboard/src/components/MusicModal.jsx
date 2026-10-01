import React, { useState, useEffect } from 'react';
import { Music, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import Modal from './ui/Modal';
import { apiJson } from '../lib/api';

// Self-host: add, change or remove one clip's background music (Stable Audio
// Open, music.py). The clip keeps its file; onDone gets the server answer.
export default function MusicModal({ isOpen, onClose, jobId, index, inputFilename, onDone }) {
    const [settings, setSettings] = useState(null);
    const [style, setStyle] = useState('lofi');
    const [prompt, setPrompt] = useState('');
    const [volume, setVolume] = useState(0.18);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setError('');
        apiJson('/api/music/settings')
            .then((s) => { setSettings(s); setStyle(s.style); setVolume(s.volume); })
            .catch(() => setSettings({ styles: ['lofi'], available: false }));
    }, [isOpen]);

    const send = (remove) => async () => {
        setBusy(remove ? 'remove' : 'apply');
        setError('');
        try {
            const res = await apiJson('/api/music', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId, clip_index: index, input_filename: inputFilename, style, prompt, volume, remove }),
            });
            onDone?.(res);
            onClose();
        } catch (e) {
            setError(e.detail || e.message || 'Request failed');
        } finally {
            setBusy('');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} eyebrow="EDITOR · MUSIC" title="background music">
            {!settings ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
            ) : (
                <div className="space-y-4">
                    {!settings.available && (
                        <p className="text-xs text-warn">The music model is not installed on this server (diffusers + torchsde).</p>
                    )}
                    {settings.available && !settings.tokenSet && (
                        <p className="text-xs text-warn">HF_TOKEN is not set: accept the Stable Audio Open license on Hugging Face and set the token first.</p>
                    )}
                    <div>
                        <p className="eyebrow mb-2">Style</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.styles.map((s) => (
                                <button key={s} type="button" onClick={() => setStyle(s)}
                                    className={`px-3 py-1.5 rounded-input border text-xs lowercase transition-colors
                                        ${style === s && !prompt.trim() ? 'border-[color:var(--color-accent)] text-ink' : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="eyebrow mb-2">Or describe it</p>
                        <input className="input-field" placeholder="e.g. soft acoustic guitar, warm, slow (overrides the style)"
                            value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="eyebrow">Volume</p>
                            <span className="readout">{Math.round(volume * 100)}%</span>
                        </div>
                        <input type="range" min="2" max="60" step="1" value={Math.round(volume * 100)}
                            onChange={(e) => setVolume(parseInt(e.target.value, 10) / 100)}
                            className="w-full accent-[var(--color-accent)]" aria-label="music volume" />
                        <p className="text-[11px] text-muted mt-1">The music ducks on its own while someone is speaking.</p>
                    </div>
                    {error && (
                        <p className="text-sm text-warn flex items-start gap-1.5 break-words">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={send(true)} disabled={!!busy} className="btn-quiet py-2 text-sm">
                            {busy === 'remove' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} remove music
                        </button>
                        <button onClick={send(false)} disabled={!!busy || !settings.available} className="btn-primary py-2 text-sm">
                            {busy === 'apply' ? <><Loader2 size={14} className="animate-spin" /> making music…</> : <><Music size={14} /> apply music</>}
                        </button>
                    </div>
                    <p className="text-[11px] text-muted">
                        Generated by Stable Audio Open (instrumental, ~30-60 s on a T4). Applying again replaces the music, it never stacks.
                    </p>
                </div>
            )}
        </Modal>
    );
}
