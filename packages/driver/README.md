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
