/// <reference lib="dom" />

declare module "@moxon6/quiet-js" {
  export class Transmitter {
    constructor(
      audioContext: globalThis.AudioContext,
      instance: WebAssembly.Instance
    );
    selectProfile(profile: string | object, clampFrame?: boolean): this;
    transmit(payload: Uint8Array): Promise<this>;
    destroy(): this;
  }

  export function resumeIfSuspended(
    audioContext: globalThis.AudioContext
  ): void;

  export const importObject: WebAssembly.Imports;
}

// Augment AudioContext with setSinkId method
// https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
interface AudioContext {
  setSinkId(sinkId: string): Promise<void>;
}

// Augment AudioWorkletNode with port property
// https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/port
interface AudioWorkletNode extends AudioNode {
  readonly port: MessagePort;
}
