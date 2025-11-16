declare namespace Quiet {
  interface Transmitter {
    transmit(payload: ArrayBuffer): void;
    destroy(): void;
    frameLength: number;
    getAverageEncodeTime(): number;
    getProfile(): unknown;
  }

  interface Receiver {
    destroy(): void;
    getAverageDecodeTime(): number;
  }

  interface TransmitterOptions {
    profile: string | object;
    outputDeviceId?: string;
    onFinish?: () => void;
    onEnqueue?: () => void;
    clampFrame?: boolean;
  }

  interface ReceiverOptions {
    profile: string | object;
    inputDeviceId?: string;
    onReceive: (payload: ArrayBuffer) => void;
    onCreateFail?: (reason: string) => void;
    onReceiveFail?: (checksumFailCount: number) => void;
    onReceiverStatsUpdate?: (stats: unknown) => void;
  }

  interface InitOptions {
    profilesPrefix?: string;
    memoryInitializerPrefix?: string;
    libfecPrefix?: string;
    onReady?: () => void;
    onError?: (reason: string) => void;
  }

  function init(opts: InitOptions): void;
  function addReadyCallback(
    callback: () => void,
    errback?: (reason: string) => void
  ): void;
  function setProfilesPrefix(prefix: string): void;
  function setMemoryInitializerPrefix(prefix: string): void;
  function transmitter(opts: TransmitterOptions): Transmitter;
  function receiver(opts: ReceiverOptions): Receiver;
  function str2ab(str: string): ArrayBuffer;
  function ab2str(ab: ArrayBuffer): string;
  function mergeab(ab1: ArrayBuffer, ab2: ArrayBuffer): ArrayBuffer;
}

declare global {
  interface Window {
    Quiet?: typeof Quiet;
  }
}
