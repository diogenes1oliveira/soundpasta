# Soundpasta Roadmap

Transmit clipboard data over audio between two devices using the Quiet.js protocol, with device virtualization support.

## Phase 1: Device Virtualization for Testing

### 1.1 Generic Device Model Interface

- [ ] Create abstract base classes/interfaces/models:
  - `OutputDevice` - for audio output devices
  - `InputDevice` - for audio input devices
  - `VirtualDevice` - can function as either input or output (with type parameter)
- [ ] Define common operations: list, create, remove, query properties
- [ ] Design for extensibility to support multiple backends (PulseAudio, Windows, macOS)

### 1.2 Basic CLI Interface with Click

- [ ] Implement CLI commands:
  - `input list` - list available input devices
  - `input create <name>` - create virtual input device
  - `input remove <name>` - remove virtual input device
  - `output list` - list available output devices
  - `output create <name>` - create virtual output device
  - `output remove <name>` - remove virtual output device
- [ ] Add persistence flag (`--persistent` / `--no-persistent`) for device creation
- [ ] Implement device querying and status commands

### 1.3 PulseAudio Implementation

- [ ] Implement PulseAudio backend using CLI (`pactl`, `pacmd`)
- [ ] Support for virtual sinks (output devices)
- [ ] Support for virtual sources (input devices)
- [ ] Handle device persistence configuration
- [ ] Error handling for PulseAudio operations

### 1.4 Testing Virtual Audio Pipes

- [ ] Generate DTMF (Dual-Tone Multi-Frequency) dial tones
- [ ] Test audio transmission through virtual PulseAudio pipes:
  - Create virtual sink and source
  - Send DTMF tones to virtual sink
  - Capture from virtual source
  - Verify tone detection and accuracy
- [ ] Validate end-to-end audio pipeline

## Phase 2: Headless Browser with Quiet.js

### 2.1 FastAPI Server Setup

- [ ] Create FastAPI application
- [ ] Serve static JavaScript files (Quiet.js library)
- [ ] Serve HTML pages for device selection and testing
- [ ] Configure CORS if needed for browser access
- [ ] Add health check endpoints

### 2.2 JavaScript/HTML Device Selection

- [ ] Create HTML interface for device selection:
  - Dropdown/select for input devices
  - Dropdown/select for output devices
  - Device name display and selection
- [ ] Implement JavaScript to:
  - Enumerate available audio devices using Web Audio API
  - Display device names and properties
  - Allow device selection by name
  - Initialize Quiet.js with selected devices
- [ ] Mimic future UI behavior for testing

### 2.3 UDP JavaScript Bridge

- [ ] Research UDP communication options for JavaScript:
  - WebRTC DataChannels (UDP-like)
  - Browser extension APIs (if applicable)
  - Server-side proxy/bridge pattern
  - Node.js bridge with headless browser communication
- [ ] Implement chosen UDP bridge solution
- [ ] Create JavaScript interface to send Quiet.js data as UDP packets
- [ ] Handle packet encoding/decoding

### 2.4 Headless Browser Testing

- [ ] Set up headless browser (Playwright or Puppeteer)
- [ ] Create local mock UDP server for testing
- [ ] Test bidirectional communication:
  - Headless browser → Mock UDP server
  - Mock UDP server → Headless browser
- [ ] Verify Quiet.js audio encoding/decoding works correctly
- [ ] Test with virtual audio devices from Phase 1

## Phase 3: TCP-like Stack in Python

### 3.1 Research TCP-like Implementations

- [ ] Evaluate existing Python libraries:
  - PyTCP - Python TCP/IP stack framework
  - asyncio protocols and transports
  - Twisted framework
  - Custom lightweight implementation
- [ ] Choose approach (full library vs. minimal custom implementation)

### 3.2 Implement TCP-like Features

- [ ] **Checksum**: Implement packet checksum verification
  - TCP-style checksum algorithm
  - Verify data integrity
- [ ] **Retransmission**: Implement reliable delivery
  - Sequence numbers
  - Acknowledgment (ACK) mechanism
  - Timeout and retransmission logic
  - Duplicate detection
- [ ] **Congestion Control**: Implement flow control
  - Window-based flow control
  - Basic congestion avoidance
  - Rate limiting
- [ ] Design protocol header format
- [ ] Implement connection establishment (handshake)
- [ ] Implement connection teardown

### 3.3 Integration with UDP Layer

- [ ] Build TCP-like layer on top of UDP
- [ ] Handle packet fragmentation and reassembly
- [ ] Implement connection state management
- [ ] Add logging and debugging capabilities

## Phase 4: WebSocket Protocol with FastAPI

### 4.1 FastAPI WebSocket Integration

- [ ] Set up WebSocket endpoints in FastAPI
- [ ] Implement WebSocket connection handling
- [ ] Add connection lifecycle management (connect, disconnect, error handling)
- [ ] Implement message routing

### 4.2 Clipboard Data Transmission

- [ ] Implement clipboard reading (platform-specific):
  - Linux: xclip, xsel, or clipboard libraries
  - Windows: pywin32 or clipboard libraries
  - macOS: pbcopy/pbpaste or clipboard libraries
- [ ] Implement clipboard writing
- [ ] Add data format handling (text, images, etc.)
- [ ] Implement clipboard change detection/monitoring

### 4.3 Protocol Integration

- [ ] Integrate TCP-like stack with WebSocket layer
- [ ] Map WebSocket messages to TCP-like protocol
- [ ] Handle WebSocket binary/text frames
- [ ] Implement end-to-end flow:
  - Clipboard → WebSocket → TCP-like → UDP → Quiet.js → Audio
  - Audio → Quiet.js → UDP → TCP-like → WebSocket → Clipboard

### 4.4 End-to-End Testing

- [ ] Test full pipeline with two devices:
  - Device A: Clipboard → Audio transmission
  - Device B: Audio reception → Clipboard
- [ ] Test bidirectional clipboard sync
- [ ] Test with various data types (text, images)
- [ ] Test error handling and recovery
- [ ] Performance testing and optimization

## Future Enhancements

### Security

- [ ] Implement encryption for data transmission
- [ ] Add authentication mechanisms
- [ ] Secure device pairing

### Performance

- [ ] Optimize audio encoding/decoding
- [ ] Reduce latency
- [ ] Handle network congestion better
- [ ] Support for larger clipboard data

### Platform Support

- [ ] Complete Windows virtual device implementation
- [ ] Mobile device support (Android, iOS)

### User Experience

- [ ] GUI application (beyond CLI)
- [ ] Device discovery and pairing UI
- [ ] Connection status indicators
- [ ] Error messages and diagnostics
