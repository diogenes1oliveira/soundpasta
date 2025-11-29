import {
  type UnreliableCommunicator,
  CONNECTION_STATE,
  type ConnectionState,
  PACKET_FLAGS,
  type ReliabilityConfig,
  DEFAULT_CONFIG,
} from "./types";
import { ReliabilityManager } from "./reliability";
import { createSynPacket, createFinPacket } from "./packet";

interface FragmentedMessage {
  totalFragments: number;
  receivedFragments: Map<number, ArrayBuffer>;
  expectedSequence: number;
}

export class ReliableWebSocket {
  private communicator: UnreliableCommunicator;
  private state: ConnectionState = CONNECTION_STATE.CONNECTING;
  private reliabilityManager: ReliabilityManager;
  private config: ReliabilityConfig;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private closingTimer: ReturnType<typeof setTimeout> | null = null;
  private fragmentedMessages: Map<number, FragmentedMessage> = new Map();
  private nextFragmentId: number = 1;
  private _binaryType: "blob" | "arraybuffer" = "arraybuffer";

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(
    communicator: UnreliableCommunicator,
    config: ReliabilityConfig = DEFAULT_CONFIG
  ) {
    this.communicator = communicator;
    this.config = config;
    this.reliabilityManager = new ReliabilityManager(
      (data) => this.communicator.send(data),
      config
    );

    this.communicator.onReceive = (data) => this.handleReceivedData(data);
    this.communicator.onError = (error) => this.handleError(error);

    this.establishConnection();
  }

  get readyState(): number {
    return this.state;
  }

  get bufferedAmount(): number {
    return this.reliabilityManager.getBufferedAmount();
  }

  get binaryType(): "blob" | "arraybuffer" {
    return this._binaryType;
  }

  set binaryType(value: "blob" | "arraybuffer") {
    this._binaryType = value;
  }

  private establishConnection(): void {
    const synPacket = createSynPacket();
    this.communicator.send(synPacket);

    this.connectionTimer = setTimeout(() => {
      if (this.state === CONNECTION_STATE.CONNECTING) {
        this.close(1006, "Connection timeout");
      }
    }, this.config.connectionTimeout);
  }

  private handleReceivedData(data: ArrayBuffer): void {
    const result = this.reliabilityManager.handleReceivedPacket(data);
    if (!result) {
      return;
    }

    const { flags, payload, isDuplicate } = result;

    if (isDuplicate) {
      return;
    }

    if (flags & PACKET_FLAGS.SYN) {
      this.handleSyn();
      return;
    }

    if (flags & PACKET_FLAGS.FIN) {
      this.handleFin();
      return;
    }

    if (flags & PACKET_FLAGS.DATA) {
      this.handleData(payload);
    }
  }

  private handleSyn(): void {
    if (this.state === CONNECTION_STATE.CONNECTING) {
      const synPacket = createSynPacket();
      this.communicator.send(synPacket);
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      this.state = CONNECTION_STATE.OPEN;
      const event = new Event("open");
      if (this.onopen) {
        this.onopen(event);
      }
    }
  }

  private handleFin(): void {
    if (
      this.state === CONNECTION_STATE.OPEN ||
      this.state === CONNECTION_STATE.CLOSING
    ) {
      this.state = CONNECTION_STATE.CLOSED;
      if (this.closingTimer) {
        clearTimeout(this.closingTimer);
        this.closingTimer = null;
      }
      const event = new CloseEvent("close", {
        code: 1000,
        reason: "",
        wasClean: true,
      });
      if (this.onclose) {
        this.onclose(event);
      }
    }
  }

  private handleData(payload: ArrayBuffer): void {
    if (this.state !== CONNECTION_STATE.OPEN) {
      return;
    }

    const view = new DataView(payload);
    if (payload.byteLength < 5) {
      this.handleCompleteMessage(payload);
      return;
    }

    const fragmentId = view.getUint32(0, true);
    const fragmentIndex = view.getUint8(4);
    const isLastFragment = fragmentIndex & 0x80;
    const actualIndex = fragmentIndex & 0x7f;
    const fragmentData = payload.slice(5);

    let fragmented = this.fragmentedMessages.get(fragmentId);
    if (!fragmented) {
      fragmented = {
        totalFragments: isLastFragment ? actualIndex + 1 : -1,
        receivedFragments: new Map(),
        expectedSequence: 0,
      };
      this.fragmentedMessages.set(fragmentId, fragmented);
    }

    fragmented.receivedFragments.set(actualIndex, fragmentData);

    if (isLastFragment) {
      fragmented.totalFragments = actualIndex + 1;
    }

    if (
      fragmented.totalFragments > 0 &&
      fragmented.receivedFragments.size === fragmented.totalFragments
    ) {
      const reassembled = this.reassembleMessage(fragmented);
      this.fragmentedMessages.delete(fragmentId);
      this.handleCompleteMessage(reassembled);
    }
  }

