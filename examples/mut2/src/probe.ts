/**
 * 5-baud init probe — try several connect/config combinations against the
 * OpenPort 2.0 firmware to find one it actually accepts. Logs the raw
 * firmware response for each attempt.
 *
 * Usage: pnpm --filter @emdzej/j2534-example-mut2 probe
 */

import {
  Protocol,
  IoctlId,
  ConfigParam,
  Pin,
  SHORT_TO_GROUND,
  VOLTAGE_OFF,
} from "@emdzej/j2534-types";
import { J2534Device, createMsg } from "@emdzej/j2534-driver";
import { SerialTransport } from "@emdzej/j2534-serial";

const ADDR = 0x01;

interface Variant {
  name: string;
  flags: number;
  baud: number;
  config?: { parameter: number; value: number }[];
}

const VARIANTS: Variant[] = [
  { name: "10400 baud, flags=0, no SET_CONFIG", flags: 0, baud: 10400 },
  { name: "10400 baud, NO_CHECKSUM, no SET_CONFIG", flags: 0x0200, baud: 10400 },
  { name: "10400 baud, flags=0, with MUT-II SET_CONFIG", flags: 0, baud: 10400, config: [
    { parameter: ConfigParam.PARITY, value: 0 },
    { parameter: ConfigParam.DATA_BITS, value: 0 },
    { parameter: ConfigParam.LOOPBACK, value: 1 },
  ]},
  { name: "5 baud, flags=0", flags: 0, baud: 5 },
  { name: "15625 baud, flags=0 (no NO_CHECKSUM)", flags: 0, baud: 15625 },
  { name: "15625 baud, NO_CHECKSUM (current example)", flags: 0x0200, baud: 15625 },
];

async function probe(variant: Variant): Promise<void> {
  console.log(`\n──── ${variant.name} ────`);
  const device = new J2534Device({ transport: new SerialTransport() });
  try {
    await device.passThruOpen();
    const channelId = await device.passThruConnect(Protocol.ISO9141, variant.flags, variant.baud);
    if (variant.config) {
      await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, variant.config);
    }
    await device.passThruSetProgrammingVoltage(Pin.PIN_1, SHORT_TO_GROUND);
    try {
      const initMsg = createMsg(Protocol.ISO9141, [ADDR]);
      const resp = (await device.passThruIoctl(channelId, IoctlId.FIVE_BAUD_INIT, initMsg)) as
        | { data: Uint8Array; dataSize: number }
        | undefined;
      if (resp) {
        const hex = Array.from(resp.data.subarray(0, resp.dataSize))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        console.log(`✓ init OK — ${resp.dataSize} bytes: ${hex}`);
      } else {
        console.log(`? init returned nothing`);
      }
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
    }
    await device.passThruSetProgrammingVoltage(Pin.PIN_1, VOLTAGE_OFF);
    await device.passThruDisconnect(channelId);
    await device.passThruClose();
  } catch (err) {
    console.log(`✗ setup error: ${(err as Error).message}`);
    try {
      await device.passThruClose();
    } catch {}
  }
}

/**
 * Bypass the firmware's FIVE_BAUD_INIT entirely. Open the channel at a low
 * baud, transmit the address byte as a normal frame, switch to 15625, then
 * dump anything the ECU sends back.
 */
