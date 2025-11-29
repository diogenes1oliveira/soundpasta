import { Transmitter, resumeIfSuspended, importObject } from "@moxon6/quiet-js";
import quietWasmUrl from "@moxon6/quiet-js/quiet.wasm?url";
import quietWorkletUrl from "@moxon6/quiet-js/quiet.worklet.js?url";

const getUserAudio = (micDeviceId?: string): Promise<MediaStream> => {
  console.log(
    `[QuietDuplex] getUserAudio() - Requesting media with deviceId: ${
      micDeviceId ?? "default"
    }`
  );
  return navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: false,
        ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
      },
    })
    .then((stream) => {
      console.log("[QuietDuplex] getUserAudio() - Media stream obtained");
      return stream;
    })
    .catch((error) => {
      console.error(
        "[QuietDuplex] getUserAudio() - Error obtaining media:",
        error
      );
      throw error;
    });
};

export type DeviceInfo = {
  label: string;
  deviceId: string;
  kind: "audioinput" | "audiooutput";
};

/**
 * List available input and output devices
 *
 * Because this requests the audio permission, it needs to be triggered in a user gesture.
 */
export async function listDevices(): Promise<{
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
}> {
  // Request permission first to get device labels
  await navigator.mediaDevices.getUserMedia({ audio: true });

  // Enumerate all devices
  const devices = await navigator.mediaDevices.enumerateDevices();

  const inputs: DeviceInfo[] = [];
  const outputs: DeviceInfo[] = [];
  let unknownInputCount = 0;
  let unknownOutputCount = 0;

  for (const device of devices) {
    if (device.kind === "audioinput") {
      inputs.push({
        label: device.label || `Unknown Input Device #${++unknownInputCount}`,
        deviceId: device.deviceId,
        kind: "audioinput",
      });
    } else if (device.kind === "audiooutput") {
      outputs.push({
        label: device.label || `Unknown Output Device #${++unknownOutputCount}`,
        deviceId: device.deviceId,
        kind: "audiooutput",
      });
    }
  }

  return { inputs, outputs };
}

export interface QuietDuplexSetupOptions {
  profileDef: object;
  micDeviceId?: string;
  speakerDeviceId?: string;
  clampFrame?: boolean;
  onData?: (data: Uint8Array) => void;
}

export class QuietDuplex {
  private audioContext: AudioContext;
  private ready: boolean = false;
  private instance: WebAssembly.Instance | null = null;
  private quietProcessorNode: AudioWorkletNode | null = null;
  private transmitter: Transmitter | null = null;
  private audioInput: MediaStreamAudioSourceNode | null = null;
  private audioStream: MediaStream | null = null;
  private onData: ((data: Uint8Array) => void) | null = null;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  async load(profileDef: object): Promise<void> {
    console.log("[QuietDuplex] load() - Starting WASM instantiation");
    const { module, instance } = await WebAssembly.instantiateStreaming(
      fetch(quietWasmUrl),
      importObject
    );
    console.log("[QuietDuplex] load() - WASM instantiated");

    this.instance = instance;

    if (typeof window !== "undefined") {
      const { audioWorklet } = this.audioContext;
      console.log("[QuietDuplex] load() - Adding audio worklet module");
      await audioWorklet.addModule(quietWorkletUrl);
      console.log("[QuietDuplex] load() - Audio worklet module added");

      console.log("[QuietDuplex] load() - Creating AudioWorkletNode");
      this.quietProcessorNode = new AudioWorkletNode(
        this.audioContext,
        "quiet-receiver-worklet",
        {
          processorOptions: {
            quietModule: module,
            profile: profileDef,
            sampleRate: this.audioContext.sampleRate,
          },
        }
      );
      console.log("[QuietDuplex] load() - AudioWorkletNode created");
    }
    console.log("[QuietDuplex] load() - Complete");
  }