  private reassembleMessage(fragmented: FragmentedMessage): ArrayBuffer {
    const totalSize = Array.from(fragmented.receivedFragments.values()).reduce(
      (sum, frag) => sum + frag.byteLength,
      0
    );
    const result = new Uint8Array(totalSize);
    let offset = 0;

    for (let i = 0; i < fragmented.totalFragments; i++) {
      const fragment = fragmented.receivedFragments.get(i);
      if (!fragment) {
        continue;
      }
      result.set(new Uint8Array(fragment), offset);
      offset += fragment.byteLength;
    }

    return result.buffer;
  }

  private handleCompleteMessage(data: ArrayBuffer): void {
    const event = new MessageEvent("message", {
      data: this._binaryType === "blob" ? new Blob([data]) : data,
    });
    if (this.onmessage) {
      this.onmessage(event);
    }
  }

  private handleError(_error: Error): void {
    const event = new Event("error");
    if (this.onerror) {
      this.onerror(event);
    }
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (this.state !== CONNECTION_STATE.OPEN) {
      throw new Error("WebSocket is not open");
    }

    let buffer: ArrayBuffer;
    if (typeof data === "string") {
      const encoder = new TextEncoder();
      buffer = encoder.encode(data).buffer;
    } else if (data instanceof Blob) {
      throw new Error("Blob sending not yet implemented");
    } else if (data instanceof ArrayBuffer) {
      buffer = data;
    } else {
      const bufferView = new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength
      );
      buffer = bufferView.buffer.slice(
        bufferView.byteOffset,
        bufferView.byteOffset + bufferView.byteLength
      ) as ArrayBuffer;
    }

    this.sendMessage(buffer);
  }

  private sendMessage(data: ArrayBuffer): void {
    const maxPayloadSize = this.config.maxPacketPayloadSize;
    const fragmentId = this.nextFragmentId++;
    const totalFragments = Math.ceil(data.byteLength / maxPayloadSize);

    if (totalFragments === 1) {
      this.reliabilityManager.sendPacket(data, PACKET_FLAGS.DATA);
      return;
    }

    const view = new Uint8Array(data);
    for (let i = 0; i < totalFragments; i++) {
      const start = i * maxPayloadSize;
      const end = Math.min(start + maxPayloadSize, data.byteLength);
      const fragment = view.slice(start, end);

      const fragmentHeader = new ArrayBuffer(5);
      const headerView = new DataView(fragmentHeader);
      headerView.setUint32(0, fragmentId, true);
      const isLast = i === totalFragments - 1;
      headerView.setUint8(4, isLast ? i | 0x80 : i);

      const fragmentPayload = new Uint8Array(5 + fragment.length);
      fragmentPayload.set(new Uint8Array(fragmentHeader), 0);
      fragmentPayload.set(fragment, 5);

      this.reliabilityManager.sendPacket(
        fragmentPayload.buffer,
        PACKET_FLAGS.DATA
      );
    }
  }

  close(code?: number, reason?: string): void {
    if (
      this.state === CONNECTION_STATE.CLOSED ||
      this.state === CONNECTION_STATE.CLOSING
    ) {
      return;
    }

    this.state = CONNECTION_STATE.CLOSING;

    const finSequence = this.reliabilityManager.getNextSequence();
    const finPacket = createFinPacket(finSequence);
    this.communicator.send(finPacket);
    this.reliabilityManager.sendPacket(new ArrayBuffer(0), PACKET_FLAGS.FIN);

    this.closingTimer = setTimeout(() => {
      this.state = CONNECTION_STATE.CLOSED;
      if (this.closingTimer) {
        clearTimeout(this.closingTimer);
        this.closingTimer = null;
      }
      const event = new CloseEvent("close", {
        code: code || 1000,
        reason: reason || "",
        wasClean: false,
      });
      if (this.onclose) {
        this.onclose(event);
      }
    }, this.config.connectionTimeout);
  }
}