async function bypassInit(initBaud: number, postBaud: number): Promise<void> {
  console.log(`\n──── BYPASS: tx 0x01 @ ${initBaud} baud, listen @ ${postBaud} (LOOPBACK on) ────`);
  const device = new J2534Device({ transport: new SerialTransport() });
  try {
    await device.passThruOpen();
    const channelId = await device.passThruConnect(Protocol.ISO9141, 0, initBaud);

    // LOOPBACK ON — if firmware actually drives K-line, we'll see our own TX echoed back
    await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
      { parameter: ConfigParam.LOOPBACK, value: 1 },
    ]);
    console.log(`  LOOPBACK enabled — we should receive our own TX as RX`);

    // Battery voltage sanity
    try {
      const mv = (await device.passThruIoctl(channelId, IoctlId.READ_VBATT)) as number;
      console.log(`  VBATT (pin 16) = ${(mv / 1000).toFixed(2)} V`);
    } catch (err) {
      console.log(`  VBATT read failed: ${(err as Error).message}`);
    }

    // Pin 1 ground — DO NOT swallow errors this time
    try {
      await device.passThruSetProgrammingVoltage(Pin.PIN_1, SHORT_TO_GROUND);
      console.log(`  pin 1 → SHORT_TO_GROUND OK`);
    } catch (err) {
      console.log(`  ✗ pin 1 ground FAILED: ${(err as Error).message}`);
    }

    // Pass-all filter so we can read back
    const mask = createMsg(Protocol.ISO9141, [0x00]);
    const pat = createMsg(Protocol.ISO9141, [0x00]);
    await device.passThruStartMsgFilter(channelId, 1 /* PASS_FILTER */, mask, pat);

    // Send 0x01 at the (slow) init baud
    const txMsg = createMsg(Protocol.ISO9141, [0x01]);
    console.log(`  tx 0x01 @ ${initBaud} baud (this should hold the line for ~${(1000 / initBaud) * 10 | 0} ms)`);
    const txStart = Date.now();
    await device.passThruWriteMsgs(channelId, [txMsg], 5000);

    // Wait for the byte to actually clock out
    const byteMs = Math.ceil((10 * 1000) / initBaud);
    await new Promise((r) => setTimeout(r, byteMs + 50));
    console.log(`  tx took ${Date.now() - txStart} ms`);

    // Switch baud
    if (postBaud !== initBaud) {
      try {
        await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
          { parameter: ConfigParam.DATA_RATE, value: postBaud },
        ]);
        console.log(`  switched baud → ${postBaud}`);
      } catch (err) {
        console.log(`  ✗ baud switch failed: ${(err as Error).message}`);
      }
    }

    // Read for 3 seconds
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 500);
        for (const m of msgs) {
          const hex = Array.from(m.data.subarray(0, m.dataSize))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          console.log(`  RX: ${hex}  (rxStatus=0x${m.rxStatus.toString(16)})`);
        }
      } catch {
        // empty rx — keep polling
      }
    }

    try { await device.passThruSetProgrammingVoltage(Pin.PIN_1, VOLTAGE_OFF); } catch {}
    await device.passThruDisconnect(channelId);
    await device.passThruClose();
  } catch (err) {
    console.log(`✗ setup error: ${(err as Error).message}`);
    try { await device.passThruClose(); } catch {}
  }
}

/**
 * Sniff the K-line passively at 15625 baud for N seconds. Useful if the ECU
 * is babbling on its own (some MUT-II ECUs do, after a pin-1 ground trigger).
 */
async function passiveSniff(baud: number, seconds: number): Promise<void> {
  console.log(`\n──── PASSIVE SNIFF @ ${baud} baud for ${seconds}s ────`);
  const device = new J2534Device({ transport: new SerialTransport() });
  try {
    await device.passThruOpen();
    const channelId = await device.passThruConnect(Protocol.ISO9141, 0, baud);
    try {
      const mv = (await device.passThruIoctl(channelId, IoctlId.READ_VBATT)) as number;
      console.log(`  VBATT = ${(mv / 1000).toFixed(2)} V`);
    } catch {}
    try {
      await device.passThruSetProgrammingVoltage(Pin.PIN_1, SHORT_TO_GROUND);
      console.log(`  pin 1 grounded`);
    } catch {}
    const mask = createMsg(Protocol.ISO9141, [0x00]);
    const pat = createMsg(Protocol.ISO9141, [0x00]);
    await device.passThruStartMsgFilter(channelId, 1, mask, pat);

    const deadline = Date.now() + seconds * 1000;
    let got = 0;
    while (Date.now() < deadline) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 500);
        for (const m of msgs) {
          got++;
          const hex = Array.from(m.data.subarray(0, m.dataSize))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          console.log(`  [${(deadline - Date.now()) / 1000}s] RX (${m.dataSize}b): ${hex}`);
        }
      } catch {
        // empty
      }
    }
    console.log(`  total messages: ${got}`);

    try { await device.passThruSetProgrammingVoltage(Pin.PIN_1, VOLTAGE_OFF); } catch {}
    await device.passThruDisconnect(channelId);
    await device.passThruClose();
  } catch (err) {
    console.log(`  ✗ ${(err as Error).message}`);
    try { await device.passThruClose(); } catch {}
  }
}

/**
 * Baseline: open at a normal baud, enable LOOPBACK, send a byte, verify we
 * receive it back. If THIS fails, LOOPBACK on K-line doesn't work at all on
 * this firmware/device — and our bypass test was always going to be silent.
 */
