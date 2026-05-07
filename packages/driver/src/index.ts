import {
  type Transport,
  type PassThruMsg,
  type SConfig,
  type SByteArray,
  type VersionInfo,
  type PeriodicMsgState,
  type FunctionalAddress,
  Protocol,
  ProtocolExt,
  FilterType,
  IoctlId,
  ConnectFlag,
  J2534Error,
  Pin,
  VOLTAGE_OFF,
  SHORT_TO_GROUND,
} from "@emdzej/j2534-types";
import {
  protocolToChannelByte,
  encodeCommand,
  buildOpenChannelCmd,
  buildCloseChannelCmd,
  buildTransmitCmd,
  buildFilterCmd,
  buildStopFilterCmd,
  buildGetConfigCmd,
  buildSetConfigCmd,
  buildReadVoltageCmd,
  buildFastInitCmd,
  buildSetVoltageCmd,
  buildFiveBaudInitCmd,
  MessageQueue,
  parseResponse,
  type DeviceResponse,
} from "@emdzej/j2534-core";

// ─── Constants ──────────────────────────────────────────────────────

const MAX_PERIODIC_MSGS = 10;
const MAX_FILTERS_PER_CHANNEL = 10;

// ─── Types ──────────────────────────────────────────────────────────

export interface ChannelState {
  id: number;
  channelByte: number;
  protocol: Protocol | number;
  flags: number;
  baudRate: number;
  filters: Map<number, FilterState>;
  rxQueue: MessageQueue;
  functionalAddresses: FunctionalAddress[];
}

export interface FilterState {
  type: FilterType;
  mask: Uint8Array;
  pattern: Uint8Array;
  flowControl?: Uint8Array;
}

export interface J2534Options {
  /** USB transport implementation (Node or WebUSB) */
  transport: Transport;
  /** Read polling interval in ms (default 10) */
  pollInterval?: number;
}

// ─── Driver ─────────────────────────────────────────────────────────

/**
 * J2534 PassThru driver implementation.
 *
 * Supports J2534-1 and J2534-2 features available on the Tactrix OpenPort 2.0:
 * - All standard protocols (CAN, ISO15765, ISO9141, ISO14230, J1850VPW, J1850PWM)
 * - Multi-channel support (CAN + K-line + L-line + AUX simultaneously)
 * - Periodic messages (software timer implementation)
 * - Programming voltage control
 * - 5-baud and fast initialization
 * - Functional message lookup table (software filter)
 * - ISO15765 extended addressing
 */
export class J2534Device {
  private transport: Transport;
  private deviceId: number | null = null;
  private channels: Map<number, ChannelState> = new Map();
  private periodicMsgs: Map<number, PeriodicMsgState> = new Map();
  private nextChannelId = 1;
  private nextFilterId = 1;
  private nextPeriodicId = 1;
  private lastError = "";
  private firmwareVersion = "";
  private pollInterval: number;

  constructor(options: J2534Options) {
    this.transport = options.transport;
    this.pollInterval = options.pollInterval ?? 10;
  }

  // ─── PassThruOpen ───────────────────────────────────────────────

  async passThruOpen(): Promise<number> {
    await this.transport.open();

    // Send identification command
    await this.transport.write(encodeCommand("ati"));
    const resp = await this.readResponse();
    if (resp.type === "version") {
      this.firmwareVersion = resp.firmware;
    }

    // Attach
    await this.transport.write(encodeCommand("ata"));
    const ack = await this.readResponse();
    if (ack.type !== "ack") {
      throw this.setError(J2534Error.ERR_FAILED, "Device did not acknowledge open");
    }

    this.deviceId = 1;
    return this.deviceId;
  }

  // ─── PassThruClose ──────────────────────────────────────────────

  async passThruClose(): Promise<void> {
    this.assertOpen();

    // Stop all periodic messages
    for (const [id] of this.periodicMsgs) {
      this.stopPeriodicTimer(id);
    }
    this.periodicMsgs.clear();

    await this.transport.write(encodeCommand("atz"));
    await this.transport.close();
    this.deviceId = null;
    this.channels.clear();
  }

  // ─── PassThruConnect ────────────────────────────────────────────

