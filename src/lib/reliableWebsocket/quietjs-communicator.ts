import type { UnreliableCommunicator } from "./types";

export interface QuietJSCommunicatorOptions {
  profile?: string;
  outputDeviceName?: string;
  inputDeviceName?: string;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export class QuietJSCommunicator implements UnreliableCommunicator {
  private transmitter: Quiet.Transmitter | null = null;
  private receiver: Quiet.Receiver | null = null;
  private profile: string;
  private outputDeviceName?: string;
  private inputDeviceName?: string;
  private initialized = false;
  private initPromise: Promise<void>;
  public onReceive?: (data: ArrayBuffer) => void;
  public onError?: (error: Error) => void;

  constructor(options: QuietJSCommunicatorOptions = {}) {
    this.profile = options.profile || "ultrasonic";
    this.outputDeviceName = options.outputDeviceName;
    this.inputDeviceName = options.inputDeviceName;

    this.initPromise = this.initialize(options.onReady, options.onError);
  }

  private async initialize(
    onReady?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof Quiet === "undefined") {
        const error = new Error("Quiet.js is not loaded");
        if (onError) onError(error);
        reject(error);
        return;
      }

      Quiet.init({
        profilesPrefix: "/quietjs/",
        memoryInitializerPrefix: "/quietjs/",
        onReady: async () => {
          try {
            await this.setupDevices();
            this.initialized = true;
            if (onReady) onReady();
            resolve();
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            if (onError) onError(err);
            reject(err);
          }
        },
        onError: (reason: string) => {
          const error = new Error(`Quiet.js initialization failed: ${reason}`);
          if (onError) onError(error);
          reject(error);
        },
      });
    });
  }

  private async setupDevices(): Promise<void> {
    if (this.outputDeviceName || this.inputDeviceName) {
      await this.selectDevices();
    }

    this.createTransmitter();
    this.createReceiver();
  }

  private async selectDevices(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      if (this.inputDeviceName) {
        const inputDevice = devices.find(
          (d) =>
            d.kind === "audioinput" && d.label.includes(this.inputDeviceName!)
        );
        if (inputDevice) {
          this.inputDeviceName = inputDevice.deviceId;
        }
      }

      if (this.outputDeviceName) {
        const outputDevice = devices.find(
          (d) =>
            d.kind === "audiooutput" && d.label.includes(this.outputDeviceName!)
        );
        if (outputDevice && "setSinkId" in AudioContext.prototype) {
          this.outputDeviceName = outputDevice.deviceId;
        }
      }
    } catch (error) {
      console.warn("Failed to enumerate devices:", error);
    }
  }

  private createTransmitter(): void {
    this.transmitter = Quiet.transmitter({
      profile: this.profile,
      onFinish: () => {
        // Transmission complete
      },
      onEnqueue: () => {
        // Data enqueued
      },
    });
  }

  private createReceiver(): void {
    this.receiver = Quiet.receiver({
      profile: this.profile,
      onReceive: (payload: ArrayBuffer) => {
        if (this.onReceive) {
          this.onReceive(payload);
        }
      },
      onCreateFail: (reason: string) => {
        const error = new Error(`Receiver creation failed: ${reason}`);
        if (this.onError) {
          this.onError(error);
        }
      },
      onReceiveFail: (checksumFailCount: number) => {
        const error = new Error(
          `Receiver checksum failures: ${checksumFailCount}`
        );
        if (this.onError) {
          this.onError(error);
        }
      },
    });
  }

  send(data: ArrayBuffer, onComplete?: () => void): void {
    if (!this.initialized) {
      this.initPromise
        .then(() => {
          this.doSend(data, onComplete);
        })
        .catch((error) => {
          if (this.onError) {
            this.onError(error);
          }
        });
      return;
    }

    this.doSend(data, onComplete);
  }

  private doSend(data: ArrayBuffer, onComplete?: () => void): void {
    if (!this.transmitter) {
      const error = new Error("Transmitter not initialized");
      if (this.onError) {
        this.onError(error);
      }
      return;
    }

    try {
      this.transmitter.transmit(data);
      if (onComplete) {
        setTimeout(onComplete, 0);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  destroy(): void {
    if (this.transmitter) {
      this.transmitter.destroy();
      this.transmitter = null;
    }
    if (this.receiver) {
      this.receiver.destroy();
      this.receiver = null;
    }
  }
}
