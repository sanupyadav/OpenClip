import React, { useState, useEffect } from 'react';
import { Bot, Check, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { apiJson } from '../lib/api';
import Switch from './Switch';

const putJson = (path, body) => apiJson(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// Self-host: the OpenAI-compatible gateway profile. The key is write-only: the
// server never sends it back, so the field starts empty and a blank key keeps
// the one already saved. onSaved gets the server's { localLlm, llmSettings }.
export function LlmGatewayForm({ gateway, onSaved }) {
    const [baseUrl, setBaseUrl] = useState(gateway?.baseUrl || '');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState(gateway?.model || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = async (clear = false) => {
        setSaving(true);
        setError('');
        try {
            const res = await putJson('/api/llm/config',
                clear ? { base_url: '' } : { base_url: baseUrl, api_key: apiKey, model });
            setApiKey('');
            if (clear) { setBaseUrl(''); setModel(''); }
            onSaved?.(res);
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
                placeholder={gateway?.hasKey ? 'API key (saved, leave empty to keep it)' : 'API key'}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <input className="input-field font-mono" placeholder="Model, e.g. deepseek/deepseek-v4-flash"
                value={model} onChange={(e) => setModel(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => save()} disabled={saving || !baseUrl.trim()} className="btn-primary px-4 py-2 text-sm">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save gateway
                </button>
                {gateway?.baseUrl && (
                    <button onClick={() => save(true)} disabled={saving} className="btn-ghost px-4 py-2 text-sm">
                        Remove
                    </button>
                )}
                {error && <span className="text-sm text-warn">{error}</span>}
            </div>
        </div>
    );
}

// Self-host: a local Ollama, and the toggle that makes it the model the jobs
// use. Off, the gateway profile (or Gemini) takes over again.
function OllamaSection({ ollama, useOllama, onSaved }) {
    const [url, setUrl] = useState(ollama?.url || 'http://localhost:11434');
    const [model, setModel] = useState(ollama?.model || '');
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const loadModels = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiJson(`/api/llm/ollama/models?url=${encodeURIComponent(url)}`);
            setModels(res.models || []);
            if (!model && res.models?.length) setModel(res.models[0]);
            if (!res.models?.length) setError('Ollama answered but has no models. Run: ollama pull llama3.2');
        } catch (e) {
            setModels([]);
            setError(e.message || 'Could not reach Ollama');
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (ollama?.url) loadModels(); }, []);

    const save = async (enabled) => {
        if (enabled && !model.trim()) {
            setError('Pick a model first: press Models to load the ones installed in Ollama, or type one.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            onSaved?.(await putJson('/api/llm/ollama', { url, model, enabled }));
        } catch (e) {
            setError(e.message || 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    const changed = url !== (ollama?.url || '') || model !== (ollama?.model || '');

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink">Use Ollama for clip picking</p>
                <Switch checked={!!useOllama} disabled={saving}
                    onChange={(v) => save(v)} label="Use Ollama" />
            </div>
            <div className="flex gap-2">
                <input className="input-field font-mono flex-1" placeholder="http://localhost:11434"
                    value={url} onChange={(e) => setUrl(e.target.value)} />
                <button onClick={loadModels} disabled={loading || !url.trim()} className="btn-quiet px-3 py-2 text-sm shrink-0"
                    title="Load the models installed in this Ollama">
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Models
                </button>
            </div>
            {models.length > 0 ? (
                <select className="input-field font-mono" value={model} onChange={(e) => setModel(e.target.value)}>
                    {!models.includes(model) && model && <option value={model}>{model}</option>}
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
            ) : (
                <input className="input-field font-mono" placeholder="Model, e.g. llama3.2"
                    value={model} onChange={(e) => setModel(e.target.value)} />
            )}
            <div className="flex flex-wrap items-center gap-2">
                {changed && (
                    <button onClick={() => save(useOllama)} disabled={saving || !url.trim()} className="btn-primary px-4 py-2 text-sm">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save Ollama
                    </button>
                )}
                {error && <span className="text-sm text-warn break-all">{error}</span>}
            </div>
        </div>
    );
}

// Self-host Settings: which model picks the clip moments (gateway, Ollama or
// Gemini), a live test, and the two profiles.
export default function LocalLlmCard({ llm, settings, onSaved }) {
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

    const saved = (res) => { setResult(null); onSaved?.(res); };
    const source = !llm ? null : settings?.useOllama ? 'Ollama' : 'Gateway';

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-paper3 rounded-input text-brass">
                        <Bot size={18} />
                    </div>
                    <h2 className="font-display lowercase text-lg text-ink">Current AI model</h2>
                </div>
                {source ? <span className="badge-ok">{source}</span> : <span className="badge-warn">Gemini key only</span>}
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

                <div className="flex flex-wrap items-center gap-3 mb-2">
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
            </>)}

            <div className="mt-5 pt-5 border-t border-rule">
                <p className="eyebrow mb-3">Ollama (local)</p>
                <OllamaSection ollama={settings?.ollama} useOllama={settings?.useOllama} onSaved={saved} />
            </div>

            <div className={`mt-5 pt-5 border-t border-rule ${settings?.useOllama ? 'opacity-60' : ''}`}>
                <p className="eyebrow mb-3">
                    Gateway (OpenAI-compatible){settings?.useOllama ? ' · used when Ollama is off' : ''}
                </p>
                <LlmGatewayForm gateway={settings?.gateway} onSaved={saved} />
            </div>

            <p className="text-xs text-muted mt-5 leading-relaxed">
                The model here picks the clip moments instead of Gemini and applies to the next job; it survives a
                restart. The server's <code>.env</code> (<code>LLM_BASE_URL</code> / <code>LLM_API_KEY</code> /
                <code> LLM_MODEL</code>) works too. Ollama runs where the backend runs: from Docker, reach one on
                your PC with <code>http://host.docker.internal:11434</code>. Layout picking and on-screen hooks
                still use a Gemini key when one is set.
            </p>
        </div>
    );
}
