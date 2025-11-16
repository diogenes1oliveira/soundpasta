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
    onFinish?: () => void;
    onEnqueue?: () => void;
    clampFrame?: boolean;
  }

  interface ReceiverOptions {
    profile: string | object;
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
  function setProfilesPrefix(prefix: string): void;
  function setMemoryInitializerPrefix(prefix: string): void;
  function transmitter(opts: TransmitterOptions): Transmitter;
  function receiver(opts: ReceiverOptions): Receiver;
  function str2ab(str: string): ArrayBuffer;
  function ab2str(ab: ArrayBuffer): string;
}
