/**
 * BMW DS2 Protocol — MS43 ECU Diagnostic Tool
 *
 * Communicates with BMW MS43 (Siemens Motronic) ECU using the DS2 protocol
 * over K-line via J2534 ISO9141 channel.
 *
 * DS2 runs at 9600 baud, 8 data bits, even parity, 1 stop bit.
 * No init sequence — just open channel and start sending commands.
 *
 * Usage:
 *   pnpm start                    # Auto-detect transport, run ECU ident
 *   pnpm start -- --ident         # Read ECU identification
 *   pnpm start -- --live          # Live data polling (RPM, temps, etc.)
 *   pnpm start -- --live --duration 30  # Poll for 30 seconds
 *   pnpm start -- -u              # Force USB transport
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  Protocol,
  FilterType,
  ConfigParam,
  IoctlId,
} from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { SerialTransport } from "@emdzej/j2534-serial";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

// ─── DS2 Protocol Constants ───────────────────────────────────────

const DS2_ECU_ADDRESS = 0x12; // DME / Motronic ECU
const DS2_ACK_OK = 0xa0;

const PARITY_EVEN = 2;

// ─── DS2 Command Builders ─────────────────────────────────────────

function ds2Checksum(data: number[]): number {
  let xor = 0;
  for (const b of data) xor ^= b;
  return xor;
}

function ds2BuildCommand(address: number, payload: number[]): number[] {
  // Format: [address] [length] [payload...] [checksum]
  // length = total bytes including address, length, payload, and checksum
  const length = 2 + payload.length + 1; // addr + len + payload + checksum
  const packet = [address, length, ...payload];
  packet.push(ds2Checksum(packet));
  return packet;
}

// Known MS43 commands
const CMD_ECU_IDENT = ds2BuildCommand(DS2_ECU_ADDRESS, [0x00]);
// => [0x12, 0x04, 0x00, 0x16]

const CMD_READ_GENERAL_DATA = ds2BuildCommand(DS2_ECU_ADDRESS, [0x0b, 0x03]);
// => [0x12, 0x05, 0x0B, 0x03, 0x1F]



// ─── DS2 Response Parser ──────────────────────────────────────────

interface DS2Response {
  address: number;
  length: number;
  ack: number;
  payload: Uint8Array;
  checksumOk: boolean;
  raw: Uint8Array;
}

function parseDS2Response(data: Uint8Array, size: number): DS2Response | null {
  if (size < 4) return null; // Minimum: addr + len + ack + checksum

  const address = data[0];
  const length = data[1];

  if (size < length) return null; // Incomplete

  const raw = data.subarray(0, length);
  const ack = data[2];
  const payload = data.subarray(3, length - 1);

  // Verify checksum
  let xor = 0;
  for (let i = 0; i < length - 1; i++) xor ^= data[i];
  const checksumOk = xor === data[length - 1];

  return { address, length, ack, payload: new Uint8Array(payload), checksumOk, raw: new Uint8Array(raw) };
}

// ─── ECU Ident Decoder ────────────────────────────────────────────
// DS2 ECU ident response payload is ASCII-encoded.
// First 7 bytes = ecuId (hardware part number), used by RomRaider for ECU matching.
// Remaining bytes contain software number, coding, and diagnostic info.
// Field offsets based on RomRaider DS2EcuInit and community reverse-engineering.

interface EcuIdent {
  ecuId: string;          // 7 chars — hardware part number (e.g. "7545150")
  hwNumber: string;       // same as ecuId, but labeled clearly
  swNumber: string;       // software/calibration number
  coding: string;         // variant coding
  diagIndex: string;      // diagnostic index
  busIndex: string;       // bus index
  extra: string;          // remaining bytes (dates, ISN, etc.)
  raw: string;            // full payload as ASCII
}

function decodeEcuIdent(payload: Uint8Array): EcuIdent {
  const raw = new TextDecoder().decode(payload);
  const ecuId = raw.substring(0, 7);
  const swNumber = raw.substring(7, 21);
  const coding = raw.substring(21, 25);
  const diagIndex = raw.substring(25, 29);
  const busIndex = raw.substring(29, 31);
  const extra = raw.substring(31);

  return {
    ecuId,
    hwNumber: ecuId,
    swNumber,
    coding,
    diagIndex,
    busIndex,
    extra,
    raw,
  };
}

// ─── MS43 Group 0x03 Response Decoder ─────────────────────────────
// DS2 command 0x0B 0x03 returns "Engine Parameters" group data.
// Response payload is ~26 bytes (after addr/len/ack, before checksum).
// Offsets from handmade0octopus/ds2 Arduino library and Logger.S wiki:
//   - ECU 7545150: batteryOffset=22, RPM at offset 0 (uint16)
// Remaining offsets are approximate — verify with engine running.

interface GroupParam {
  name: string;
  offset: number;
  size: number;       // 1=byte, 2=uint16
  convert: (raw: number) => number;
  units: string;
  format: number;
}

// Known offsets for MS43 ECU 7545150 group 0x0B 0x03 response
const MS43_GROUP03_PARAMS: GroupParam[] = [
  { name: "Engine Speed",     offset: 0,  size: 2, convert: (x) => x,                units: "RPM",  format: 0 },
  { name: "Coolant Temp",     offset: 5,  size: 1, convert: (x) => x * 0.75 - 48,    units: "°C",   format: 1 },
  { name: "Intake Air Temp",  offset: 7,  size: 1, convert: (x) => x * 0.75 - 48,    units: "°C",   format: 1 },
  { name: "Battery Voltage",  offset: 22, size: 1, convert: (x) => x * 0.1015625,    units: "V",    format: 1 },
];

function decodeGroupData(payload: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};

  for (const p of MS43_GROUP03_PARAMS) {
    if (p.offset >= payload.length) continue;
    let raw: number;
    if (p.size === 2 && p.offset + 1 < payload.length) {
      raw = (payload[p.offset] << 8) | payload[p.offset + 1];
    } else {
      raw = payload[p.offset];
    }
    const value = p.convert(raw);
    result[p.name] = `${value.toFixed(p.format)} ${p.units}`;
  }

  // Also dump raw hex for reverse-engineering remaining fields
  result["Raw"] = formatHex(payload, payload.length);

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatHex(data: Uint8Array, len: number): string {
  return Array.from(data.subarray(0, len))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────

const program = new Command()
  .name("ds2")
  .description("BMW DS2 diagnostic tool for MS43 ECU via J2534")
  .option("-p, --port <path>", "Serial port path")
  .option("-u, --usb", "Force USB transport")
  .option("--ident", "Read ECU identification")

  .option("--live", "Live data polling")
  .option("--duration <seconds>", "Polling duration in seconds", "30")
  .option("--raw <hex>", "Send raw DS2 hex bytes (e.g. '12 04 00 16')")
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

  // ─── Open ISO9141 K-line channel at 9600 baud ────────────────

  console.log(chalk.cyan("Opening ISO9141 channel at 9600 baud..."));

  // ISO9141_NO_CHECKSUM flag — DS2 has its own checksum, we don't want
  // the J2534 layer adding/checking ISO9141 checksums
  const flags = 0x0200; // ISO9141_NO_CHECKSUM
  const channelId = await device.passThruConnect(
    Protocol.ISO9141,
    flags,
    9600
  );
  console.log(chalk.green(`Channel ${channelId} opened.`));

  // Configure for DS2: 8 data bits, even parity
  await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
    { parameter: ConfigParam.PARITY, value: PARITY_EVEN },
    { parameter: ConfigParam.DATA_BITS, value: 0 },    // 0 = 8 bits (RomRaider convention)
    { parameter: ConfigParam.P1_MAX, value: 1 },        // inter-byte max (matches RomRaider)
    { parameter: ConfigParam.P3_MIN, value: 1 },        // min time between ECU response and next request
    { parameter: ConfigParam.P4_MIN, value: 0 },        // inter-byte min for tester
    { parameter: ConfigParam.LOOPBACK, value: 1 },      // echo TX back — confirms K-line output
  ]);

  // Pass-all filter — accept any incoming DS2 responses
  const mask = createMsg(Protocol.ISO9141, [0x00]);
  const pattern = createMsg(Protocol.ISO9141, [0x00]);
  await device.passThruStartMsgFilter(
    channelId,
    FilterType.PASS_FILTER,
    mask,
    pattern
  );

  console.log(chalk.green("DS2 channel configured (9600/8E1).\n"));

  // ─── DS2 Send/Receive ────────────────────────────────────────

  async function ds2Send(cmd: number[], label: string): Promise<DS2Response | null> {
    console.log(chalk.yellow(`TX [${label}]: ${cmd.map(b => b.toString(16).padStart(2, "0")).join(" ")}`));

    const msg = createMsg(Protocol.ISO9141, cmd);
    await device.passThruWriteMsgs(channelId, [msg], 1000);

    // Wait for response — DS2 K-line echoes TX, then ECU responds
    // We may receive our own echo first, then the actual response
    await sleep(200); // Give ECU time to respond

    const responses: DS2Response[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 500);
        for (const rxMsg of msgs) {
          console.log(
            chalk.dim(`RX: ${formatHex(rxMsg.data, rxMsg.dataSize)} (${rxMsg.dataSize} bytes)`)
          );

          // Try parsing as DS2
          const parsed = parseDS2Response(rxMsg.data, rxMsg.dataSize);
          if (parsed) {
            // Skip our own echo (same as what we sent)
            if (
              parsed.raw.length === cmd.length &&
              parsed.raw.every((b, i) => b === cmd[i])
            ) {
              console.log(chalk.dim("  (echo, skipping)"));
              continue;
            }

            responses.push(parsed);
            console.log(
              chalk.green(
                `  DS2: addr=0x${parsed.address.toString(16)} ` +
                `ack=0x${parsed.ack.toString(16)} ` +
                `payload=${formatHex(parsed.payload, parsed.payload.length)} ` +
                `checksum=${parsed.checksumOk ? "OK" : "FAIL"}`
              )
            );
          }
        }
      } catch {
        // timeout / empty buffer
      }
      if (responses.length > 0) break;
      await sleep(100);
    }

    return responses[0] ?? null;
  }

  // ─── Execute requested commands ───────────────────────────────

  const doIdent = opts.ident || (!opts.live && !opts.raw);

  if (doIdent) {
    console.log(chalk.bold("\n═══ ECU Identification ═══"));
    const resp = await ds2Send(CMD_ECU_IDENT, "ECU_IDENT");
    if (resp && resp.ack === DS2_ACK_OK) {
      const ident = decodeEcuIdent(resp.payload);
      console.log(chalk.green(`  ECU ID (HW#):    ${chalk.bold(ident.ecuId)}`));
      console.log(chalk.green(`  Software #:      ${ident.swNumber}`));
      console.log(chalk.green(`  Coding:          ${ident.coding}`));
      console.log(chalk.green(`  Diag Index:      ${ident.diagIndex}`));
      console.log(chalk.green(`  Bus Index:       ${ident.busIndex}`));
      if (ident.extra) {
        console.log(chalk.green(`  Extra:           ${ident.extra}`));
      }
      console.log(chalk.dim(`  Raw: ${formatHex(resp.payload, resp.payload.length)}`));
    } else if (resp) {
      console.log(chalk.red(`NAK or error: 0x${resp.ack.toString(16)}`));
    } else {
      console.log(chalk.red("No response from ECU."));
    }
  }


  if (opts.live) {
    console.log(chalk.bold("\n═══ Live Data Polling ═══"));
    const duration = parseInt(opts.duration, 10) * 1000;
    const endTime = Date.now() + duration;
    let pollCount = 0;

    while (Date.now() < endTime) {
      const resp = await ds2Send(CMD_READ_GENERAL_DATA, "GENERAL_DATA");
      if (resp && resp.ack === DS2_ACK_OK) {
        pollCount++;
        const decoded = decodeGroupData(resp.payload);
        console.log(chalk.bold(`\n── Poll #${pollCount} ──`));
        for (const [key, value] of Object.entries(decoded)) {
          console.log(`  ${chalk.cyan(key.padEnd(20))} ${value}`);
        }
      } else {
        console.log(chalk.red("No response."));
      }
      await sleep(500); // ~2 Hz polling
    }
    console.log(chalk.green(`\n${pollCount} polls completed.`));
  }

  if (opts.raw) {
    console.log(chalk.bold("\n═══ Raw DS2 Command ═══"));
    const bytes = (opts.raw as string)
      .trim()
      .split(/[\s,]+/)
      .map((b) => parseInt(b, 16));
    const resp = await ds2Send(bytes, "RAW");
    if (resp) {
      console.log(chalk.green(`Response: ${formatHex(resp.raw, resp.raw.length)}`));
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  console.log(chalk.cyan("\nClosing..."));
  await device.passThruDisconnect(channelId);
  await device.passThruClose();
  console.log(chalk.green("Done."));
}

main().catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
