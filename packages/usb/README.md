# @emdzej/j2534-usb

Node.js libusb bulk-endpoint transport for
[`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver).
Talks directly to the Tactrix OpenPort 2.0 (VID `0x0403` / PID
`0xCC4D`) bypassing the kernel CDC ACM driver.

**Requires elevated privileges** on macOS and Linux (libusb needs to
detach the kernel driver to claim the interface). On Windows you may
need to install a generic WinUSB driver via Zadig.

Most users should prefer
[`@emdzej/j2534-serial`](https://www.npmjs.com/package/@emdzej/j2534-serial)
unless they need raw USB control.

## Install

```bash
npm install @emdzej/j2534-driver @emdzej/j2534-usb
```

## Use

```ts
import { J2534Device } from '@emdzej/j2534-driver';
import { createUsbTransport } from '@emdzej/j2534-usb';

const transport = await createUsbTransport();   // auto-detect by VID/PID
const dev = new J2534Device(transport);
await dev.open();
// … see @emdzej/j2534-driver
```

## See also

- [Root README](https://github.com/emdzej/j2534#readme)
- [`@emdzej/j2534-serial`](https://www.npmjs.com/package/@emdzej/j2534-serial) —
  no-sudo alternative

## License

MIT
