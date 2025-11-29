import { describe, it, expect } from "vitest";
import { MockUnreliableCommunicator } from "./__tests__/mock-communicator";

describe("UnreliableCommunicator", () => {
  it("should call onReceive when data is received", () => {
    const communicator = new MockUnreliableCommunicator();
    let receivedData: ArrayBuffer | null = null;

    communicator.onReceive = (data) => {
      receivedData = data;
    };

    const testData = new Uint8Array([1, 2, 3, 4]).buffer;
    communicator.simulateReceive(testData);

    expect(receivedData).toBe(testData);
  });

  it("should call onError when error occurs", () => {
    const communicator = new MockUnreliableCommunicator();
    let receivedError: Error | null = null;

    communicator.onError = (error) => {
      receivedError = error;
    };

    const testError = new Error("Test error");
    communicator.simulateError(testError);

    expect(receivedError).toBe(testError);
  });

  it("should call onComplete callback after send", () => {
    const communicator = new MockUnreliableCommunicator();
    let completed = false;

    const testData = new Uint8Array([1, 2, 3]).buffer;
    communicator.send(testData, () => {
      completed = true;
    });

    expect(completed).toBe(true);
  });

  it("should track sent packets", () => {
    const communicator = new MockUnreliableCommunicator();
    const testData1 = new Uint8Array([1, 2, 3]).buffer;
    const testData2 = new Uint8Array([4, 5, 6]).buffer;

    communicator.send(testData1);
    communicator.send(testData2);

    const sentPackets = communicator.getSentPackets();
    expect(sentPackets).toHaveLength(2);
    expect(sentPackets[0]).toBe(testData1);
    expect(sentPackets[1]).toBe(testData2);
  });

  it("should connect two communicators bidirectionally", () => {
    const comm1 = new MockUnreliableCommunicator();
    const comm2 = new MockUnreliableCommunicator();

    let comm1Received: ArrayBuffer | null = null;
    let comm2Received: ArrayBuffer | null = null;

    comm1.onReceive = (data) => {
      comm1Received = data;
    };
    comm2.onReceive = (data) => {
      comm2Received = data;
    };

    comm1.connectTo(comm2);

    const testData1 = new Uint8Array([1, 2, 3]).buffer;
    const testData2 = new Uint8Array([4, 5, 6]).buffer;

    comm1.send(testData1);
    comm2.send(testData2);

    expect(comm2Received).toBe(testData1);
    expect(comm1Received).toBe(testData2);
  });
});
