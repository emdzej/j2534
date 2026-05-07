# @emdzej/j2534-ts — J2534 PassThru Driver for TypeScript

A complete TypeScript implementation of the SAE J2534 PassThru API for vehicle diagnostic communication, targeting the Tactrix OpenPort 2.0 interface.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
├─────────────────────────────────────────────────────────────┤
│                  @emdzej/j2534-driver                               │
│          (J2534Device — full PassThru API)                   │
├──────────────────────┬──────────────────────────────────────┤
│    @emdzej/j2534-core       │         @emdzej/j2534-types                  │
│  (AT commands,       │   (enums, interfaces,                 │
│   parser, queue)     │    constants)                         │
├──────────────────────┴──────────────────────────────────────┤
│          Transport Interface (pluggable)                     │
├────────────────────────┬────────────────────────────────────┤
│     @emdzej/j2534-usb         │         @emdzej/j2534-webusb              │
│  (Node.js + libusb)    │      (Browser WebUSB)              │
└────────────────────────┴────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@emdzej/j2534-types` | TypeScript types, enums, and constants for the full J2534 spec |
| `@emdzej/j2534-core` | AT-command encoder/decoder, response parser, message FIFO queue |
| `@emdzej/j2534-usb` | Node.js USB transport via `usb` package (libusb bindings) |
| `@emdzej/j2534-webusb` | Browser WebUSB transport for Chrome/Edge |
| `@emdzej/j2534-driver` | Main driver — implements the full J2534 PassThru API |

## Examples

| Example | Description |
|---------|-------------|
| `@emdzej/j2534-example-canlogger` | Passive CAN/ISO15765 bus sniffer with file logging |
| `@emdzej/j2534-example-klogger` | K-line/L-line/AUX serial data logger |
| `@emdzej/j2534-example-innomts` | Innovate MTS wideband O2 sensor reader (LC-1/LM-1) |

## Quick Start

```bash
cd ts
pnpm install
pnpm build
```

### Node.js (USB)

```typescript
import { Protocol, FilterType } from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

const device = new J2534Device({ transport: new NodeUsbTransport() });

await device.passThruOpen();
const ch = await device.passThruConnect(Protocol.CAN, 0, 500000);

// Pass-all filter
const mask = createMsg(Protocol.CAN, [0, 0, 0, 0]);
const pattern = createMsg(Protocol.CAN, [0, 0, 0, 0]);
await device.passThruStartMsgFilter(ch, FilterType.PASS_FILTER, mask, pattern);

// Read messages
const msgs = await device.passThruReadMsgs(ch, 10, 1000);
for (const msg of msgs) {
  console.log(msg.data.subarray(0, msg.dataSize));
}

await device.passThruDisconnect(ch);
await device.passThruClose();
```

### Browser (WebUSB)

```typescript
import { Protocol, FilterType } from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { WebUsbTransport } from "@emdzej/j2534-webusb";

// Must be called from a user gesture (button click)
async function connectAndRead() {
  const device = new J2534Device({ transport: new WebUsbTransport() });
  await device.passThruOpen();
  // ... same API as Node.js
}

