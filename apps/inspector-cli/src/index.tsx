import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { J2534Device } from "@emdzej/j2534-driver";
import { SerialTransport } from "@emdzej/j2534-serial";
import { NodeUsbTransport } from "@emdzej/j2534-usb";
import {
  type VersionInfo,
  type PassThruMsg,
  IoctlId,
  Pin,
  VOLTAGE_OFF,
  SHORT_TO_GROUND,
  Protocol,
  ProtocolExt,
  ConfigParam,
} from "@emdzej/j2534-types";

// ─── Types ─────────────────────────────────────────────────────────

type Tab = "info" | "io" | "channels" | "config" | "init" | "monitor";

interface ChannelEntry {
  id: number;
  protocol: Protocol;
  baudRate: number;
  label: string;
}

interface LogEntry {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface RxEntry {
  channelId: number;
  msg: PassThruMsg;
  receivedAt: number;
}

type InitType = "fast" | "fivebaud";

// ─── Constants ─────────────────────────────────────────────────────

const TABS: { key: string; id: Tab; label: string }[] = [
  { key: "1", id: "info", label: "Device Info" },
  { key: "2", id: "io", label: "I/O Control" },
  { key: "3", id: "channels", label: "Channels" },
  { key: "4", id: "config", label: "Config" },
  { key: "5", id: "init", label: "Diag Init" },
  { key: "6", id: "monitor", label: "Monitor" },
];

const IO_PINS = [
  { pin: Pin.AUX, name: "AUX (2.5mm)" },
  { pin: Pin.PIN_1, name: "Pin 1" },
  { pin: Pin.PIN_2_J1850P, name: "Pin 2 (J1850+)" },
  { pin: Pin.PIN_3, name: "Pin 3" },
  { pin: Pin.PIN_6_CAN_H, name: "Pin 6 (CAN_H)" },
  { pin: Pin.PIN_7_K_LINE, name: "Pin 7 (K-Line)" },
  { pin: Pin.PIN_9, name: "Pin 9" },
  { pin: Pin.PIN_10_J1850M, name: "Pin 10 (J1850-)" },
  { pin: Pin.PIN_11, name: "Pin 11" },
  { pin: Pin.PIN_12, name: "Pin 12" },
  { pin: Pin.PIN_13, name: "Pin 13" },
  { pin: Pin.PIN_14_CAN_L, name: "Pin 14 (CAN_L)" },
  { pin: Pin.PIN_15_L_LINE, name: "Pin 15 (L-Line)" },
] as const;

const PROTOCOLS = [
  { protocol: Protocol.CAN, label: "CAN", defaultBaud: 500000 },
  { protocol: Protocol.ISO15765, label: "ISO 15765", defaultBaud: 500000 },
  { protocol: Protocol.ISO9141, label: "ISO 9141 K-Line", defaultBaud: 10400 },
  { protocol: ProtocolExt.ISO9141_L as unknown as Protocol, label: "ISO 9141 L-Line", defaultBaud: 10400 },
  { protocol: ProtocolExt.ISO9141_INNO as unknown as Protocol, label: "ISO 9141 AUX (2.5mm)", defaultBaud: 4800 },
  { protocol: Protocol.ISO14230, label: "ISO 14230 K-Line", defaultBaud: 10400 },
  { protocol: ProtocolExt.ISO14230_L as unknown as Protocol, label: "ISO 14230 L-Line", defaultBaud: 10400 },
] as const;

// ─── Main App ──────────────────────────────────────────────────────

function App({ serialPort, forceUsb }: { serialPort?: string; forceUsb: boolean }) {
  const { exit } = useApp();
  const [transportType, setTransportType] = useState<"serial" | "usb">("serial");
  const [device, setDevice] = useState<J2534Device | null>(null);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [batteryMv, setBatteryMv] = useState<number | null>(null);
  const [progMv, setProgMv] = useState<number | null>(null);
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // IO state
  const [ioPinIdx, setIoPinIdx] = useState(0);
  const [ioMode, setIoMode] = useState<"voltage" | "off" | "ground">("voltage");
  const [ioVoltage, setIoVoltage] = useState(5000);
  const [ioPinReadMv, setIoPinReadMv] = useState<number | null>(null);
  // Per-pin applied state: tracks what was last set on each pin
  const [pinStates, setPinStates] = useState<
    Map<number, { mode: "voltage" | "off" | "ground"; voltage: number }>
  >(new Map());

  // Channel state
  const [protoIdx, setProtoIdx] = useState(0);

  // Config state
  const [configResults, setConfigResults] = useState<
    { param: string; value: number }[]
  >([]);

  // Init state
  const [initType, setInitType] = useState<InitType>("fast");
  const [initChannelIdx, setInitChannelIdx] = useState(0);
  const [initResult, setInitResult] = useState<string | null>(null);

  // Monitor state
  const [rxMessages, setRxMessages] = useState<RxEntry[]>([]);
  const [monitorChannelIdx, setMonitorChannelIdx] = useState(0);
  const [polling, setPolling] = useState<Set<number>>(new Set());
  const [txInput, setTxInput] = useState("");
  const [txEditing, setTxEditing] = useState(false);

  const log = (level: LogEntry["level"], message: string) => {
    setLogs((prev) => [
      ...prev.slice(-49),
      { time: new Date().toLocaleTimeString(), level, message },
    ]);
  };

  const connect = async () => {
    setConnecting(true);
    setError(null);

    // Try serial transport first (no sudo needed), fall back to USB
    let dev: J2534Device;
    let transport: "serial" | "usb" = "serial";

    if (forceUsb) {
      try {
        transport = "usb";
        dev = new J2534Device({ transport: new NodeUsbTransport() });
        await dev.passThruOpen();
      } catch (e: any) {
        setError(e.message);
        log("error", `Connect failed: ${e.message}`);
        setConnecting(false);
        return;
      }
    } else {
      try {
        dev = new J2534Device({ transport: new SerialTransport(serialPort) });
        await dev.passThruOpen();
      } catch {
        try {
          transport = "usb";
          dev = new J2534Device({ transport: new NodeUsbTransport() });
          await dev.passThruOpen();
        } catch (e: any) {
          setError(e.message);
          log("error", `Connect failed: ${e.message}`);
          setConnecting(false);
          return;
        }
      }
    }

    setDevice(dev);
    setTransportType(transport);
    const v = await dev.passThruReadVersion();
    setVersion(v);
    setConnected(true);
    log("info", `Connected via ${transport} transport`);
    setConnecting(false);
    await refreshVoltagesFor(dev);
  };

  const disconnect = async () => {
    if (!device) return;
    try {
      stopAllPolling();
      for (const ch of channels) {
        await device.passThruDisconnect(ch.id);
      }
      setChannels([]);
      await device.passThruClose();
      setDevice(null);
      setConnected(false);
      setVersion(null);
      setBatteryMv(null);
      setProgMv(null);
      log("info", "Device disconnected");
    } catch (e: any) {
      log("error", `Disconnect failed: ${e.message}`);
    }
  };

  const refreshVoltagesFor = async (dev: J2534Device) => {
    try {
      const batt = (await dev.passThruIoctl(0, IoctlId.READ_VBATT)) as number;
      setBatteryMv(batt);
    } catch (e: any) {
      log("error", `Battery voltage read failed: ${e.message}`);
    }
    try {
      const prog = (await dev.passThruIoctl(0, IoctlId.READ_PROG_VOLTAGE)) as number;
      setProgMv(prog);
    } catch {
      setProgMv(null);
    }
  };

  const refreshVoltages = async () => {
    if (!device) return;
    await refreshVoltagesFor(device);
  };

  const applyIo = async () => {
    if (!device) return;
    const pin = IO_PINS[ioPinIdx].pin;
    const name = IO_PINS[ioPinIdx].name;
    try {
      if (ioMode === "voltage") {
        await device.passThruSetProgrammingVoltage(pin, ioVoltage);
        log("info", `Set ${name} to ${(ioVoltage / 1000).toFixed(2)}V`);
      } else if (ioMode === "off") {
        await device.passThruSetProgrammingVoltage(pin, VOLTAGE_OFF);
        log("info", `Turned off ${name}`);
      } else {
        await device.passThruSetProgrammingVoltage(pin, SHORT_TO_GROUND);
        log("warn", `Shorted ${name} to ground`);
      }
      // Track applied state
      setPinStates((prev) => {
        const next = new Map(prev);
        next.set(pin, { mode: ioMode, voltage: ioMode === "voltage" ? ioVoltage : 0 });
        return next;
      });
      // Re-read pin voltage after applying
      await readSelectedPinVoltage();
    } catch (e: any) {
      log("error", `IO failed: ${e.message}`);
    }
  };

  const readSelectedPinVoltage = async (pinIdxOverride?: number) => {
    if (!device) return;
    const pin = IO_PINS[pinIdxOverride ?? ioPinIdx].pin;
    try {
      const mv = await device.readPinVoltage(pin);
      setIoPinReadMv(mv);
    } catch {
      setIoPinReadMv(null);
    }
  };

  const openChannel = async () => {
    if (!device) return;
    const proto = PROTOCOLS[protoIdx];
    try {
      const chId = await device.passThruConnect(
        proto.protocol,
        0,
        proto.defaultBaud
      );
      setChannels((prev) => [
        ...prev,
        {
          id: chId,
          protocol: proto.protocol,
          baudRate: proto.defaultBaud,
          label: proto.label,
        },
      ]);
      log("info", `Opened ${proto.label} channel ${chId} @ ${proto.defaultBaud}`);
    } catch (e: any) {
      log("error", `Open channel failed: ${e.message}`);
    }
  };

  const closeChannel = async (chId: number) => {
    if (!device) return;
    try {
      await device.passThruDisconnect(chId);
      setChannels((prev) => prev.filter((c) => c.id !== chId));
      log("info", `Closed channel ${chId}`);
    } catch (e: any) {
      log("error", `Close channel failed: ${e.message}`);
    }
  };

  const readConfig = async () => {
    if (!device) return;
    if (channels.length === 0) {
      log("warn", "Open a channel first");
      return;
    }
    const ch = channels[0];
    const params = [
      ConfigParam.DATA_RATE,
      ConfigParam.LOOPBACK,
      ConfigParam.P1_MAX,
      ConfigParam.P3_MIN,
      ConfigParam.P4_MIN,
      ConfigParam.PARITY,
      ConfigParam.DATA_BITS,
    ];
    try {
      const results = (await device.passThruIoctl(
        ch.id,
        IoctlId.GET_CONFIG,
        params.map((p) => ({ parameter: p, value: 0 }))
      )) as { parameter: number; value: number }[];
      setConfigResults(
        results.map((r) => ({
          param: ConfigParam[r.parameter] ?? `0x${r.parameter.toString(16)}`,
          value: r.value,
        }))
      );
      log("info", `Read ${results.length} config params from CH${ch.id}`);
    } catch (e: any) {
      log("error", `Read config failed: ${e.message}`);
    }
  };

  // ─── Diagnostic Init ───────────────────────────────────────────────

  const runFastInit = async () => {
    if (!device || channels.length === 0) return;
    const ch = channels[initChannelIdx % channels.length];
    setInitResult(null);
    try {
      const initBytes = [0xc1, 0x33, 0xf1, 0x81]; // StartCommunication request
      const inputMsg: PassThruMsg = {
        protocolId: ch.protocol,
        rxStatus: 0,
        txFlags: 0,
        timestamp: 0,
        dataSize: initBytes.length,
        extraDataIndex: initBytes.length,
        data: new Uint8Array(initBytes),
      };
      const result = await device.passThruIoctl(ch.id, IoctlId.FAST_INIT, inputMsg) as PassThruMsg;
      if (result) {
        const hex = Array.from(result.data.subarray(0, result.dataSize))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        setInitResult(`Response (${result.dataSize} bytes): ${hex}`);
        log("info", `Fast init on CH${ch.id}: ${hex}`);
      } else {
        setInitResult("No response");
      }
    } catch (e: any) {
      setInitResult(`Error: ${e.message}`);
      log("error", `Fast init failed: ${e.message}`);
    }
  };

  const runFiveBaudInit = async () => {
    if (!device || channels.length === 0) return;
    const ch = channels[initChannelIdx % channels.length];
    setInitResult(null);
    try {
      const inputMsg: PassThruMsg = {
        protocolId: ch.protocol,
        rxStatus: 0,
        txFlags: 0,
        timestamp: 0,
        dataSize: 1,
        extraDataIndex: 1,
        data: new Uint8Array([0x33]), // ISO 9141-2 default target
      };
      const result = await device.passThruIoctl(ch.id, IoctlId.FIVE_BAUD_INIT, inputMsg) as PassThruMsg;
      if (result) {
        const hex = Array.from(result.data.subarray(0, result.dataSize))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        setInitResult(`Response (${result.dataSize} bytes): ${hex}`);
        log("info", `5-baud init on CH${ch.id}: ${hex}`);
      } else {
        setInitResult("No response");
      }
    } catch (e: any) {
      setInitResult(`Error: ${e.message}`);
      log("error", `5-baud init failed: ${e.message}`);
    }
  };

  // ─── Message Monitor ───────────────────────────────────────────────

  const pollTimers = React.useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());