async function loopbackBaseline(baud: number): Promise<void> {
  console.log(`\n──── LOOPBACK BASELINE @ ${baud} baud ────`);
  const device = new J2534Device({ transport: new SerialTransport() });
  try {
    await device.passThruOpen();
    const channelId = await device.passThruConnect(Protocol.ISO9141, 0, baud);
    await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
      { parameter: ConfigParam.LOOPBACK, value: 1 },
    ]);
    const mask = createMsg(Protocol.ISO9141, [0x00]);
    const pat = createMsg(Protocol.ISO9141, [0x00]);
    await device.passThruStartMsgFilter(channelId, 1, mask, pat);

    const txMsg = createMsg(Protocol.ISO9141, [0xaa]);
    await device.passThruWriteMsgs(channelId, [txMsg], 1000);
    console.log(`  sent 0xAA, waiting for loopback...`);

    const deadline = Date.now() + 2000;
    let got = 0;
    while (Date.now() < deadline) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 200);
        for (const m of msgs) {
          got++;
          const hex = Array.from(m.data.subarray(0, m.dataSize))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          console.log(`  RX: ${hex}  (rxStatus=0x${m.rxStatus.toString(16)})`);
        }
      } catch {}
    }
    console.log(`  ${got > 0 ? "✓" : "✗"} loopback echo: ${got} messages`);
    await device.passThruDisconnect(channelId);
    await device.passThruClose();
  } catch (err) {
    console.log(`  ✗ ${(err as Error).message}`);
    try { await device.passThruClose(); } catch {}
  }
}

async function main(): Promise<void> {
  process.env.J2534_DEBUG = "1";

  // Sanity baseline: does loopback work at all?
  await loopbackBaseline(10400);
  await new Promise((r) => setTimeout(r, 500));

  // Test 1: MUT-II init (0x01 @ 5 baud) — bypass firmware
  await bypassInit(5, 15625);
  await new Promise((r) => setTimeout(r, 500));

  // Test 2: standard OBD-II ISO9141 init (0x33 @ 5 baud), listen at 10400
  console.log("\n══ Standard ISO9141 init test (0x33 @ 5, listen @ 10400) ══");
  await bypassInitWithAddr(5, 10400, 0x33);
  await new Promise((r) => setTimeout(r, 500));

  // Test 3: passive sniff
  await passiveSniff(15625, 3);
}

async function bypassInitWithAddr(initBaud: number, postBaud: number, addr: number): Promise<void> {
  console.log(`\n──── BYPASS: tx 0x${addr.toString(16)} @ ${initBaud} baud, listen @ ${postBaud} ────`);
  const device = new J2534Device({ transport: new SerialTransport() });
  try {
    await device.passThruOpen();
    const channelId = await device.passThruConnect(Protocol.ISO9141, 0, initBaud);
    try { await device.passThruSetProgrammingVoltage(Pin.PIN_1, SHORT_TO_GROUND); } catch {}

    const mask = createMsg(Protocol.ISO9141, [0x00]);
    const pat = createMsg(Protocol.ISO9141, [0x00]);
    await device.passThruStartMsgFilter(channelId, 1, mask, pat);

    const txMsg = createMsg(Protocol.ISO9141, [addr]);
    const start = Date.now();
    await device.passThruWriteMsgs(channelId, [txMsg], 5000);
    await new Promise((r) => setTimeout(r, Math.ceil((10 * 1000) / initBaud) + 50));
    console.log(`  tx took ${Date.now() - start} ms`);

    if (postBaud !== initBaud) {
      try {
        await device.passThruIoctl(channelId, IoctlId.SET_CONFIG, [
          { parameter: ConfigParam.DATA_RATE, value: postBaud },
        ]);
      } catch {}
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const msgs = await device.passThruReadMsgs(channelId, 1, 500);
        for (const m of msgs) {
          const hex = Array.from(m.data.subarray(0, m.dataSize))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          console.log(`  RX: ${hex}`);
        }
      } catch {}
    }
    try { await device.passThruSetProgrammingVoltage(Pin.PIN_1, VOLTAGE_OFF); } catch {}
    await device.passThruDisconnect(channelId);
    await device.passThruClose();
  } catch (err) {
    console.log(`  ✗ ${(err as Error).message}`);
    try { await device.passThruClose(); } catch {}
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