document.getElementById("connect")!.addEventListener("click", connectAndRead);
```

---

## J2534 API Reference

### PassThruOpen

Opens connection to the hardware device.

```typescript
const deviceId = await device.passThruOpen();
```

Performs:
1. USB device discovery and connection
2. Sends `ati` (identify) — receives firmware version
3. Sends `ata` (attach) — device acknowledges readiness

---

### PassThruClose

Closes the device connection.

```typescript
await device.passThruClose();
```

Sends `atz` (reset) and releases USB interface.

---

### PassThruConnect

Opens a communication channel with specified protocol and baud rate.

```typescript
const channelId = await device.passThruConnect(
  protocol: Protocol,
  flags: number,     // ConnectFlag bitmask
  baudRate: number
);
```

**Supported protocols:**

| Protocol | Baud Rates | Notes |
|----------|-----------|-------|
| `Protocol.J1850VPW` | 10400 | J1850 Variable Pulse Width (GM) |
| `Protocol.J1850PWM` | 41600 | J1850 Pulse Width Modulation (Ford) |
| `Protocol.ISO9141` | 4800–10400 | K-line diagnostics (OBD-II, KWP) |
| `Protocol.ISO14230` | 4800–10400 | KWP2000 (ISO 14230) |
| `Protocol.CAN` | 125000–1000000 | Raw CAN frames |
| `Protocol.ISO15765` | 125000–1000000 | CAN application layer (UDS/OBD-II) |

**J2534-2 Extended Channel IDs (multi-channel):**

| Protocol | Description |
|----------|-------------|
| `ProtocolExt.ISO9141_K` | K-line channel |
| `ProtocolExt.ISO9141_L` | L-line channel |
| `ProtocolExt.ISO9141_INNO` | AUX 2.5mm jack (RS-232) |
| `ProtocolExt.ISO14230_K` | KWP2000 over K-line |
| `ProtocolExt.ISO14230_L` | KWP2000 over L-line |
| `ProtocolExt.CAN_CH1` | CAN bus channel 1 |
| `ProtocolExt.ISO15765_CH1` | ISO15765 channel 1 |
| `ProtocolExt.J1850VPW_CH1` | J1850 VPW channel 1 |
| `ProtocolExt.J1850PWM_CH1` | J1850 PWM channel 1 |

**Multi-channel example (CAN + K-line simultaneously):**
```typescript
const canCh = await device.passThruConnect(Protocol.CAN, 0, 500000);
const kCh = await device.passThruConnect(ProtocolExt.ISO9141_K, 0x0200, 10400);
// Both channels active at the same time on different physical buses
```

**Connect flags:**

| Flag | Value | Description |
|------|-------|-------------|
| `CAN_29BIT_ID` | 0x0100 | Use 29-bit extended CAN IDs |
| `ISO9141_NO_CHECKSUM` | 0x0200 | Skip ISO9141 checksum validation |
| `CAN_ID_BOTH` | 0x0800 | Accept both 11-bit and 29-bit IDs |
| `ISO9141_K_LINE_ONLY` | 0x1000 | Use K-line only (no L-line init) |

**Tactrix extensions:**

| Flag | Value | Description |
|------|-------|-------------|
| `SNIFF_MODE` | 0x10000000 | Passive listen (CAN: no ACK) |

---

### PassThruDisconnect

Closes a communication channel.

```typescript
await device.passThruDisconnect(channelId);
```

---

### PassThruReadMsgs

Reads messages from the receive buffer.

```typescript
const msgs: PassThruMsg[] = await device.passThruReadMsgs(
  channelId: number,
  numMsgs: number,    // Max messages to read
  timeout: number     // Timeout in milliseconds
);
```

Returns up to `numMsgs` messages. Throws `ERR_BUFFER_EMPTY` if no messages arrive within timeout.

**PassThruMsg structure:**

```typescript
interface PassThruMsg {
  protocolId: Protocol;     // Protocol that generated this message
  rxStatus: number;         // RxStatus flags
  txFlags: number;          // Tx flags (for TX confirmation messages)
  timestamp: number;        // Microsecond timestamp
  dataSize: number;         // Number of valid bytes in data
  extraDataIndex: number;   // Start of extra data (ISO15765)
  data: Uint8Array;         // Message payload (up to 4128 bytes)
}
```

**RxStatus flags:**

| Flag | Value | Meaning |
|------|-------|---------|
| `TX_MSG_TYPE` | 0x0001 | This is a TX confirmation, not a received message |
| `START_OF_MESSAGE` | 0x0002 | First frame of multi-frame message |
| `ISO15765_FIRST_FRAME` | 0x0002 | ISO15765 First Frame indication |
| `RX_BREAK` | 0x0004 | Break received |
| `TX_INDICATION` | 0x0008 | Transmit complete indication |
| `ISO15765_PADDING_ERROR` | 0x0010 | Padding error in received frame |
| `ISO15765_EXT_ADDR` | 0x0080 | Extended addressing used |
| `CAN_29BIT_ID` | 0x0100 | Message used 29-bit CAN ID |

---

### PassThruWriteMsgs

Transmits messages on a channel.

```typescript
import { createMsg } from "@emdzej/j2534-driver";

