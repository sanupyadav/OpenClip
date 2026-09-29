import React, { useState } from 'react';
import { Bot, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { apiJson } from '../lib/api';

// Self-host: point the moment picker at an OpenAI-compatible gateway from the
// dashboard. The key is write-only: the server never sends it back, so the
// field starts empty and a blank key keeps the one already saved.
export function LlmGatewayForm({ llm, onSaved }) {
    const [baseUrl, setBaseUrl] = useState(llm?.baseUrl || '');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState(llm?.model || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = async (clear = false) => {
        setSaving(true);
        setError('');
        try {
            const res = await apiJson('/api/llm/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clear ? { base_url: '' } : { base_url: baseUrl, api_key: apiKey, model }),
            });
            setApiKey('');
            if (clear) { setBaseUrl(''); setModel(''); }
            onSaved?.(res.localLlm || null);
        } catch (e) {
            setError(e.message || 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            <input className="input-field font-mono" placeholder="https://your-gateway.trycloudflare.com/v1"
                value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <input className="input-field font-mono" type="password" autoComplete="off"
                placeholder={llm?.hasKey ? 'API key (saved, leave empty to keep it)' : 'API key'}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <input className="input-field font-mono" placeholder="Model, e.g. deepseek/deepseek-v4-flash"
                value={model} onChange={(e) => setModel(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => save()} disabled={saving || !baseUrl.trim()} className="btn-primary px-4 py-2 text-sm">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save gateway
                </button>
                {llm && (
                    <button onClick={() => save(true)} disabled={saving} className="btn-ghost px-4 py-2 text-sm">
                        Remove
                    </button>
                )}
                {error && <span className="text-sm text-warn">{error}</span>}
            </div>
        </div>
    );
}

// Self-host Settings: the OpenAI-compatible model the moment picker runs on
// (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY in the server's .env) and a live test.
export default function LocalLlmCard({ llm, onSaved }) {
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState(null);
    const [editing, setEditing] = useState(!llm);

    const runTest = async () => {
        setTesting(true);
        setResult(null);
        try {
            setResult(await apiJson('/api/llm/test', { method: 'POST' }));
        } catch (e) {
            setResult({ ok: false, error: e.message || 'Request failed' });
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-paper3 rounded-input text-brass">
                        <Bot size={18} />
                    </div>
                    <h2 className="font-display lowercase text-lg text-ink">Current AI model</h2>
                </div>
                {llm ? <span className="badge-ok">Active</span> : <span className="badge-warn">Not set</span>}
            </div>

            {llm && (<>
            <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 mb-4">
                <dt className="text-muted">Model</dt>
                <dd className="text-ink font-mono break-all">{llm.model}</dd>
                <dt className="text-muted">Server</dt>
                <dd className="text-ink font-mono break-all">{llm.baseUrl}</dd>
                <dt className="text-muted">API key</dt>
                <dd className={llm.hasKey ? 'text-ok' : 'text-muted'}>{llm.hasKey ? 'set on the server (hidden)' : 'none'}</dd>
            </dl>

            <div className="flex flex-wrap items-center gap-3">
                <button onClick={runTest} disabled={testing} className="btn-quiet px-4 py-2 text-sm">
                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {testing ? 'Testing…' : 'Test model'}
                </button>
                <button onClick={() => setEditing((v) => !v)} className="btn-ghost px-4 py-2 text-sm">
                    {editing ? 'Close' : 'Change'}
                </button>
                {result && (result.ok ? (
                    <span className="text-sm text-ok flex items-center gap-1.5">
                        <Check size={14} /> Working · answered in {result.seconds}s
                    </span>
                ) : (
                    <span className="text-sm text-warn flex items-start gap-1.5 break-all">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" /> Not working: {result.error}
                    </span>
                ))}
            </div>
            </>)}

            {editing && (
                <div className="mt-4">
                    <LlmGatewayForm llm={llm} onSaved={(next) => { setResult(null); setEditing(!next); onSaved?.(next); }} />
                </div>
            )}

            <p className="text-xs text-muted mt-4 leading-relaxed">
                Any OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenRouter, your own gateway) picks the clip
                moments instead of Gemini. Saved here it applies to the next job and survives a restart; the
                server's <code>.env</code> (<code>LLM_BASE_URL</code> / <code>LLM_API_KEY</code> / <code>LLM_MODEL</code>) works too.
                Layout picking and on-screen hooks still use a Gemini key when one is set.
            </p>
        </div>
    );
}
