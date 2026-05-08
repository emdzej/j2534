/**
 * K-Line Logger — Sniffs ISO9141 / K-line serial data and logs to stdout/file.
 *
 * Equivalent to the C++ klogger sample from Tactrix OpenPort 2.0 SDK.
 *
 * Usage:
 *   pnpm start                          # K-line at 4800 baud
 *   pnpm start -- --baud 10400          # Custom baud
 *   pnpm start -- --channel l           # L-line
 *   pnpm start -- --channel aux         # AUX (2.5mm jack)
 *   pnpm start -- --parity odd          # Set parity
 *   pnpm start -- --p1max 20            # Message framing timeout (ms)
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { Protocol, FilterType, ConfigParam, IoctlId, ProtocolExt } from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

// Tactrix extensions: channel selection
const ISO9141_K = Protocol.ISO9141;
const ISO9141_L = ProtocolExt.ISO9141_L as unknown as Protocol;
const ISO9141_INNO = ProtocolExt.ISO9141_INNO as unknown as Protocol;

// Parity values
const PARITY_NONE = 0;
const PARITY_ODD = 1;
const PARITY_EVEN = 2;

const program = new Command()
  .name("klogger")
  .description("Sniffs ISO9141 / K-line serial data and logs to stdout/file")
  .option("--channel <type>", "Channel: k, l, or aux", "k")
  .option("--baud <rate>", "Baud rate", "4800")
  .option("--parity <type>", "Parity: none, odd, even", "none")
  .option("--p1max <ms>", "Message framing timeout in ms", "2")
  .option("-o, --output <file>", "Output log file")
  .option("--duration <seconds>", "Logging duration in seconds", "60")
  .parse();

const opts = program.opts();
const baudRate = parseInt(opts.baud, 10);
const durationSec = parseInt(opts.duration, 10);
const outputFile = opts.output;
const p1max = parseInt(opts.p1max, 10);

function getProtocol(channel: string): Protocol {
  switch (channel.toLowerCase()) {
    case "l":
      return ISO9141_L;
    case "aux":
    case "inno":
      return ISO9141_INNO;
    default:
      return ISO9141_K;
  }
}

function getParityValue(p: string): number {
  switch (p.toLowerCase()) {
    case "odd":
      return PARITY_ODD;
    case "even":
      return PARITY_EVEN;
    default:
      return PARITY_NONE;
  }
}

function formatHex(data: Uint8Array, len: number): string {
  return Array.from(data.subarray(0, len))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function log(line: string): void {
  console.log(line);
  if (outputFile) {
    appendFileSync(outputFile, line + "\n");
  }
}

async function main(): Promise<void> {
  const transport = new NodeUsbTransport();
  const device = new J2534Device({ transport });

  console.log(chalk.cyan("Opening device..."));
  await device.passThruOpen();

  const version = await device.passThruReadVersion();
  console.log(chalk.cyan(`Firmware: ${chalk.bold(version.firmwareVersion)}`));

  const protocol = getProtocol(opts.channel);
  console.log(chalk.cyan(`Channel: ${chalk.bold(opts.channel)} | Baud: ${chalk.bold(String(baudRate))} | Parity: ${chalk.bold(opts.parity)}`));

  // ISO9141_NO_CHECKSUM flag since we're sniffing raw serial
  const flags = 0x0200; // ISO9141_NO_CHECKSUM
  const channelId = await device.passThruConnect(protocol, flags, baudRate);

  // Set timing parameters
  await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
    { parameter: ConfigParam.P1_MAX, value: p1max },
    { parameter: ConfigParam.PARITY, value: getParityValue(opts.parity) },
  ]);

  // Pass-all filter (1-byte mask of zero)
  const mask = createMsg(protocol, [0x00]);
  const pattern = createMsg(protocol, [0x00]);
  await device.passThruStartMsgFilter(channelId, FilterType.PASS_FILTER, mask, pattern);

  console.log(chalk.yellow(`Logging for ${durationSec}s... (Ctrl+C to stop)\n`));
  if (outputFile) {
    writeFileSync(outputFile, `# K-line log started at ${new Date().toISOString()}\n`);
  }

  const endTime = Date.now() + durationSec * 1000;
  let msgCount = 0;

  while (Date.now() < endTime) {
    try {
      const msgs = await device.passThruReadMsgs(channelId, 16, 1000);
      for (const msg of msgs) {
        msgCount++;
        const ts = (msg.timestamp / 1000).toFixed(3);
        const hex = formatHex(msg.data, msg.dataSize);
        log(`${chalk.dim(`[${ts}ms]`)} (${chalk.bold(String(msg.dataSize))} bytes) ${hex}`);
      }
    } catch {
      // timeout
    }
  }

  console.log(chalk.green(`\nDone. ${chalk.bold(String(msgCount))} messages captured.`));
  await device.passThruDisconnect(channelId);
  await device.passThruClose();
}

main().catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
