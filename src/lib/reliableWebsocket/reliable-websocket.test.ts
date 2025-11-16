import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReliableWebSocket } from "./reliable-websocket";
import { MockUnreliableCommunicator } from "./__tests__/mock-communicator";
import { CONNECTION_STATE, DEFAULT_CONFIG } from "./types";
import { createSynPacket, createFinPacket, decodePacket } from "./packet";
import { PACKET_FLAGS } from "./types";
import {
  createTestPayload,
  extractPacketHeader,
  waitForEvent,
} from "./__tests__/test-utils";

describe("ReliableWebSocket", () => {
  let mockComm: MockUnreliableCommunicator;
  let ws: ReliableWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    mockComm = new MockUnreliableCommunicator();
  });

  afterEach(() => {
    if (ws) {
      ws.close();
    }
    vi.useRealTimers();
  });

  describe("Connection Establishment", () => {
    it("should start in CONNECTING state", () => {
      ws = new ReliableWebSocket(mockComm);
      expect(ws.readyState).toBe(CONNECTION_STATE.CONNECTING);
    });

    it("should send SYN packet on construction", () => {
      ws = new ReliableWebSocket(mockComm);
      const sentPackets = mockComm.getSentPackets();
      expect(sentPackets.length).toBeGreaterThan(0);

      const synPacket = sentPackets[0];
      const decoded = decodePacket(synPacket);
      expect(decoded).not.toBeNull();
      expect(decoded!.header.flags & PACKET_FLAGS.SYN).toBeTruthy();
    });

    it("should transition to OPEN state when SYN is received", async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);

      await vi.runAllTimersAsync();

      expect(ws.readyState).toBe(CONNECTION_STATE.OPEN);
    });

    it("should call onopen when connection opens", async () => {
      ws = new ReliableWebSocket(mockComm);
      let opened = false;

      ws.onopen = () => {
        opened = true;
      };

      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);

      await vi.runAllTimersAsync();

      expect(opened).toBe(true);
    });

    it("should timeout if no SYN received", async () => {
      const config = { ...DEFAULT_CONFIG, connectionTimeout: 1000 };
      ws = new ReliableWebSocket(mockComm, config);

      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(1000);

      expect(ws.readyState).toBe(CONNECTION_STATE.CLOSED);
    });
  });

  describe("Sending Data", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should send string data", () => {
      ws.send("hello");
      const sentPackets = mockComm.getSentPackets();
      expect(sentPackets.length).toBeGreaterThan(0);
    });

    it("should send ArrayBuffer data", () => {
      const data = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(data);
      const sentPackets = mockComm.getSentPackets();
      expect(sentPackets.length).toBeGreaterThan(0);
    });

    it("should send ArrayBufferView data", () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      ws.send(data);
      const sentPackets = mockComm.getSentPackets();
      expect(sentPackets.length).toBeGreaterThan(0);
    });

    it("should create packets with correct headers", () => {
      const data = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(data);

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      expect(dataPacket).toBeDefined();
      if (dataPacket) {
        const header = extractPacketHeader(dataPacket);
        expect(header).not.toBeNull();
        expect(header!.flags & PACKET_FLAGS.DATA).toBeTruthy();
      }
    });

    it("should fragment large messages", () => {
      const largeData = createTestPayload(3000);
      ws.send(largeData);

      const sentPackets = mockComm.getSentPackets();
      const dataPackets = sentPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      expect(dataPackets.length).toBeGreaterThan(1);
    });

    it("should throw error if sending when not open", () => {
      ws.close();
      expect(() => {
        ws.send("test");
      }).toThrow("WebSocket is not open");
    });
  });

  describe("Receiving Data", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should call onmessage when data is received", async () => {
      let receivedMessage: MessageEvent | null = null;

      ws.onmessage = (event) => {
        receivedMessage = event;
      };

      const testData = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(testData);

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      if (dataPacket) {
        mockComm.simulateReceive(dataPacket);
      }

      await vi.runAllTimersAsync();

      expect(receivedMessage).not.toBeNull();
    });

    it("should ignore duplicate packets", async () => {
      let messageCount = 0;

      ws.onmessage = () => {
        messageCount++;
      };

      const testData = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(testData);

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      if (dataPacket) {
        mockComm.simulateReceive(dataPacket);
        mockComm.simulateReceive(dataPacket);
      }

      await vi.runAllTimersAsync();

      expect(messageCount).toBe(1);
    });

    it("should reassemble fragmented messages", async () => {
      let receivedMessage: MessageEvent | null = null;

      ws.onmessage = (event) => {
        receivedMessage = event;
      };

      const largeData = createTestPayload(3000);
      ws.send(largeData);

      const sentPackets = mockComm.getSentPackets();
      const dataPackets = sentPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      for (const packet of dataPackets) {
        mockComm.simulateReceive(packet);
      }

      await vi.runAllTimersAsync();

      expect(receivedMessage).not.toBeNull();
      if (receivedMessage) {
        const receivedData = receivedMessage.data as ArrayBuffer;
        expect(receivedData.byteLength).toBe(largeData.byteLength);
      }
    });
  });

  describe("Retransmission", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it.skip("should retransmit unacknowledged packets", async () => {
      const commWithLoss = new MockUnreliableCommunicator({
        packetLossRate: 0.0,
      });
      commWithLoss.connectedTo = undefined;

      const wsWithLoss = new ReliableWebSocket(commWithLoss);
      const synPacket = createSynPacket();
      commWithLoss.simulateReceive(synPacket);
      await vi.runAllTimersAsync();

      wsWithLoss.send("test");
      await vi.runAllTimersAsync();

      const sentPackets = commWithLoss.getSentPackets();
      const dataPackets = sentPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });
      expect(dataPackets.length).toBeGreaterThan(0);

      commWithLoss.clearSentPackets();
      const originalOnReceive = commWithLoss.onReceive;
      commWithLoss.onReceive = undefined;

      vi.advanceTimersByTime(DEFAULT_CONFIG.retransmissionTimeout + 100);
      await vi.runAllTimersAsync();

      const afterRetransmitPackets = commWithLoss.getSentPackets();
      const retransmittedDataPackets = afterRetransmitPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      expect(retransmittedDataPackets.length).toBeGreaterThan(0);
    });

    it("should stop retransmitting after max attempts", async () => {
      const commWithLoss = new MockUnreliableCommunicator({
        packetLossRate: 1.0,
      });
      const wsWithLoss = new ReliableWebSocket(commWithLoss);
      const synPacket = createSynPacket();
      commWithLoss.simulateReceive(synPacket);
      await vi.runAllTimersAsync();

      wsWithLoss.send("test");

      const maxAttempts = DEFAULT_CONFIG.maxRetransmissionAttempts;
      for (let i = 0; i < maxAttempts + 1; i++) {
        vi.advanceTimersByTime(DEFAULT_CONFIG.retransmissionTimeout);
      }

      const sentPackets = commWithLoss.getSentPackets();
      const dataPackets = sentPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      expect(dataPackets.length).toBeLessThanOrEqual(maxAttempts + 1);
    });
  });

  describe("Acknowledgments", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should send ACK when packet is received", async () => {
      const testData = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(testData);

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      if (dataPacket) {
        mockComm.simulateReceive(dataPacket);
      }

      await vi.runAllTimersAsync();

      const allPackets = mockComm.getSentPackets();
      const ackPackets = allPackets.filter((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.ACK;
      });

      expect(ackPackets.length).toBeGreaterThan(0);
    });
  });

  describe("Checksum Validation", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should reject packets with invalid checksum", async () => {
      let messageReceived = false;

      ws.onmessage = () => {
        messageReceived = true;
      };

      const testData = new Uint8Array([1, 2, 3, 4]).buffer;
      ws.send(testData);

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      if (dataPacket) {
        const corrupted = new Uint8Array(dataPacket);
        corrupted[0] = (corrupted[0] + 1) % 256;
        mockComm.simulateReceive(corrupted.buffer);
      }

      await vi.runAllTimersAsync();

      expect(messageReceived).toBe(false);
    });
  });

  describe("Graceful Close", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should transition to CLOSING state on close", () => {
      ws.close();
      expect(ws.readyState).toBe(CONNECTION_STATE.CLOSING);
    });

    it("should send FIN packet on close", () => {
      ws.close();
      const sentPackets = mockComm.getSentPackets();
      const finPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.FIN;
      });

      expect(finPacket).toBeDefined();
    });

    it("should transition to CLOSED when FIN is received", async () => {
      ws.close();
      const finPacket = createFinPacket(1);
      mockComm.simulateReceive(finPacket);

      await vi.runAllTimersAsync();

      expect(ws.readyState).toBe(CONNECTION_STATE.CLOSED);
    });

    it("should call onclose when connection closes", async () => {
      let closed = false;

      ws.onclose = () => {
        closed = true;
      };

      ws.close();
      const finPacket = createFinPacket(1);
      mockComm.simulateReceive(finPacket);

      await vi.runAllTimersAsync();

      expect(closed).toBe(true);
    });
  });

  describe("bufferedAmount", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should track unacknowledged bytes", () => {
      const data = createTestPayload(1000);
      ws.send(data);

      expect(ws.bufferedAmount).toBeGreaterThan(0);
    });

    it("should decrease when packets are acknowledged", async () => {
      const data = createTestPayload(1000);
      ws.send(data);

      const initialBuffered = ws.bufferedAmount;

      const sentPackets = mockComm.getSentPackets();
      const dataPacket = sentPackets.find((p) => {
        const decoded = decodePacket(p);
        return decoded && decoded.header.flags & PACKET_FLAGS.DATA;
      });

      if (dataPacket) {
        mockComm.simulateReceive(dataPacket);
      }

      await vi.runAllTimersAsync();

      expect(ws.bufferedAmount).toBeLessThan(initialBuffered);
    });
  });

  describe("binaryType", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should default to arraybuffer", () => {
      expect(ws.binaryType).toBe("arraybuffer");
    });

    it("should allow setting to blob", () => {
      ws.binaryType = "blob";
      expect(ws.binaryType).toBe("blob");
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      ws = new ReliableWebSocket(mockComm);
      const synPacket = createSynPacket();
      mockComm.simulateReceive(synPacket);
      await vi.runAllTimersAsync();
    });

    it("should call onerror when communicator reports error", () => {
      let errorOccurred = false;

      ws.onerror = () => {
        errorOccurred = true;
      };

      mockComm.simulateError(new Error("Test error"));

      expect(errorOccurred).toBe(true);
    });
  });
});
