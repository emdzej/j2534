/**
 * BMW MS43 DS2 TUI — Full-screen diagnostic interface
 *
 * Two-panel layout with job list on the left, output on the right.
 * Persistent connection, modal dialogs for arguments, watch mode.
 *
 * Usage:
 *   pnpm tui                    # Auto-detect transport
 *   pnpm tui -- -u              # Force USB transport
 *   pnpm tui -- -p /dev/cu.xxx  # Specific serial port
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { Command } from "commander";
import {
  Protocol,
  FilterType,
  ConfigParam,
  IoctlId,
} from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { SerialTransport } from "@emdzej/j2534-serial";
import { NodeUsbTransport } from "@emdzej/j2534-usb";
import {
  JOB_REGISTRY,
  getCategories,
  type JobEntry,
  type JobResult,
  type JobArg,
} from "./job-registry.js";
import { parseDS2Response, DS2_ACK, type DS2Response } from "./ms43-jobs.js";

// ─── DS2 Constants ────────────────────────────────────────────────

const DS2_ECU_ADDRESS = 0x12;
const PARITY_EVEN = 2;

// ─── Helpers ──────────────────────────────────────────────────────

function formatHex(data: Uint8Array | number[], len?: number): string {
  const arr = data instanceof Uint8Array ? Array.from(data) : data;
  return arr
    .slice(0, len ?? arr.length)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Connection State ─────────────────────────────────────────────

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

interface AppState {
  connState: ConnectionState;
  transportType: string;
  firmware: string;
  voltage: string;
  channelId: number | null;
  error: string | null;
}

// ─── Modal State ──────────────────────────────────────────────────

interface ModalState {
  visible: boolean;
  job: JobEntry | null;
  argValues: Record<string, string>;
  focusedArg: number;
  editing: boolean;
  editBuffer: string;
}

// ─── Watch State ──────────────────────────────────────────────────

interface WatchState {
  active: boolean;
  intervalMs: number;
  count: number;
}

// ─── Main App ─────────────────────────────────────────────────────

function App({
  serialPort,
  forceUsb,
}: {
  serialPort?: string;
  forceUsb: boolean;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const termWidth = stdout?.columns ?? 120;
  const termHeight = stdout?.rows ?? 40;

  const leftWidth = Math.max(35, Math.min(45, Math.floor(termWidth * 0.35)));
  const rightWidth = termWidth - leftWidth - 4; // borders

  // ─── State ──────────────────────────────────────────────────────

  const [app, setApp] = useState<AppState>({
    connState: "disconnected",
    transportType: "",
    firmware: "",
    voltage: "",
    channelId: null,
    error: null,
  });

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [result, setResult] = useState<JobResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [lastExecTime, setLastExecTime] = useState<number | null>(null);

  const [modal, setModal] = useState<ModalState>({
    visible: false,
    job: null,
    argValues: {},
    focusedArg: 0,
    editing: false,
    editBuffer: "",
  });

  const [watch, setWatch] = useState<WatchState>({
    active: false,
    intervalMs: 500,
    count: 0,
  });

  const [statusMsg, setStatusMsg] = useState("");

  const deviceRef = useRef<J2534Device | null>(null);
  const channelRef = useRef<number | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Categories for display ─────────────────────────────────────

  const categories = getCategories();

  // Build flat list with category headers
  type ListItem =
    | { type: "category"; name: string }
    | { type: "job"; job: JobEntry; globalIdx: number };

  const listItems: ListItem[] = [];
  let jobIdx = 0;
  for (const cat of categories) {
    listItems.push({ type: "category", name: cat });
    for (const job of JOB_REGISTRY.filter((j) => j.category === cat)) {
      listItems.push({ type: "job", job, globalIdx: jobIdx++ });
    }
  }

  // Map selectedIdx (job-only) to listItems index
  const jobOnlyItems = listItems.filter(
    (i): i is Extract<ListItem, { type: "job" }> => i.type === "job"
  );
  const selectedJob = jobOnlyItems[selectedIdx]?.job ?? null;

  // Visible list height (content area minus top bar, bottom bar, borders)
  const visibleListHeight = termHeight - 6;

  // ─── Connection ─────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setApp((s) => ({ ...s, connState: "connecting", error: null }));
    setStatusMsg("Connecting...");

    let device: J2534Device;
    let transport = "serial";

    try {
      if (forceUsb) {
        transport = "usb";
        device = new J2534Device({ transport: new NodeUsbTransport() });
      } else {
        try {
          device = new J2534Device({
            transport: new SerialTransport(serialPort),
          });
        } catch {
          transport = "usb";
          device = new J2534Device({ transport: new NodeUsbTransport() });
        }
      }

      await device.passThruOpen();
      const version = await device.passThruReadVersion();

      // Read battery voltage
      let voltStr = "---";
      try {
        const mv = (await device.passThruIoctl(
          0,
          IoctlId.READ_VBATT
        )) as number;
        voltStr = `${(mv / 1000).toFixed(1)}V`;
      } catch {}

      // Open ISO9141 channel at 9600 baud for DS2
      const flags = 0x0200; // ISO9141_NO_CHECKSUM
      const chId = await device.passThruConnect(
        Protocol.ISO9141,
        flags,
        9600
      );

      // Configure DS2: 8E1
      await device.passThruIoctl(chId, IoctlId.SET_CONFIG, [
        { parameter: ConfigParam.PARITY, value: PARITY_EVEN },
        { parameter: ConfigParam.DATA_BITS, value: 0 },
        { parameter: ConfigParam.P1_MAX, value: 1 },
        { parameter: ConfigParam.P3_MIN, value: 1 },
        { parameter: ConfigParam.P4_MIN, value: 0 },
        { parameter: ConfigParam.LOOPBACK, value: 1 },
      ]);

      // Pass-all filter
      const mask = createMsg(Protocol.ISO9141, [0x00]);
      const pattern = createMsg(Protocol.ISO9141, [0x00]);
      await device.passThruStartMsgFilter(
        chId,
        FilterType.PASS_FILTER,
        mask,
        pattern
      );

      deviceRef.current = device;
      channelRef.current = chId;

      setApp({
        connState: "connected",
        transportType: transport,
        firmware: version.firmwareVersion,
        voltage: voltStr,
        channelId: chId,
        error: null,
      });
      setStatusMsg("Connected. DS2 channel open (9600/8E1).");
    } catch (e: any) {
      setApp((s) => ({
        ...s,
        connState: "error",
        error: e.message,
      }));
      setStatusMsg(`Connection failed: ${e.message}`);
    }
  }, [forceUsb, serialPort]);

  const disconnect = useCallback(async () => {
    stopWatch();
    const device = deviceRef.current;
    const chId = channelRef.current;
    if (device) {
      try {
        if (chId !== null) await device.passThruDisconnect(chId);
        await device.passThruClose();
      } catch {}
    }
    deviceRef.current = null;
    channelRef.current = null;
    setApp({
      connState: "disconnected",
      transportType: "",
      firmware: "",
      voltage: "",
      channelId: null,
      error: null,
    });
    setStatusMsg("Disconnected.");
  }, []);

  // ─── DS2 Send/Receive ───────────────────────────────────────────

  const ds2Execute = useCallback(
    async (cmd: number[]): Promise<DS2Response | null> => {
      const device = deviceRef.current;
      const chId = channelRef.current;
      if (!device || chId === null) return null;

      const msg = createMsg(Protocol.ISO9141, cmd);
      await device.passThruWriteMsgs(chId, [msg], 1000);

      await sleep(200);

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const msgs = await device.passThruReadMsgs(chId, 1, 500);
          for (const rxMsg of msgs) {
            const parsed = parseDS2Response(rxMsg.data, rxMsg.dataSize);
            if (parsed) {
              // Skip echo
              if (
                parsed.raw.length === cmd.length &&
                parsed.raw.every((b, i) => b === cmd[i])
              ) {
                continue;
              }
              return parsed;
            }
          }
        } catch {}
        await sleep(100);
      }
      return null;
    },
    []
  );

  // ─── Job Execution ──────────────────────────────────────────────

  const executeJob = useCallback(
    async (job: JobEntry, args: Record<string, string>) => {
      setExecuting(true);
      setStatusMsg(`Executing: ${job.name}...`);
      const startTime = Date.now();

      try {
        const cmd = job.build(args);
        const resp = await ds2Execute(cmd);

        if (resp) {
          const formatted = job.format(resp);
          setResult(formatted);
          setLastExecTime(Date.now() - startTime);
          setStatusMsg(
            `${job.name}: ${formatted.success ? "OK" : "NAK"} (${Date.now() - startTime}ms)`
          );

          // Refresh voltage after any command
          try {
            const mv = (await deviceRef.current?.passThruIoctl(
              0,
              IoctlId.READ_VBATT
            )) as number;
            setApp((s) => ({
              ...s,
              voltage: `${(mv / 1000).toFixed(1)}V`,
            }));
          } catch {}
        } else {
          setResult({
            success: false,
            ack: 0,
            fields: [{ label: "Error", value: "No response from ECU" }],
            rawHex: formatHex(cmd),
          });
          setLastExecTime(Date.now() - startTime);
          setStatusMsg(`${job.name}: No response (${Date.now() - startTime}ms)`);
        }
      } catch (e: any) {
        setResult({
          success: false,
          ack: 0,
          fields: [{ label: "Error", value: e.message }],
          rawHex: "",
        });
        setStatusMsg(`${job.name}: Error - ${e.message}`);
      }

      setExecuting(false);
    },
    [ds2Execute]
  );

  // ─── Watch Mode ─────────────────────────────────────────────────

  const startWatch = useCallback(
    (job: JobEntry, args: Record<string, string>) => {
      stopWatch();
      setWatch({ active: true, intervalMs: 500, count: 0 });

      // Execute immediately
      executeJob(job, args);

      const timer = setInterval(() => {
        setWatch((w) => ({ ...w, count: w.count + 1 }));
        executeJob(job, args);
      }, 500);

      watchTimerRef.current = timer;
    },
    [executeJob]
  );

  const stopWatch = useCallback(() => {
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    setWatch({ active: false, intervalMs: 500, count: 0 });
  }, []);

  // ─── Auto-connect ───────────────────────────────────────────────

  useEffect(() => {
    connect();
    return () => {
      if (watchTimerRef.current) clearInterval(watchTimerRef.current);
    };
  }, []);

  // ─── Modal Helpers ──────────────────────────────────────────────

  const openModal = useCallback((job: JobEntry) => {
    const defaults: Record<string, string> = {};
    for (const arg of job.args) {
      defaults[arg.name] = arg.default ?? "";
    }
    setModal({
      visible: true,
      job,
      argValues: defaults,
      focusedArg: 0,
      editing: false,
      editBuffer: "",
    });
  }, []);

  const closeModal = useCallback(() => {
    setModal((m) => ({ ...m, visible: false, job: null }));
  }, []);

  const submitModal = useCallback(() => {
    if (!modal.job) return;
    const job = modal.job;
    const args = { ...modal.argValues };
    closeModal();
    executeJob(job, args);
  }, [modal, executeJob, closeModal]);

  // ─── Keyboard Input ─────────────────────────────────────────────

  useInput((input, key) => {
    // Modal mode
    if (modal.visible) {
      if (modal.editing) {
        // Editing a field
        if (key.return) {
          // Save value
          const arg = modal.job!.args[modal.focusedArg];
          setModal((m) => ({
            ...m,
            argValues: { ...m.argValues, [arg.name]: m.editBuffer },
            editing: false,
          }));
          return;
        }
        if (key.escape) {
          setModal((m) => ({ ...m, editing: false }));
          return;
        }
        if (key.backspace || key.delete) {
          setModal((m) => ({
            ...m,
            editBuffer: m.editBuffer.slice(0, -1),
          }));
          return;
        }
        // Accept text input
        if (input && input.length === 1) {
          setModal((m) => ({ ...m, editBuffer: m.editBuffer + input }));
        }
        return;
      }

      // Modal navigation
      if (key.escape || input === "q") {
        closeModal();
        return;
      }
      if (key.return) {
        const arg = modal.job?.args[modal.focusedArg];
        if (!arg) {
          submitModal();
          return;
        }

        if (arg.type === "boolean") {
          // Toggle boolean
          const current = modal.argValues[arg.name];
          setModal((m) => ({
            ...m,
            argValues: {
              ...m.argValues,
              [arg.name]: current === "true" ? "false" : "true",
            },
          }));
          return;
        }
        if (arg.type === "select") {
          // Cycle select options
          const opts = arg.options ?? [];
          const curIdx = opts.findIndex(
            (o) => o.value === modal.argValues[arg.name]
          );
          const nextIdx = (curIdx + 1) % opts.length;
          setModal((m) => ({
            ...m,
            argValues: { ...m.argValues, [arg.name]: opts[nextIdx].value },
          }));
          return;
        }
        // Start editing for number/hex
        setModal((m) => ({
          ...m,
          editing: true,
          editBuffer: m.argValues[arg.name] ?? "",
        }));
        return;
      }
      if (key.upArrow) {
        setModal((m) => ({
          ...m,
          focusedArg: Math.max(0, m.focusedArg - 1),
        }));
        return;
      }
      if (key.downArrow) {
        setModal((m) => ({
          ...m,
          focusedArg: Math.min(
            (m.job?.args.length ?? 1) - 1,
            m.focusedArg + 1
          ),
        }));
        return;
      }
      // Tab to submit
      if (key.tab) {
        submitModal();
        return;
      }
      return;
    }

    // Global keys
    if (input === "q" || (key.ctrl && input === "c")) {
      disconnect().then(() => exit());
      return;
    }

    if (app.connState !== "connected") {
      if (input === "r") connect();
      return;
    }

    // Watch mode — Escape to stop
    if (watch.active) {
      if (key.escape || input === "w") {
        stopWatch();
        setStatusMsg("Watch stopped.");
        return;
      }
      return;
    }

    // Navigation
    if (key.upArrow || input === "k") {
      setSelectedIdx((i) => Math.max(0, i - 1));
      // Adjust scroll
      const newIdx = Math.max(0, selectedIdx - 1);
      if (newIdx < scrollOffset) setScrollOffset(newIdx);
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIdx((i) => Math.min(jobOnlyItems.length - 1, i + 1));
      const newIdx = Math.min(jobOnlyItems.length - 1, selectedIdx + 1);
      if (newIdx >= scrollOffset + visibleListHeight - 2) {
        setScrollOffset(newIdx - visibleListHeight + 3);
      }
      return;
    }

    // Page up/down
    if (key.pageUp) {
      setSelectedIdx((i) => Math.max(0, i - 10));
      setScrollOffset((o) => Math.max(0, o - 10));
      return;
    }
    if (key.pageDown) {
      setSelectedIdx((i) => Math.min(jobOnlyItems.length - 1, i + 10));
      setScrollOffset((o) =>
        Math.min(jobOnlyItems.length - visibleListHeight, o + 10)
      );
      return;
    }

    // Home/End (g/G vim-style)
    if (input === "g") {
      setSelectedIdx(0);
      setScrollOffset(0);
      return;
    }
    if (input === "G") {
      setSelectedIdx(jobOnlyItems.length - 1);
      setScrollOffset(Math.max(0, jobOnlyItems.length - visibleListHeight));
      return;
    }

    // Execute
    if (key.return) {
      if (!selectedJob || executing) return;
      if (selectedJob.args.length > 0) {
        openModal(selectedJob);
      } else {
        executeJob(selectedJob, {});
      }
      return;
    }

    // Watch mode
    if (input === "w") {
      if (!selectedJob || !selectedJob.watchable || executing) return;
      if (selectedJob.args.length > 0) {
        // For watchable jobs with args, open modal — user submits, then we'd need watch
        // For now, just execute with defaults
        const defaults: Record<string, string> = {};
        for (const arg of selectedJob.args) {
          defaults[arg.name] = arg.default ?? "";
        }
        startWatch(selectedJob, defaults);
      } else {
        startWatch(selectedJob, {});
      }
      return;
    }

    // Repeat last
    if (input === "r") {
      if (!selectedJob || executing) return;
      if (selectedJob.args.length > 0) {
        // Use last modal values or defaults
        const defaults: Record<string, string> = {};
        for (const arg of selectedJob.args) {
          defaults[arg.name] = arg.default ?? "";
        }
        executeJob(selectedJob, defaults);
      } else {
        executeJob(selectedJob, {});
      }
      return;
    }
  });

  // ─── Render ─────────────────────────────────────────────────────

  // Build visible list items with category headers
  // We need to map job indices to display positions accounting for category headers
  const displayItems: Array<
    | { type: "category"; name: string }
    | { type: "job"; job: JobEntry; selected: boolean; idx: number }
  > = [];

  let currentJobIdx = 0;
  for (const cat of categories) {
    displayItems.push({ type: "category", name: cat });
    for (const job of JOB_REGISTRY.filter((j) => j.category === cat)) {
      displayItems.push({
        type: "job",
        job,
        selected: currentJobIdx === selectedIdx,
        idx: currentJobIdx,
      });
      currentJobIdx++;
    }
  }

  // Simple scroll: calculate which display items to show based on selected job position
  const selectedDisplayIdx = displayItems.findIndex(
    (item) => item.type === "job" && item.selected
  );
  const maxVisible = visibleListHeight - 2;
  let displayStart = 0;
  if (selectedDisplayIdx >= 0) {
    if (selectedDisplayIdx >= displayStart + maxVisible) {
      displayStart = selectedDisplayIdx - maxVisible + 1;
    }
    if (selectedDisplayIdx < displayStart) {
      displayStart = selectedDisplayIdx;
    }
    // Keep scroll offset in bounds
    displayStart = Math.max(
      0,
      Math.min(displayStart, displayItems.length - maxVisible)
    );
  }
  // Use scrollOffset for display offset tracking
  if (scrollOffset > displayStart) displayStart = scrollOffset;

  const visibleItems = displayItems.slice(
    displayStart,
    displayStart + maxVisible
  );

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* ─── Title Bar ─── */}
      <Box
        width={termWidth}
        justifyContent="space-between"
        paddingX={1}
      >
        <Box>
          <Text bold color="cyan">
            MS43 DS2 Diagnostics
          </Text>
        </Box>
        <Box gap={2}>
          {app.connState === "connected" ? (
            <>
              <Text color="green" bold>CONNECTED</Text>
              <Text dimColor>({app.transportType})</Text>
              <Text dimColor>FW: {app.firmware}</Text>
              <Text dimColor>9600/8E1</Text>
              <Text color="yellow">{app.voltage}</Text>
            </>
          ) : app.connState === "connecting" ? (
            <Text color="yellow">Connecting...</Text>
          ) : app.connState === "error" ? (
            <Text color="red">ERROR: {app.error}</Text>
          ) : (
            <Text color="red">DISCONNECTED (r: retry)</Text>
          )}
        </Box>
      </Box>

      {/* ─── Main Content ─── */}
      <Box flexGrow={1}>
        {/* Left Panel — Job List */}
        <Box
          flexDirection="column"
          width={leftWidth}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="cyan" underline>
            Jobs ({jobOnlyItems.length})
          </Text>

          {visibleItems.map((item, i) => {
            if (item.type === "category") {
              return (
                <Text key={`cat-${item.name}-${i}`} bold color="yellow">
                  {item.name}
                </Text>
              );
            }
            const { job, selected } = item;
            const prefix = selected ? " > " : "   ";
            const watchIcon = job.watchable ? " ~" : "";
            return (
              <Text
                key={job.id}
                color={selected ? "cyan" : "white"}
                bold={selected}
                wrap="truncate"
              >
                {prefix}
                {job.name}
                {watchIcon}
              </Text>
            );
          })}
        </Box>

        {/* Right Panel — Output */}
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {/* Job info header */}
          {selectedJob && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="cyan">
                {selectedJob.name}
              </Text>
              <Text dimColor>{selectedJob.description}</Text>
              {selectedJob.args.length > 0 && (
                <Text dimColor>
                  Args: {selectedJob.args.map((a) => a.label).join(", ")}
                </Text>
              )}
            </Box>
          )}

          {/* Execution state */}
          {executing && (
            <Text color="yellow">Executing...</Text>
          )}

          {/* Watch indicator */}
          {watch.active && (
            <Box>
              <Text color="magenta" bold>
                WATCH MODE
              </Text>
              <Text dimColor>
                {" "}
                (poll #{watch.count}, {watch.intervalMs}ms interval, Esc/w to
                stop)
              </Text>
            </Box>
          )}

          {/* Results */}
          {result && (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text bold color={result.success ? "green" : "red"}>
                  {result.success ? "OK" : "FAILED"}
                </Text>
                {lastExecTime !== null && (
                  <Text dimColor> ({lastExecTime}ms)</Text>
                )}
              </Box>

              <Box flexDirection="column" marginTop={1}>
                {result.fields.map((f, i) => (
                  <Box key={i}>
                    <Box width={Math.min(25, Math.floor(rightWidth * 0.4))}>
                      <Text dimColor>{f.label}</Text>
                    </Box>
                    <Text wrap="truncate">{f.value}</Text>
                  </Box>
                ))}
              </Box>

              {result.rawHex && (
                <Box marginTop={1}>
                  <Text dimColor>Raw: {result.rawHex}</Text>
                </Box>
              )}
            </Box>
          )}

          {!result && !executing && (
            <Text dimColor>
              Select a job and press Enter to execute.
            </Text>
          )}
        </Box>
      </Box>

      {/* ─── Modal Dialog ─── */}
      {modal.visible && modal.job && (
        <ModalDialog
          job={modal.job}
          argValues={modal.argValues}
          focusedArg={modal.focusedArg}
          editing={modal.editing}
          editBuffer={modal.editBuffer}
          width={Math.min(60, termWidth - 10)}
        />
      )}

      {/* ─── Status Line ─── */}
      <Box paddingX={1}>
        <Text dimColor>{statusMsg}</Text>
      </Box>

      {/* ─── Bottom Toolbar ─── */}
      <Box
        width={termWidth}
        paddingX={1}
        gap={2}
      >
        <Text color="cyan">Enter</Text>
        <Text dimColor>Execute</Text>
        <Text color="cyan">w</Text>
        <Text dimColor>Watch</Text>
        <Text color="cyan">r</Text>
        <Text dimColor>Repeat</Text>
        <Text color="cyan">Esc</Text>
        <Text dimColor>Stop</Text>
        <Text color="cyan">j/k</Text>
        <Text dimColor>Navigate</Text>
        <Text color="cyan">q</Text>
        <Text dimColor>Quit</Text>
      </Box>
    </Box>
  );
}

