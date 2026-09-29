import React, { useState } from 'react';
import { Bot, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { apiJson } from '../lib/api';

// Self-host Settings: the OpenAI-compatible model the moment picker runs on
// (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY in the server's .env) and a live test.
export default function LocalLlmCard({ llm }) {
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState(null);

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
                <span className="badge-ok">Active</span>
            </div>

            <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 mb-4">
                <dt className="text-muted">Model</dt>
                <dd className="text-ink font-mono break-all">{llm.model}</dd>
                <dt className="text-muted">Server</dt>
                <dd className="text-ink font-mono break-all">{llm.baseUrl}</dd>
                <dt className="text-muted">API key</dt>
                <dd className={llm.hasKey ? 'text-ok' : 'text-muted'}>{llm.hasKey ? 'set on the server' : 'none'}</dd>
            </dl>

            <div className="flex flex-wrap items-center gap-3">
                <button onClick={runTest} disabled={testing} className="btn-quiet px-4 py-2 text-sm">
                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {testing ? 'Testing…' : 'Test model'}
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

            <p className="text-xs text-muted mt-4 leading-relaxed">
                Picks the clip moments instead of Gemini. Change it with <code>LLM_MODEL</code>,{' '}
                <code>LLM_BASE_URL</code> and <code>LLM_API_KEY</code> in the server's <code>.env</code>, then restart the backend.
                Layout picking and on-screen hooks still use a Gemini key when one is set.
            </p>
        </div>
    );
}
