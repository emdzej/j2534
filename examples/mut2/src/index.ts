/**
 * Mitsubishi MUT-II Protocol — ECU Diagnostic Tool
 *
 * Communicates with Mitsubishi ECUs (Evo 4-9, 3000GT, Eclipse, etc.) using
 * the MUT-II protocol over K-line via J2534 ISO9141 channel.
 *
 * MUT-II protocol:
 *   - 5-baud init with address byte 0x01 on K-line
 *   - ECU responds with sync bytes: C0 55 EF 85
 *   - Then communicates at 15625 baud, 8N1
 *   - Simple request/response: send 1 byte address, receive 1 byte value
 *   - ECU ID: send 0xFE → 1st byte, send 0xFF → 2nd byte
 *
 * Based on libftdimut by Niall McAndrew (OpenPort 1.3u)
 * and community reverse-engineering (EvoEcu wiki, EvoScan, modifiedmitsubishi).
 *
 * Usage:
 *   pnpm start                    # Auto-detect transport, read ECU ID + basic params
 *   pnpm start -- --ident         # Read ECU identification only
 *   pnpm start -- --live          # Live data polling
 *   pnpm start -- --live --duration 30  # Poll for 30 seconds
 *   pnpm start -- --pids 21,07,17 # Poll specific PIDs only
 *   pnpm start -- -u              # Force USB transport
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  Protocol,
  FilterType,
  ConfigParam,
  IoctlId,
  Pin,
  SHORT_TO_GROUND,
  VOLTAGE_OFF,
} from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { SerialTransport } from "@emdzej/j2534-serial";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

// ─── MUT-II Protocol Constants ────────────────────────────────────

const MUT2_BAUD = 15625;
const MUT2_INIT_ADDR = 0x01; // 5-baud init address byte for ECU

// Expected sync response after 5-baud init
const MUT2_SYNC = [0xc0, 0x55, 0xef, 0x85];

// Special requests
const MUT2_ECU_ID_HI = 0xfe; // First byte of ECU ROM ID
const MUT2_ECU_ID_LO = 0xff; // Second byte of ECU ROM ID

// Fault code requests
const MUT2_FAULTS_LO = 0x38; // Active faults, low byte (bits 0-7)
const MUT2_FAULTS_HI = 0x39; // Active faults, high byte (bits 8-15)
const MUT2_STORED_FAULTS_LO = 0x3b; // Stored faults, low byte
const MUT2_STORED_FAULTS_HI = 0x3c; // Stored faults, high byte
const MUT2_CLEAR_FAULTS = 0xfc; // Clear EFI DTCs (EvoScan XML: 1994-1998 vehicles only)

// ─── MUT-II PID Definitions ──────────────────────────────────────
// Sources: EvoScan DataItems, EvoEcu wiki, libmut, community RE

interface MutPid {
  id: number;
  name: string;
  units: string;
  convert: (raw: number) => number;
  format: number; // decimal places
}

// Formulas from EvoScan "Mitsubishi MUTII EFI" XML definition.
// Metric conversions used where available; imperial-only values noted.
const MUT2_PIDS: MutPid[] = [
  // ── Engine ──────────────────────────────────────────────────────
  { id: 0x21, name: "Engine Speed",       units: "RPM",    convert: (x) => x * 31.25,           format: 0 },
  { id: 0x07, name: "Coolant Temp",       units: "°C",     convert: (x) => x,                   format: 0 },   // raw = °C (metric eval from XML)
  { id: 0x10, name: "Coolant Temp Scaled",units: "°C",     convert: (x) => x - 40,              format: 0 },   // 1998+ vehicles
  { id: 0x3a, name: "Intake Air Temp",    units: "°C",     convert: (x) => x,                   format: 0 },   // raw = °C (metric eval from XML)
  { id: 0x11, name: "MAF Air Temp Scaled",units: "°C",     convert: (x) => x - 40,              format: 0 },   // 1998+ vehicles
  { id: 0x17, name: "Throttle Position",  units: "%",      convert: (x) => x * 100 / 255,       format: 1 },
  { id: 0x14, name: "Battery Voltage",    units: "V",      convert: (x) => x * 0.07333,         format: 1 },
  { id: 0x1a, name: "MAF Sensor",         units: "Hz",     convert: (x) => x * 6.25,            format: 0 },
  { id: 0x1c, name: "ECU Load",           units: "",       convert: (x) => x * 5 / 8,           format: 1 },   // max 160
  { id: 0x2f, name: "Vehicle Speed",      units: "km/h",   convert: (x) => x * 2,               format: 0 },
  { id: 0x29, name: "Injector PW",        units: "ms",     convert: (x) => x * 0.256,           format: 2 },
  { id: 0x06, name: "Timing Advance",     units: "°",      convert: (x) => x - 20,              format: 0 },
  { id: 0x26, name: "Knock Count",        units: "count",  convert: (x) => x,                   format: 0 },   // 1998+ vehicles
  { id: 0x30, name: "Knock Voltage",      units: "V",      convert: (x) => x * 0.0195,          format: 3 },
  { id: 0x13, name: "O2 Sensor (Front)",  units: "V",      convert: (x) => x * 0.01952,         format: 3 },
  { id: 0x3c, name: "O2 Sensor #2",       units: "V",      convert: (x) => x * 0.01952,         format: 3 },
  { id: 0x24, name: "Target Idle RPM",    units: "RPM",    convert: (x) => x * 7.8,             format: 0 },
  { id: 0x16, name: "ISC Steps",          units: "steps",  convert: (x) => x,                   format: 0 },

  // ── Fuel ────────────────────────────────────────────────────────
  { id: 0x0c, name: "Fuel Trim Low",      units: "%",      convert: (x) => 0.1953125 * x - 25,  format: 1 },   // LTFT
  { id: 0x0d, name: "Fuel Trim Mid",      units: "%",      convert: (x) => 0.1953125 * x - 25,  format: 1 },   // LTFT
  { id: 0x0e, name: "Fuel Trim High",     units: "%",      convert: (x) => 0.1953125 * x - 25,  format: 1 },   // LTFT
  { id: 0x50, name: "Fuel Trim InUse",    units: "%",      convert: (x) => 0.1953125 * x - 25,  format: 1 },   // LTFT currently active
  { id: 0x0f, name: "O2 Feedback (STFT)", units: "%",      convert: (x) => 0.1953125 * x - 25,  format: 1 },   // STFT
  { id: 0x32, name: "AFR Map Target",     units: "AFR",    convert: (x) => x > 0 ? (14.7 * 128) / x : 0, format: 1 },

  // ── Pressure / Air ──────────────────────────────────────────────
  { id: 0x15, name: "Barometer",          units: "kPa",    convert: (x) => x * 0.49,            format: 1 },
  { id: 0x38, name: "Boost (MAP)",        units: "PSI",    convert: (x) => x * 0.19348,         format: 1 },   // absolute
  { id: 0x45, name: "MAP Scaled",         units: "kPa",    convert: (x) => x,                   format: 0 },
  { id: 0x1d, name: "Airflow/Rev",        units: "load",   convert: (x) => x * 200 / 255,       format: 1 },
  { id: 0x2c, name: "Air Volume",         units: "",       convert: (x) => x,                   format: 0 },
  { id: 0x44, name: "MAT Scaled",         units: "°C",     convert: (x) => x - 40,              format: 0 },   // manifold air temp
  { id: 0x12, name: "EGR Temperature",    units: "°F",     convert: (x) => -2.7 * x + 597.7,    format: 0 },   // °F only in XML

  // ── Boost Control (1998+) ───────────────────────────────────────
  { id: 0x86, name: "Wastegate Duty",     units: "%",      convert: (x) => x / 2,               format: 1 },
  { id: 0x8a, name: "Load Error",         units: "load",   convert: (x) => 0.15625 * x - 20,    format: 1 },
  { id: 0x8b, name: "WGDC Correction",    units: "%",      convert: (x) => 0.5 * x - 64,        format: 1 },

  // ── Misc ────────────────────────────────────────────────────────
  { id: 0x27, name: "Octane Level",       units: "%",      convert: (x) => x * 100 / 255,       format: 0 },
  { id: 0x79, name: "Injector Latency",   units: "",       convert: (x) => x,                   format: 0 },
  { id: 0x1f, name: "Load 11Bit4",        units: "",       convert: (x) => x,                   format: 0 },
  { id: 0x41, name: "Load 1Byte (mod)",   units: "load",   convert: (x) => x * 1.2,             format: 1 },   // Tephra mod ROM only
];

// ─── MUT-II Fault Code Definitions ───────────────────────────────
// Each bit in the 16-bit fault word corresponds to a DTC

const MUT2_DTC_TABLE: { bit: number; code: number; name: string }[] = [
  { bit: 0,  code: 11, name: "Oxygen sensor" },
  { bit: 1,  code: 12, name: "Intake air flow sensor" },
  { bit: 2,  code: 13, name: "Intake air temperature sensor" },
  { bit: 3,  code: 14, name: "Throttle position sensor" },
  { bit: 4,  code: 15, name: "ISC motor position sensor" },
  { bit: 5,  code: 21, name: "Engine coolant temperature sensor" },
  { bit: 6,  code: 22, name: "Engine speed sensor" },
  { bit: 7,  code: 23, name: "TDC sensor" },
  { bit: 8,  code: 24, name: "Vehicle speed sensor" },
  { bit: 9,  code: 25, name: "Barometric pressure sensor" },
  { bit: 10, code: 31, name: "Knock sensor" },
  { bit: 11, code: 41, name: "Injector circuit" },
  { bit: 12, code: 42, name: "Fuel pump relay" },
  { bit: 13, code: 43, name: "EGR" },
  { bit: 14, code: 44, name: "Ignition coil" },
  { bit: 15, code: 36, name: "Ignition circuit" },
];

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

function decodeFaults(lo: number, hi: number): { code: number; name: string }[] {
  const word = (hi << 8) | lo;
  const faults: { code: number; name: string }[] = [];
  for (const dtc of MUT2_DTC_TABLE) {
    if (word & (1 << dtc.bit)) {
      faults.push({ code: dtc.code, name: dtc.name });
    }
  }
  return faults;
}

// ─── Main ─────────────────────────────────────────────────────────

const program = new Command()
  .name("mut2")
  .description("Mitsubishi MUT-II diagnostic tool via J2534")
  .option("-p, --port <path>", "Serial port path")
  .option("-u, --usb", "Force USB transport")
  .option("--ident", "Read ECU identification only")
  .option("--live", "Live data polling")
  .option("--duration <seconds>", "Polling duration in seconds", "30")
  .option("--pids <list>", "Comma-separated hex PIDs to poll (e.g. 21,07,17)")
  .option("--faults", "Read fault codes")
  .option("--clear-faults", "Clear fault codes")
  .option("--raw <hex>", "Send raw MUT-II request byte (e.g. '21')")
  .option("--pin1-ground", "Pull OBD-II pin 1 to ground (some ECUs require this for diag mode)")
  .parse();

const opts = program.opts();

async function main(): Promise<void> {
  // ─── Connect ──────────────────────────────────────────────────

  let device: J2534Device;
  let transportName: string;

  if (opts.usb) {
    device = new J2534Device({ transport: new NodeUsbTransport() });
    transportName = "usb";
  } else {
    try {
      device = new J2534Device({ transport: new SerialTransport(opts.port) });
      transportName = "serial";
    } catch {
      device = new J2534Device({ transport: new NodeUsbTransport() });
      transportName = "usb";
    }
  }

  console.log(chalk.cyan(`Opening device (${transportName})...`));
  await device.passThruOpen();

  const version = await device.passThruReadVersion();
  console.log(chalk.cyan(`Firmware: ${chalk.bold(version.firmwareVersion)}`));

  // ─── Pin 1 to ground (optional) ────────────────────────────────
  // Some Mitsubishi ECUs require OBD-II pin 1 pulled to ground to
  // enter diagnostic mode. The OpenPort can do this via
  // SetProgrammingVoltage with SHORT_TO_GROUND.

  if (opts.pin1Ground) {
    console.log(chalk.cyan("Pulling pin 1 to ground..."));
    await device.passThruSetProgrammingVoltage(Pin.PIN_1, SHORT_TO_GROUND);
    console.log(chalk.green("Pin 1 grounded."));
  }

  // ─── Open ISO9141 K-line channel at 15625 baud ──────────────

  console.log(chalk.cyan("Opening ISO9141 channel at 15625 baud..."));

  // MUT-II uses no ISO9141 checksum — raw byte protocol
  const flags = 0x0200; // ISO9141_NO_CHECKSUM
  const channelId = await device.passThruConnect(
    Protocol.ISO9141,
    flags,
    MUT2_BAUD
  );
  console.log(chalk.green(`Channel ${channelId} opened.`));

  // Configure for MUT-II: 8N1
  await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
    { parameter: ConfigParam.PARITY, value: 0 },       // No parity
    { parameter: ConfigParam.DATA_BITS, value: 0 },     // 8 bits
    { parameter: ConfigParam.P1_MAX, value: 2 },        // Inter-byte max
    { parameter: ConfigParam.P3_MIN, value: 0 },        // Min time between response and next request
    { parameter: ConfigParam.P4_MIN, value: 0 },        // Inter-byte min
    { parameter: ConfigParam.LOOPBACK, value: 1 },      // Echo TX back
  ]);

  // Pass-all filter
  const mask = createMsg(Protocol.ISO9141, [0x00]);
  const pattern = createMsg(Protocol.ISO9141, [0x00]);
  await device.passThruStartMsgFilter(
    channelId,
    FilterType.PASS_FILTER,
    mask,
    pattern
  );

  console.log(chalk.green("MUT-II channel configured (15625/8N1)."));

  // ─── 5-baud init ─────────────────────────────────────────────

  console.log(chalk.cyan("\nPerforming 5-baud init (address 0x01)..."));

  const initMsg = createMsg(Protocol.ISO9141, [MUT2_INIT_ADDR]);
  const initResp = await device.passThruIoctl(channelId, IoctlId.FIVE_BAUD_INIT, initMsg);

  if (initResp && typeof initResp === "object" && "data" in initResp) {
    const respData = (initResp as { data: Uint8Array; dataSize: number }).data;
    const respSize = (initResp as { dataSize: number }).dataSize;
    console.log(chalk.green(`Init response: ${formatHex(respData, respSize)}`));

    // Verify sync bytes
    const syncOk =
      respSize >= 4 &&
      respData[0] === MUT2_SYNC[0] &&
      respData[1] === MUT2_SYNC[1] &&
      respData[2] === MUT2_SYNC[2] &&
      respData[3] === MUT2_SYNC[3];

    if (syncOk) {
      console.log(chalk.green("Sync OK (C0 55 EF 85)."));
    } else {
      console.log(chalk.yellow("Warning: unexpected sync bytes, continuing anyway."));
    }
  } else {
    console.log(chalk.yellow("No init response data, continuing..."));
  }

  await sleep(100);

  // ─── MUT-II Send/Receive ─────────────────────────────────────

  async function mutRequest(pid: number): Promise<number | null> {
    const msg = createMsg(Protocol.ISO9141, [pid]);
    await device.passThruWriteMsgs(channelId, [msg], 1000);

    // MUT-II: send 1 byte → receive echo (1 byte) + response (1 byte)
    // With LOOPBACK=1 we get our TX echoed back, then ECU response
    await sleep(50);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 500);
        for (const rxMsg of msgs) {
          // Skip echo of our own request
          if (rxMsg.dataSize === 1 && rxMsg.data[0] === pid) {
            continue;
          }
          // Response is 1 byte
          if (rxMsg.dataSize >= 1) {
            return rxMsg.data[rxMsg.dataSize - 1];
          }
        }
      } catch {
        // timeout
      }
      await sleep(20);
    }
    return null;
  }

  // ─── Execute requested commands ───────────────────────────────

  const doIdent = opts.ident || (!opts.live && !opts.faults && !opts.clearFaults && !opts.raw);

  if (doIdent) {
    console.log(chalk.bold("\n═══ ECU Identification ═══"));

    const idHi = await mutRequest(MUT2_ECU_ID_HI);
    const idLo = await mutRequest(MUT2_ECU_ID_LO);

    if (idHi !== null && idLo !== null) {
      const ecuId = (idHi << 8) | idLo;
      console.log(chalk.green(`  ECU ROM ID:  0x${ecuId.toString(16).padStart(4, "0")} (${ecuId})`));
      console.log(chalk.green(`    High byte: 0x${idHi.toString(16).padStart(2, "0")}`));
      console.log(chalk.green(`    Low byte:  0x${idLo.toString(16).padStart(2, "0")}`));
    } else {
      console.log(chalk.red("Failed to read ECU ID."));
    }

    // Read a few basic params as a quick check
    console.log(chalk.bold("\n═══ Quick Status ═══"));
    const quickPids = [0x21, 0x07, 0x17, 0x14];
    for (const pidId of quickPids) {
      const pidDef = MUT2_PIDS.find((p) => p.id === pidId);
      if (!pidDef) continue;
      const raw = await mutRequest(pidId);
      if (raw !== null) {
        const value = pidDef.convert(raw);
        console.log(
          chalk.green(
            `  ${pidDef.name.padEnd(20)} ${value.toFixed(pidDef.format)} ${pidDef.units}  (raw: 0x${raw.toString(16).padStart(2, "0")})`
          )
        );
      } else {
        console.log(chalk.red(`  ${pidDef.name.padEnd(20)} no response`));
      }
    }
  }

  if (opts.faults) {
    console.log(chalk.bold("\n═══ Fault Codes ═══"));

    const activeLo = await mutRequest(MUT2_FAULTS_LO);
    const activeHi = await mutRequest(MUT2_FAULTS_HI);
    const storedLo = await mutRequest(MUT2_STORED_FAULTS_LO);
    const storedHi = await mutRequest(MUT2_STORED_FAULTS_HI);

    if (activeLo !== null && activeHi !== null) {
      const active = decodeFaults(activeLo, activeHi);
      if (active.length === 0) {
        console.log(chalk.green("  No active faults."));
      } else {
        console.log(chalk.yellow(`  ${active.length} active fault(s):`));
        for (const f of active) {
          console.log(chalk.yellow(`    Code ${f.code}: ${f.name}`));
        }
      }
    } else {
      console.log(chalk.red("  Failed to read active faults."));
    }

    if (storedLo !== null && storedHi !== null) {
      const stored = decodeFaults(storedLo, storedHi);
      if (stored.length === 0) {
        console.log(chalk.green("  No stored faults."));
      } else {
        console.log(chalk.yellow(`  ${stored.length} stored fault(s):`));
        for (const f of stored) {
          console.log(chalk.yellow(`    Code ${f.code}: ${f.name}`));
        }
      }
    } else {
      console.log(chalk.red("  Failed to read stored faults."));
    }
  }

  if (opts.clearFaults) {
    console.log(chalk.bold("\n═══ Clear Fault Codes ═══"));
    const resp = await mutRequest(MUT2_CLEAR_FAULTS);
    if (resp !== null && resp === 0x00) {
      console.log(chalk.green("  Fault codes cleared."));
    } else {
      console.log(chalk.red(`  Clear faults response: 0x${resp?.toString(16) ?? "null"}`));
    }
  }

  if (opts.live) {
    console.log(chalk.bold("\n═══ Live Data Polling ═══"));
    const duration = parseInt(opts.duration, 10) * 1000;
    const endTime = Date.now() + duration;
    let pollCount = 0;

    // Determine which PIDs to poll
    let activePids: MutPid[];
    if (opts.pids) {
      const requestedIds = (opts.pids as string)
        .split(",")
        .map((s) => parseInt(s.trim(), 16));
      activePids = requestedIds
        .map((id) => MUT2_PIDS.find((p) => p.id === id))
        .filter((p): p is MutPid => p !== undefined);
      if (activePids.length === 0) {
        console.log(chalk.red("No valid PIDs specified."));
        console.log(chalk.dim("Available: " + MUT2_PIDS.map((p) => `0x${p.id.toString(16)}(${p.name})`).join(", ")));
      }
    } else {
      // Default: RPM, coolant, TPS, battery, timing, knock
      activePids = [0x21, 0x07, 0x17, 0x14, 0x06, 0x26]
        .map((id) => MUT2_PIDS.find((p) => p.id === id))
        .filter((p): p is MutPid => p !== undefined);
    }

    while (Date.now() < endTime && activePids.length > 0) {
      pollCount++;
      const line: string[] = [];
      for (const pid of activePids) {
        const raw = await mutRequest(pid.id);
        if (raw !== null) {
          const value = pid.convert(raw);
          line.push(`${pid.name}: ${value.toFixed(pid.format)}${pid.units}`);
        } else {
          line.push(`${pid.name}: --`);
        }
      }
      process.stdout.write(`\r${chalk.cyan(`#${pollCount}`)} ${line.join("  |  ")}`);
    }
    console.log(chalk.green(`\n${pollCount} polls completed.`));
  }

  if (opts.raw) {
    console.log(chalk.bold("\n═══ Raw MUT-II Request ═══"));
    const pid = parseInt((opts.raw as string).trim(), 16);
    console.log(chalk.yellow(`TX: 0x${pid.toString(16).padStart(2, "0")}`));
    const resp = await mutRequest(pid);
    if (resp !== null) {
      console.log(chalk.green(`RX: 0x${resp.toString(16).padStart(2, "0")} (${resp})`));
    } else {
      console.log(chalk.red("No response."));
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  console.log(chalk.cyan("\nClosing..."));
  if (opts.pin1Ground) {
    console.log(chalk.cyan("Releasing pin 1..."));
    await device.passThruSetProgrammingVoltage(Pin.PIN_1, VOLTAGE_OFF);
  }
  await device.passThruDisconnect(channelId);
  await device.passThruClose();
  console.log(chalk.green("Done."));
}

main().catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
