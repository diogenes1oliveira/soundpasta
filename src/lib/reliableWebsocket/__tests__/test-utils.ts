import { PACKET_HEADER_SIZE } from "../types";
import { encodePacket, decodePacket } from "../packet";

export function createTestPacket(
  sequence: number,
  flags: number,
  payload: ArrayBuffer
): ArrayBuffer {
  return encodePacket(sequence, flags, payload);
}

export function verifyPacketStructure(packet: ArrayBuffer): boolean {
  if (packet.byteLength < PACKET_HEADER_SIZE) {
    return false;
  }

  const decoded = decodePacket(packet);
  return decoded !== null;
}

export function extractPacketHeader(packet: ArrayBuffer): {
  sequence: number;
  checksum: number;
  flags: number;
  payloadLength: number;
} | null {
  if (packet.byteLength < PACKET_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(packet);
  return {
    sequence: view.getUint32(0, true),
    checksum: view.getUint32(4, true),
    flags: view.getUint8(8),
    payloadLength: view.getUint16(9, true),
  };
}

export function createTestPayload(size: number): ArrayBuffer {
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    payload[i] = i % 256;
  }
  return payload.buffer;
}

export function corruptPacket(packet: ArrayBuffer): ArrayBuffer {
  const corrupted = new Uint8Array(packet);
  const index = Math.floor(Math.random() * corrupted.length);
  corrupted[index] = (corrupted[index] + 1) % 256;
  return corrupted.buffer;
}

export function waitForEvent(
  target: EventTarget,
  eventName: string,
  timeout: number = 1000
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(eventName, handler);
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeout);

    const handler = (event: Event) => {
      clearTimeout(timer);
      target.removeEventListener(eventName, handler);
      resolve(event);
    };

    target.addEventListener(eventName, handler);
  });
}
