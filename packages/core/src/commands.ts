import { type PassThruMsg, Protocol } from "@emdzej/j2534-types";

/**
 * Maps Protocol enum to the channel byte used in AT commands to the Openport device.
 */
export function protocolToChannelByte(protocol: Protocol | number): number {
  switch (protocol) {
    case Protocol.J1850VPW:
      return 0x31;
    case Protocol.J1850PWM:
      return 0x32;
    case Protocol.ISO9141:
      return 0x33;
    case Protocol.ISO14230:
      return 0x34;
    case Protocol.CAN:
      return 0x35;
    case Protocol.ISO15765:
      return 0x36;
    // Tactrix J2534-2 extended channel IDs
    case 0x00009080: // J1850VPW_CH1
      return 0x31;
    case 0x00009160: // J1850PWM_CH1
      return 0x32;
    case 0x00009200: // ISO9141_K
      return 0x33;
    case 0x00009201: // ISO9141_L
      return 0x43; // L-line channel byte
    case 0x00009202: // ISO9141_INNO (AUX)
      return 0x53; // AUX channel byte
    case 0x00009280: // ISO14230_K
      return 0x34;
    case 0x00009281: // ISO14230_L
      return 0x44; // L-line KWP channel byte
    default:
      throw new Error(`Unsupported protocol: 0x${protocol.toString(16)}`);
  }
}

/**
 * Encode an AT command string + optional binary payload into a Uint8Array for USB transmission.
 */
export function encodeCommand(
  command: string,
  payload?: Uint8Array
): Uint8Array {
  const cmdBytes = new TextEncoder().encode(command);
  if (!payload || payload.length === 0) {
    // Command + \r terminator
    const buf = new Uint8Array(cmdBytes.length + 1);
    buf.set(cmdBytes);
    buf[cmdBytes.length] = 0x0d; // \r
    return buf;
  }
  // Command + space + payload (no terminator needed for binary payloads)
  const buf = new Uint8Array(cmdBytes.length + payload.length);
  buf.set(cmdBytes);
  buf.set(payload, cmdBytes.length);
  return buf;
}

/**
 * Build the "ato" (open channel) command.
 * Format: ato<channelByte> <flags(4bytes)> <baud(4bytes)> 0\r
 */
export function buildOpenChannelCmd(
  protocol: Protocol,
  flags: number,
  baudRate: number
): Uint8Array {
  const channelByte = protocolToChannelByte(protocol);
  const cmd = `ato${String.fromCharCode(channelByte)} ${flags} ${baudRate} 0`;
  return encodeCommand(cmd);
}

/**
 * Build the "atc" (close channel) command.
 */
export function buildCloseChannelCmd(channelByte: number): Uint8Array {
  return encodeCommand(`atc${String.fromCharCode(channelByte)}`);
}

/**
 * Build the "att" (transmit) command with message payload.
 * Format: att<channelByte> <dataSize> <txFlags>\r <data bytes>
 */
export function buildTransmitCmd(
  channelByte: number,
  msg: PassThruMsg
): Uint8Array {
  const header = `att${String.fromCharCode(channelByte)} ${msg.dataSize} ${msg.txFlags}\r`;
  const headerBytes = new TextEncoder().encode(header);
  const buf = new Uint8Array(headerBytes.length + msg.dataSize);
  buf.set(headerBytes);
  buf.set(msg.data.subarray(0, msg.dataSize), headerBytes.length);
  return buf;
}

/**
 * Build the "atf" (set filter) command.
 * Format: atf<channelByte> <filterType> <txFlags> <dataSize>\r <mask><pattern>[<flowControl>]
 */
export function buildFilterCmd(
  channelByte: number,
  filterType: number,
  txFlags: number,
  mask: Uint8Array,
  pattern: Uint8Array,
  flowControl?: Uint8Array
): Uint8Array {
  const dataSize = mask.length;
  const header = `atf${String.fromCharCode(channelByte)} ${filterType} ${txFlags} ${dataSize}\r`;
  const headerBytes = new TextEncoder().encode(header);
  const payloadSize =
    dataSize * 2 + (flowControl ? flowControl.length : 0);
  const buf = new Uint8Array(headerBytes.length + payloadSize);
  buf.set(headerBytes);
  let offset = headerBytes.length;
  buf.set(mask.subarray(0, dataSize), offset);
  offset += dataSize;
  buf.set(pattern.subarray(0, dataSize), offset);
  offset += dataSize;
  if (flowControl) {
    buf.set(flowControl.subarray(0, dataSize), offset);
  }
  return buf;
}

/**
 * Build the "atk" (stop filter) command.
 */
export function buildStopFilterCmd(
  channelByte: number,
  filterId: number
): Uint8Array {
  return encodeCommand(`atk${String.fromCharCode(channelByte)} ${filterId}`);
}

/**
 * Build "atg" (get config) command.
 */
export function buildGetConfigCmd(
  channelByte: number,
  paramId: number
): Uint8Array {
  return encodeCommand(`atg${String.fromCharCode(channelByte)} ${paramId}`);
}

/**
 * Build "ats" (set config) command.
 */
export function buildSetConfigCmd(
  channelByte: number,
  paramId: number,
  value: number
): Uint8Array {
  return encodeCommand(
    `ats${String.fromCharCode(channelByte)} ${paramId} ${value}`
  );
}

/**
 * Build "atr" (read pin voltage) command.
 */
export function buildReadVoltageCmd(pin: number): Uint8Array {
  return encodeCommand(`atr ${pin}`);
}

/**
 * Build "aty" (fast init) command.
 */
export function buildFastInitCmd(
  channelByte: number,
  data: Uint8Array
): Uint8Array {
  const header = `aty${String.fromCharCode(channelByte)} ${data.length} 0\r`;
  const headerBytes = new TextEncoder().encode(header);
  const buf = new Uint8Array(headerBytes.length + data.length);
  buf.set(headerBytes);
  buf.set(data, headerBytes.length);
  return buf;
}

/**
 * Build "atv" (set programming voltage) command.
 * Format: atv <pin> <millivolts>\r
 */
export function buildSetVoltageCmd(
  pin: number,
  millivolts: number
): Uint8Array {
  return encodeCommand(`atv ${pin} ${millivolts}`);
}

/**
 * Build five-baud init command.
 * The OpenPort 2.0 firmware handles 5-baud init via the aty command
 * with special timing parameters set beforehand (W0-W5).
 * Format: aty<channelByte> <addrLen> 1\r <address byte>
 * The '1' flag distinguishes 5-baud from fast init ('0').
 */
export function buildFiveBaudInitCmd(
  channelByte: number,
  targetAddress: number
): Uint8Array {
  const header = `aty${String.fromCharCode(channelByte)} 1 1\r`;
  const headerBytes = new TextEncoder().encode(header);
  const buf = new Uint8Array(headerBytes.length + 1);
  buf.set(headerBytes);
  buf[headerBytes.length] = targetAddress & 0xff;
  return buf;
}
