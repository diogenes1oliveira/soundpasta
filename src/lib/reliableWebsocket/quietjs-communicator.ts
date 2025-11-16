import type { UnreliableCommunicator } from "./types";

export interface QuietJSCommunicatorOptions {
  profile?: string;
}

export class QuietJSCommunicator implements UnreliableCommunicator {
  private transmitter: Quiet.Transmitter | null = null;
  private receiver: Quiet.Receiver | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private profile: string;
  private receivedContent: ArrayBuffer = new ArrayBuffer(0);
  onReceive?: (data: ArrayBuffer) => void;
  onError?: (error: Error) => void;

  constructor(options: QuietJSCommunicatorOptions = {}) {
    this.profile = options.profile || "audible";
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
        if (this.onError) {
          this.onError(
            error instanceof Error ? error : new Error(String(error))
          );
        }
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

  destroy(): void {
    if (this.transmitter) {
      this.transmitter.destroy();
      this.transmitter = null;
    }
    this.stopReceiver();
  }
}