// ─── Modal Dialog Component ───────────────────────────────────────

function ModalDialog({
  job,
  argValues,
  focusedArg,
  editing,
  editBuffer,
  width,
}: {
  job: JobEntry;
  argValues: Record<string, string>;
  focusedArg: number;
  editing: boolean;
  editBuffer: string;
  width: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Text bold color="yellow">
        {job.name} - Arguments
      </Text>
      <Text dimColor>{job.description}</Text>

      <Box flexDirection="column" marginTop={1}>
        {job.args.map((arg, i) => {
          const focused = i === focusedArg;
          const value = argValues[arg.name] ?? "";

          let displayValue = value;
          if (arg.type === "boolean") {
            displayValue = value === "true" ? "YES" : "NO";
          } else if (arg.type === "select") {
            const opt = arg.options?.find((o) => o.value === value);
            displayValue = opt?.label ?? value;
          }

          return (
            <Box key={arg.name}>
              <Text color={focused ? "cyan" : "white"}>
                {focused ? " > " : "   "}
              </Text>
              <Box width={20}>
                <Text bold={focused}>{arg.label}</Text>
              </Box>
              {focused && editing ? (
                <Box>
                  <Text color="yellow">{editBuffer}</Text>
                  <Text color="yellow">_</Text>
                </Box>
              ) : (
                <Text color={focused ? "green" : "white"}>
                  {displayValue}
                </Text>
              )}
              {arg.description && focused && !editing && (
                <Text dimColor> ({arg.description})</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter: Edit/Toggle  Tab: Execute  Esc: Cancel
        </Text>
      </Box>
    </Box>
  );
}

// ─── Entry Point ──────────────────────────────────────────────────

const program = new Command()
  .name("ds2-tui")
  .description(
    "Full-screen TUI for BMW MS43 DS2 diagnostics via J2534"
  )
  .option(
    "-p, --port <path>",
    "Serial port path (e.g. /dev/cu.usbmodemXXXX)"
  )
  .option("-u, --usb", "Force USB transport (requires sudo on macOS)")
  .parse();

const opts = program.opts();

render(<App serialPort={opts.port} forceUsb={opts.usb ?? false} />, {
  exitOnCtrlC: false,
});
