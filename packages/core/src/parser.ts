import { type PassThruMsg, Protocol, RxStatus } from "@emdzej/j2534-types";

/** Response packet types from the Openport device */
export enum PacketType {
  NORM_MSG = 0x00,
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
 * Check if the protocol uses K-line (ISO9141 or ISO14230).
 * K-line messages have different framing than CAN.
 */
function isKLine(protocol: Protocol): boolean {
  return protocol === Protocol.ISO9141 || protocol === Protocol.ISO14230;
}

/**
 * Check if the protocol uses CAN bus.
 */
function isCan(protocol: Protocol): boolean {
  return protocol === Protocol.CAN || protocol === Protocol.ISO15765;
}

/**
 * Parse a 4-byte big-endian timestamp from the buffer at the given offset.
 */
function parseTimestamp(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

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

  // Check for text-based responses (ari, aro, arg, arr, arf, ary, are)
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
    // Response format: "arr <pin> <millivolts>"
    const parts = text.slice(4).trim().split(/\s+/);
    if (parts.length >= 2) {
      const mv = parseInt(parts[1], 10);
      return { type: "voltage", millivolts: mv };
    }
    // Fallback: single value (just millivolts)
    const mv = parseInt(parts[0], 10);
    return { type: "voltage", millivolts: mv };
  }

  if (text.startsWith("ary")) {
    // Fast init response: ary<channelByte> <dataLen>\r<data>
    const crIdx = buf.indexOf(0x0d);
    if (crIdx >= 0 && crIdx < buf.length - 1) {
      const data = buf.slice(crIdx + 1);
      return { type: "fast_init", data };
    }
    return { type: "fast_init", data: new Uint8Array(0) };
  }

  // Error response: "are <code>"
  if (text.startsWith("are")) {
    const code = parseInt(text.slice(4).trim(), 10);
    return { type: "error", code };
  }

  // Binary message frame: starts with 0x61 0x72 ("ar") + channel byte
  if (buf[0] === 0x61 && buf[1] === 0x72 && buf.length > 4) {
    return parseMessageFrame(buf, protocol);
  }

  return { type: "unknown", raw: buf };
}

/**
 * Parse all binary message packets from a buffer.
 * The Openport device can send multiple packets in a single USB transfer.
 * Returns all parsed messages.
 *
 * Binary frame format:
 *   [0] 0x61 'a'
 *   [1] 0x72 'r'
 *   [2] channel byte (e.g. 0x33=ISO9141, 0x35=CAN) or 0x6F 'o' for ack
 *   [3] packet length (bytes after header, so total = length + 4)
 *   [4] packet type
 *   [5...] payload (timestamp and/or data, depends on packet type and protocol)
 *
 * For K-line (ISO9141/ISO14230):
 *   - NORM_MSG (0x00) / TX_LB_MSG (0x20): payload is raw data, NO timestamp
 *   - NORM_MSG_START_IND (0x80) / TX_LB_START_IND (0xA0): payload is 4-byte timestamp, no data
 *   - RX_MSG_END_IND (0x40) / LB_MSG_END_IND (0x60): payload is 4-byte timestamp, no data
 *   - TX_DONE (0x10): payload is 4-byte timestamp
 *
 * For CAN/ISO15765:
 *   - All data packets include 4-byte timestamp at start of payload, then data
 */
