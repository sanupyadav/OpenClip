// How far along a clip job is, read from its log lines (main.py's markers).
// Bands: download 0-10, transcription 10-40, moment picking 40-60, render 60-100.
export function jobProgress(logs = []) {
  let pct = 0;
  let label = 'Starting…';
  let totalClips = 0;
  let readyClips = 0;
  for (const line of logs) {
    let m;
    if ((m = [...line.matchAll(/\[download\]\s+([\d.]+)%/g)].pop())) {
      pct = Math.max(pct, (parseFloat(m[1]) / 100) * 10);
      label = 'Downloading video';
    } else if (/Video downloaded in/.test(line)) {
      pct = Math.max(pct, 10);
      label = 'Transcribing';
    } else if ((m = line.match(/Transcribing… (\d+)%/))) {
      pct = Math.max(pct, 10 + (parseInt(m[1], 10) / 100) * 30);
      label = `Transcribing ${m[1]}%`;
    } else if (/Using the transcript|Analyzing with/.test(line)) {
      pct = Math.max(pct, 42);
      label = 'Finding the best moments';
    } else if (/Shortlisted \d+ window/.test(line)) {
      pct = Math.max(pct, 52);
      label = 'Writing clip titles';
    } else if ((m = line.match(/Found (\d+) clips/))) {
      totalClips = parseInt(m[1], 10);
      pct = Math.max(pct, 60);
      label = `Rendering 0 / ${totalClips} clips`;
    } else if (/✅ Clip \d+ ready/.test(line)) {
      readyClips += 1;
      if (totalClips) {
        pct = Math.max(pct, 60 + (readyClips / totalClips) * 40);
        label = `Rendering ${readyClips} / ${totalClips} clips`;
      }
    }
  }
  return { pct: Math.min(99, Math.round(pct)), label };
}
