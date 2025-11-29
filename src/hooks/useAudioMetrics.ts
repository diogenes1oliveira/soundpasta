import { useEffect, useMemo, useRef, useState } from "react";

type UseAudioMetricsResult = {
  volume: number | null;
  frequencyHz: number | null;
  sources: MediaDeviceInfo[];
  error: string | null;
};

export function useAudioMetrics(
  deviceId: string | null
): UseAudioMetricsResult {
  const [sources, setSources] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [frequencyHz, setFrequencyHz] = useState<number | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const timeDomainBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const freqDomainBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  // Enumerate input devices when permission is granted
  useEffect(() => {
    let cancelled = false;
    async function enumerate() {
      try {
        // Ensure permissions to get labels
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Ignore; enumeration may still work but labels might be empty
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          const inputs = devices.filter((d) => d.kind === "audioinput");
          setSources(inputs);
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

  const constraints = useMemo<MediaStreamConstraints>(() => {
    return {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };
  }, [deviceId]);

  // Manage stream and analyser graph
  useEffect(() => {
    let disposed = false;

    async function start() {
      stop(); // ensure previous stopped
      setError(null);
      setVolume(null);
      setFrequencyHz(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const audioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048; // power of two; gives freqBinCount = 1024
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const src = audioContext.createMediaStreamSource(stream);
        sourceNodeRef.current = src;
        src.connect(analyser);

        timeDomainBufferRef.current = new Float32Array(
          new ArrayBuffer(analyser.fftSize * 4)
        );
        freqDomainBufferRef.current = new Float32Array(
          new ArrayBuffer(analyser.frequencyBinCount * 4)
        );

        const update = () => {
          if (!analyserRef.current || !audioContextRef.current) {
            return;
          }
          const analyserNode = analyserRef.current;
          const ac = audioContextRef.current;

          // Volume: RMS of time-domain samples (Float32, range ~[-1,1])
          const timeBuf = timeDomainBufferRef.current!;
          analyserNode.getFloatTimeDomainData(
            timeBuf as unknown as Float32Array<ArrayBuffer>
          );
          let sumSquares = 0;
          for (let i = 0; i < timeBuf.length; i++) {
            const v = timeBuf[i];
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / timeBuf.length);
          setVolume(rms);

          // Dominant frequency: find peak magnitude bin
          const freqBuf = freqDomainBufferRef.current!;
          analyserNode.getFloatFrequencyData(
            freqBuf as unknown as Float32Array<ArrayBuffer>
          ); // in dB values

          let peakIndex = 0;
          let peakDb = -Infinity;
          for (let i = 0; i < freqBuf.length; i++) {
            const db = freqBuf[i];
            if (db > peakDb) {
              peakDb = db;
              peakIndex = i;
            }
          }
          const binWidth = ac.sampleRate / analyserNode.fftSize;
          const dominantHz = peakIndex * binWidth;
          setFrequencyHz(Number.isFinite(dominantHz) ? dominantHz : null);

          rafIdRef.current = requestAnimationFrame(update);
        };
        rafIdRef.current = requestAnimationFrame(update);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
        }
      }
    }

    function stop() {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch {
          // ignore
        }
        sourceNodeRef.current = null;
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {
          // ignore
        }
        analyserRef.current = null;
      }
      if (audioContextRef.current) {
        // Close to release device on some browsers
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    start();
    return () => {
      disposed = true;
      stop();
    };
  }, [constraints]);

  return { volume, frequencyHz, sources, error };
}

export function useQuietProfiles(): string[] {
  const [profiles, setProfiles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchProfiles() {
      try {
        console.log("[useQuietProfiles] Loading profiles...");
        const response = await fetch("/quietjs/quiet-profiles.json");
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(`Failed to fetch profiles: ${response.statusText}`);
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }
        const profileNames = Object.keys(data);
        console.log(
          `[useQuietProfiles] Loaded ${profileNames.length} profiles`
        );
        setProfiles(profileNames);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("[useQuietProfiles] Error loading profiles:", error);
        setProfiles([]);
      }
    }

    fetchProfiles();

    return () => {
      cancelled = true;
    };
  }, []);

  return profiles;
}
