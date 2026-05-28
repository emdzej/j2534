# @emdzej/j2534-types

SAE J2534 PassThru API type definitions — `Protocol`, `ConnectFlag`,
`ConfigParam`, `FilterType`, `Pin`, `RxStatus` enums plus result and
message interfaces. Zero runtime — pure TypeScript declarations.

Used by every other `@emdzej/j2534-*` package.

## Install

```bash
npm install @emdzej/j2534-types
```

## Use

```ts
import { Protocol, ConnectFlag, ConfigParam } from '@emdzej/j2534-types';

console.log(Protocol.ISO15765);     // 0x06
console.log(ConfigParam.LOOPBACK);  // numeric J2534 config ID
```

## See also

- [Root README](https://github.com/emdzej/j2534#readme) — full
  project overview, supported hardware, examples
- [`@emdzej/j2534-driver`](https://www.npmjs.com/package/@emdzej/j2534-driver) —
  the J2534Device implementation that consumes these types

## License

MIT
