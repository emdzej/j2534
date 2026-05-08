import { J2534Device, createMsg, type J2534Options } from "@emdzej/j2534-driver";
import { WebSerialTransport, listDevices } from "@emdzej/j2534-webserial";
import {
  type VersionInfo,
  type PassThruMsg,
  type SConfig,
  type SByteArray,
  type DeviceInfo,
  Protocol,
  ProtocolExt,
  ConnectFlag,
  FilterType,
  IoctlId,
  ConfigParam,
  Pin,
  VOLTAGE_OFF,
  SHORT_TO_GROUND,
} from "@emdzej/j2534-types";

export type { SConfig };

export {
  Protocol,
  ProtocolExt,
  ConnectFlag,
  FilterType,
  IoctlId,
  ConfigParam,
  Pin,
  VOLTAGE_OFF,
  SHORT_TO_GROUND,
};

export type LogEntry = {
  timestamp: Date;
  level: "info" | "warn" | "error" | "rx" | "tx";
  message: string;
};

export type ChannelInfo = {
  id: number;
  protocol: Protocol | number;
  protocolName: string;
  flags: number;
  baudRate: number;
  filterIds: number[];
};

const PROTOCOL_NAMES: Record<number, string> = {
  [Protocol.J1850VPW]: "J1850 VPW",
  [Protocol.J1850PWM]: "J1850 PWM",
  [Protocol.ISO9141]: "ISO 9141",
  [Protocol.ISO14230]: "ISO 14230 (KWP)",
  [Protocol.CAN]: "CAN",
  [Protocol.ISO15765]: "ISO 15765 (CAN)",
  [Protocol.SCI_A_ENGINE]: "SCI-A Engine",
  [Protocol.SCI_A_TRANS]: "SCI-A Trans",
  [Protocol.SCI_B_ENGINE]: "SCI-B Engine",
  [Protocol.SCI_B_TRANS]: "SCI-B Trans",
  [ProtocolExt.CAN_CH1]: "CAN CH1 (ext)",
  [ProtocolExt.ISO15765_CH1]: "ISO15765 CH1 (ext)",
  [ProtocolExt.J1850VPW_CH1]: "J1850VPW CH1 (ext)",
  [ProtocolExt.J1850PWM_CH1]: "J1850PWM CH1 (ext)",
  [ProtocolExt.ISO9141_K]: "ISO9141 K-Line (ext)",
  [ProtocolExt.ISO9141_L]: "ISO9141 L-Line (ext)",
  [ProtocolExt.ISO9141_INNO]: "ISO9141 AUX/Innovate (ext)",
  [ProtocolExt.ISO14230_K]: "ISO14230 K-Line (ext)",
  [ProtocolExt.ISO14230_L]: "ISO14230 L-Line (ext)",
};

export function getProtocolName(p: number): string {
  return PROTOCOL_NAMES[p] ?? `Unknown (0x${p.toString(16)})`;
}

export function getPinName(pin: number): string {
  const names: Record<number, string> = {
    [Pin.AUX]: "AUX (Pin 0)",
    [Pin.PIN_1]: "Pin 1",
    [Pin.PIN_2_J1850P]: "Pin 2 (J1850+)",
    [Pin.PIN_3]: "Pin 3",
    [Pin.PIN_6_CAN_H]: "Pin 6 (CAN-H)",
    [Pin.PIN_7_K_LINE]: "Pin 7 (K-Line)",
    [Pin.PIN_9]: "Pin 9",
    [Pin.PIN_10_J1850M]: "Pin 10 (J1850-)",
    [Pin.PIN_11]: "Pin 11",
    [Pin.PIN_12]: "Pin 12",
    [Pin.PIN_13]: "Pin 13",
    [Pin.PIN_14_CAN_L]: "Pin 14 (CAN-L)",
    [Pin.PIN_15_L_LINE]: "Pin 15 (L-Line)",
    [Pin.PIN_16_VBATT]: "Pin 16 (VBATT)",
  };
  return names[pin] ?? `Pin ${pin}`;
}

export const CONNECTABLE_PROTOCOLS = [
  { value: Protocol.CAN, label: "CAN" },
  { value: Protocol.ISO15765, label: "ISO 15765 (CAN)" },
  { value: Protocol.ISO9141, label: "ISO 9141" },
  { value: Protocol.ISO14230, label: "ISO 14230 (KWP2000)" },
  { value: Protocol.J1850VPW, label: "J1850 VPW" },
  { value: Protocol.J1850PWM, label: "J1850 PWM" },
  { value: ProtocolExt.CAN_CH1, label: "CAN CH1 (ext)" },
  { value: ProtocolExt.ISO15765_CH1, label: "ISO15765 CH1 (ext)" },
  { value: ProtocolExt.ISO9141_K, label: "ISO9141 K-Line (ext)" },
  { value: ProtocolExt.ISO9141_L, label: "ISO9141 L-Line (ext)" },
  { value: ProtocolExt.ISO9141_INNO, label: "ISO9141 AUX/Innovate (ext)" },
  { value: ProtocolExt.ISO14230_K, label: "ISO14230 K-Line (ext)" },
  { value: ProtocolExt.ISO14230_L, label: "ISO14230 L-Line (ext)" },
];

