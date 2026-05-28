# @emdzej/j2534-webserial

Browser **Web Serial** transport for
[`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver).
Talks to the Tactrix OpenPort 2.0 directly from Chrome / Edge — no
native dependencies. Works in any modern Chromium-based browser
that exposes [`navigator.serial`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

## Install

```bash
npm install @emdzej/j2534-driver @emdzej/j2534-webserial
```

## Use

```ts
import { J2534Device } from '@emdzej/j2534-driver';
import { createWebSerialTransport } from '@emdzej/j2534-webserial';

// must be called from a user-gesture handler (button click etc.)
const transport = await createWebSerialTransport();

const dev = new J2534Device(transport);
await dev.open();
// … see @emdzej/j2534-driver
```

The browser shows its standard port-picker dialog; the user grants
access per-origin / per-device.

## See also

- [Root README](https://github.com/emdzej/j2534#readme)
- [`@emdzej/j2534-webusb`](https://www.npmjs.com/package/@emdzej/j2534-webusb) —
  WebUSB alternative when Web Serial isn't available

## License

MIT
