# j2534-ts

Cross-platform TypeScript implementation of the SAE J2534 PassThru API for the **Tactrix OpenPort 2.0** USB diagnostic interface.

J2534 is a standard API that lets PC-based diagnostic software communicate with vehicle ECUs over OBD-II. This project replaces the traditionally Windows-only DLL with a TypeScript library that works in Node.js and browsers.

## Supported Protocols

| Protocol | Use Case |
|---|---|
| CAN (11-bit / 29-bit) | Raw CAN bus communication |
| ISO 15765 | CAN-based diagnostics (ISO-TP, UDS) |
| ISO 9141 | K-line (slow init) |
| ISO 14230 | KWP2000 over K-line (fast/slow init) |

> J1850 VPW/PWM are **not** supported — the OpenPort 2.0 hardware lacks these interfaces.

## Packages

### Core Libraries

| Package | Description |
|---|---|
| `@emdzej/j2534-types` | Enums, interfaces, constants (Protocol, ConnectFlag, ConfigParam) |
| `@emdzej/j2534-core` | AT-command encoder, response parser, message queue |
| `@emdzej/j2534-driver` | `J2534Device` class — full PassThru API implementation |

### Transports

| Package | Runtime | Mechanism |
|---|---|---|
| `@emdzej/j2534-serial` | Node.js | CDC ACM serial port — **default, no sudo** |
| `@emdzej/j2534-usb` | Node.js | libusb bulk endpoints (requires sudo on macOS) |
| `@emdzej/j2534-webserial` | Browser | Web Serial API |
| `@emdzej/j2534-webusb` | Browser | WebUSB API |

### USB vs Serial (Node.js)

Both transports talk to the same OpenPort 2.0 hardware. The difference is permissions:

- **Serial** (default): Uses the CDC ACM driver (`/dev/cu.usbmodemXXXX`). No sudo needed on macOS. Auto-detects the device by VID/manufacturer string.
- **USB**: Uses libusb bulk endpoints. Requires sudo on macOS. Detects by VID `0x0403` / PID `0xCC4D`.

All CLI tools default to serial. Pass `-u` or `--usb` to use the USB transport instead.

## Apps

| App | Description |
|---|---|
| `@emdzej/j2534-inspector-cli` | Ink (React) TUI — 6 tabs for device inspection |
| `@emdzej/j2534-inspector-web` | SvelteKit web inspector |

## Examples

| Example | Description |
|---|---|
| `@emdzej/j2534-example-canlogger` | Passive CAN/ISO 15765 bus sniffer |
| `@emdzej/j2534-example-klogger` | K-line/L-line/AUX serial data logger |
| `@emdzej/j2534-example-innomts` | Innovate MTS wideband O2 reader (LC-1/LM-1) |
| `@emdzej/j2534-example-ds2` | BMW DS2 diagnostic tool for MS43 ECU (CLI + full TUI) |
| `@emdzej/j2534-example-mut2` | Mitsubishi MUT-II diagnostic tool |

## Getting Started

```bash
pnpm install
pnpm build
```

Run an example:

```bash
# CAN bus sniffer
pnpm --filter @emdzej/j2534-example-canlogger start

# BMW DS2 TUI
pnpm --filter @emdzej/j2534-example-ds2 tui

# CLI inspector
pnpm --filter @emdzej/j2534-inspector-cli start

# Use USB transport (needs sudo on macOS)
sudo pnpm --filter @emdzej/j2534-example-ds2 tui -- -u
```

## Tech Stack

- **TypeScript 5.7+** — ES2022 target, ESM only
- **pnpm 9.x** workspaces + **Turborepo** build orchestration
- **Ink** (React for terminal) for CLI TUIs
- **SvelteKit** for web inspector
- **commander** for CLI argument parsing
- **serialport** / **usb** (libusb) for Node.js device access

## Documentation

See [docs/API.md](docs/API.md) for the full API reference.

## License

See [LICENSE](LICENSE).
