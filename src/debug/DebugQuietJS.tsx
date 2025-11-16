import { useEffect, useRef, useState } from "react";
import { QuietJSCommunicator } from "../lib/reliableWebsocket/quietjs-communicator";

type Mode = "send" | "receive";

export default function DebugQuietJS() {
  const [mode, setMode] = useState<Mode>("send");
  const [quietReady, setQuietReady] = useState(false);
  const [sendText, setSendText] = useState("");
  const [sending, setSending] = useState(false);
  const [receivedMessages, setReceivedMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [receiverActive, setReceiverActive] = useState(false);
  const receiveCounterRef = useRef(0);
  const communicatorRef = useRef<QuietJSCommunicator | null>(null);
  const receivedMessagesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const debugLogTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Capture console.log, console.warn, console.error for debug display
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const addLog = (level: string, ...args: unknown[]) => {
      const timestamp = new Date().toISOString();
      const message = args
        .map((arg) => {
          if (typeof arg === "object") {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(" ");
      setDebugLogs((prev) => [
        ...prev.slice(-49),
        `[${timestamp}] [${level}] ${message}`,
      ]);
    };

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      if (
        args[0]?.toString().includes("[QuietJS") ||
        args[0]?.toString().includes("[DebugQuietJS")
      ) {
        addLog("LOG", ...args);
      }
    };

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      if (
        args[0]?.toString().includes("[QuietJS") ||
        args[0]?.toString().includes("[DebugQuietJS")
      ) {
        addLog("WARN", ...args);
      }
    };

    console.error = (...args: unknown[]) => {
      originalError(...args);
      if (
        args[0]?.toString().includes("[QuietJS") ||
        args[0]?.toString().includes("[DebugQuietJS")
      ) {
        addLog("ERROR", ...args);
      }
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  // Auto-scroll received messages textarea to bottom
  useEffect(() => {
    if (receivedMessagesTextareaRef.current) {
      receivedMessagesTextareaRef.current.scrollTop =
        receivedMessagesTextareaRef.current.scrollHeight;
    }
  }, [receivedMessages]);

  // Auto-scroll debug log textarea to bottom
  useEffect(() => {
    if (debugLogTextareaRef.current) {
      debugLogTextareaRef.current.scrollTop =
        debugLogTextareaRef.current.scrollHeight;
    }
  }, [debugLogs]);

  useEffect(() => {
    const checkQuietReady = () => {
      if (typeof window !== "undefined" && window.Quiet) {
        console.log(
          "[DebugQuietJS] Quiet.js is available, creating communicator"
        );
        setQuietReady(true);
        communicatorRef.current = new QuietJSCommunicator({
          profile: "audible",
        });
        communicatorRef.current.onError = (error: Error) => {
          console.error("[DebugQuietJS] Error from communicator:", error);
          const timestamp = new Date().toISOString();
          setErrors((prev) => [...prev, `[${timestamp}] ${error.message}`]);
        };
      } else {
        console.log("[DebugQuietJS] Waiting for Quiet.js to load...");
        setTimeout(checkQuietReady, 100);
      }
    };

    checkQuietReady();

    return () => {
      if (communicatorRef.current) {
        communicatorRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (!communicatorRef.current) {
      console.log("[DebugQuietJS] No communicator available");
      return;
    }

    console.log(
      `[DebugQuietJS] Mode: ${mode}, ReceiverActive: ${receiverActive}`
    );

    if (mode === "receive" && receiverActive) {
      console.log("[DebugQuietJS] Setting up receiver callback");
      communicatorRef.current.onReceive = (data: ArrayBuffer) => {
        console.log(
          `[DebugQuietJS] onReceive callback fired with ${data.byteLength} bytes`
        );
        if (typeof window === "undefined" || !window.Quiet) {
          console.error("[DebugQuietJS] Window or Quiet not available");
          return;
        }
        const Quiet = window.Quiet;
        const text = Quiet.ab2str(data);
        console.log(`[DebugQuietJS] Decoded text: "${text}"`);
        receiveCounterRef.current += 1;
        const timestamp = new Date().toISOString();
        setReceivedMessages((prev) => [
          ...prev,
          `[${timestamp}] #${receiveCounterRef.current}: ${text}`,
        ]);
      };
      console.log("[DebugQuietJS] Starting receiver");
      communicatorRef.current.startReceiver();
    } else if (mode === "receive" && !receiverActive) {
      console.log("[DebugQuietJS] Stopping receiver");
      communicatorRef.current.stopReceiver();
      communicatorRef.current.onReceive = undefined;
    }
  }, [mode, receiverActive]);

  const handleSend = () => {
    if (!communicatorRef.current || !sendText.trim() || sending) {
      return;
    }

    setSending(true);
    if (typeof window === "undefined" || !window.Quiet) {
      setSending(false);
      return;
    }

    const Quiet = window.Quiet;
    const data = Quiet.str2ab(sendText);

    communicatorRef.current.send(data, () => {
      setSending(false);
    });
  };

  const handleActivateReceiver = () => {
    console.log("[DebugQuietJS] Activate receiver button clicked");
    setReceiverActive(true);
    receiveCounterRef.current = 0;
    setReceivedMessages([]);
  };

  const handleDeactivateReceiver = () => {
    setReceiverActive(false);
    if (communicatorRef.current) {
      communicatorRef.current.stopReceiver();
    }
  };

  if (!quietReady) {
    return (
      <div
        style={{
          padding: 16,
          fontFamily: "sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "200px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              border: "4px solid #f3f3f3",
              borderTop: "4px solid #3498db",
              borderRadius: "50%",
              width: "40px",
              height: "40px",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <div>Loading Quiet.js...</div>
        </div>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>/debug/quietjs</h2>

      <div style={{ marginBottom: 16 }}>
        <label>
          <input
            type="radio"
            value="send"
            checked={mode === "send"}
            onChange={(e) => {
              if (e.target.checked) {
                setMode("send");
                if (receiverActive) {
                  handleDeactivateReceiver();
                }
              }
            }}
            style={{ marginRight: 8 }}
          />
          Send Mode
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            value="receive"
            checked={mode === "receive"}
            onChange={(e) => {
              if (e.target.checked) {
                setMode("receive");
              }
            }}
            style={{ marginRight: 8 }}
          />
          Receive Mode
        </label>
      </div>

      {mode === "send" && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="send-text"
              style={{ display: "block", marginBottom: 4 }}
            >
              Text to send:
            </label>
            <textarea
              id="send-text"
              value={sendText}
              onChange={(e) => setSendText(e.target.value)}
              rows={5}
              style={{
                width: "100%",
                maxWidth: "600px",
                padding: 8,
                fontFamily: "monospace",
                resize: "vertical",
              }}
              disabled={sending}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={handleSend}
              disabled={sending || !sendText.trim()}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                cursor: sending ? "not-allowed" : "pointer",
              }}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {mode === "receive" && (
        <div>
          <div style={{ marginBottom: 12 }}>
            {!receiverActive ? (
              <button
                onClick={handleActivateReceiver}
                style={{
                  padding: "8px 16px",
                  fontSize: "14px",
                }}
              >
                Activate Receiver
              </button>
            ) : (
              <button
                onClick={handleDeactivateReceiver}
                style={{
                  padding: "8px 16px",
                  fontSize: "14px",
                  backgroundColor: "#dc3545",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Deactivate Receiver
              </button>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="receive-text"
              style={{ display: "block", marginBottom: 4 }}
            >
              Received messages:
            </label>
            <textarea
              ref={receivedMessagesTextareaRef}
              id="receive-text"
              value={receivedMessages.join("\n")}
              readOnly
              rows={10}
              style={{
                width: "100%",
                maxWidth: "600px",
                padding: 8,
                fontFamily: "monospace",
                resize: "vertical",
                backgroundColor: "#f8f9fa",
                color: "#333",
              }}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <label
          htmlFor="debug-log"
          style={{ display: "block", marginBottom: 4 }}
        >
          Debug Log (QuietJS events):
        </label>
        <textarea
          ref={debugLogTextareaRef}
          id="debug-log"
          value={debugLogs.join("\n")}
          readOnly
          rows={8}
          style={{
            width: "100%",
            maxWidth: "600px",
            padding: 8,
            fontFamily: "monospace",
            fontSize: "11px",
            resize: "vertical",
            backgroundColor: "#f8f9fa",
            color: "#333",
            border: "1px solid #ccc",
          }}
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <label
          htmlFor="error-log"
          style={{ display: "block", marginBottom: 4 }}
        >
          Error Log:
        </label>
        <textarea
          id="error-log"
          value={errors.join("\n")}
          readOnly
          rows={6}
          style={{
            width: "100%",
            maxWidth: "600px",
            padding: 8,
            fontFamily: "monospace",
            resize: "vertical",
            backgroundColor: "#fff",
            color: "#dc3545",
            border: "1px solid #dc3545",
          }}
        />
      </div>
    </div>
  );
}