  async passThruConnect(
    protocol: Protocol | number,
    flags: number,
    baudRate: number
  ): Promise<number> {
    this.assertOpen();
    this.validateProtocol(protocol);

    const channelByte = protocolToChannelByte(protocol);

    // Check if this channel byte is already in use
    for (const [, ch] of this.channels) {
      if (ch.channelByte === channelByte) {
        throw this.setError(J2534Error.ERR_CHANNEL_IN_USE, `Channel 0x${channelByte.toString(16)} already connected`);
      }
    }

    const cmd = buildOpenChannelCmd(protocol as Protocol, flags, baudRate);
    await this.transport.write(cmd);
    const resp = await this.readResponse();
    if (resp.type !== "ack") {
      throw this.setError(J2534Error.ERR_FAILED, "Connect failed");
    }

    const channelId = this.nextChannelId++;
    this.channels.set(channelId, {
      id: channelId,
      channelByte,
      protocol,
      flags,
      baudRate,
      filters: new Map(),
      rxQueue: new MessageQueue(),
      functionalAddresses: [],
    });

    return channelId;
  }

  // ─── PassThruDisconnect ─────────────────────────────────────────

  async passThruDisconnect(channelId: number): Promise<void> {
    const ch = this.getChannel(channelId);

    // Stop any periodic messages on this channel
    for (const [id, pm] of this.periodicMsgs) {
      if (pm.channelId === channelId) {
        this.stopPeriodicTimer(id);
        this.periodicMsgs.delete(id);
      }
    }

    await this.transport.write(buildCloseChannelCmd(ch.channelByte));
    ch.rxQueue.clear();
    this.channels.delete(channelId);
  }

  // ─── PassThruReadMsgs ───────────────────────────────────────────

  async passThruReadMsgs(
    channelId: number,
    numMsgs: number,
    timeout: number
  ): Promise<PassThruMsg[]> {
    const ch = this.getChannel(channelId);

    const deadline = Date.now() + timeout;
    while (ch.rxQueue.length < numMsgs && Date.now() < deadline) {
      await this.pollOnce(ch);
      if (ch.rxQueue.length < numMsgs) {
        await sleep(Math.min(this.pollInterval, deadline - Date.now()));
      }
    }

    if (ch.rxQueue.isEmpty) {
      throw this.setError(J2534Error.ERR_BUFFER_EMPTY, "No messages available");
    }

    return ch.rxQueue.drain(numMsgs);
  }

  // ─── PassThruWriteMsgs ──────────────────────────────────────────

  async passThruWriteMsgs(
    channelId: number,
    msgs: PassThruMsg[],
    timeout: number
  ): Promise<number> {
    const ch = this.getChannel(channelId);
    let written = 0;

    for (const msg of msgs) {
      const cmd = buildTransmitCmd(ch.channelByte, msg);
      await this.transport.write(cmd);
      written++;
    }

    return written;
  }

  // ─── PassThruStartPeriodicMsg ───────────────────────────────────

  async passThruStartPeriodicMsg(
    channelId: number,
    msg: PassThruMsg,
    intervalMs: number
  ): Promise<number> {
    this.assertOpen();
    const ch = this.getChannel(channelId);

    if (this.periodicMsgs.size >= MAX_PERIODIC_MSGS) {
      throw this.setError(J2534Error.ERR_EXCEEDED_LIMIT, `Max ${MAX_PERIODIC_MSGS} periodic messages`);
    }

    if (intervalMs < 5 || intervalMs > 65535) {
      throw this.setError(J2534Error.ERR_INVALID_TIME_INTERVAL, "Interval must be 5–65535 ms");
    }

    const id = this.nextPeriodicId++;
    const state: PeriodicMsgState = {
      id,
      channelId,
      msg: { ...msg, data: new Uint8Array(msg.data) },
      intervalMs,
      timer: null,
    };

    // Start the software timer
    state.timer = setInterval(async () => {
      try {
        const cmd = buildTransmitCmd(ch.channelByte, state.msg);
        await this.transport.write(cmd);
      } catch {
        // If write fails, stop the timer
        this.stopPeriodicTimer(id);
      }
    }, intervalMs);

    this.periodicMsgs.set(id, state);
    return id;
  }

  // ─── PassThruStopPeriodicMsg ────────────────────────────────────

  async passThruStopPeriodicMsg(
    channelId: number,
    msgId: number
  ): Promise<void> {
    const pm = this.periodicMsgs.get(msgId);
    if (!pm) {
      throw this.setError(J2534Error.ERR_INVALID_MSG_ID, `Invalid periodic msg ID: ${msgId}`);
    }
    if (pm.channelId !== channelId) {
      throw this.setError(J2534Error.ERR_INVALID_MSG_ID, "Periodic msg not on this channel");
    }

    this.stopPeriodicTimer(msgId);
    this.periodicMsgs.delete(msgId);
  }

  // ─── PassThruStartMsgFilter ─────────────────────────────────────

