# @emdzej/j2534-driver

The `J2534Device` class — full SAE J2534 PassThru API implementation
for the Tactrix OpenPort 2.0. Supports CAN (11/29-bit), ISO 15765
(ISO-TP / UDS), ISO 9141 (K-line slow init), and ISO 14230 (KWP2000
fast init).

Transport-agnostic: pair with one of the `@emdzej/j2534-*-transport`
packages depending on runtime (Node serial / Node USB / Web Serial /
WebUSB).

## Install

```bash
npm install @emdzej/j2534-driver @emdzej/j2534-serial
```

## Use (Node.js, serial transport)

```ts
import { J2534Device } from '@emdzej/j2534-driver';
import { createSerialTransport } from '@emdzej/j2534-serial';
import { Protocol, ConnectFlag } from '@emdzej/j2534-types';

const transport = await createSerialTransport(); // auto-detect OpenPort
const dev = new J2534Device(transport);
await dev.open();

const channel = await dev.connect(Protocol.ISO15765, 0, 500_000);
await dev.writeMsgs(channel, [{ data: Uint8Array.of(0x22, 0xf1, 0x90) }]);
const responses = await dev.readMsgs(channel, 1, 1000);
console.log(responses);

await dev.disconnect(channel);
await dev.close();
```

## Slow-ECU support

Older K-line ECUs (BMW instrument cluster, IKE, body modules) read
from EEPROM, which can take 50–200 ms before they start
responding. The OpenPort 2.0 firmware silently drops responses
that arrive after an internal short timeout unless the `att`
transmit command carries an explicit `timeoutMicros` field — which
the Tactrix reference DLL always emits. As of `0.2.0`,
`passThruWriteMsgs` propagates the J2534 `Timeout` argument into
the firmware command (ms → µs, default 1 s for K-line). If your
first exchange works but the second times out empty, this is the
fix.

For DS2-style sessions, also enforce the SGBD's `ParRegenTime`
host-side — wait `regenTimeMs - elapsed` ms before issuing the
next TX. The firmware's J2534 `P3_MIN` handling appears
insufficient for slow ECUs; host-side gating mirrors the
`Ds2Session` pattern in `@emdzej/ediabasx-interface-serial`.

## Debugging

`J2534_RAW_TRACE=1` dumps every raw-byte chunk received from the
device transport to `stderr` — useful for telling "device sent
nothing" apart from "device sent a frame our K-line assembler
dropped".

## See also

- [Root README](https://github.com/emdzej/j2534#readme) — full
  project overview, supported hardware (Tactrix OpenPort 2.0 VID
  `0x0403` / PID `0xCC4D`), and end-to-end examples
- [`@emdzej/j2534-types`](https://www.npmjs.com/package/@emdzej/j2534-types) —
  the enum/interface declarations
- Transports:
  [`j2534-serial`](https://www.npmjs.com/package/@emdzej/j2534-serial),
  [`j2534-usb`](https://www.npmjs.com/package/@emdzej/j2534-usb),
  [`j2534-webserial`](https://www.npmjs.com/package/@emdzej/j2534-webserial),
  [`j2534-webusb`](https://www.npmjs.com/package/@emdzej/j2534-webusb)

## License

MIT