const msg = createMsg(Protocol.CAN, [0x00, 0x00, 0x07, 0xE0, 0x02, 0x01, 0x00]);
const numWritten = await device.passThruWriteMsgs(channelId, [msg], 1000);
```

**CAN message data format:**
- Bytes 0–3: CAN ID (4 bytes, MSB first)
- Bytes 4+: CAN data payload

**ISO15765 message data format:**
- Bytes 0–3: CAN ID (4 bytes, MSB first)
- Bytes 4+: ISO-TP payload (driver handles segmentation)

---

### PassThruStartMsgFilter

Sets up a message filter on a channel.

```typescript
const filterId = await device.passThruStartMsgFilter(
  channelId: number,
  filterType: FilterType,
  maskMsg: PassThruMsg,
  patternMsg: PassThruMsg,
  flowControlMsg?: PassThruMsg   // Required for FLOW_CONTROL_FILTER
);
```

**Filter types:**

| Type | Value | Description |
|------|-------|-------------|
| `PASS_FILTER` | 0x01 | Allow messages matching (data & mask) == pattern |
| `BLOCK_FILTER` | 0x02 | Block messages matching (data & mask) == pattern |
| `FLOW_CONTROL_FILTER` | 0x03 | ISO15765 flow control (required for ISO15765) |

**Example: Pass-all CAN filter**
```typescript
const mask = createMsg(Protocol.CAN, [0x00, 0x00, 0x00, 0x00]);
const pattern = createMsg(Protocol.CAN, [0x00, 0x00, 0x00, 0x00]);
await device.passThruStartMsgFilter(ch, FilterType.PASS_FILTER, mask, pattern);
```

**Example: ISO15765 flow control for OBD-II**
```typescript
const mask    = createMsg(Protocol.ISO15765, [0xFF, 0xFF, 0xFF, 0xFF]);
const txId    = createMsg(Protocol.ISO15765, [0x00, 0x00, 0x07, 0xE0]);
const rxId    = createMsg(Protocol.ISO15765, [0x00, 0x00, 0x07, 0xE8]);
await device.passThruStartMsgFilter(ch, FilterType.FLOW_CONTROL_FILTER, mask, txId, rxId);
```

---

### PassThruStopMsgFilter

Removes a previously set filter.

```typescript
await device.passThruStopMsgFilter(channelId, filterId);
```

---

### PassThruStartPeriodicMsg

Starts sending a message at a fixed interval (software timer implementation).

```typescript
const periodicId = await device.passThruStartPeriodicMsg(
  channelId,
  msg,        // PassThruMsg to send repeatedly
  intervalMs  // Interval in milliseconds (5–65535)
);
```

**Limits:** Maximum 10 concurrent periodic messages across all channels.

**Example: OBD-II keep-alive (tester present)**
```typescript
const testerPresent = createMsg(Protocol.ISO15765, [0x00, 0x00, 0x07, 0xE0, 0x01, 0x3E]);
const periodicId = await device.passThruStartPeriodicMsg(channelId, testerPresent, 2000);
```

---

### PassThruStopPeriodicMsg

Stops a periodic message.

```typescript
await device.passThruStopPeriodicMsg(channelId, periodicId);
```

---

### PassThruSetProgrammingVoltage

Controls voltage output on OBD-II connector pins. The OpenPort 2.0 supports
voltage control on pins 1, 2 (J1850P), 3, 9, 11, 12, 13, and the AUX jack.

```typescript
import { Pin, VOLTAGE_OFF, SHORT_TO_GROUND } from "@emdzej/j2534-types";

// Set pin 2 to 5000mV
await device.passThruSetProgrammingVoltage(Pin.PIN_2_J1850P, 5000);

// Turn off voltage
await device.passThruSetProgrammingVoltage(Pin.PIN_2_J1850P, VOLTAGE_OFF);

