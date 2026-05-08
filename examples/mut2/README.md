# Mitsubishi MUT-II Diagnostic Tool

Communicates with Mitsubishi ECUs (Evo 4-9, 3000GT, Eclipse, Galant VR-4, etc.) using the MUT-II protocol over K-line via a Tactrix OpenPort 2.0 J2534 interface.

## Protocol Overview

MUT-II is Mitsubishi's proprietary diagnostic protocol. It uses a simple 1-byte request / 1-byte response scheme over K-line after a 5-baud initialization handshake.

| Parameter | Value |
|---|---|
| Init | 5-baud, address byte `0x01` |
| Sync response | `C0 55 EF 85` |
| Baud rate | 15625 |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| K-line pin | OBD-II pin 7 |

### Communication Flow

1. Open ISO9141 channel at 15625 baud with `ISO9141_NO_CHECKSUM` flag (`0x0200`)
2. Perform `FIVE_BAUD_INIT` IOCTL with address `0x01`
3. ECU responds with sync bytes: `C0 55 EF 85`
4. Send 1-byte PID address, receive 1-byte value

### J2534 Configuration

- Protocol: ISO9141
- Connect flags: `ISO9141_NO_CHECKSUM` (`0x0200`)
- Parity: 0 (none), Data bits: 0 (8 bits)
- Loopback: enabled (TX echo for confirmation)
- P1_MAX: 2, P3_MIN: 0, P4_MIN: 0

## Supported Commands

### ECU Identification (`--ident`)

Reads ECU ROM ID via PIDs `0xFE` (high byte) and `0xFF` (low byte), producing a 16-bit identifier.

### Live Data (`--live`)

Polls PIDs in a loop with real-time display. Default PIDs: RPM, Coolant, TPS, Battery, Timing, Knock. Use `--pids` to select specific PIDs.

### Fault Codes (`--faults`)

Reads diagnostic trouble codes as bitmasks:

| Request | Description |
|---|---|
| `0x38` | Active faults, low byte (bits 0-7) |
| `0x39` | Active faults, high byte (bits 8-15) |
| `0x3B` | Stored faults, low byte |
| `0x3C` | Stored faults, high byte |

Each bit maps to a DTC:

| Bit | Code | Fault |
|---|---|---|
| 0 | 11 | Oxygen sensor |
| 1 | 12 | Intake air flow sensor |
| 2 | 13 | Intake air temperature sensor |
| 3 | 14 | Throttle position sensor |
| 4 | 15 | ISC motor position sensor |
| 5 | 21 | Engine coolant temperature sensor |
| 6 | 22 | Engine speed sensor |
| 7 | 23 | TDC sensor |
| 8 | 24 | Vehicle speed sensor |
| 9 | 25 | Barometric pressure sensor |
| 10 | 31 | Knock sensor |
| 11 | 41 | Injector circuit |
| 12 | 42 | Fuel pump relay |
| 13 | 43 | EGR |
| 14 | 44 | Ignition coil |
| 15 | 36 | Ignition circuit |

### Clear Faults (`--clear-faults`)

Sends `0xFC` to clear EFI DTCs. Returns `0x00` on success.

> **Note**: EvoScan documents this as supported on 1994-1998 vehicles only.

### Pin 1 Ground (`--pin1-ground`)

Some Mitsubishi ECUs require OBD-II pin 1 to be pulled to ground to enter diagnostic mode. This option uses the OpenPort's `SetProgrammingVoltage` with `SHORT_TO_GROUND` on pin 1 before init, and releases it on cleanup.

### Raw Request (`--raw`)

Send an arbitrary 1-byte MUT-II request:

```bash
pnpm start -- --raw 21   # Read engine speed raw byte
```

## PID Table

Formulas sourced from EvoScan `Mitsubishi MUTII EFI.xml`.