  cleanup(): void {
    console.log("[QuietDuplex] cleanup() - Starting cleanup");
    this.ready = false;

    if (this.onData) {
      this.onData = null;
    }
    if (this.transmitter) {
      console.log("[QuietDuplex] cleanup() - Destroying transmitter");
      this.transmitter.destroy();
      this.transmitter = null;
    }
    if (this.audioInput) {
      console.log("[QuietDuplex] cleanup() - Disconnecting audio input");
      this.audioInput.disconnect();
      this.audioInput = null;
    }
    if (this.audioStream) {
      console.log("[QuietDuplex] cleanup() - Stopping audio stream tracks");
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    console.log("[QuietDuplex] cleanup() - Cleanup complete");
  }

  async setup(options: QuietDuplexSetupOptions): Promise<void> {
    console.log("[QuietDuplex] setup() - Starting setup");
    const { profileDef, micDeviceId, speakerDeviceId, clampFrame, onData } =
      options;

    console.log("[QuietDuplex] setup() - Cleaning up previous instance");
    this.cleanup();
    console.log("[QuietDuplex] setup() - Cleanup complete");

    console.log("[QuietDuplex] setup() - Resuming audio context if suspended");
    resumeIfSuspended(this.audioContext);
    console.log("[QuietDuplex] setup() - Audio context resumed");

    // Set sink ID BEFORE creating any audio nodes (setSinkId can hang if called after nodes are created)
    if (speakerDeviceId) {
      console.log(
        `[QuietDuplex] setup() - Setting sink ID to ${speakerDeviceId} (before creating audio nodes)`
      );
      if ("setSinkId" in this.audioContext) {
        try {
          await this.audioContext.setSinkId(speakerDeviceId);
          console.log("[QuietDuplex] setup() - Sink ID set successfully");
        } catch (error) {
          throw new Error(
            `Failed to set sink ID: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      } else {
        throw new Error(
          "setSinkId is not supported in this browser. Cannot set speaker device."
        );
      }
    } else {
      console.log(
        "[QuietDuplex] setup() - No speakerDeviceId provided, skipping setSinkId"
      );
    }

    console.log(
      `[QuietDuplex] setup() - Requesting user audio (micDeviceId: ${
        micDeviceId ?? "default"
      })`
    );
    this.audioStream = await getUserAudio(micDeviceId);
    console.log("[QuietDuplex] setup() - User audio obtained");

    if (!this.quietProcessorNode) {
      console.log(
        "[QuietDuplex] setup() - quietProcessorNode not found, calling load()"
      );
      await this.load(profileDef);
      console.log("[QuietDuplex] setup() - load() complete");
    } else {
      console.log(
        "[QuietDuplex] setup() - quietProcessorNode already exists, skipping load()"
      );
    }

    console.log("[QuietDuplex] setup() - Creating media stream source");
    this.audioInput = this.audioContext.createMediaStreamSource(
      this.audioStream
    );
    console.log("[QuietDuplex] setup() - Media stream source created");

    if (!this.instance) {
      throw new Error("WASM instance not initialized");
    }

    console.log("[QuietDuplex] setup() - Creating transmitter");
    this.transmitter = new Transmitter(this.audioContext, this.instance);
    console.log("[QuietDuplex] setup() - Transmitter created");
    console.log(
      `[QuietDuplex] setup() - Selecting profile, clampFrame: ${
        clampFrame ?? "undefined"
      }`
    );
    try {
      console.log("[QuietDuplex] setup() - About to call selectProfile");
      this.transmitter.selectProfile(profileDef, clampFrame);
      console.log("[QuietDuplex] setup() - selectProfile returned");
    } catch (error) {
      console.error(
        `[QuietDuplex] setup() - Error in selectProfile: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
    console.log("[QuietDuplex] setup() - Profile selected");

    this.onData = onData || null;
    if (this.quietProcessorNode) {
      console.log(
        "[QuietDuplex] setup() - Connecting audio input to quiet processor"
      );
      this.audioInput.connect(this.quietProcessorNode);
      this.quietProcessorNode.port.onmessage = (
        e: MessageEvent<{ value: string }>
      ) => {
        this.onStringData(e.data.value);
      };
      console.log(
        "[QuietDuplex] setup() - Audio input connected and message handler set"
      );
    } else {
      console.log(
        "[QuietDuplex] setup() - WARNING: quietProcessorNode is null, cannot connect"
      );
    }

    this.ready = true;
    console.log("[QuietDuplex] setup() - Setup complete, ready = true");
  }

  async send(payload: Uint8Array): Promise<void> {
    console.log(
      `[QuietDuplex] send() - Sending payload (${payload.length} bytes)`
    );
    if (!this.ready) {
      throw new Error("Quiet.js is not ready");
    }

    if (!this.transmitter) {
      throw new Error("Transmitter not initialized");
    }

    await this.transmitter.transmit(payload);
    console.log("[QuietDuplex] send() - Payload transmitted");
  }

  private onStringData(s: string): void {
    if (!this.ready) {
      throw new Error("Quiet.js is not ready");
    }
    if (!this.onData) {
      return;
    }
    const buffer = new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    this.onData(buffer);
  }
}