export function parseAllPackets(
  buf: Uint8Array,
  protocol: Protocol
): DeviceResponse[] {
  const results: DeviceResponse[] = [];
  let offset = 0;

  while (offset < buf.length) {
    // Check for text-based response mixed in
    if (buf[offset] !== 0x61 || offset + 1 >= buf.length || buf[offset + 1] !== 0x72) {
      // Not a binary frame — try parsing remainder as text
      const remainder = buf.slice(offset);
      const resp = parseResponse(remainder, protocol);
      if (resp.type !== "unknown") {
        results.push(resp);
      }
      break;
    }

    // Need at least 4 bytes for header
    if (offset + 4 > buf.length) break;

    // Check for "aro" ack (ar + 'o')
    if (buf[offset + 2] === 0x6f) {
      results.push({ type: "ack" });
      // Find end of text response (next \n or end)
      let end = offset + 3;
      while (end < buf.length && buf[end] !== 0x0a) end++;
      offset = end + 1;
      continue;
    }

    const packetLen = buf[offset + 3]; // bytes after the 4-byte header
    const totalLen = packetLen + 4;

    if (offset + totalLen > buf.length) {
      // Incomplete packet — return what we have
      break;
    }

    const packet = buf.slice(offset, offset + totalLen);
    const resp = parseMessageFrame(packet, protocol);
    results.push(resp);
    offset += totalLen;
  }

  return results;
}

function parseMessageFrame(
  buf: Uint8Array,
  protocol: Protocol
): DeviceResponse {
  // buf[2] = channel byte, buf[3] = packet length, buf[4] = packet type
  const packetType = buf[4] as PacketType;
  const packetLen = buf[3];
  const payloadStart = 5;
  const kLine = isKLine(protocol);
  const can = isCan(protocol);

  let rxStatus = 0;
  let timestamp = 0;
  let data = new Uint8Array(0);

  switch (packetType) {
    case PacketType.TX_DONE:
      // Timestamp at payload start
      rxStatus = RxStatus.TX_MSG_TYPE;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      if (can && packetLen > 5) {
        // CAN: data after timestamp
        data = buf.slice(payloadStart + 4);
      }
      break;

    case PacketType.NORM_MSG_START_IND:
      // Start of a normal RX message
      rxStatus = RxStatus.START_OF_MESSAGE;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      if (can && packetLen > 5) {
        data = buf.slice(payloadStart + 4);
      }
      // K-line: no data, just indication
      break;

    case PacketType.TX_LB_START_IND:
      // Start of a TX loopback message
      rxStatus = RxStatus.TX_MSG_TYPE | RxStatus.START_OF_MESSAGE;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      if (can && packetLen > 5) {
        data = buf.slice(payloadStart + 4);
      }
      // K-line: no data, just indication
      break;

    case PacketType.NORM_MSG:
      // Normal data packet
      rxStatus = 0;
      if (kLine) {
        // K-line: raw data, NO timestamp
        data = buf.slice(payloadStart, payloadStart + packetLen - 1);
      } else if (can) {
        // CAN: 4-byte timestamp then data
        if (packetLen >= 5) {
          timestamp = parseTimestamp(buf, payloadStart);
        }
        data = buf.slice(payloadStart + 4);
      }
      break;

    case PacketType.TX_LB_MSG:
      // TX loopback data
      rxStatus = RxStatus.TX_MSG_TYPE;
      if (kLine) {
        // K-line: raw data, NO timestamp
        data = buf.slice(payloadStart, payloadStart + packetLen - 1);
      } else if (can) {
        if (packetLen >= 5) {
          timestamp = parseTimestamp(buf, payloadStart);
        }
        data = buf.slice(payloadStart + 4);
      }
      break;

    case PacketType.RX_MSG_END_IND:
      // End of normal RX message — timestamp only for K-line
      rxStatus = 0;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      if (can && packetLen > 5) {
        data = buf.slice(payloadStart + 4);
      }
      break;

    case PacketType.EXT_ADDR_MSG_END_IND:
      rxStatus = RxStatus.ISO15765_EXT_ADDR;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      if (can && packetLen > 5) {
        data = buf.slice(payloadStart + 4);
      }
      break;

    case PacketType.LB_MSG_END_IND:
      // End of TX loopback message — timestamp only for K-line
      rxStatus = RxStatus.TX_MSG_TYPE;
      if (packetLen >= 5) {
        timestamp = parseTimestamp(buf, payloadStart);
      }
      break;

    default:
      // Unknown packet type — return raw
      return { type: "unknown", raw: buf };
  }

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
