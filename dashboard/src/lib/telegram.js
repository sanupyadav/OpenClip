import { apiJson } from './api';

// Delete a sent clip from the Telegram chat and drop its mark. Telegram only
// lets a bot delete within 48 h; past that, offer to drop the mark alone.
// Resolves true when the mark is gone.
export async function unsendTelegram(jobId, index) {
    if (!window.confirm('Delete this clip from the Telegram chat?')) return false;
    const path = `/api/telegram/sends/${encodeURIComponent(jobId)}/${index}`;
    try {
        await apiJson(path, { method: 'DELETE' });
        return true;
    } catch (e) {
        const why = e.detail || e.message || 'Could not delete';
        if (e.status === 409) {
            if (!window.confirm(`${why}\n\nRemove the "sent" mark here anyway?`)) return false;
            await apiJson(`${path}?forget=true`, { method: 'DELETE' });
            return true;
        }
        alert(why);
        return false;
    }
}


// Queue a clip for the background send. Resolves to the "sending" mark.
export function sendToTelegram({ jobId, index, inputFilename = null, title = '', description = '' }) {
    return apiJson('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, clip_index: index, input_filename: inputFilename, title, description }),
    });
}

// The Telegram marks of one job, by clip index ({} when unavailable).
export function fetchTelegramSends(jobId) {
    return apiJson(`/api/telegram/sends/${encodeURIComponent(jobId)}`).then((d) => d.sends || {}).catch(() => ({}));
}
