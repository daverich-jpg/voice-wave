import { useEffect, useRef, useState } from "react";
import { VoiceWaveform, type SourceKind, type VoiceState, type WaveStats } from "./components/VoiceWaveform";

type Theme = "system" | "light" | "dark";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-(--vw-pill) p-1 shadow-(--vw-pill-shadow)">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-(--vw-focus) ${
            value === o.value ? "bg-(--vw-btn) text-(--vw-heading)" : "text-(--vw-muted) hover:text-(--vw-heading)"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Reviewer readout: what's actually driving the wave, refreshed 5×/s. */
function Readout({ statsRef, state }: { statsRef: React.MutableRefObject<WaveStats>; state: VoiceState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  const s = statsRef.current;
  return (
    <p className="font-mono text-[11px] tabular-nums text-(--vw-muted)">
      {state} · {Math.round(s.fps)} fps · level {s.level.toFixed(2)}
      {s.db !== null && ` · ${s.db.toFixed(0)} dBFS`} · {s.bars} bars
    </p>
  );
}

export function App() {
  const [source, setSource] = useState<SourceKind>("mic");
  const [theme, setTheme] = useState<Theme>("system");
  const [state, setState] = useState<VoiceState>("idle");
  const statsRef = useRef<WaveStats>({ fps: 0, level: 0, db: null, bars: 0 });

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Handy for poking at it from devtools.
  useEffect(() => {
    (window as unknown as { voiceWave: unknown }).voiceWave = { stats: statsRef.current };
  }, []);

  return (
    <main className="flex min-h-full flex-col items-center justify-between px-4 py-6">
      <div aria-hidden />
      <VoiceWaveform source={source} onStateChange={setState} statsRef={statsRef} />
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-2">
          <Segmented
            label="Audio source"
            value={source}
            onChange={setSource}
            options={[
              { value: "mic", label: "Live mic" },
              { value: "sim", label: "Simulated speech" },
            ]}
          />
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <Readout statsRef={statsRef} state={state} />
      </div>
    </main>
  );
}
