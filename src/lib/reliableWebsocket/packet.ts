import CRC32 from "crc-32";
import {
  PACKET_HEADER_SIZE,
  SEQUENCE_SIZE,
  CHECKSUM_SIZE,
  FLAGS_SIZE,
  LENGTH_SIZE,
  PACKET_FLAGS,
  type PacketHeader,
} from "./types";

export function calculateChecksum(data: ArrayBuffer): number {
  const view = new Uint8Array(data);
  return CRC32.buf(view) >>> 0;
}

export function encodePacket(
  sequence: number,
  flags: number,
  payload: ArrayBuffer
): ArrayBuffer {
  const payloadLength = payload.byteLength;
  const packetSize = PACKET_HEADER_SIZE + payloadLength;
  const packet = new ArrayBuffer(packetSize);
  const view = new DataView(packet);

  let offset = 0;

  view.setUint32(offset, sequence, true);
  offset += SEQUENCE_SIZE;

  const headerWithoutChecksum = new ArrayBuffer(
    PACKET_HEADER_SIZE - CHECKSUM_SIZE
  );
  const headerView = new DataView(headerWithoutChecksum);
  headerView.setUint32(0, sequence, true);
  headerView.setUint8(4, flags);
  headerView.setUint16(5, payloadLength, true);

  const payloadView = new Uint8Array(payload);
  const dataForChecksum = new Uint8Array(
    headerWithoutChecksum.byteLength + payload.byteLength
  );
  dataForChecksum.set(new Uint8Array(headerWithoutChecksum), 0);
  dataForChecksum.set(payloadView, headerWithoutChecksum.byteLength);

  const checksum = calculateChecksum(dataForChecksum.buffer);

  view.setUint32(offset, checksum, true);
  offset += CHECKSUM_SIZE;

  view.setUint8(offset, flags);
  offset += FLAGS_SIZE;

  view.setUint16(offset, payloadLength, true);
  offset += LENGTH_SIZE;

  const payloadArray = new Uint8Array(packet, offset);
  payloadArray.set(new Uint8Array(payload));

  return packet;
}

export function decodePacket(data: ArrayBuffer): {
  header: PacketHeader;
  payload: ArrayBuffer;
} | null {
  if (data.byteLength < PACKET_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(data);
  let offset = 0;

  const sequence = view.getUint32(offset, true);
  offset += SEQUENCE_SIZE;

  const checksum = view.getUint32(offset, true);
  offset += CHECKSUM_SIZE;

  const flags = view.getUint8(offset);
  offset += FLAGS_SIZE;

  const payloadLength = view.getUint16(offset, true);
  offset += LENGTH_SIZE;

  if (data.byteLength < PACKET_HEADER_SIZE + payloadLength) {
    return null;
  }

  const headerWithoutChecksum = new ArrayBuffer(
    SEQUENCE_SIZE + FLAGS_SIZE + LENGTH_SIZE
  );
  const headerView = new DataView(headerWithoutChecksum);
  headerView.setUint32(0, sequence, true);
  headerView.setUint8(4, flags);
  headerView.setUint16(5, payloadLength, true);

  const payload = data.slice(offset, offset + payloadLength);
  const payloadView = new Uint8Array(payload);

  const dataForChecksum = new Uint8Array(
    headerWithoutChecksum.byteLength + payload.byteLength
  );
  dataForChecksum.set(new Uint8Array(headerWithoutChecksum), 0);
  dataForChecksum.set(payloadView, headerWithoutChecksum.byteLength);

  const calculatedChecksum = calculateChecksum(dataForChecksum.buffer);

  if (calculatedChecksum !== checksum) {
    return null;
  }

  return {
    header: {
      sequence,
      checksum,
      flags,
      payloadLength,
    },
    payload,
  };
}

export function createAckPacket(sequence: number): ArrayBuffer {
  return encodePacket(sequence, PACKET_FLAGS.ACK, new ArrayBuffer(0));
}

export function createSynPacket(): ArrayBuffer {
  return encodePacket(0, PACKET_FLAGS.SYN, new ArrayBuffer(0));
}

export function createFinPacket(sequence: number): ArrayBuffer {
  return encodePacket(sequence, PACKET_FLAGS.FIN, new ArrayBuffer(0));
}