  async passThruStartMsgFilter(
    channelId: number,
    filterType: FilterType,
    maskMsg: PassThruMsg,
    patternMsg: PassThruMsg,
    flowControlMsg?: PassThruMsg
  ): Promise<number> {
    const ch = this.getChannel(channelId);

    if (ch.filters.size >= MAX_FILTERS_PER_CHANNEL) {
      throw this.setError(J2534Error.ERR_EXCEEDED_LIMIT, `Max ${MAX_FILTERS_PER_CHANNEL} filters per channel`);
    }

    // ISO15765 requires flow control filter before any other
    if (
      (ch.protocol === Protocol.ISO15765 || ch.protocol === 0x00009040) &&
      filterType !== FilterType.FLOW_CONTROL_FILTER &&
      ![...ch.filters.values()].some((f) => f.type === FilterType.FLOW_CONTROL_FILTER)
    ) {
      throw this.setError(J2534Error.ERR_NO_FLOW_CONTROL, "ISO15765 requires a flow control filter first");
    }

    const mask = maskMsg.data.subarray(0, maskMsg.dataSize);
    const pattern = patternMsg.data.subarray(0, patternMsg.dataSize);
    const flow = flowControlMsg
      ? flowControlMsg.data.subarray(0, flowControlMsg.dataSize)
      : undefined;

    const cmd = buildFilterCmd(
      ch.channelByte,
      filterType,
      maskMsg.txFlags,
      mask,
      pattern,
      flow
    );

    await this.transport.write(cmd);
    const resp = await this.readResponse();

    let filterId: number;
    if (resp.type === "filter_id") {
      filterId = resp.id;
    } else {
      filterId = this.nextFilterId++;
    }

    ch.filters.set(filterId, {
      type: filterType,
      mask: new Uint8Array(mask),
      pattern: new Uint8Array(pattern),
      flowControl: flow ? new Uint8Array(flow) : undefined,
    });

    return filterId;
  }

  // ─── PassThruStopMsgFilter ──────────────────────────────────────

  async passThruStopMsgFilter(
    channelId: number,
    filterId: number
  ): Promise<void> {
    const ch = this.getChannel(channelId);
    if (!ch.filters.has(filterId)) {
      throw this.setError(J2534Error.ERR_INVALID_FILTER_ID, `Invalid filter ID: ${filterId}`);
    }
    await this.transport.write(buildStopFilterCmd(ch.channelByte, filterId));
    ch.filters.delete(filterId);
  }

  // ─── PassThruSetProgrammingVoltage ──────────────────────────────

  async passThruSetProgrammingVoltage(
    pin: number,
    voltage: number
  ): Promise<void> {
    this.assertOpen();

    // Validate pin
    const validPins = [0, 1, 2, 3, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16];
    if (!validPins.includes(pin)) {
      throw this.setError(J2534Error.ERR_PIN_INVALID, `Invalid pin: ${pin}`);
    }

    let millivolts: number;
    if (voltage === VOLTAGE_OFF) {
      millivolts = 0; // Turn off voltage
    } else if (voltage === SHORT_TO_GROUND) {
      millivolts = -1; // Signal ground to firmware
    } else {
      millivolts = voltage; // Already in millivolts per J2534 spec
    }

    await this.transport.write(buildSetVoltageCmd(pin, millivolts));
    const resp = await this.readResponse();
    if (resp.type === "error") {
      throw this.setError(J2534Error.ERR_FAILED, "Failed to set programming voltage");
    }
  }

  // ─── PassThruReadVersion ────────────────────────────────────────

  async passThruReadVersion(): Promise<VersionInfo> {
    this.assertOpen();
    return {
      firmwareVersion: this.firmwareVersion,
      dllVersion: "3.0.0",
      apiVersion: "04.04",
    };
  }

  // ─── PassThruGetLastError ───────────────────────────────────────

  passThruGetLastError(): string {
    return this.lastError;
  }

  // ─── PassThruIoctl ──────────────────────────────────────────────

