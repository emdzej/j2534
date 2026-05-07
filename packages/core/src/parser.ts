import { type PassThruMsg, Protocol, RxStatus } from "@emdzej/j2534-types";

/** Response packet types from the Openport device */
export enum PacketType {
  TX_DONE = 0x10,
  TX_LB_MSG = 0x20,
  RX_MSG_END_IND = 0x40,
  EXT_ADDR_MSG_END_IND = 0x44,
  LB_MSG_END_IND = 0x60,
  NORM_MSG_START_IND = 0x80,
  TX_LB_START_IND = 0xa0,
}

/** Parsed device response */
export type DeviceResponse =
  | { type: "ack" }
  | { type: "version"; firmware: string }
  | { type: "message"; msg: PassThruMsg }
  | { type: "filter_id"; id: number }
  | { type: "config"; paramId: number; value: number }
  | { type: "voltage"; millivolts: number }
  | { type: "fast_init"; data: Uint8Array }
  | { type: "error"; code: number }
  | { type: "unknown"; raw: Uint8Array };

/**
 * Parse a raw USB response buffer from the Openport device.
 * Device responses start with 0x61 0x72 ("ar") for data,
 * or the ACK pattern for command acknowledgments.
 */
export function parseResponse(
  buf: Uint8Array,
  protocol: Protocol
): DeviceResponse {
  if (buf.length < 2) {
    return { type: "unknown", raw: buf };
  }

  const decoder = new TextDecoder();

  // Check for text-based responses (ari, aro, arg, arr, arf, ary)
  const text = decoder.decode(buf).trim();

  if (text.startsWith("ari")) {
    return { type: "version", firmware: text.slice(4).trim() };
  }

  if (text.startsWith("aro")) {
    return { type: "ack" };
  }

  if (text.startsWith("arf")) {
    const id = parseInt(text.slice(4).trim(), 10);
    return { type: "filter_id", id };
  }

  if (text.startsWith("arg")) {
    const parts = text.slice(4).trim().split(/\s+/);
    return {
      type: "config",
      paramId: parseInt(parts[0], 10),
      value: parseInt(parts[1], 10),
    };
  }

  if (text.startsWith("arr")) {
    const mv = parseInt(text.slice(4).trim(), 10);
    return { type: "voltage", millivolts: mv };
  }

  if (text.startsWith("ary")) {
    // Fast init response: ary<channelByte> <dataLen>\r<data>
    // Find the data after the header
    const crIdx = buf.indexOf(0x0d);
    if (crIdx >= 0 && crIdx < buf.length - 1) {
      const data = buf.slice(crIdx + 1);
      return { type: "fast_init", data };
    }
    return { type: "fast_init", data: new Uint8Array(0) };
  }

  // Binary message frame: starts with 0x61 0x72 ("ar") + channel byte
  if (buf[0] === 0x61 && buf[1] === 0x72 && buf.length > 4) {
    return parseMessageFrame(buf, protocol);
  }

  return { type: "unknown", raw: buf };
}

function parseMessageFrame(
  buf: Uint8Array,
  protocol: Protocol
): DeviceResponse {
  // buf[2] = channel byte, buf[3] = length, buf[4] = packet type
  const packetType = buf[4] as PacketType;
  const dataStart = 5;

  let rxStatus = 0;
  if (
    packetType === PacketType.TX_DONE ||
    packetType === PacketType.TX_LB_MSG ||
    packetType === PacketType.TX_LB_START_IND
  ) {
    rxStatus |= RxStatus.TX_MSG_TYPE;
  }
  if (
    packetType === PacketType.NORM_MSG_START_IND ||
    packetType === PacketType.TX_LB_START_IND
  ) {
    rxStatus |= RxStatus.START_OF_MESSAGE;
  }
  if (packetType === PacketType.EXT_ADDR_MSG_END_IND) {
    rxStatus |= RxStatus.ISO15765_EXT_ADDR;
  }

  // Extract timestamp (4 bytes after packet type in some frames)
  let timestamp = 0;
  let msgDataStart = dataStart;
  if (buf.length > dataStart + 4) {
    timestamp =
      (buf[dataStart] << 24) |
      (buf[dataStart + 1] << 16) |
      (buf[dataStart + 2] << 8) |
      buf[dataStart + 3];
    msgDataStart = dataStart + 4;
  }

  const data = buf.slice(msgDataStart);

  const msg: PassThruMsg = {
    protocolId: protocol,
    rxStatus,
    txFlags: 0,
    timestamp,
    dataSize: data.length,
    extraDataIndex: data.length,
    data,
  };

  return { type: "message", msg };
}
