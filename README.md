# j2534-ts

TypeScript implementation of the SAE J2534 PassThru API for the **Tactrix OpenPort 2.0** USB interface. Works in both Node.js (via libusb) and browsers (via WebUSB).

## What is J2534?

SAE J2534 is a standard API for PC-based diagnostic software to communicate with vehicle ECUs over OBD-II. This project reimplements the traditionally Windows-only DLL interface in TypeScript.

## Packages

| Package | Description |
|---------|-------------|
| `@emdzej/j2534-types` | Enums, interfaces, and constants |
| `@emdzej/j2534-core` | AT-command encoder, response parser, message queue |
| `@emdzej/j2534-driver` | Main `J2534Device` class implementing the full PassThru API |
| `@emdzej/j2534-usb` | Node.js transport (libusb bulk endpoints) |
| `@emdzej/j2534-webusb` | Browser transport (WebUSB API) |

## Features

- **Full J2534-1 API** — Open/Close, Connect/Disconnect, ReadMsgs/WriteMsgs, filters, periodic messages, IOCTL, programming voltage
- **J2534-2 extensions** — Multi-channel, extended protocols, passive sniff mode
- **Supported protocols** — CAN, ISO 15765, ISO 9141, ISO 14230, J1850 VPW/PWM
- **Pluggable transport** — Same driver works over Node.js libusb or browser WebUSB

## Examples

- **canlogger** — Passive CAN/ISO 15765 bus sniffer
- **klogger** — K-line/L-line/AUX serial data logger
- **innomts** — Innovate MTS wideband O2 sensor reader (LC-1/LM-1)

## Getting Started

```bash
pnpm install
pnpm build
```

Run an example:

```bash
pnpm --filter @emdzej/j2534-example-canlogger start
```

## Documentation

See [docs/API.md](docs/API.md) for the full API reference.
