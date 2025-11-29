import type { UnreliableCommunicator } from "./types";

export interface QuietJSCommunicatorOptions {
  profile?: string;
  sinkId?: string;
}

export class QuietJSCommunicator implements UnreliableCommunicator {
  private transmitter: Quiet.Transmitter | null = null;
  private receiver: Quiet.Receiver | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private profile: string;
  private sinkId?: string;
  private receivedContent: ArrayBuffer = new ArrayBuffer(0);
  onReceive?: (data: ArrayBuffer) => void;
  onError?: (error: Error) => void;

  constructor(options: QuietJSCommunicatorOptions = {}) {
    this.profile = options.profile || "audible";
    this.sinkId = options.sinkId;
    this.initialize();
  }

  private initialize(): void {
    if (this.isInitialized || this.initializationPromise) {
      return;
    }

    this.initializationPromise = new Promise<void>((resolve, reject) => {
      if (typeof window === "undefined" || !window.Quiet) {
        reject(new Error("Quiet.js is not loaded"));
        return;
      }

      const Quiet = window.Quiet;

      Quiet.init({
        profilesPrefix: "/quietjs/",
        memoryInitializerPrefix: "/quietjs/",
        libfecPrefix: "/quietjs/",
      });

      Quiet.addReadyCallback(
        () => {
          console.log("[QuietJSCommunicator] Quiet.js ready callback fired");
          this.isInitialized = true;
          resolve();
        },
        (reason: string) => {
          console.error(
            `[QuietJSCommunicator] Quiet.js initialization failed: ${reason}`
          );
          const error = new Error(`Quiet.js initialization failed: ${reason}`);
          if (this.onError) {
            this.onError(error);
          }
          reject(error);
        }
      );
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized && this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.isInitialized) {
      throw new Error("Quiet.js is not initialized");
    }
  }

  resumeAudioContext(): void {
    if (typeof window === "undefined" || !window.Quiet) {
      console.warn(
        "[QuietJSCommunicator] Cannot resume AudioContext: Quiet.js is not loaded"
      );
      return;
    }

    try {
      const Quiet = window.Quiet;
      const audioCtx = Quiet.getAudioContext();

      if (!audioCtx) {
        console.warn(
          "[QuietJSCommunicator] AudioContext not available from Quiet.js"
        );
        return;
      }

      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch((error) => {
          console.warn(
            "[QuietJSCommunicator] Failed to resume AudioContext:",
            error
          );
        });
      }
    } catch (error) {
      console.warn("[QuietJSCommunicator] Error in resumeAudioContext:", error);
    }
  }

  async checkMicrophonePermission(): Promise<void> {
    console.log("[QuietJSCommunicator] Checking microphone permission");

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      throw new Error("MediaDevices API not available");
    }

    // Check if Permissions API is available
    if (
      typeof navigator.permissions !== "undefined" &&
      navigator.permissions.query
    ) {
      try {
        const result = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        console.log(
          `[QuietJSCommunicator] Microphone permission state: ${result.state}`
        );

        if (result.state === "granted") {
          console.log(
            "[QuietJSCommunicator] Microphone permission already granted"
          );
          return;
        }

        if (result.state === "denied") {
          throw new Error("Microphone permission denied");
        }

        // If state is "prompt", we'll request it explicitly below
        if (result.state === "prompt") {
          console.log(
            "[QuietJSCommunicator] Microphone permission in prompt state, requesting..."
          );
        }
      } catch (error) {
        // Permissions API might not support 'microphone' in all browsers
        // Fall through to explicit getUserMedia request
        console.log(
          "[QuietJSCommunicator] Permissions API query failed, falling back to getUserMedia:",
          error
        );
      }
    }

