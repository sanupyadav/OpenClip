import React, { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Job clock for the Clip Generator. `times` are the server's log timestamps
// (seconds), so the start survives a refresh; ticks while running, then
// freezes on the total once the job ends.
export default function ElapsedTimer({ times, running }) {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!times || times.length === 0) return null;
  const end = running ? now : times[times.length - 1];
  return (
    <span className="readout flex items-center gap-1 tabular-nums" title={running ? 'Time since the job started' : 'Total processing time'}>
      <Timer size={12} className="shrink-0" />
      {fmt(end - times[0])}
    </span>
  );
}
