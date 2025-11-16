import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParamValue } from "../hooks/useSearchParamValue";

export default function DebugOutput() {
  const [selectedSinkId, setSelectedSinkId] = useState<string | null>(null);
  const [sinkDescription, setSinkDescription] = useSearchParamValue(
    "sink_description",
    {
      debounceMs: 300,
    }
  );
  const [sinks, setSinks] = useState<MediaDeviceInfo[]>([]);
  const [frequency, setFrequency] = useState<string>("1000");
  const [duration, setDuration] = useState<string>("1.0");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const sinkId = useMemo(() => selectedSinkId ?? "", [selectedSinkId]);

  // Request permission and enumerate output devices
  useEffect(() => {
    let cancelled = false;
    async function enumerate() {
      try {
        // Request permission to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Ignore; enumeration may still work but labels might be empty
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          const outputs = devices.filter((d) => d.kind === "audiooutput");
          setSinks(outputs);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
        }
      }
    }
    enumerate();
    const handleChange = () => enumerate();
    navigator.mediaDevices.addEventListener("devicechange", handleChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", handleChange);
    };
  }, []);

  // Auto-select sink from query string
  useEffect(() => {
    if (selectedSinkId !== null) {
      return;
    }
    if (!sinkDescription) {
      return;
    }
    const match = sinks.find((s) => s.label && s.label === sinkDescription);
    if (match) {
      setSelectedSinkId(match.deviceId);
    }
  }, [sinkDescription, sinks, selectedSinkId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
        } catch {
          // Ignore
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const handlePlay = async () => {
    if (playing) {
      return;
    }

    if (!selectedSinkId) {
      setError("Please select an output device");
      return;
    }

    const freq = parseFloat(frequency);
    const dur = parseFloat(duration);

    if (isNaN(freq) || freq <= 0) {
      setError("Frequency must be a positive number");
      return;
    }

    if (isNaN(dur) || dur <= 0) {
      setError("Duration must be a positive number");
      return;
    }

    setError(null);
    setPlaying(true);

    try {
      // Create or reuse AudioContext
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const audioContext = audioContextRef.current;

      // Set the sink
      if ("setSinkId" in audioContext) {
        console.log(`[DebugOutput] Setting sink ID: ${selectedSinkId}`);
        await (audioContext as any).setSinkId(selectedSinkId);
        // Verify sink was set
        const currentSinkId = (audioContext as any).sinkId || "unknown";
        console.log(
          `[DebugOutput] Current sink ID after set: ${currentSinkId}`
        );
      } else {
        throw new Error("setSinkId is not supported in this browser");
      }

      // Create oscillator
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      oscillator.connect(audioContext.destination);

      oscillatorRef.current = oscillator;

      // Start playback
      oscillator.start();

      // Stop after duration
      timeoutRef.current = window.setTimeout(() => {
        try {
          oscillator.stop();
          oscillator.disconnect();
          oscillatorRef.current = null;
        } catch {
          // Ignore
        }
        setPlaying(false);
        timeoutRef.current = null;
      }, dur * 1000);
    } catch (e) {
      setError((e as Error).message);
      setPlaying(false);
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>/debug/output</h2>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="sink">Sink: </label>
        <select
          id="sink"
          value={sinkId}
          onChange={(e) => {
            const nextSinkId = e.target.value ? e.target.value : null;
            setSelectedSinkId(nextSinkId);
            if (nextSinkId) {
              const match = sinks.find((s) => s.deviceId === nextSinkId);
              const nextDescription = match?.label ?? null;
              setSinkDescription(nextDescription);
            } else {
              setSinkDescription(null);
            }
          }}
          disabled={playing}
        >
          <option value="">Select output device</option>
          {sinks.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label || `Output (${s.deviceId.slice(0, 6)}...)`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="frequency">Frequency (Hz): </label>
        <input
          id="frequency"
          type="number"
          min="1"
          step="1"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          disabled={playing}
          style={{ width: 120 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="duration">Duration (s): </label>
        <input
          id="duration"
          type="number"
          min="0.1"
          step="0.1"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          disabled={playing}
          style={{ width: 120 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={handlePlay} disabled={playing || !selectedSinkId}>
          {playing ? "Playing..." : "Play"}
        </button>
      </div>

      {error && (
        <div style={{ color: "crimson", marginTop: 8 }}>Error: {error}</div>
      )}
    </div>
  );
}