  async passThruIoctl(
    channelId: number,
    ioctlId: IoctlId,
    input?: SConfig[] | PassThruMsg | SByteArray
  ): Promise<SConfig[] | number | PassThruMsg | void> {
    switch (ioctlId) {
      case IoctlId.GET_CONFIG: {
        const ch = this.getChannel(channelId);
        const configs = input as SConfig[];
        const results: SConfig[] = [];
        for (const cfg of configs) {
          await this.transport.write(
            buildGetConfigCmd(ch.channelByte, cfg.parameter)
          );
          const resp = await this.readResponse();
          if (resp.type === "config") {
            results.push({ parameter: cfg.parameter, value: resp.value });
          }
        }
        return results;
      }

      case IoctlId.SET_CONFIG: {
        const ch = this.getChannel(channelId);
        const configs = input as SConfig[];
        for (const cfg of configs) {
          await this.transport.write(
            buildSetConfigCmd(ch.channelByte, cfg.parameter, cfg.value)
          );
        }
        return;
      }

      case IoctlId.READ_VBATT: {
        await this.transport.write(buildReadVoltageCmd(16));
        const resp = await this.readResponse();
        if (resp.type === "voltage") {
          return resp.millivolts;
        }
        throw this.setError(J2534Error.ERR_FAILED, "Failed to read voltage");
      }

      case IoctlId.FIVE_BAUD_INIT: {
        const ch = this.getChannel(channelId);
        const msg = input as PassThruMsg;
        if (!msg || msg.dataSize < 1) {
          throw this.setError(J2534Error.ERR_INVALID_MSG, "5-baud init requires target address byte");
        }
        const targetAddress = msg.data[0];
        await this.transport.write(
          buildFiveBaudInitCmd(ch.channelByte, targetAddress)
        );
        // 5-baud init takes ~2 seconds (9 bits at 5 baud = 1800ms + response)
        const resp = await this.readResponse(5000);
        if (resp.type === "fast_init") {
          return {
            protocolId: ch.protocol as Protocol,
            rxStatus: 0,
            txFlags: 0,
            timestamp: 0,
            dataSize: resp.data.length,
            extraDataIndex: resp.data.length,
            data: resp.data,
          };
        }
        throw this.setError(J2534Error.ERR_FAILED, "5-baud init failed or timed out");
      }

      case IoctlId.FAST_INIT: {
        const ch = this.getChannel(channelId);
        const msg = input as PassThruMsg;
        await this.transport.write(
          buildFastInitCmd(ch.channelByte, msg.data.subarray(0, msg.dataSize))
        );
        const resp = await this.readResponse();
        if (resp.type === "fast_init") {
          return {
            protocolId: ch.protocol as Protocol,
            rxStatus: 0,
            txFlags: 0,
            timestamp: 0,
            dataSize: resp.data.length,
            extraDataIndex: resp.data.length,
            data: resp.data,
          };
        }
        throw this.setError(J2534Error.ERR_FAILED, "Fast init failed");
      }

      case IoctlId.CLEAR_TX_BUFFER:
        return; // no-op

      case IoctlId.CLEAR_RX_BUFFER: {
        const ch = this.getChannel(channelId);
        ch.rxQueue.clear();
        return;
      }

      case IoctlId.CLEAR_PERIODIC_MSGS: {
        for (const [id, pm] of this.periodicMsgs) {
          if (pm.channelId === channelId) {
            this.stopPeriodicTimer(id);
            this.periodicMsgs.delete(id);
          }
        }
        return;
      }

      case IoctlId.CLEAR_MSG_FILTERS: {
        const ch = this.getChannel(channelId);
        for (const [fid] of ch.filters) {
          await this.transport.write(buildStopFilterCmd(ch.channelByte, fid));
        }
        ch.filters.clear();
        return;
      }

      case IoctlId.CLEAR_FUNCT_MSG_LOOKUP_TABLE: {
        const ch = this.getChannel(channelId);
        ch.functionalAddresses = [];
        return;
      }

      case IoctlId.ADD_TO_FUNCT_MSG_LOOKUP_TABLE: {
        const ch = this.getChannel(channelId);
        const byteArray = input as SByteArray;
        if (!byteArray || !byteArray.data) {
          throw this.setError(J2534Error.ERR_NULL_PARAMETER, "Byte array required");
        }
        // Each address is protocol-dependent size (4 bytes for CAN/ISO15765)
        const addrSize = this.getAddressSize(ch.protocol);
        for (let i = 0; i + addrSize <= byteArray.numOfBytes; i += addrSize) {
          ch.functionalAddresses.push({
            address: new Uint8Array(byteArray.data.slice(i, i + addrSize)),
          });
        }
        return;
      }

      case IoctlId.DELETE_FROM_FUNCT_MSG_LOOKUP_TABLE: {
        const ch = this.getChannel(channelId);
        const byteArray = input as SByteArray;
        if (!byteArray || !byteArray.data) {
          throw this.setError(J2534Error.ERR_NULL_PARAMETER, "Byte array required");
        }
        const addrSize = this.getAddressSize(ch.protocol);
        for (let i = 0; i + addrSize <= byteArray.numOfBytes; i += addrSize) {
          const toRemove = byteArray.data.slice(i, i + addrSize);
          ch.functionalAddresses = ch.functionalAddresses.filter(
            (fa) => !arraysEqual(fa.address, toRemove)
          );
        }
        return;
      }

      case IoctlId.READ_PROG_VOLTAGE: {
        // Read voltage on the programming pin (same as VBATT but configurable)
        await this.transport.write(buildReadVoltageCmd(2)); // Pin 2 (J1850P) typical
        const resp = await this.readResponse();
        if (resp.type === "voltage") {
          return resp.millivolts;
        }
        throw this.setError(J2534Error.ERR_FAILED, "Failed to read programming voltage");
      }

      default:
        throw this.setError(J2534Error.ERR_INVALID_IOCTL_ID, `Unknown IOCTL ID: ${ioctlId}`);
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────

  private assertOpen(): void {
    if (this.deviceId === null) {
      throw this.setError(J2534Error.ERR_DEVICE_NOT_CONNECTED, "Device not open");
    }
  }

  private getChannel(channelId: number): ChannelState {
    const ch = this.channels.get(channelId);
    if (!ch) {
      throw this.setError(J2534Error.ERR_INVALID_CHANNEL_ID, `Invalid channel: ${channelId}`);
    }
    return ch;
  }

  private validateProtocol(protocol: Protocol | number): void {
    // SCI protocols are not supported by hardware
    if (
      protocol === Protocol.SCI_A_ENGINE ||
      protocol === Protocol.SCI_A_TRANS ||
      protocol === Protocol.SCI_B_ENGINE ||
      protocol === Protocol.SCI_B_TRANS
    ) {
      throw this.setError(
        J2534Error.ERR_INVALID_PROTOCOL_ID,
        "SCI protocols not supported by OpenPort 2.0 hardware"
      );
    }
  }

  private setError(code: J2534Error, message: string): J2534Exception {
    this.lastError = message;
    return new J2534Exception(code, message);
  }

  private async readResponse(timeout = 2000): Promise<DeviceResponse> {
    try {
      const buf = await this.transport.read(timeout);
      const protocol = this.channels.size > 0
        ? this.channels.values().next().value!.protocol as Protocol
        : Protocol.CAN;
      return parseResponse(buf, protocol);
    } catch {
      return { type: "unknown", raw: new Uint8Array(0) };
    }
  }

  private async pollOnce(ch: ChannelState): Promise<void> {
    try {
      const buf = await this.transport.read(1);
      if (buf.length > 0) {
        const resp = parseResponse(buf, ch.protocol as Protocol);
        if (resp.type === "message") {
          // Apply functional address filtering if table is populated
          if (ch.functionalAddresses.length > 0) {
            if (this.matchesFunctionalAddress(ch, resp.msg)) {
              ch.rxQueue.push(resp.msg);
            }
          } else {
            ch.rxQueue.push(resp.msg);
          }
        }
      }
    } catch {
      // timeout or no data — expected
    }
  }

  private matchesFunctionalAddress(ch: ChannelState, msg: PassThruMsg): boolean {
    const addrSize = this.getAddressSize(ch.protocol);
    if (msg.dataSize < addrSize) return false;
    const msgAddr = msg.data.subarray(0, addrSize);
    return ch.functionalAddresses.some((fa) => arraysEqual(fa.address, msgAddr));
  }

  private getAddressSize(protocol: Protocol | number): number {
    switch (protocol) {
      case Protocol.CAN:
      case Protocol.ISO15765:
      case 0x00009000: // CAN_CH1
      case 0x00009040: // ISO15765_CH1
        return 4;
      default:
        return 1;
    }
  }

  private stopPeriodicTimer(id: number): void {
    const pm = this.periodicMsgs.get(id);
    if (pm?.timer) {
      clearInterval(pm.timer as ReturnType<typeof setInterval>);
      pm.timer = null;
    }
  }
}

// ─── Exception ──────────────────────────────────────────────────────

/**
 * J2534 error with status code.
 */
export class J2534Exception extends Error {
  constructor(
    public readonly code: J2534Error,
    message: string
  ) {
    super(message);
    this.name = "J2534Exception";
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Helper to create a PassThruMsg for use in filter setup, writes, etc.
 */
export function createMsg(
  protocol: Protocol | number,
  data: number[],
  txFlags = 0
): PassThruMsg {
  const buf = new Uint8Array(4128);
  buf.set(data);
  return {
    protocolId: protocol as Protocol,
    rxStatus: 0,
    txFlags,
    timestamp: 0,
    dataSize: data.length,
    extraDataIndex: data.length,
    data: buf,
  };
}