// Short to ground
await device.passThruSetProgrammingVoltage(Pin.PIN_7_K_LINE, SHORT_TO_GROUND);
```

---

### PassThruReadVersion

Returns firmware, DLL, and API version strings.

```typescript
const version = await device.passThruReadVersion();
// { firmwareVersion: "2.20.3", dllVersion: "3.0.0", apiVersion: "04.04" }
```

---

### PassThruGetLastError

Returns human-readable description of the last error.

```typescript
const errorText = device.passThruGetLastError();
```

---

### PassThruIoctl

Performs I/O control operations.

```typescript
await device.passThruIoctl(channelId, ioctlId, input?);
```

**Supported IOCTLs:**

| IOCTL | Input | Output | Description |
|-------|-------|--------|-------------|
| `GET_CONFIG` | `SConfig[]` | `SConfig[]` | Read configuration parameters |
| `SET_CONFIG` | `SConfig[]` | void | Set configuration parameters |
| `READ_VBATT` | — | `number` (mV) | Read battery voltage (pin 16) |
| `FIVE_BAUD_INIT` | `PassThruMsg` (1 byte: target addr) | `PassThruMsg` (keyword bytes) | ISO9141 5-baud initialization |
| `FAST_INIT` | `PassThruMsg` | `PassThruMsg` | ISO14230 fast initialization |
| `CLEAR_TX_BUFFER` | — | void | Clear transmit buffer |
| `CLEAR_RX_BUFFER` | — | void | Clear receive buffer |
| `CLEAR_PERIODIC_MSGS` | — | void | Stop all periodic messages on channel |
| `CLEAR_MSG_FILTERS` | — | void | Remove all filters on channel |
| `CLEAR_FUNCT_MSG_LOOKUP_TABLE` | — | void | Clear functional address table |
| `ADD_TO_FUNCT_MSG_LOOKUP_TABLE` | `SByteArray` | void | Add addresses to functional table |
| `DELETE_FROM_FUNCT_MSG_LOOKUP_TABLE` | `SByteArray` | void | Remove addresses from table |
| `READ_PROG_VOLTAGE` | — | `number` (mV) | Read programming pin voltage |

**Example: Read battery voltage**
```typescript
const millivolts = await device.passThruIoctl(channelId, IoctlId.READ_VBATT);
console.log(`Battery: ${(millivolts as number) / 1000}V`);
```

**Example: Set timing parameters**
```typescript
await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
  { parameter: ConfigParam.P1_MAX, value: 20 },
  { parameter: ConfigParam.ISO15765_BS, value: 0 },
  { parameter: ConfigParam.ISO15765_STMIN, value: 0 },
]);
```

**Example: 5-baud initialization (ISO9141)**
```typescript
// Target address 0x33 is the standard OBD-II ISO9141 init address
const initMsg = createMsg(Protocol.ISO9141, [0x33]);
const response = await device.passThruIoctl(channelId, IoctlId.FIVE_BAUD_INIT, initMsg);
// response contains keyword bytes from the ECU
console.log("Keywords:", (response as PassThruMsg).data.subarray(0, 2));
```

**Example: Functional message lookup table (multi-ECU)**
```typescript
import { IoctlId, type SByteArray } from "@emdzej/j2534-types";

// Add multiple ECU response addresses to receive from all simultaneously
const addresses: SByteArray = {
  numOfBytes: 8,
  data: new Uint8Array([
    0x00, 0x00, 0x07, 0xE8,  // ECU 1 response (0x7E8)
    0x00, 0x00, 0x07, 0xE9,  // ECU 2 response (0x7E9)
  ]),
};
await device.passThruIoctl(channelId, IoctlId.ADD_TO_FUNCT_MSG_LOOKUP_TABLE, addresses);