export const IO_PINS = [
  Pin.AUX,
  Pin.PIN_1,
  Pin.PIN_2_J1850P,
  Pin.PIN_3,
  Pin.PIN_6_CAN_H,
  Pin.PIN_7_K_LINE,
  Pin.PIN_9,
  Pin.PIN_10_J1850M,
  Pin.PIN_11,
  Pin.PIN_12,
  Pin.PIN_13,
  Pin.PIN_14_CAN_L,
  Pin.PIN_15_L_LINE,
];

export const CONFIG_PARAMS = [
  { value: ConfigParam.DATA_RATE, label: "Data Rate" },
  { value: ConfigParam.LOOPBACK, label: "Loopback" },
  { value: ConfigParam.NODE_ADDRESS, label: "Node Address" },
  { value: ConfigParam.NETWORK_LINE, label: "Network Line" },
  { value: ConfigParam.P1_MIN, label: "P1 Min" },
  { value: ConfigParam.P1_MAX, label: "P1 Max" },
  { value: ConfigParam.P2_MIN, label: "P2 Min" },
  { value: ConfigParam.P2_MAX, label: "P2 Max" },
  { value: ConfigParam.P3_MIN, label: "P3 Min" },
  { value: ConfigParam.P3_MAX, label: "P3 Max" },
  { value: ConfigParam.P4_MIN, label: "P4 Min" },
  { value: ConfigParam.P4_MAX, label: "P4 Max" },
  { value: ConfigParam.W0, label: "W0" },
  { value: ConfigParam.W1, label: "W1" },
  { value: ConfigParam.W2, label: "W2" },
  { value: ConfigParam.W3, label: "W3" },
  { value: ConfigParam.W4, label: "W4" },
  { value: ConfigParam.W5, label: "W5" },
  { value: ConfigParam.TIDLE, label: "T-Idle" },
  { value: ConfigParam.TINIL, label: "T-Inil" },
  { value: ConfigParam.TWUP, label: "T-Wup" },
  { value: ConfigParam.PARITY, label: "Parity" },
  { value: ConfigParam.BIT_SAMPLE_POINT, label: "Bit Sample Point" },
  { value: ConfigParam.SYNC_JUMP_WIDTH, label: "Sync Jump Width" },
  { value: ConfigParam.DATA_BITS, label: "Data Bits" },
  { value: ConfigParam.ISO15765_BS, label: "ISO15765 Block Size" },
  { value: ConfigParam.ISO15765_STMIN, label: "ISO15765 ST Min" },
  { value: ConfigParam.ISO15765_WFT_MAX, label: "ISO15765 WFT Max" },
];

