import { useEffect, useMemo, useState } from "react";
import { useAudioMetrics } from "../hooks/useAudioMetrics";
import { useSearchParamValue } from "../hooks/useSearchParamValue";

export default function DebugInput() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceDescription, setDeviceDescription] = useSearchParamValue(
    "device_description",
    {
      debounceMs: 300,
    }
  );
  const { volume, frequencyHz, sources, error } =
    useAudioMetrics(selectedDeviceId);

  const deviceId = useMemo(() => selectedDeviceId ?? "", [selectedDeviceId]);

  useEffect(() => {
    if (selectedDeviceId !== null) {
      return;
    }
    if (!deviceDescription) {
      return;
    }
    const match = sources.find((s) => s.label && s.label === deviceDescription);
    if (match) {
      setSelectedDeviceId(match.deviceId);
    }
  }, [deviceDescription, sources, selectedDeviceId]);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>/debug/input</h2>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="source">Source: </label>
        <select
          id="source"
          value={deviceId}
          onChange={(e) => {
            const nextDeviceId = e.target.value ? e.target.value : null;
            setSelectedDeviceId(nextDeviceId);
            if (nextDeviceId) {
              const match = sources.find((s) => s.deviceId === nextDeviceId);
              const nextDescription = match?.label ?? null;
              setDeviceDescription(nextDescription);
            } else {
              setDeviceDescription(null);
            }
          }}
        >
          <option value="">Default</option>
          {sources.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label || `Input (${s.deviceId.slice(0, 6)}...)`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="volume">Volume (RMS): </label>
        <input
          id="volume"
          type="text"
          readOnly
          value={volume != null ? volume.toFixed(4) : ""}
          style={{ width: 140 }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="freq">Dominant Frequency (Hz): </label>
        <input
          id="freq"
          type="text"
          readOnly
          value={frequencyHz != null ? frequencyHz.toFixed(2) : ""}
          style={{ width: 160 }}
        />
      </div>

      {error && (
        <div style={{ color: "crimson", marginTop: 8 }}>Error: {error}</div>
      )}
    </div>
  );
}
