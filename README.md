# Voice Wave

A voice-input composer whose waveform reacts to your microphone, or to simulated speech
when the mic isn't available. Built from Figma `My personal works` → node `1341:309`.

```bash
npm install
npm run dev   # http://localhost:5300
```

## Using the component

```tsx
import { VoiceWaveform } from "./components/VoiceWaveform";

<VoiceWaveform source="mic" />   // live mic, falls back to simulation if denied
<VoiceWaveform source="sim" />   // always simulated
```

Props: `source`, `processingMs`, `onStateChange`, `statsRef` (fps / level / dBFS, written per frame).
Theme follows `prefers-color-scheme`, or set `data-theme="light" | "dark"` on `<html>`.

## Files

| File | Job |
|---|---|
| `components/VoiceWaveform.tsx` | Composer UI and the idle → listening → processing state machine |
| `components/voice/WaveCanvas.tsx` | Canvas renderer: scrolling loudness history, per-bar easing |
| `components/voice/levelSources.ts` | Mic (getUserMedia + AnalyserNode) and simulated sources |
| `components/voice/useLevelSource.ts` | Opens/closes/hot-swaps the source; falls back on mic failure |
| `components/voice/speechSimulator.ts` | Synthetic speech loudness |

## Decisions

- **Scrolling history, not a spectrum.** Each bar is ~40 ms of loudness, newest on the right,
  like dictation UIs. Frequency bars mostly show the low end jumping and read as "music player".
- **Meter ballistics.** Fast attack (18 ms), slower release (75 ms), peak held per bar so short
  syllables aren't lost between frames.
- **Mic levels in dBFS with an adaptive gate and ceiling.** Room noise reads as silence, and a
  quiet mic still fills the bars.
- **Simulation follows speech rhythm**: syllables (~3.9 Hz loudness modulation), words, phrase
  pauses (~19/min), and loudness falling across each phrase. Seeded, so it's reproducible.
- **Frame-rate independent easing** (`1 - e^(-dt/τ)`), so 60 Hz and 120 Hz screens feel the same.
- **Reduced motion:** no idle breathing and no processing sweep; the wave still shows your voice.

## Testing

`/fake-clock.html` runs the same app with `requestAnimationFrame` and `performance.now`
replaced; call `__flush(frames, dtMs)` to step it. Add `?motion=full` to ignore the OS
reduced-motion setting.
