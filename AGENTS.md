# AGENTS.md — AI Agent Context for j2534-ts

> **Keep this file up to date.** When you make significant changes to the repo — new packages, changed conventions, architectural decisions, new protocols, or updated hardware details — update the relevant sections below so future agent sessions start with accurate context.

## Project Overview

**j2534-ts** is a TypeScript implementation of the SAE J2534 PassThru API targeting the **Tactrix OpenPort 2.0** USB diagnostic interface. J2534 is a standard API for PC-based diagnostic software to communicate with vehicle ECUs over OBD-II. This project replaces the traditionally Windows-only DLL with a cross-platform TypeScript library that works in Node.js and browsers.

### Target Hardware

- **Tactrix OpenPort 2.0**: VID `0x0403`, PID `0xCC4D`
- Firmware version: `1.17.4877`
- Channel byte mapping: ISO9141=`0x33`, ISO14230=`0x34`, CAN=`0x35`, ISO15765=`0x36`

## Monorepo Structure

```
j2534-ts/
├── packages/           # Core libraries (published as @emdzej/j2534-*)
│   ├── types/          # Enums, interfaces, constants (Protocol, ConnectFlag, ConfigParam)
│   ├── core/           # AT-command encoder, response parser, message queue
│   ├── driver/         # J2534Device class — full PassThru API implementation
│   ├── usb/            # Node.js transport via libusb (bulk endpoints)
│   ├── serial/         # Node.js transport via serialport (CDC ACM, no sudo)
│   ├── webusb/         # Browser transport via WebUSB API
│   └── webserial/      # Browser transport via Web Serial API
├── apps/               # Standalone applications
│   ├── inspector-cli/  # Ink (React) TUI — 6 tabs, device inspection
│   └── inspector-web/  # SvelteKit web inspector
├── examples/           # Diagnostic tool examples
│   ├── canlogger/      # Passive CAN/ISO15765 bus sniffer
│   ├── klogger/        # K-line/L-line/AUX serial data logger
│   ├── innomts/        # Innovate MTS wideband O2 reader (LC-1/LM-1)
│   ├── ds2/            # BMW DS2 diagnostic tool for MS43 ECU (full TUI)
│   └── mut2/           # Mitsubishi MUT-II diagnostic tool
├── docs/               # API documentation
├── turbo.json          # Turborepo task config
├── pnpm-workspace.yaml # Workspace definition
└── tsconfig.base.json  # Shared TS config (ES2022, ESNext modules, bundler resolution)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7+, ES2022 target |
| Package manager | pnpm 9.x with workspaces |
| Build orchestration | Turborepo |
| Module system | ESM only (`"type": "module"` in all packages) |
| CLI argument parsing | commander |
| CLI TUI apps | Ink (React for terminal) |
| Web apps | SvelteKit |
| USB access (Node) | usb (libusb bindings) |
| Serial access (Node) | serialport |
| USB access (Browser) | WebUSB API |
| Serial access (Browser) | Web Serial API |

## Transport: USB vs Serial

Both transports communicate with the same OpenPort 2.0 hardware. The choice matters for DX and permissions:

| | USB (`@emdzej/j2534-usb`) | Serial (`@emdzej/j2534-serial`) |
|---|---|---|
| Mechanism | libusb bulk endpoints | CDC ACM serial port (`/dev/cu.usbmodemXXXX`) |
| macOS permissions | **Requires sudo** (libusb needs root) | **No sudo needed** (user-accessible) |
| Device path | N/A (VID/PID enumeration) | `/dev/cu.usbmodemTAhJALxt1` (auto-detected) |
| Detection | By VID `0x0403` / PID `0xCC4D` | By VID/manufacturer string match |
| Default | No | **Yes** (preferred on macOS) |

**Rule: Serial transport is the default for all Node.js tools.** USB is a fallback (e.g., pass `-u` or `--usb` flag). This avoids sudo prompts during development.

## Protocols

Only protocols supported by the Tactrix OpenPort 2.0 are exposed:

- **CAN** (11-bit and 29-bit)
- **ISO 15765** (CAN-based diagnostics, ISO-TP)
- **ISO 9141** (K-line, slow init)
- **ISO 14230** (KWP2000, K-line fast/slow init)

**Not supported** (do not add): J1850 VPW, J1850 PWM — the OpenPort 2.0 hardware does not support these.

## Communication Protocol with OpenPort 2.0

The OpenPort 2.0 speaks an AT-command-based text protocol over the transport:

- Commands are ASCII strings terminated by `\r\n`
- Responses are parsed by `packages/core/src/parser.ts` → `parseAllPackets()`
- Device open requires reading the initial ACK sequence
- Voltage is read via AT command and parsed from response string
- K-line packets (`NORM_MSG`/`TX_LB_MSG`) have **no timestamp**

## Key Conventions

### Code Style
- Use English names for all job/function identifiers in source code
- German text is acceptable in data tables extracted from BMW EDIABAS SGBDs (fault descriptions, etc.)
- `XOR` checksum for DS2 protocol frames
- All packages use `src/` → `dist/` build layout

### Package Naming
- Libraries: `@emdzej/j2534-{name}` (e.g., `@emdzej/j2534-core`)
- Apps: `@emdzej/j2534-inspector-{name}`
- Examples: `@emdzej/j2534-example-{name}`

### Build & Run
```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (respects dependency graph)
pnpm clean            # Clean all build outputs

