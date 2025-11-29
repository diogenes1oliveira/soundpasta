import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParamValue } from "../hooks/useSearchParamValue";
import { useListDevices } from "../hooks/useListDevices";
import { useQuietDuplex } from "../hooks/useQuietDuplex";
import { useQuietProfiles } from "../hooks/useQuietProfiles";

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  type: "incoming" | "outgoing";
}

export default function DebugQuietJS() {
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<
    string | null
  >(null);
  const [inputDeviceDescription, setInputDeviceDescription] =
    useSearchParamValue("input_device", {
      debounceMs: 300,
    });

  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<
    string | null
  >(null);
  const [outputDeviceDescription, setOutputDeviceDescription] =
    useSearchParamValue("output_device", {
      debounceMs: 300,
    });

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [profileName, setProfileName] = useSearchParamValue("profile", {
    debounceMs: 300,
  });
  const [clampFrameParam, setClampFrameParam] = useSearchParamValue(
    "clamp_frame",
    {
      debounceMs: 300,
    }
  );
  const clampFrame = clampFrameParam === "true";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: devicesData, isLoading, error, refetch } = useListDevices();
  const { data: profilesData, isLoading: isLoadingProfiles } =
    useQuietProfiles();

  const handleIncomingData = useCallback((data: Uint8Array) => {
    const text = new TextDecoder().decode(data);
    const newMessage: Message = {
      id: Date.now().toString(),
      text,
      timestamp: new Date(),
      type: "incoming",
    };
    setMessages((prev) => [...prev, newMessage]);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedProfile = profileName ?? "ultrasonic";

  const {
    isReady,
    isLoading: isDuplexLoading,
    error: duplexError,
    start: startDuplex,
    stop: stopDuplex,
    send: sendData,
  } = useQuietDuplex({
    micDeviceId: selectedInputDeviceId,
    speakerDeviceId: selectedOutputDeviceId,
    profile: selectedProfile,
    clampFrame,
    onData: handleIncomingData,
  });

  const inputs = devicesData?.inputs ?? [];
  const outputs = devicesData?.outputs ?? [];

  const inputDeviceId = useMemo(
    () => selectedInputDeviceId ?? "",
    [selectedInputDeviceId]
  );
  const outputDeviceId = useMemo(
    () => selectedOutputDeviceId ?? "",
    [selectedOutputDeviceId]
  );

  // Auto-select input device from URL query params
  useEffect(() => {
    if (selectedInputDeviceId !== null) {
      return;
    }
    if (!inputDeviceDescription) {
      return;
    }
    const match = inputs.find(
      (s) => s.label && s.label === inputDeviceDescription
    );
    if (match) {
      setSelectedInputDeviceId(match.deviceId);
    }
  }, [
    inputDeviceDescription,
    inputs,
    selectedInputDeviceId,
    setInputDeviceDescription,
  ]);

  // Auto-select output device from URL query params
  useEffect(() => {
    if (selectedOutputDeviceId !== null) {
      return;
    }
    if (!outputDeviceDescription) {
      return;
    }
    const match = outputs.find(
      (s) => s.label && s.label === outputDeviceDescription
    );
    if (match) {
      setSelectedOutputDeviceId(match.deviceId);
    }
  }, [
    outputDeviceDescription,
    outputs,
    selectedOutputDeviceId,
    setOutputDeviceDescription,
  ]);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>/debug/quietjs</h2>

      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          style={{
            padding: "8px 16px",
            fontSize: "14px",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Refreshing..." : "Refresh Devices"}
        </button>
      </div>

      {isLoading && <div style={{ marginBottom: 12 }}>Loading devices...</div>}

      {error && (
        <div style={{ color: "crimson", marginBottom: 12 }}>
          Error: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {duplexError && (
        <div style={{ color: "crimson", marginBottom: 12 }}>
          Duplex Error: {duplexError.message}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="input-device">Input: </label>
        <select
          id="input-device"
          value={inputDeviceId}
          onChange={(e) => {
            const nextDeviceId = e.target.value ? e.target.value : null;
            setSelectedInputDeviceId(nextDeviceId);
            if (nextDeviceId) {
              const match = inputs.find((s) => s.deviceId === nextDeviceId);
              const nextDescription = match?.label ?? null;
              setInputDeviceDescription(nextDescription);
            } else {
              setInputDeviceDescription(null);
            }
          }}
          disabled={isLoading}
        >
          <option value="">Unset</option>
          {inputs.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label || `Input (${s.deviceId.slice(0, 6)}...)`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="output-device">Output: </label>
        <select
          id="output-device"
          value={outputDeviceId}
          onChange={(e) => {
            const nextDeviceId = e.target.value ? e.target.value : null;
            setSelectedOutputDeviceId(nextDeviceId);
            if (nextDeviceId) {
              const match = outputs.find((s) => s.deviceId === nextDeviceId);
              const nextDescription = match?.label ?? null;
              setOutputDeviceDescription(nextDescription);
            } else {
              setOutputDeviceDescription(null);
            }
          }}
          disabled={isLoading}
        >
          <option value="">Unset</option>
          {outputs.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label || `Output (${s.deviceId.slice(0, 6)}...)`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="profile">Profile: </label>
        <select
          id="profile"
          value={selectedProfile}
          onChange={(e) => {
            const nextProfile = e.target.value || null;
            setProfileName(nextProfile);
          }}
          disabled={isLoadingProfiles}
        >
          {isLoadingProfiles ? (
            <option>Loading profiles...</option>
          ) : (
            profilesData &&
            Object.keys(profilesData).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))
          )}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="clamp-frame">
          <input
            id="clamp-frame"
            type="checkbox"
            checked={clampFrame}
            onChange={(e) => {
              setClampFrameParam(e.target.checked ? "true" : null);
            }}
          />{" "}
          Clamp Frame
        </label>
      </div>

      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <button
          onClick={() => {
            if (isReady) {
              stopDuplex();
            } else {
              startDuplex();
            }
          }}
          disabled={isDuplexLoading}
          style={{
            padding: "16px 32px",
            fontSize: "18px",
            fontWeight: "bold",
            width: "100%",
            maxWidth: "400px",
            cursor: isDuplexLoading ? "not-allowed" : "pointer",
          }}
        >
          {isDuplexLoading
            ? "Loading..."
            : isReady
            ? "Running - Click to Stop"
            : "Start"}
        </button>
      </div>

      <div
        style={{
          marginTop: 32,
          display: "flex",
          flexDirection: "column",
          height: "600px",
          border: "1px solid #444",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                display: "flex",
                justifyContent:
                  message.type === "outgoing" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "70%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  backgroundColor:
                    message.type === "outgoing" ? "#646cff" : "#333",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ wordWrap: "break-word" }}>{message.text}</div>
                <div
                  style={{
                    fontSize: "11px",
                    opacity: 0.7,
                    marginTop: "4px",
                    textAlign: "right",
                  }}
                >
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            borderTop: "1px solid #444",
            padding: "12px",
            display: "flex",
            gap: "8px",
          }}
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && inputText.trim() && isReady) {
                const text = inputText;
                setInputText("");
                const newMessage: Message = {
                  id: Date.now().toString(),
                  text,
                  timestamp: new Date(),
                  type: "outgoing",
                };
                setMessages((prev) => [...prev, newMessage]);
                try {
                  const encoder = new TextEncoder();
                  const data = encoder.encode(text);
                  await sendData(data);
                } catch (err) {
                  console.error("Failed to send message:", err);
                }
              }
            }}
            placeholder="Type a message..."
            disabled={!isReady}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #444",
              backgroundColor: "#1a1a1a",
              color: "inherit",
              fontSize: "14px",
              opacity: isReady ? 1 : 0.5,
              cursor: isReady ? "text" : "not-allowed",
            }}
          />
          <button
            onClick={async () => {
              if (inputText.trim() && isReady) {
                const text = inputText;
                setInputText("");
                const newMessage: Message = {
                  id: Date.now().toString(),
                  text,
                  timestamp: new Date(),
                  type: "outgoing",
                };
                setMessages((prev) => [...prev, newMessage]);
                try {
                  const encoder = new TextEncoder();
                  const data = encoder.encode(text);
                  await sendData(data);
                } catch (err) {
                  console.error("Failed to send message:", err);
                }
              }
            }}
            disabled={!isReady}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              opacity: isReady ? 1 : 0.5,
              cursor: isReady ? "pointer" : "not-allowed",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
