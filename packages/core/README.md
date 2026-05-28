# @emdzej/j2534-core

Wire-level building blocks for the Tactrix OpenPort 2.0 J2534
protocol — AT-command encoder, response parser, async message
queue. Used internally by
[`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver);
most users won't import this package directly.

## Install

```bash
npm install @emdzej/j2534-core
```

## Use

```ts
import { encodeCommand, parseResponse } from '@emdzej/j2534-core';

const bytes = encodeCommand('ATI');         // → Uint8Array("ati\r\n")
const result = parseResponse(rxBuffer);     // → { kind, payload, … }
```

## See also

- [Root README](https://github.com/emdzej/j2534#readme) — full
  project overview, supported hardware, examples

## License

MIT