  const startPolling = (channelId: number) => {
    if (pollTimers.current.has(channelId)) return;
    const timer = setInterval(async () => {
      if (!device) return;
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 50);
        for (const msg of msgs) {
          setRxMessages((prev) => [
            ...prev.slice(-499),
            { channelId, msg, receivedAt: Date.now() },
          ]);
        }
      } catch {
        // ERR_BUFFER_EMPTY is expected
      }
    }, 100);
    pollTimers.current.set(channelId, timer);
    setPolling((prev) => new Set(prev).add(channelId));
    log("info", `Started RX polling on CH${channelId}`);
  };

  const stopPolling = (channelId: number) => {
    const timer = pollTimers.current.get(channelId);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(channelId);
    }
    setPolling((prev) => {
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
    log("info", `Stopped RX polling on CH${channelId}`);
  };

  const stopAllPolling = () => {
    for (const [chId] of pollTimers.current) {
      stopPolling(chId);
    }
  };

  const sendTxMessage = async () => {
    if (!device || channels.length === 0 || !txInput.trim()) return;
    const ch = channels[monitorChannelIdx % channels.length];
    try {
      const bytes = txInput
        .trim()
        .split(/[\s,]+/)
        .map((b) => parseInt(b, 16));
      const msg: PassThruMsg = {
        protocolId: ch.protocol,
        rxStatus: 0,
        txFlags: 0,
        timestamp: 0,
        dataSize: bytes.length,
        extraDataIndex: bytes.length,
        data: new Uint8Array(bytes),
      };
      await device.passThruWriteMsgs(ch.id, [msg], 1000);
      log("info", `Sent ${bytes.length} bytes on CH${ch.id}`);
      setTxInput("");
      setTxEditing(false);
    } catch (e: any) {
      log("error", `TX failed: ${e.message}`);
    }
  };

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      for (const [, timer] of pollTimers.current) {
        clearInterval(timer);
      }
    };
  }, []);

  // Auto-connect on startup
  useEffect(() => {
    connect();
  }, []);

  // Keyboard handling
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      disconnect().then(() => exit());
      return;
    }

    // Tab switching
    const tabMatch = TABS.find((t) => t.key === input);
    if (tabMatch) {
      setTab(tabMatch.id);
      if (tabMatch.id === "io" && connected) {
        setTimeout(() => readSelectedPinVoltage(), 0);
      }
      return;
    }

    if (!connected) return;

    // Global shortcuts
    if (input === "r" && tab === "info") {
      refreshVoltages();
      return;
    }

    // IO tab controls
    if (tab === "io") {
      if (key.upArrow) {
        const newIdx = Math.max(0, ioPinIdx - 1);
        setIoPinIdx(newIdx);
        setIoPinReadMv(null);
        readSelectedPinVoltage(newIdx);
      }
      if (key.downArrow) {
        const newIdx = Math.min(IO_PINS.length - 1, ioPinIdx + 1);
        setIoPinIdx(newIdx);
        setIoPinReadMv(null);
        readSelectedPinVoltage(newIdx);
      }
      if (input === "r") readSelectedPinVoltage();
      if (input === "v") setIoMode("voltage");
      if (input === "o") setIoMode("off");
      if (input === "g") setIoMode("ground");
      if (input === "+" || input === "=")
        setIoVoltage((v) => Math.min(25000, v + 500));
      if (input === "-")
        setIoVoltage((v) => Math.max(0, v - 500));
      if (key.return) applyIo();
      return;
    }

    // Channels tab controls
    if (tab === "channels") {
      if (key.upArrow) setProtoIdx((i) => Math.max(0, i - 1));
      if (key.downArrow)
        setProtoIdx((i) => Math.min(PROTOCOLS.length - 1, i + 1));
      if (input === "o") openChannel();
      if (input === "x" && channels.length > 0)
        closeChannel(channels[channels.length - 1].id);
      return;
    }

    // Config tab controls
    if (tab === "config") {
      if (key.return) readConfig();
      return;
    }

    // Init tab controls
    if (tab === "init") {
      if (input === "f") setInitType("fast");
      if (input === "b") setInitType("fivebaud");
      if (key.leftArrow) setInitChannelIdx((i) => Math.max(0, i - 1));
      if (key.rightArrow) setInitChannelIdx((i) => Math.min(channels.length - 1, i + 1));
      if (key.return) {
        if (initType === "fast") runFastInit();
        else runFiveBaudInit();
      }
      return;
    }

    // Monitor tab controls
    if (tab === "monitor") {
      if (txEditing) {
        // In TX editing mode, capture text input
        if (key.return) {
          sendTxMessage();
          return;
        }
        if (key.escape) {
          setTxEditing(false);
          return;
        }
        if (key.backspace || key.delete) {
          setTxInput((prev) => prev.slice(0, -1));
          return;
        }
        // Accept hex chars and spaces
        if (/^[0-9a-fA-F\s,]$/.test(input)) {
          setTxInput((prev) => prev + input);
        }
        return;
      }
      if (input === "s" && channels.length > 0) {
        const ch = channels[monitorChannelIdx % channels.length];
        if (polling.has(ch.id)) stopPolling(ch.id);
        else startPolling(ch.id);
      }
      if (input === "c") {
        setRxMessages([]);
        log("info", "Cleared message buffer");
      }
      if (input === "t") {
        setTxEditing(true);
      }
      if (key.leftArrow) setMonitorChannelIdx((i) => Math.max(0, i - 1));
      if (key.rightArrow) setMonitorChannelIdx((i) => Math.min(channels.length - 1, i + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          J2534 Inspector
        </Text>
        <Text> </Text>
        {connected ? (
          <Text color="green" bold>
            CONNECTED
          </Text>
        ) : connecting ? (
          <Text color="yellow">Connecting...</Text>
        ) : (
          <Text color="red">DISCONNECTED</Text>
        )}
        {connected && (
          <>
            <Text> </Text>
            <Text dimColor>({transportType})</Text>
          </>
        )}
        {version && (
          <>
            <Text> </Text>
            <Text dimColor>FW: {version.firmwareVersion}</Text>
          </>
        )}
      </Box>

      {/* Tab bar */}
      <Box gap={1} paddingX={1} marginY={0}>
        {TABS.map((t) => (
          <Text
            key={t.id}
            color={tab === t.id ? "cyan" : "gray"}
            bold={tab === t.id}
            underline={tab === t.id}
          >
            [{t.key}] {t.label}
          </Text>
        ))}
        <Text dimColor> q:quit</Text>
      </Box>

      {/* Tab content */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={0}
        minHeight={12}
      >
        {tab === "info" && (
          <InfoTab
            version={version}
            batteryMv={batteryMv}
            progMv={progMv}
            channels={channels}
            connected={connected}
          />
        )}
        {tab === "io" && (
          <IoTab
            pinIdx={ioPinIdx}
            mode={ioMode}
            voltage={ioVoltage}
            connected={connected}
            pinReadMv={ioPinReadMv}
            pinStates={pinStates}
          />
        )}
        {tab === "channels" && (
          <ChannelsTab
            protoIdx={protoIdx}
            channels={channels}
            connected={connected}
          />
        )}
        {tab === "config" && (
          <ConfigTab
            results={configResults}
            connected={connected}
            hasChannel={channels.length > 0}
          />
        )}
        {tab === "init" && (
          <InitTab
            initType={initType}
            channels={channels}
            channelIdx={initChannelIdx}
            result={initResult}
            connected={connected}
          />
        )}
        {tab === "monitor" && (
          <MonitorTab
            channels={channels}
            channelIdx={monitorChannelIdx}
            rxMessages={rxMessages}
            polling={polling}
            txInput={txInput}
            txEditing={txEditing}
            connected={connected}
          />
        )}
      </Box>

      {/* Error display */}
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Log panel */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        height={6}
      >
        <Text bold dimColor>
          Log
        </Text>
        {logs.slice(-4).map((entry, i) => (
          <Text key={i}>
            <Text dimColor>{entry.time} </Text>
            <Text
              color={
                entry.level === "error"
                  ? "red"
                  : entry.level === "warn"
                    ? "yellow"
                    : "white"
              }
            >
              {entry.message}
            </Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// ─── Tab Components ────────────────────────────────────────────────

function InfoTab({
  version,
  batteryMv,
  progMv,
  channels,
  connected,
}: {
  version: VersionInfo | null;
  batteryMv: number | null;
  progMv: number | null;
  channels: ChannelEntry[];
  connected: boolean;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device to view information.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Version</Text>
        <Row label="Firmware" value={version?.firmwareVersion ?? "---"} />
        <Row label="DLL" value={version?.dllVersion ?? "---"} />
        <Row label="API" value={version?.apiVersion ?? "---"} />
      </Box>

      <Box flexDirection="column">
        <Text bold>
          Voltages <Text dimColor>(r: refresh)</Text>
        </Text>
        <Row
          label="Battery (Pin 16)"
          value={batteryMv != null ? `${(batteryMv / 1000).toFixed(2)}V` : "---"}
        />
        <Row
          label="Programming (Pin 2)"
          value={progMv != null ? `${(progMv / 1000).toFixed(2)}V` : "---"}
        />
      </Box>

      <Box flexDirection="column">
        <Text bold>Active Channels</Text>
        {channels.length === 0 ? (
          <Text dimColor> No channels open.</Text>
        ) : (
          channels.map((ch) => (
            <Row
              key={ch.id}
              label={`CH${ch.id}: ${ch.label}`}
              value={`${ch.baudRate} baud`}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function IoTab({
  pinIdx,
  mode,
  voltage,
  connected,
  pinReadMv,
  pinStates,
}: {
  pinIdx: number;
  mode: "voltage" | "off" | "ground";
  voltage: number;
  connected: boolean;
  pinReadMv: number | null;
  pinStates: Map<number, { mode: "voltage" | "off" | "ground"; voltage: number }>;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device to control I/O pins.</Text>;
  }

  const formatPinState = (pin: number): string => {
    const state = pinStates.get(pin);
    if (!state) return "";
    switch (state.mode) {
      case "voltage":
        return `SET ${(state.voltage / 1000).toFixed(2)}V`;
      case "off":
        return "OFF";
      case "ground":
        return "GND";
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          Pin Selection <Text dimColor>(Up/Down arrows, r: read)</Text>
        </Text>
        {IO_PINS.map((p, i) => {
          const stateLabel = formatPinState(p.pin);
          return (
            <Text key={p.name}>
              <Text color={i === pinIdx ? "cyan" : "white"}>
                {i === pinIdx ? " > " : "   "}
                {p.name}
              </Text>
              {i === pinIdx && pinReadMv != null && (
                <Text color="green"> = {(pinReadMv / 1000).toFixed(2)}V</Text>
              )}
              {stateLabel && (
                <Text color={
                  pinStates.get(p.pin)?.mode === "ground" ? "red" :
                  pinStates.get(p.pin)?.mode === "off" ? "yellow" : "blue"
                }> [{stateLabel}]</Text>
              )}
            </Text>
          );
        })}
      </Box>

      <Box flexDirection="column">
        <Text bold>Mode</Text>
        <Box gap={2}>
          <Text color={mode === "voltage" ? "cyan" : "gray"}>
            [v] Voltage
          </Text>
          <Text color={mode === "off" ? "yellow" : "gray"}>
            [o] Off
          </Text>
          <Text color={mode === "ground" ? "red" : "gray"}>
            [g] Ground
          </Text>
        </Box>
      </Box>

      {mode === "voltage" && (
        <Box flexDirection="column">
          <Text bold>
            Voltage: {(voltage / 1000).toFixed(2)}V{" "}
            <Text dimColor>(+/-: adjust 500mV)</Text>
          </Text>
        </Box>
      )}

      <Text dimColor>
        Press Enter to apply{" "}
        {mode === "voltage"
          ? `${(voltage / 1000).toFixed(2)}V to ${IO_PINS[pinIdx].name}`
          : mode === "off"
            ? `OFF to ${IO_PINS[pinIdx].name}`
            : `SHORT TO GROUND on ${IO_PINS[pinIdx].name}`}
      </Text>

      {mode === "ground" && (
        <Text color="yellow" bold>
          WARNING: Shorting pins can damage connected hardware!
        </Text>
      )}
    </Box>
  );
}

function ChannelsTab({
  protoIdx,
  channels,
  connected,
}: {
  protoIdx: number;
  channels: ChannelEntry[];
  connected: boolean;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device to manage channels.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          Open Channel <Text dimColor>(Up/Down, o: open)</Text>
        </Text>
        {PROTOCOLS.map((p, i) => (
          <Text key={p.label}>
            <Text color={i === protoIdx ? "cyan" : "white"}>
              {i === protoIdx ? " > " : "   "}
              {p.label} ({p.defaultBaud} baud)
            </Text>
          </Text>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text bold>
          Active Channels <Text dimColor>(x: close last)</Text>
        </Text>
        {channels.length === 0 ? (
          <Text dimColor> No channels open.</Text>
        ) : (
          channels.map((ch) => (
            <Text key={ch.id}>
              {"   "}CH{ch.id}: {ch.label} @ {ch.baudRate} baud
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

function ConfigTab({
  results,
  connected,
  hasChannel,
}: {
  results: { param: string; value: number }[];
  connected: boolean;
  hasChannel: boolean;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device to read configuration.</Text>;
  }
  if (!hasChannel) {
    return <Text dimColor>Open a channel first to read configuration.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        Configuration <Text dimColor>(Enter: read from CH)</Text>
      </Text>
      {results.length === 0 ? (
        <Text dimColor> Press Enter to read config parameters.</Text>
      ) : (
        results.map((r, i) => (
          <Row key={i} label={r.param} value={String(r.value)} />
        ))
      )}
    </Box>
  );
}

function InitTab({
  initType,
  channels,
  channelIdx,
  result,
  connected,
}: {
  initType: InitType;
  channels: ChannelEntry[];
  channelIdx: number;
  result: string | null;
  connected: boolean;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device to use diagnostic init.</Text>;
  }
  if (channels.length === 0) {
    return <Text dimColor>Open an ISO 9141 or ISO 14230 channel first.</Text>;
  }

  const ch = channels[channelIdx % channels.length];

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          Channel <Text dimColor>(Left/Right to select)</Text>
        </Text>
        <Text>
          {"   "}CH{ch.id}: {ch.label} @ {ch.baudRate} baud
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Init Type</Text>
        <Box gap={2}>
          <Text color={initType === "fast" ? "cyan" : "gray"}>
            [f] Fast Init (ISO 14230)
          </Text>
          <Text color={initType === "fivebaud" ? "cyan" : "gray"}>
            [b] 5-Baud Init (ISO 9141)
          </Text>
        </Box>
      </Box>

      {initType === "fast" ? (
        <Box flexDirection="column">
          <Text dimColor>
            Sends StartCommunication (C1 33 F1 81) via fast init wakeup
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            Sends target address 0x33 at 5 baud, waits for keyword response (~5s)
          </Text>
        </Box>
      )}

      <Text dimColor>Press Enter to execute</Text>

      {result && (
        <Text color={result.startsWith("Error") ? "red" : "green"}>
          {result}
        </Text>
      )}
    </Box>
  );
}

function MonitorTab({
  channels,
  channelIdx,
  rxMessages,
  polling,
  txInput,
  txEditing,
  connected,
}: {
  channels: ChannelEntry[];
  channelIdx: number;
  rxMessages: RxEntry[];
  polling: Set<number>;
  txInput: string;
  txEditing: boolean;
  connected: boolean;
}) {
  if (!connected) {
    return <Text dimColor>Connect a device and open a channel to monitor messages.</Text>;
  }
  if (channels.length === 0) {
    return <Text dimColor>Open a channel first.</Text>;
  }

  const ch = channels[channelIdx % channels.length];
  const isPolling = polling.has(ch.id);

  const formatHex = (msg: PassThruMsg): string =>
    Array.from(msg.data.subarray(0, msg.dataSize))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");

  const formatTs = (msg: PassThruMsg): string =>
    msg.timestamp === 0 ? "---" : `${(msg.timestamp / 1000).toFixed(1)}ms`;

  // Show last 10 messages for the selected channel
  const filtered = rxMessages
    .filter((m) => m.channelId === ch.id)
    .slice(-10);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          Channel <Text dimColor>(Left/Right to select)</Text>
        </Text>
        <Text>
          {"   "}CH{ch.id}: {ch.label}{" "}
          <Text color={isPolling ? "green" : "gray"}>
            {isPolling ? "[POLLING]" : "[STOPPED]"}
          </Text>
        </Text>
      </Box>

      <Box gap={2}>
        <Text color="cyan">[s] {isPolling ? "Stop" : "Start"} RX</Text>
        <Text color="cyan">[c] Clear ({rxMessages.length})</Text>
        <Text color="cyan">[t] TX Send</Text>
      </Box>

      {/* Message table */}
      <Box flexDirection="column">
        <Text bold>
          Messages <Text dimColor>(last 10)</Text>
        </Text>
        <Box>
          <Box width={8}><Text dimColor>CH</Text></Box>
          <Box width={12}><Text dimColor>Time</Text></Box>
          <Box width={6}><Text dimColor>Len</Text></Box>
          <Text dimColor>Data</Text>
        </Box>
        {filtered.length === 0 ? (
          <Text dimColor>   No messages yet.</Text>
        ) : (
          filtered.map((entry, i) => (
            <Box key={i}>
              <Box width={8}><Text color="gray">{entry.channelId}</Text></Box>
              <Box width={12}><Text color="gray">{formatTs(entry.msg)}</Text></Box>
              <Box width={6}><Text color="gray">{entry.msg.dataSize}</Text></Box>
              <Text color="green">{formatHex(entry.msg)}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* TX input */}
      {txEditing ? (
        <Box>
          <Text color="yellow">TX&gt; </Text>
          <Text>{txInput}</Text>
          <Text dimColor>_</Text>
          <Text dimColor>  (Enter: send, Esc: cancel)</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ─── Shared Components ─────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text>{"   "}</Text>
      <Box width={25}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

// ─── Entry Point ───────────────────────────────────────────────────

import { Command } from "commander";

const program = new Command()
  .name("j2534-inspector")
  .description("TUI inspector for J2534 / Tactrix OpenPort 2.0 devices")
  .option("-p, --port <path>", "Serial port path (e.g. /dev/cu.usbmodemXXXX)")
  .option("-u, --usb", "Force USB transport (requires sudo on macOS)")
  .parse();

const opts = program.opts();

render(<App serialPort={opts.port} forceUsb={opts.usb ?? false} />);