# Run apps
pnpm --filter @emdzej/j2534-inspector-cli start    # CLI inspector
pnpm --filter @emdzej/j2534-example-ds2 start       # DS2 CLI mode
pnpm --filter @emdzej/j2534-example-ds2 tui          # DS2 full TUI

# Transport flags (examples/apps)
#   default = serial (no sudo)
#   -u / --usb = USB transport (needs sudo on macOS)
```

## ECU-Specific Details

### BMW MS43 (DS2 Protocol)
- DS2 address: `0x12`, baud: 9600, 8E1
- ACK OK: `0xA0`, NAK: `0xB0`
- Frame: `[addr] [len] [cmd...] [xor_checksum]`
- Fault response: `[addr][len][ack][fault_count][op_hours_hi][op_hours_lo][6-byte entries...][checksum]`
- Each fault entry: `[ORT][ART][UW1][UW2][UW3][UW4]` — location, type, 4 environment values
- Job library in `examples/ds2/src/ms43-jobs.ts` (60+ commands from EDIABAS SGBD disassembly)
- Fault decoder in `examples/ds2/src/ms43-faults.ts` (170 ORT codes, 144 ART codes, env scaling)
- TUI job registry in `examples/ds2/src/job-registry.ts` (50+ jobs with formatters)

### Mitsubishi MUT-II
- J2534 ISO 9141 at 15625 baud, 8N1
- Uses `FIVE_BAUD_INIT` IOCTL, `ISO9141_NO_CHECKSUM` connect flag (`0x0200`)
- Single-byte PID request/response protocol

## Important Files

| File | Purpose |
|---|---|
| `packages/types/src/index.ts` | Protocol, ConnectFlag, ConfigParam enums |
| `packages/core/src/commands.ts` | AT command builders |
| `packages/core/src/parser.ts` | Response parser (`parseAllPackets()`) |
| `packages/driver/src/index.ts` | `J2534Device` class |
| `packages/usb/src/index.ts` | `NodeUsbTransport` |
| `packages/serial/src/index.ts` | `SerialTransport` (auto-detects by VID/manufacturer) |
| `apps/inspector-cli/src/index.tsx` | Ink TUI, 6 tabs |
| `examples/ds2/src/ms43-jobs.ts` | MS43 DS2 command builders/parsers |
| `examples/ds2/src/ms43-faults.ts` | Fault decoder (tables + `decodeFaultMemory()`) |
| `examples/ds2/src/job-registry.ts` | TUI job registry with formatters |
| `examples/ds2/src/tui.tsx` | DS2 full-screen Ink TUI |

## Updating This File

When you make changes that affect any of the following, **update this file**:

- New packages, apps, or examples added to the monorepo
- New protocols or ECU support added
- Transport changes or new transport implementations
- Build system or tooling changes
- Architectural decisions or convention changes
- New hardware support or hardware-specific quirks discovered
- Significant new files or entry points

Keep sections concise and factual. This file is consumed by AI agents at the start of sessions — accuracy and brevity matter more than prose.