function createDeviceStore() {
  let device = $state<J2534Device | null>(null);
  let connected = $state(false);
  let version = $state<VersionInfo | null>(null);
  let batteryVoltage = $state<number | null>(null);
  let progVoltage = $state<number | null>(null);
  let channels = $state<ChannelInfo[]>([]);
  let log = $state<LogEntry[]>([]);
  let busy = $state(false);
  let rxMessages = $state<
    { channelId: number; msg: PassThruMsg; receivedAt: Date }[]
  >([]);
  let rxPolling = $state<Record<number, ReturnType<typeof setInterval>>>({});

  function addLog(
    level: LogEntry["level"],
    message: string,
  ) {
    log.push({ timestamp: new Date(), level, message });
    if (log.length > 500) log.splice(0, log.length - 500);
  }

  async function connect() {
    if (connected) return;
    busy = true;
    try {
      const transport = new WebSerialTransport();
      device = new J2534Device({ transport });
      await device.passThruOpen();
      connected = true;
      addLog("info", "Device opened successfully");

      version = await device.passThruReadVersion();
      addLog(
        "info",
        `Firmware: ${version.firmwareVersion}, DLL: ${version.dllVersion}, API: ${version.apiVersion}`,
      );

      await refreshVoltages();
    } catch (e: any) {
      addLog("error", `Connection failed: ${e.message}`);
      device = null;
      connected = false;
      throw e;
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    if (!device || !connected) return;
    busy = true;
    try {
      // Stop all rx polling
      for (const timer of Object.values(rxPolling)) clearInterval(timer);
      rxPolling = {};

      // Disconnect all channels
      for (const ch of channels) {
        try {
          await device.passThruDisconnect(ch.id);
        } catch {}
      }
      channels = [];

      await device.passThruClose();
      addLog("info", "Device closed");
    } catch (e: any) {
      addLog("error", `Disconnect error: ${e.message}`);
    } finally {
      device = null;
      connected = false;
      version = null;
      batteryVoltage = null;
      progVoltage = null;
      busy = false;
    }
  }

  async function refreshVoltages() {
    if (!device || !connected) return;
    try {
      batteryVoltage = (await device.passThruIoctl(
        0,
        IoctlId.READ_VBATT,
      )) as number;
      addLog(
        "info",
        `Battery: ${(batteryVoltage / 1000).toFixed(2)}V`,
      );
    } catch (e: any) {
      addLog("warn", `Read VBATT failed: ${e.message}`);
    }
    try {
      progVoltage = (await device.passThruIoctl(
        0,
        IoctlId.READ_PROG_VOLTAGE,
      )) as number;
      addLog(
        "info",
        `Prog voltage: ${(progVoltage / 1000).toFixed(2)}V`,
      );
    } catch (e: any) {
      addLog("warn", `Read prog voltage failed: ${e.message}`);
    }
  }

  async function setPinVoltage(pin: number, millivolts: number) {
    if (!device || !connected) return;
    busy = true;
    try {
      await device.passThruSetProgrammingVoltage(pin, millivolts);
      addLog("info", `Set ${getPinName(pin)} to ${millivolts}mV`);
    } catch (e: any) {
      addLog("error", `Set voltage failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function setPinOff(pin: number) {
    if (!device || !connected) return;
    busy = true;
    try {
      await device.passThruSetProgrammingVoltage(pin, VOLTAGE_OFF);
      addLog("info", `${getPinName(pin)} voltage OFF`);
    } catch (e: any) {
      addLog("error", `Pin off failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function setPinShortToGround(pin: number) {
    if (!device || !connected) return;
    busy = true;
    try {
      await device.passThruSetProgrammingVoltage(pin, SHORT_TO_GROUND);
      addLog("info", `${getPinName(pin)} shorted to ground`);
    } catch (e: any) {
      addLog("error", `Short to ground failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function connectChannel(
    protocol: number,
    flags: number,
    baudRate: number,
  ): Promise<number> {
    if (!device || !connected) throw new Error("Not connected");
    busy = true;
    try {
      const id = await device.passThruConnect(protocol, flags, baudRate);
      const info: ChannelInfo = {
        id,
        protocol,
        protocolName: getProtocolName(protocol),
        flags,
        baudRate,
        filterIds: [],
      };
      channels.push(info);
      addLog(
        "info",
        `Channel ${id} opened: ${info.protocolName} @ ${baudRate} baud`,
      );
      return id;
    } catch (e: any) {
      addLog("error", `Connect channel failed: ${e.message}`);
      throw e;
    } finally {
      busy = false;
    }
  }

  async function disconnectChannel(channelId: number) {
    if (!device || !connected) return;
    busy = true;
    try {
      if (rxPolling[channelId]) {
        clearInterval(rxPolling[channelId]);
        delete rxPolling[channelId];
      }
      await device.passThruDisconnect(channelId);
      channels = channels.filter((c) => c.id !== channelId);
      addLog("info", `Channel ${channelId} closed`);
    } catch (e: any) {
      addLog("error", `Disconnect channel failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function addFilter(
    channelId: number,
    filterType: FilterType,
    maskData: number[],
    patternData: number[],
    flowControlData?: number[],
    protocol?: number,
  ): Promise<number> {
    if (!device || !connected) throw new Error("Not connected");
    const ch = channels.find((c) => c.id === channelId);
    const proto = protocol ?? ch?.protocol ?? Protocol.CAN;
    const mask = createMsg(proto, maskData);
    const pattern = createMsg(proto, patternData);
    const flow = flowControlData
      ? createMsg(proto, flowControlData)
      : undefined;
    const filterId = await device.passThruStartMsgFilter(
      channelId,
      filterType,
      mask,
      pattern,
      flow,
    );
    if (ch) ch.filterIds.push(filterId);
    addLog(
      "info",
      `Filter ${filterId} added to channel ${channelId} (type=${FilterType[filterType]})`,
    );
    return filterId;
  }

  async function removeFilter(channelId: number, filterId: number) {
    if (!device || !connected) return;
    await device.passThruStopMsgFilter(channelId, filterId);
    const ch = channels.find((c) => c.id === channelId);
    if (ch) ch.filterIds = ch.filterIds.filter((f) => f !== filterId);
    addLog("info", `Filter ${filterId} removed from channel ${channelId}`);
  }

  function startRxPolling(channelId: number, intervalMs = 100) {
    if (rxPolling[channelId]) return;
    rxPolling[channelId] = setInterval(async () => {
      if (!device || !connected) return;
      try {
        const msgs = await device.passThruReadMsgs(channelId, 16, 50);
        const now = new Date();
        for (const msg of msgs) {
          rxMessages.push({ channelId, msg, receivedAt: now });
          if (rxMessages.length > 2000) rxMessages.splice(0, rxMessages.length - 2000);
        }
      } catch {
        // ERR_BUFFER_EMPTY is expected
      }
    }, intervalMs);
  }

  function stopRxPolling(channelId: number) {
    if (rxPolling[channelId]) {
      clearInterval(rxPolling[channelId]);
      delete rxPolling[channelId];
    }
  }

  function clearRxMessages() {
    rxMessages.length = 0;
  }

  async function sendMessage(
    channelId: number,
    protocol: number,
    data: number[],
    txFlags = 0,
  ) {
    if (!device || !connected) return;
    const msg = createMsg(protocol, data, txFlags);
    await device.passThruWriteMsgs(channelId, [msg], 1000);
    addLog("tx", `CH${channelId}: ${data.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }

  async function getConfig(
    channelId: number,
    params: ConfigParam[],
  ): Promise<SConfig[]> {
    if (!device || !connected) throw new Error("Not connected");
    const input: SConfig[] = params.map((p) => ({ parameter: p, value: 0 }));
    return (await device.passThruIoctl(channelId, IoctlId.GET_CONFIG, input)) as SConfig[];
  }

  async function setConfig(channelId: number, configs: SConfig[]) {
    if (!device || !connected) return;
    await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, configs);
    addLog("info", `Config updated on channel ${channelId}`);
  }

  async function clearRxBuffer(channelId: number) {
    if (!device || !connected) return;
    await device.passThruIoctl(channelId, IoctlId.CLEAR_RX_BUFFER);
    addLog("info", `RX buffer cleared on channel ${channelId}`);
  }

  async function clearTxBuffer(channelId: number) {
    if (!device || !connected) return;
    await device.passThruIoctl(channelId, IoctlId.CLEAR_TX_BUFFER);
    addLog("info", `TX buffer cleared on channel ${channelId}`);
  }

  async function clearFilters(channelId: number) {
    if (!device || !connected) return;
    await device.passThruIoctl(channelId, IoctlId.CLEAR_MSG_FILTERS);
    const ch = channels.find((c) => c.id === channelId);
    if (ch) ch.filterIds = [];
    addLog("info", `Filters cleared on channel ${channelId}`);
  }

  async function fastInit(
    channelId: number,
    data: number[],
  ): Promise<PassThruMsg | null> {
    if (!device || !connected) return null;
    const ch = channels.find((c) => c.id === channelId);
    const proto = ch?.protocol ?? Protocol.ISO14230;
    const msg = createMsg(proto, data);
    const result = (await device.passThruIoctl(
      channelId,
      IoctlId.FAST_INIT,
      msg,
    )) as PassThruMsg;
    addLog("info", `Fast init on channel ${channelId}`);
    return result;
  }

  async function fiveBaudInit(
    channelId: number,
    targetAddress: number,
  ): Promise<PassThruMsg | null> {
    if (!device || !connected) return null;
    const ch = channels.find((c) => c.id === channelId);
    const proto = ch?.protocol ?? Protocol.ISO9141;
    const msg = createMsg(proto, [targetAddress]);
    const result = (await device.passThruIoctl(
      channelId,
      IoctlId.FIVE_BAUD_INIT,
      msg,
    )) as PassThruMsg;
    addLog("info", `5-baud init on channel ${channelId}, addr=0x${targetAddress.toString(16)}`);
    return result;
  }

  return {
    get device() { return device; },
    get connected() { return connected; },
    get version() { return version; },
    get batteryVoltage() { return batteryVoltage; },
    get progVoltage() { return progVoltage; },
    get channels() { return channels; },
    get log() { return log; },
    get busy() { return busy; },
    get rxMessages() { return rxMessages; },
    connect,
    disconnect,
    refreshVoltages,
    setPinVoltage,
    setPinOff,
    setPinShortToGround,
    connectChannel,
    disconnectChannel,
    addFilter,
    removeFilter,
    startRxPolling,
    stopRxPolling,
    clearRxMessages,
    sendMessage,
    getConfig,
    setConfig,
    clearRxBuffer,
    clearTxBuffer,
    clearFilters,
    fastInit,
    fiveBaudInit,
  };
}

export const deviceStore = createDeviceStore();
