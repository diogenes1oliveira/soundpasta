import type { UnreliableCommunicator } from "../types";

export interface MockCommunicatorOptions {
  packetLossRate?: number;
  corruptionRate?: number;
  delay?: number;
  reorder?: boolean;
}

export class MockUnreliableCommunicator implements UnreliableCommunicator {
  private sentPackets: ArrayBuffer[] = [];
  private options: MockCommunicatorOptions;
  private connectedTo?: MockUnreliableCommunicator;
  onReceive?: (data: ArrayBuffer) => void;
  onError?: (error: Error) => void;

  constructor(options: MockCommunicatorOptions = {}) {
    this.options = {
      packetLossRate: 0,
      corruptionRate: 0,
      delay: 0,
      reorder: false,
      ...options,
    };
  }

  send(data: ArrayBuffer, onComplete?: () => void): void {
    if (Math.random() < this.options.packetLossRate!) {
      if (onComplete) {
        onComplete();
      }
      return;
    }

    let packet = data;
    if (Math.random() < this.options.corruptionRate!) {
      packet = this.corruptPacket(data);
    }

    this.sentPackets.push(packet);

    if (this.connectedTo && this.connectedTo.onReceive) {
      this.connectedTo.onReceive(packet);
    }

    if (this.options.delay! > 0) {
      setTimeout(() => {
        if (onComplete) {
          onComplete();
        }
      }, this.options.delay);
    } else {
      if (onComplete) {
        onComplete();
      }
    }
  }

  private corruptPacket(data: ArrayBuffer): ArrayBuffer {
    const corrupted = new Uint8Array(data);
    const index = Math.floor(Math.random() * corrupted.length);
    corrupted[index] = (corrupted[index] + 1) % 256;
    return corrupted.buffer;
  }

  simulateReceive(data: ArrayBuffer): void {
    if (this.onReceive) {
      this.onReceive(data);
    }
  }

  simulateError(error: Error): void {
    if (this.onError) {
      this.onError(error);
    }
  }

  getSentPackets(): ArrayBuffer[] {
    return [...this.sentPackets];
  }

  clearSentPackets(): void {
    this.sentPackets = [];
  }

  connectTo(other: MockUnreliableCommunicator): void {
    this.connectedTo = other;
    other.connectedTo = this;
  }
}
