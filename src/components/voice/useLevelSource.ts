import { useEffect, useRef, useState } from "react";
import { LevelSource, MicUnavailableError, SourceKind, openMicSource, openSimSource } from "./levelSources";

export interface LevelSourceState {
  /** Read this inside the render loop; null while nothing is open. */
  sourceRef: React.MutableRefObject<LevelSource | null>;
  /** Which source is actually feeding the wave (may be "sim" after a mic failure). */
  activeKind: SourceKind | null;
  /** Waiting on the browser's microphone permission prompt. */
  requesting: boolean;
  /** Why the mic fell back to simulation, if it did. */
  fallbackReason: string | null;
}

/**
 * Opens the preferred source while `active`, and swaps it live if the preference
 * changes. A mic failure never leaves the wave dead: it falls back to simulation.
 */
export function useLevelSource(active: boolean, preferred: SourceKind): LevelSourceState {
  const sourceRef = useRef<LevelSource | null>(null);
  const [activeKind, setActiveKind] = useState<SourceKind | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setActiveKind(null);
      setRequesting(false);
      return;
    }
    let cancelled = false;

    const install = (src: LevelSource) => {
      if (cancelled) return src.dispose();
      sourceRef.current?.dispose();
      sourceRef.current = src;
      setActiveKind(src.kind);
    };

    if (preferred === "sim") {
      setFallbackReason(null);
      install(openSimSource());
    } else {
      setRequesting(true);
      openMicSource().then(
        (mic) => {
          if (!cancelled) {
            setFallbackReason(null);
            setRequesting(false);
          }
          install(mic);
        },
        (err) => {
          if (cancelled) return;
          setRequesting(false);
          setFallbackReason(err instanceof MicUnavailableError ? err.message : "Microphone unavailable");
          if (sourceRef.current?.kind !== "sim") install(openSimSource());
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [active, preferred]);

  // Release the device when listening ends or the component unmounts.
  useEffect(() => {
    if (active) return;
    sourceRef.current?.dispose();
    sourceRef.current = null;
  }, [active]);
  useEffect(() => () => sourceRef.current?.dispose(), []);

  return { sourceRef, activeKind, requesting, fallbackReason };
}