// Now only messages from 0x7E8 and 0x7E9 will appear in the receive queue
```

---

## Configuration Parameters (GET_CONFIG / SET_CONFIG)

| Parameter | ID | Description |
|-----------|-----|-------------|
| `DATA_RATE` | 0x01 | Baud rate |
| `LOOPBACK` | 0x03 | Enable TX echo (0=off, 1=on) |
| `NODE_ADDRESS` | 0x04 | ECU node address |
| `NETWORK_LINE` | 0x05 | Network line selection |
| `P1_MIN` | 0x06 | Inter-byte min time (ISO9141) |
| `P1_MAX` | 0x07 | Inter-byte max time / message timeout |
| `P2_MIN` | 0x08 | Time between tester request and ECU response (min) |
| `P2_MAX` | 0x09 | Time between tester request and ECU response (max) |
| `P3_MIN` | 0x0A | Time between ECU response and next request (min) |
| `P3_MAX` | 0x0B | Time between ECU response and next request (max) |
| `P4_MIN` | 0x0C | Inter-byte time for tester request (min) |
| `P4_MAX` | 0x0D | Inter-byte time for tester request (max) |
| `W0`–`W5` | 0x19,0x0E–0x12 | ISO9141 initialization timing |
| `TIDLE` | 0x13 | Bus idle time before init |
| `TINIL` | 0x14 | Duration of init pattern |
| `TWUP` | 0x15 | Wake-up time |
| `PARITY` | 0x16 | 0=none, 1=odd, 2=even |
| `BIT_SAMPLE_POINT` | 0x17 | CAN bit sample point (%) |
| `SYNC_JUMP_WIDTH` | 0x18 | CAN synchronization jump width |
| `ISO15765_BS` | 0x1F | Block size for flow control |
| `ISO15765_STMIN` | 0x20 | Separation time minimum (ms) |
| `ISO15765_BS_TX` | 0x22 | Block size (TX direction) |
| `ISO15765_STMIN_TX` | 0x23 | STmin (TX direction) |
| `ISO15765_WFT_MAX` | 0x24 | Max wait frame transmissions |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0x00 | `STATUS_NOERROR` | Success |
| 0x01 | `ERR_NOT_SUPPORTED` | Feature not supported by hardware |
| 0x02 | `ERR_INVALID_CHANNEL_ID` | Invalid channel identifier |
| 0x03 | `ERR_INVALID_PROTOCOL_ID` | Protocol not supported |
| 0x04 | `ERR_NULL_PARAMETER` | Required parameter is null |
| 0x05 | `ERR_INVALID_IOCTL_VALUE` | Invalid IOCTL parameter value |
| 0x06 | `ERR_INVALID_FLAGS` | Invalid flags combination |
| 0x07 | `ERR_FAILED` | General failure |
| 0x08 | `ERR_DEVICE_NOT_CONNECTED` | Device not open or disconnected |
| 0x09 | `ERR_TIMEOUT` | Operation timed out |
| 0x0A | `ERR_INVALID_MSG` | Invalid message structure |
| 0x0B | `ERR_INVALID_TIME_INTERVAL` | Invalid time interval |
| 0x0C | `ERR_EXCEEDED_LIMIT` | Resource limit exceeded |
| 0x0D | `ERR_INVALID_MSG_ID` | Invalid message/filter ID |
| 0x0E | `ERR_DEVICE_IN_USE` | Device already in use |
| 0x0F | `ERR_INVALID_IOCTL_ID` | Unknown IOCTL ID |
| 0x10 | `ERR_BUFFER_EMPTY` | No messages in receive buffer |
| 0x11 | `ERR_BUFFER_FULL` | Transmit buffer full |
| 0x12 | `ERR_BUFFER_OVERFLOW` | Receive buffer overflow |
| 0x13 | `ERR_PIN_INVALID` | Invalid pin number |
| 0x14 | `ERR_CHANNEL_IN_USE` | Channel already connected |
| 0x15 | `ERR_MSG_PROTOCOL_ID` | Message protocol doesn't match channel |
| 0x16 | `ERR_INVALID_FILTER_ID` | Invalid filter identifier |
| 0x17 | `ERR_NO_FLOW_CONTROL` | ISO15765 requires flow control filter |
| 0x18 | `ERR_NOT_UNIQUE` | Filter already exists |
| 0x19 | `ERR_INVALID_BAUDRATE` | Unsupported baud rate |
| 0x1A | `ERR_INVALID_DEVICE_ID` | Invalid device identifier |

---

## Transport Layer

The driver uses a pluggable `Transport` interface, allowing any USB implementation:

```typescript
interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<number>;
  read(timeout?: number): Promise<Uint8Array>;
  readonly isConnected: boolean;
}
```

### Node.js (`@emdzej/j2534-usb`)

Uses the `usb` npm package (libusb bindings). Works on Linux, macOS, Windows.

```typescript
import { NodeUsbTransport } from "@emdzej/j2534-usb";
const transport = new NodeUsbTransport();
```

### Browser (`@emdzej/j2534-webusb`)

Uses the WebUSB API. Works in Chrome and Edge (requires HTTPS or localhost).

```typescript
import { WebUsbTransport } from "@emdzej/j2534-webusb";
const transport = new WebUsbTransport();
// Note: open() must be called from a user gesture (click handler)
```

### Custom Transport

Implement the `Transport` interface for other backends (serial, TCP bridge, mock for testing):

```typescript
import type { Transport } from "@emdzej/j2534-types";