    // Explicitly request microphone access
    // This will prompt the user if permission hasn't been granted
    try {
      console.log(
        "[QuietJSCommunicator] Requesting microphone access via getUserMedia"
      );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach((track) => track.stop());
      console.log("[QuietJSCommunicator] Microphone permission granted");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to get microphone permission";
      console.error(
        `[QuietJSCommunicator] Microphone permission request failed: ${errorMessage}`
      );
      throw new Error(`Microphone permission denied: ${errorMessage}`);
    }
  }

  send(data: ArrayBuffer, onComplete?: () => void): void {
    this.ensureInitialized()
      .then(() => {
        if (typeof window === "undefined" || !window.Quiet) {
          throw new Error("Quiet.js is not available");
        }

        const Quiet = window.Quiet;

        if (this.transmitter) {
          this.transmitter.destroy();
        }

        this.transmitter = Quiet.transmitter({
          profile: this.profile,
          sinkId: this.sinkId,
          onFinish: () => {
            if (onComplete) {
              onComplete();
            }
          },
        });

        this.transmitter.transmit(data);
      })
      .catch((error) => {
        if (this.onError) {
          this.onError(
            error instanceof Error ? error : new Error(String(error))
          );
        }
        if (onComplete) {
          onComplete();
        }
      });
  }

  startReceiver(): void {
    console.log("[QuietJSCommunicator] startReceiver() called");
    this.ensureInitialized()
      .then(() => {
        return this.checkMicrophonePermission();
      })
      .then(() => {
        if (typeof window === "undefined" || !window.Quiet) {
          throw new Error("Quiet.js is not available");
        }

        const Quiet = window.Quiet;

        if (this.receiver) {
          console.log("[QuietJSCommunicator] Destroying existing receiver");
          this.receiver.destroy();
        }

        this.receivedContent = new ArrayBuffer(0);
        console.log(
          `[QuietJSCommunicator] Creating receiver with profile: ${this.profile}`
        );

        this.receiver = Quiet.receiver({
          profile: this.profile,
          onReceive: (recvPayload: ArrayBuffer) => {
            console.log(
              `[QuietJSCommunicator] onReceive called with payload size: ${recvPayload.byteLength} bytes`
            );
            if (typeof window === "undefined" || !window.Quiet) {
              console.error(
                "[QuietJSCommunicator] Window or Quiet not available in onReceive"
              );
              return;
            }
            const Quiet = window.Quiet;
            this.receivedContent = Quiet.mergeab(
              this.receivedContent,
              recvPayload
            );
            if (this.onReceive) {
              this.onReceive(this.receivedContent);
            }
          },
          onCreateFail: (reason: string) => {
            console.error(
              `[QuietJSCommunicator] onCreateFail called with reason: ${reason}`
            );
            const error = new Error(`Failed to create receiver: ${reason}`);
            if (this.onError) {
              this.onError(error);
            }
          },
          onReceiveFail: (num_fails: number) => {
            console.warn(
              `[QuietJSCommunicator] onReceiveFail called with ${num_fails} failures`
            );
            const error = new Error(`Receive failed (${num_fails} failures)`);
            if (this.onError) {
              this.onError(error);
            }
          },
        });
        console.log("[QuietJSCommunicator] Receiver created successfully");
      })
      .catch((error) => {
        console.error(`[QuietJSCommunicator] Error in startReceiver:`, error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const receiverError = new Error(
          `Failed to start receiver: ${errorMessage}`
        );
        if (this.onError) {
          this.onError(receiverError);
        }
        // Also trigger onCreateFail if receiver creation was attempted
        // (though in this case, we failed before creating it)
      });
  }

  stopReceiver(): void {
    console.log("[QuietJSCommunicator] stopReceiver() called");
    if (this.receiver) {
      this.receiver.destroy();
      this.receiver = null;
      this.receivedContent = new ArrayBuffer(0);
      console.log("[QuietJSCommunicator] Receiver destroyed");
    } else {
      console.log("[QuietJSCommunicator] No receiver to stop");
    }
  }

  setSinkId(sinkId?: string): void {
    this.sinkId = sinkId;
  }

  destroy(): void {
    if (this.transmitter) {
      this.transmitter.destroy();
      this.transmitter = null;
    }
    this.stopReceiver();
  }
}