### Engine

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x21` | Engine Speed | `x * 31.25` | RPM |
| `0x07` | Coolant Temp | `x` | °C |
| `0x10` | Coolant Temp Scaled | `x - 40` | °C |
| `0x3A` | Intake Air Temp | `x` | °C |
| `0x11` | MAF Air Temp Scaled | `x - 40` | °C |
| `0x17` | Throttle Position | `x * 100 / 255` | % |
| `0x14` | Battery Voltage | `x * 0.07333` | V |
| `0x1A` | MAF Sensor | `x * 6.25` | Hz |
| `0x1C` | ECU Load | `x * 5 / 8` | — |
| `0x2F` | Vehicle Speed | `x * 2` | km/h |
| `0x29` | Injector Pulse Width | `x * 0.256` | ms |
| `0x06` | Timing Advance | `x - 20` | ° |
| `0x26` | Knock Count | `x` | count |
| `0x30` | Knock Voltage | `x * 0.0195` | V |
| `0x13` | O2 Sensor (Front) | `x * 0.01952` | V |
| `0x3C` | O2 Sensor #2 | `x * 0.01952` | V |
| `0x24` | Target Idle RPM | `x * 7.8` | RPM |
| `0x16` | ISC Steps | `x` | steps |

### Fuel

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x0C` | Fuel Trim Low (LTFT) | `0.1953125 * x - 25` | % |
| `0x0D` | Fuel Trim Mid (LTFT) | `0.1953125 * x - 25` | % |
| `0x0E` | Fuel Trim High (LTFT) | `0.1953125 * x - 25` | % |
| `0x50` | Fuel Trim In-Use | `0.1953125 * x - 25` | % |
| `0x0F` | O2 Feedback (STFT) | `0.1953125 * x - 25` | % |
| `0x32` | AFR Map Target | `14.7 * 128 / x` | AFR |

### Pressure / Air

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x15` | Barometer | `x * 0.49` | kPa |
| `0x38` | Boost (MAP) | `x * 0.19348` | PSI |
| `0x45` | MAP Scaled | `x` | kPa |
| `0x1D` | Airflow/Rev | `x * 200 / 255` | load |
| `0x2C` | Air Volume | `x` | — |
| `0x44` | MAT Scaled | `x - 40` | °C |
| `0x12` | EGR Temperature | `-2.7 * x + 597.7` | °F |

### Boost Control (1998+)

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x86` | Wastegate Duty | `x / 2` | % |
| `0x8A` | Load Error | `0.15625 * x - 20` | load |
| `0x8B` | WGDC Correction | `0.5 * x - 64` | % |

### Misc

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x27` | Octane Level | `x * 100 / 255` | % |
| `0x79` | Injector Latency | `x` | — |
| `0x1F` | Load 11Bit4 | `x` | — |
| `0x41` | Load 1Byte (mod) | `x * 1.2` | load |

## Usage

```bash
# Default: auto-detect serial transport, read ECU ID + quick status
pnpm start

# Read ECU identification only
pnpm start -- --ident

# Live data polling (default 30s)
pnpm start -- --live

# Live data for 60 seconds
pnpm start -- --live --duration 60

# Poll specific PIDs (hex)
pnpm start -- --live --pids 21,07,17

# Read fault codes
pnpm start -- --faults

# Clear fault codes
pnpm start -- --clear-faults

# Pull pin 1 to ground for ECUs that require it
pnpm start -- --pin1-ground

# Send raw MUT-II request
pnpm start -- --raw 21

# Force USB transport
pnpm start -- -u

# Specify serial port
pnpm start -- -p /dev/cu.usbmodemXXXX
```

## Hardware

- **Interface**: Tactrix OpenPort 2.0 (VID `0x0403`, PID `0xCC4D`)
- **Transport**: Serial (default, no sudo) or USB
- **Vehicles**: Mitsubishi with MUT-II (Evo 4-9, 3000GT, Eclipse, Galant VR-4, etc.)
- **Connector**: Standard OBD-II, K-line on pin 7

## References

- [EvoScan](https://www.evoscan.com/) — `Mitsubishi MUTII EFI.xml` PID definitions (authoritative formula source)
- [libftdimut](https://github.com/niallmcandrew/libftdimut) — MUT-II over OpenPort 1.3u (FTDI), by Niall McAndrew
- [EvoEcu wiki](https://www.evoecuflash.com/) — Community reverse-engineering documentation
- [modifiedmitsubishi](https://www.modifiedmitsubishi.com/) — Community protocol documentation