class MockTransport implements Transport {
  isConnected = false;
  async open() { this.isConnected = true; }
  async close() { this.isConnected = false; }
  async write(data: Uint8Array) { return data.length; }
  async read(timeout?: number) { return new Uint8Array([...]); }
}
```

---

## Tactrix OpenPort 2.0 Protocol

The TypeScript driver communicates with the hardware using an AT-command text protocol over USB bulk endpoints:

| Command | Description | Response |
|---------|-------------|----------|
| `ati` | Identify device | `ari <firmware_version>` |
| `ata` | Attach/open device | `aro` (ACK) |
| `atz` | Reset/close device | — |
| `ato<ch> <flags> <baud> 0` | Open channel | ACK |
| `atc<ch>` | Close channel | — |
| `att<ch> <size> <txflags>\r<data>` | Transmit message | TX confirmation |
| `atf<ch> <type> <txflags> <size>\r<mask><pattern>[<flow>]` | Set filter | `arf <id>` |
| `atk<ch> <id>` | Stop filter | — |
| `atg<ch> <param>` | Get config | `arg <param> <value>` |
| `ats<ch> <param> <value>` | Set config | — |
| `atr <pin>` | Read voltage | `arr <millivolts>` |
| `atv <pin> <millivolts>` | Set programming voltage | ACK |
| `aty<ch> <size> 0\r<data>` | Fast init (ISO14230) | `ary<ch>\r<response>` |
| `aty<ch> 1 1\r<addr>` | 5-baud init (ISO9141) | `ary<ch>\r<keywords>` |

---

## SAE J2534 Spec Compliance

### Implemented (J2534-1)

- [x] PassThruOpen / PassThruClose
- [x] PassThruConnect / PassThruDisconnect
- [x] PassThruReadMsgs / PassThruWriteMsgs
- [x] PassThruStartMsgFilter / PassThruStopMsgFilter
- [x] PassThruStartPeriodicMsg / PassThruStopPeriodicMsg (software timer)
- [x] PassThruSetProgrammingVoltage
- [x] PassThruReadVersion
- [x] PassThruGetLastError
- [x] PassThruIoctl: GET_CONFIG, SET_CONFIG, READ_VBATT, FAST_INIT, FIVE_BAUD_INIT, CLEAR_TX/RX_BUFFER, CLEAR_PERIODIC_MSGS, CLEAR_MSG_FILTERS, READ_PROG_VOLTAGE
- [x] PassThruIoctl: ADD/DELETE/CLEAR_FUNCT_MSG_LOOKUP_TABLE (software filter)
- [x] Protocols: CAN, ISO15765, ISO9141, ISO14230, J1850VPW, J1850PWM
- [x] Multi-channel support (CAN + K-line + L-line + AUX simultaneously)
- [x] ISO15765 extended addressing

### Implemented (J2534-2 Extensions)

- [x] Extended Protocol/Channel IDs (CAN_CH1, ISO9141_K/L/INNO, ISO14230_K/L)
- [x] Multi-bus simultaneous operation
- [x] Functional message lookup table for multi-ECU addressing
- [x] Pin voltage control on multiple OBD-II pins
- [x] SNIFF_MODE for passive bus monitoring

### Not Supported (True Hardware Limitations)

- [ ] Protocols: SCI_A_ENGINE, SCI_A_TRANS, SCI_B_ENGINE, SCI_B_TRANS (no SCI transceiver)
- [ ] SW_CAN / Single-Wire CAN (no SW_CAN transceiver)
- [ ] DT_CAN_MIXED mode

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @emdzej/j2534-driver build

# Run an example
pnpm --filter @emdzej/j2534-example-canlogger start
```

## License

See [LICENSE](../LICENSE) in the repository root.
