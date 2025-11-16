import { PACKET_FLAGS, type ReliabilityConfig, DEFAULT_CONFIG } from "./types";
import { encodePacket, decodePacket, createAckPacket } from "./packet";

interface UnacknowledgedPacket {
  sequence: number;
  packet: ArrayBuffer;
  attempts: number;
  timerId: ReturnType<typeof setTimeout>;
}

interface ReceivedSequenceInfo {
  sequence: number;
  received: boolean;
}

export class ReliabilityManager {
  private nextSequence: number = 1;
  private unacknowledgedPackets: Map<number, UnacknowledgedPacket> = new Map();
  private receivedSequences: Map<number, boolean> = new Map();
  private receivedSequenceWindow: ReceivedSequenceInfo[] = [];
  private windowSize: number = 1000;
  private config: ReliabilityConfig;
  private sendCallback: (data: ArrayBuffer) => void;

  constructor(
    sendCallback: (data: ArrayBuffer) => void,
    config: ReliabilityConfig = DEFAULT_CONFIG
  ) {
    this.sendCallback = sendCallback;
    this.config = config;
  }

  getNextSequence(): number {
    const seq = this.nextSequence;
    this.nextSequence = (this.nextSequence + 1) >>> 0;
    return seq;
  }

  sendPacket(payload: ArrayBuffer, flags: number = PACKET_FLAGS.DATA): number {
    const sequence = this.getNextSequence();
    const packet = encodePacket(sequence, flags, payload);

    if (flags === PACKET_FLAGS.ACK) {
      this.sendCallback(packet);
      return sequence;
    }

    this.sendCallback(packet);
    this.scheduleRetransmission(sequence, packet, flags);

    return sequence;
  }

  private scheduleRetransmission(
    sequence: number,
    packet: ArrayBuffer,
    flags: number
  ): void {
    if (flags === PACKET_FLAGS.ACK) {
      return;
    }

    const scheduleNext = (): void => {
      const unacked = this.unacknowledgedPackets.get(sequence);
      if (!unacked) {
        return;
      }

      if (unacked.attempts >= this.config.maxRetransmissionAttempts) {
        this.unacknowledgedPackets.delete(sequence);
        return;
      }

      unacked.attempts++;
      this.sendCallback(packet);

      unacked.timerId = setTimeout(
        scheduleNext,
        this.config.retransmissionTimeout
      );
    };

    const timerId = setTimeout(scheduleNext, this.config.retransmissionTimeout);

    this.unacknowledgedPackets.set(sequence, {
      sequence,
      packet,
      attempts: 0,
      timerId,
    });
  }

  handleAck(sequence: number): void {
    const unacked = this.unacknowledgedPackets.get(sequence);
    if (unacked) {
      clearTimeout(unacked.timerId);
      this.unacknowledgedPackets.delete(sequence);
    }
  }

  handleReceivedPacket(data: ArrayBuffer): {
    sequence: number;
    flags: number;
    payload: ArrayBuffer;
    isDuplicate: boolean;
  } | null {
    const decoded = decodePacket(data);
    if (!decoded) {
      return null;
    }

    const { header, payload } = decoded;
    const { sequence, flags } = header;

    if (flags === PACKET_FLAGS.ACK) {
      this.handleAck(sequence);
      return null;
    }

    const isDuplicate = this.isDuplicate(sequence);
    if (!isDuplicate) {
      this.markReceived(sequence);
    }

    this.sendAck(sequence);

    return {
      sequence,
      flags,
      payload,
      isDuplicate,
    };
  }

  private isDuplicate(sequence: number): boolean {
    return this.receivedSequences.has(sequence);
  }

  private markReceived(sequence: number): void {
    this.receivedSequences.set(sequence, true);

    this.receivedSequenceWindow.push({ sequence, received: true });

    if (this.receivedSequenceWindow.length > this.windowSize) {
      const removed = this.receivedSequenceWindow.shift();
      if (removed) {
        this.receivedSequences.delete(removed.sequence);
      }
    }
  }

  private sendAck(sequence: number): void {
    const ackPacket = createAckPacket(sequence);
    this.sendCallback(ackPacket);
  }

  getUnacknowledgedCount(): number {
    return this.unacknowledgedPackets.size;
  }

  getBufferedAmount(): number {
    let total = 0;
    for (const unacked of this.unacknowledgedPackets.values()) {
      total += unacked.packet.byteLength;
    }
    return total;
  }

  cleanup(): void {
    for (const unacked of this.unacknowledgedPackets.values()) {
      clearTimeout(unacked.timerId);
    }
    this.unacknowledgedPackets.clear();
    this.receivedSequences.clear();
    this.receivedSequenceWindow = [];
  }
}
