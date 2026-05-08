# BMW DS2 Diagnostic Tool

Communicates with BMW MS43 (Siemens Motronic) ECU using the DS2 protocol over K-line via a Tactrix OpenPort 2.0 J2534 interface.

## Protocol Overview

DS2 is BMW's proprietary diagnostic protocol used on E36/E39/E46-era vehicles. It runs on the K-line (OBD-II pin 7) with no initialization sequence — just open the channel and start sending framed commands.

| Parameter | Value |
|---|---|
| Baud rate | 9600 |
| Data bits | 8 |
| Parity | Even |
| Stop bits | 1 |
| K-line pin | OBD-II pin 7 |
| ECU address | `0x12` (DME / Motronic) |

### Frame Format

```
[address] [length] [payload...] [checksum]
```

- **address** — target ECU (`0x12` for DME)
- **length** — total frame size (address + length + payload + checksum)
- **checksum** — XOR of all preceding bytes
- **ACK** — response byte at offset 2: `0xA0` = OK, `0xB0` = NAK

### J2534 Configuration

Uses ISO9141 channel with `ISO9141_NO_CHECKSUM` flag (`0x0200`) since DS2 manages its own XOR checksum. Even parity is set via `SET_CONFIG` IOCTL.

## Supported Commands

### ECU Identification (`--ident`)

Sends command `0x00` to read the ECU ident block. Response is ASCII-encoded:

| Field | Offset | Length | Description |
|---|---|---|---|
| ECU ID | 0 | 7 | Hardware part number (e.g. `7545150`) |
| SW Number | 7 | 14 | Software/calibration number |
| Coding | 21 | 4 | Variant coding |
| Diag Index | 25 | 4 | Diagnostic index |
| Bus Index | 29 | 2 | Bus index |
| Extra | 31+ | varies | Dates, ISN, etc. |

### Live Data (`--live`)

Sends group read command `0x0B 0x03` ("Engine Parameters") and decodes the response payload. Known offsets for MS43 ECU `7545150`:

| Parameter | Offset | Size | Formula | Units |
|---|---|---|---|---|
| Engine Speed | 0 | 2 (uint16) | raw | RPM |
| Coolant Temp | 5 | 1 | `x * 0.75 - 48` | °C |
| Intake Air Temp | 7 | 1 | `x * 0.75 - 48` | °C |
| Battery Voltage | 22 | 1 | `x * 0.1015625` | V |

Battery voltage at offset 22 is confirmed. Remaining offsets are approximate — additional verification with engine running is needed.

### Raw Command (`--raw`)

Send arbitrary DS2 hex bytes directly:

```bash
pnpm start -- --raw "12 04 00 16"
```

## Usage

```bash
# Default: auto-detect serial transport, read ECU ident
pnpm start

# Read ECU identification
pnpm start -- --ident

# Live data polling (default 30s)
pnpm start -- --live

# Live data for 60 seconds
pnpm start -- --live --duration 60

# Force USB transport
pnpm start -- -u

# Specify serial port
pnpm start -- -p /dev/cu.usbmodemXXXX

# Send raw DS2 command
pnpm start -- --raw "12 04 00 16"
```

## Hardware

- **Interface**: Tactrix OpenPort 2.0 (VID `0x0403`, PID `0xCC4D`)
- **Transport**: Serial (default, no sudo) or USB
- **ECU**: BMW MS43 Motronic (E46 330i, etc.)
- **Connector**: Standard OBD-II, K-line on pin 7

## Notes

- DS2 uses group reads (`0x0B <group>`) rather than individual address-based PID requests.
- Command `0x06` is READ_MEMORY, not read faults — fault reading is not implemented for DS2.
- The tool echoes all TX/RX traffic for debugging. TX loopback is enabled to confirm K-line output.

## References

- [RomRaider](https://github.com/RomRaider/RomRaider) — `DS2Protocol.java`, `DS2LoggerConnection.java`
- [handmade0octopus/ds2](https://github.com/handmade0octopus/ds2) — Arduino DS2 library with offset tables
- Logger.S wiki — MS43 group data documentation
