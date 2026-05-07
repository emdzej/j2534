/**
 * Innovate MTS Wideband O2 Reader — Reads and decodes LC-1/LM-1 lambda
 * data from the OpenPort 2.0's AUX 2.5mm jack.
 *
 * Equivalent to the C++ innomts sample from Tactrix OpenPort 2.0 SDK.
 *
 * The Innovate MTS protocol sends 16-bit word pairs at 19200 baud.
 * Each packet contains lambda, AFR, or auxiliary channel data.
 *
 * Usage:
 *   pnpm start
 *   pnpm start -- --duration 120
 */

import { Command } from "commander";
import chalk from "chalk";
import { Protocol, FilterType } from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { NodeUsbTransport } from "@emdzej/j2534-usb";

// Tactrix extension: AUX jack protocol
const ISO9141_INNO = 0x0102 as Protocol;

// MTS packet types
const MTS_FUNC_LAMBDA = 0x00;
const MTS_FUNC_O2 = 0x01;
const MTS_FUNC_INCAL = 0x02;
const MTS_FUNC_WARMUP = 0x03;
const MTS_FUNC_ERROR = 0x04;
const MTS_FUNC_AUXDATA = 0x05;

// Stoichiometric AFR for gasoline
const STOICH_AFR = 14.7;

interface MtsReading {
  lambda: number;
  afr: number;
  o2Pct: number;
  status: string;
}

const program = new Command()
  .name("innomts")
  .description("Reads and decodes Innovate MTS wideband O2 data from AUX jack")
  .option("--duration <seconds>", "Reading duration in seconds", "60")
  .parse();

const opts = program.opts();
const durationSec = parseInt(opts.duration, 10);

/**
 * Decode a 2-byte MTS word pair into a reading.
 * MTS V2 format (LC-1):
 *   Byte 0: [1][func2:0][data9:5]
 *   Byte 1: [0][data4:0]
 */
function decodeMtsWord(high: number, low: number): MtsReading | null {
  // Validate sync bits
  if ((high & 0x80) !== 0x80 || (low & 0x80) !== 0x00) {
    return null;
  }

  const func = (high >> 4) & 0x07;
  const dataHigh = high & 0x0f;
  const dataLow = low & 0x7f;
  const rawValue = (dataHigh << 7) | dataLow;

  switch (func) {
    case MTS_FUNC_LAMBDA: {
      // Lambda = raw / 8192 + 0.5
      const lambda = rawValue / 8192 + 0.5;
      return {
        lambda,
        afr: lambda * STOICH_AFR,
        o2Pct: 0,
        status: "OK",
      };
    }
    case MTS_FUNC_O2: {
      // O2% = raw / 10.0
      const o2 = rawValue / 10.0;
      return { lambda: 0, afr: 0, o2Pct: o2, status: "O2" };
    }
    case MTS_FUNC_WARMUP:
      return { lambda: 0, afr: 0, o2Pct: 0, status: "WARMUP" };
    case MTS_FUNC_ERROR:
      return { lambda: 0, afr: 0, o2Pct: 0, status: `ERROR(${rawValue})` };
    case MTS_FUNC_INCAL:
      return { lambda: 0, afr: 0, o2Pct: 0, status: "CALIBRATING" };
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const transport = new NodeUsbTransport();
  const device = new J2534Device({ transport });

  console.log(chalk.cyan("Opening device..."));
  await device.passThruOpen();

  const version = await device.passThruReadVersion();
  console.log(chalk.cyan(`Firmware: ${chalk.bold(version.firmwareVersion)}`));
  console.log(chalk.cyan("Connecting to AUX jack (Innovate MTS @ 19200 baud)..."));

  // ISO9141_NO_CHECKSUM since MTS isn't ISO9141 checksummed
  const flags = 0x0200;
  const channelId = await device.passThruConnect(ISO9141_INNO, flags, 19200);

  // Pass-all filter
  const mask = createMsg(ISO9141_INNO, [0x00]);
  const pattern = createMsg(ISO9141_INNO, [0x00]);
  await device.passThruStartMsgFilter(channelId, FilterType.PASS_FILTER, mask, pattern);

  console.log(chalk.yellow(`Reading for ${durationSec}s... (Ctrl+C to stop)\n`));
  console.log(chalk.cyan("Lambda   | AFR      | O2%      | Status"));
  console.log(chalk.cyan("---------+----------+----------+--------"));

  const endTime = Date.now() + durationSec * 1000;

  while (Date.now() < endTime) {
    try {
      const msgs = await device.passThruReadMsgs(channelId, 8, 500);
      for (const msg of msgs) {
        // Process byte pairs from the message
        for (let i = 0; i + 1 < msg.dataSize; i += 2) {
          const reading = decodeMtsWord(msg.data[i], msg.data[i + 1]);
          if (reading && reading.status === "OK") {
            console.log(
              `${chalk.bold(reading.lambda.toFixed(3).padStart(8))} | ` +
                `${chalk.bold(reading.afr.toFixed(2).padStart(8))} | ` +
                `${chalk.bold(reading.o2Pct.toFixed(1).padStart(8))} | ` +
                chalk.green(reading.status)
            );
          } else if (reading && reading.status !== "OK") {
            console.log(
              `${"---".padStart(8)} | ${"---".padStart(8)} | ${"---".padStart(8)} | ${chalk.yellow(reading.status)}`
            );
          }
        }
      }
    } catch {
      // timeout
    }
  }

  await device.passThruDisconnect(channelId);
  await device.passThruClose();
  console.log(chalk.green("\nDone."));
}

main().catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
