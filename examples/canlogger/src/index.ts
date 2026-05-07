/**
 * CAN Logger — Passively sniffs CAN bus traffic and logs to stdout/file.
 *
 * Equivalent to the C++ canlogger sample from Tactrix OpenPort 2.0 SDK.
 *
 * Usage:
 *   pnpm start                    # Log raw CAN at 500000 baud
 *   pnpm start -- --iso15765      # Log ISO15765 with OBD-II flow control
 *   pnpm start -- --baud 250000   # Custom baud rate
 */

import { writeFileSync, appendFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { Protocol, FilterType, ConnectFlag } from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

// Tactrix extension: SNIFF_MODE (passive listen, no ACK on CAN)
const SNIFF_MODE = 0x10000000;

const program = new Command()
  .name("canlogger")
  .description("Passively sniffs CAN bus traffic and logs to stdout/file")
  .option("--iso15765", "Use ISO15765 with OBD-II flow control", false)
  .option("--baud <rate>", "CAN baud rate", "500000")
  .option("-o, --output <file>", "Output log file")
  .option("--duration <seconds>", "Logging duration in seconds", "60")
  .parse();

const opts = program.opts();
const useIso15765 = opts.iso15765;
const baudRate = parseInt(opts.baud, 10);
const outputFile = opts.output;
const durationSec = parseInt(opts.duration, 10);

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
  console.log(chalk.cyan(`Protocol: ${chalk.bold(useIso15765 ? "ISO15765" : "CAN")} @ ${chalk.bold(String(baudRate))} baud`));

  const protocol = useIso15765 ? Protocol.ISO15765 : Protocol.CAN;
  const flags = SNIFF_MODE | ConnectFlag.CAN_ID_BOTH;

  const channelId = await device.passThruConnect(protocol, flags, baudRate);

  if (useIso15765) {
    // Set up flow control filter for standard OBD-II (0x7E0 -> 0x7E8)
    const mask = createMsg(protocol, [0xff, 0xff, 0xff, 0xff]);
    const pattern = createMsg(protocol, [0x00, 0x00, 0x07, 0xe0]);
    const flow = createMsg(protocol, [0x00, 0x00, 0x07, 0xe8]);
    await device.passThruStartMsgFilter(
      channelId,
      FilterType.FLOW_CONTROL_FILTER,
      mask,
      pattern,
      flow
    );
  } else {
    // Pass-all filter: mask = all zeros
    const mask = createMsg(protocol, [0x00, 0x00, 0x00, 0x00]);
    const pattern = createMsg(protocol, [0x00, 0x00, 0x00, 0x00]);
    await device.passThruStartMsgFilter(
      channelId,
      FilterType.PASS_FILTER,
      mask,
      pattern
    );
  }

  console.log(chalk.yellow(`Logging for ${durationSec}s... (Ctrl+C to stop)\n`));
  if (outputFile) {
    writeFileSync(outputFile, `# CAN log started at ${new Date().toISOString()}\n`);
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
        log(`${chalk.dim(`[${ts}ms]`)} ${hex}`);
      }
    } catch {
      // timeout / buffer empty — continue
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
