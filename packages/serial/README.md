# @emdzej/j2534-serial

Node.js CDC ACM serial transport for
[`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver).
Talks to the Tactrix OpenPort 2.0 via the kernel's USB CDC ACM
driver — `/dev/cu.usbmodem*` on macOS, `/dev/ttyACM*` on Linux, `COMx`
on Windows. **No sudo required** on any platform.

Auto-detects the OpenPort 2.0 by VID and manufacturer string.

## Install

```bash
npm install @emdzej/j2534-driver @emdzej/j2534-serial
```

## Use

```ts
import { J2534Device } from '@emdzej/j2534-driver';
import { createSerialTransport } from '@emdzej/j2534-serial';

// auto-detect
const transport = await createSerialTransport();

// or specify the port explicitly:
const transport2 = await createSerialTransport({ path: '/dev/cu.usbmodem142401' });

const dev = new J2534Device(transport);
await dev.open();
// … see @emdzej/j2534-driver
```

## When to use this vs `@emdzej/j2534-usb`

| | Serial (this package) | USB |
|---|---|---|
| Privileges | None | macOS / Linux: sudo |
| Driver | Kernel CDC ACM | libusb (userspace) |
| Use when | Default — works everywhere | Kernel driver missing / detached |

## See also

- [Root README](https://github.com/emdzej/j2534#readme)
- [`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver)

## License

MIT
