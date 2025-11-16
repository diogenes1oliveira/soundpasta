export interface UnreliableCommunicator {
  send(data: ArrayBuffer, onComplete?: () => void): void;
  onReceive?: (data: ArrayBuffer) => void;
  onError?: (error: Error) => void;
}

export const CONNECTION_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type ConnectionState =
  | typeof CONNECTION_STATE.CONNECTING
  | typeof CONNECTION_STATE.OPEN
  | typeof CONNECTION_STATE.CLOSING
  | typeof CONNECTION_STATE.CLOSED;

export const PACKET_FLAGS = {
  DATA: 0x01,
  ACK: 0x02,
  SYN: 0x04,
  FIN: 0x08,
} as const;

export interface PacketHeader {
  sequence: number;
  checksum: number;
  flags: number;
  payloadLength: number;
}

export const PACKET_HEADER_SIZE = 11;
export const SEQUENCE_SIZE = 4;
export const CHECKSUM_SIZE = 4;
export const FLAGS_SIZE = 1;
export const LENGTH_SIZE = 2;

export interface ReliabilityConfig {
  maxPacketPayloadSize: number;
  retransmissionTimeout: number;
  maxRetransmissionAttempts: number;
  connectionTimeout: number;
}

export const DEFAULT_CONFIG: ReliabilityConfig = {
  maxPacketPayloadSize: 1489,
  retransmissionTimeout: 1000,
  maxRetransmissionAttempts: 5,
  connectionTimeout: 5000,
};
