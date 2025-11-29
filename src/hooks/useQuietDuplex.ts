import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuietDuplex } from "../lib/QuietDuplex";
import { useQuietProfiles } from "./useQuietProfiles";

export interface UseQuietDuplexOptions {
  micDeviceId?: string | null;
  speakerDeviceId?: string | null;
  profile?: string;
  clampFrame?: boolean;
  onData?: (data: Uint8Array) => void;
}

export interface UseQuietDuplexResult {
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
  start: () => Promise<void>;
  stop: () => void;
  send: (data: Uint8Array) => Promise<void>;
}

export function useQuietDuplex(
  options: UseQuietDuplexOptions
): UseQuietDuplexResult {
  const {
    micDeviceId,
    speakerDeviceId,
    profile = "ultrasonic",
    clampFrame,
    onData,
  } = options;

  const { data: profilesData } = useQuietProfiles();

  const profileDef = useMemo(() => {
    if (!profilesData) {
      return null;
    }
    return profilesData[profile] ?? null;
  }, [profilesData, profile]);

  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const duplexRef = useRef<QuietDuplex | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stop = useCallback(() => {
    console.log("[useQuietDuplex] stop() - Stopping");
    if (duplexRef.current) {
      duplexRef.current.cleanup();
      duplexRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsReady(false);
    setIsLoading(false);
    setError(null);
    console.log("[useQuietDuplex] stop() - Complete");
  }, []);

  const start = useCallback(async () => {
    console.log("[useQuietDuplex] start() - Starting");
    if (duplexRef.current) {
      console.log(
        "[useQuietDuplex] start() - Existing duplex found, stopping first"
      );
      stop();
    }

    if (!profileDef) {
      const error = new Error(
        `Profile "${profile}" not found or profiles not loaded`
      );
      setError(error);
      setIsLoading(false);
      return;
    }

    console.log("[useQuietDuplex] start() - Setting loading state");
    setIsLoading(true);
    setError(null);

    try {
      console.log("[useQuietDuplex] start() - Creating AudioContext");
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      console.log("[useQuietDuplex] start() - AudioContext created");

      console.log(
        `[useQuietDuplex] start() - Creating QuietDuplex with profile: ${profile}`
      );
      const duplex = new QuietDuplex(audioContext);
      duplexRef.current = duplex;
      console.log("[useQuietDuplex] start() - QuietDuplex created");

      console.log(
        `[useQuietDuplex] start() - Calling duplex.setup() with micDeviceId: ${
          micDeviceId ?? "undefined"
        }, speakerDeviceId: ${speakerDeviceId ?? "undefined"}`
      );
      await duplex.setup({
        profileDef,
        micDeviceId: micDeviceId ?? undefined,
        speakerDeviceId: speakerDeviceId ?? undefined,
        clampFrame,
        onData: (data) => {
          if (onData) {
            onData(data);
          }
        },
      });
      console.log("[useQuietDuplex] start() - duplex.setup() complete");

      console.log("[useQuietDuplex] start() - Setting ready state");
      setIsReady(true);
      setIsLoading(false);
      console.log("[useQuietDuplex] start() - Complete");
    } catch (err) {
      console.error("[useQuietDuplex] start() - Error occurred:", err);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      setIsReady(false);
      stop();
    }
  }, [
    micDeviceId,
    speakerDeviceId,
    profile,
    profileDef,
    clampFrame,
    onData,
    stop,
  ]);

  const send = useCallback(async (data: Uint8Array) => {
    if (!duplexRef.current) {
      throw new Error("QuietDuplex is not started");
    }
    await duplexRef.current.send(data);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isReady,
    isLoading,
    error,
    start,
    stop,
    send,
  };
}
