# @emdzej/j2534-webusb

Browser **WebUSB** transport for
[`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver).
Talks to the Tactrix OpenPort 2.0 directly from Chrome / Edge — no
native dependencies. Works in any modern Chromium-based browser
that exposes [`navigator.usb`](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API).

## Install

```bash
npm install @emdzej/j2534-driver @emdzej/j2534-webusb
```

## Use

```ts
import { J2534Device } from '@emdzej/j2534-driver';
import { createWebUsbTransport } from '@emdzej/j2534-webusb';

// must be called from a user-gesture handler (button click etc.)
const transport = await createWebUsbTransport();

const dev = new J2534Device(transport);
await dev.open();
// … see @emdzej/j2534-driver
```

The browser shows its USB device-picker dialog; the user grants
access per-origin / per-device.

## See also

- [Root README](https://github.com/emdzej/j2534#readme)
- [`@emdzej/j2534-webserial`](https://www.npmjs.com/package/@emdzej/j2534-webserial) —
  Web Serial alternative; usually preferable when the device shows
  up as a CDC ACM serial port

## License

MIT
