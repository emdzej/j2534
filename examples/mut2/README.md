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

### ID Address Space

The 256-byte address space is split into two ranges:

| Range | Type | Description |
|---|---|---|
| `0x00`–`0xBF` | **Requests** | Read-only sensor/status values from the MUT table |
| `0xC0`–`0xFF` | **Commands** | Actuator control, fault clearing, ECU identification |

Requests return a 1-byte value; commands trigger ECU actions (solenoids, relays, injector disable, etc.).

### 5-Baud Initialization Sequence

The K-line must be initialized with a slow 5-baud handshake before switching to 15625 baud:

1. Hold K-line HIGH for 300 ms
2. Send address byte `0x01` at 5 baud (LSB first, with start/stop bits):
   - Start bit: LOW 200 ms
   - Bit 0: HIGH 200 ms (LSB = 1)
   - Bits 1–7: LOW 200 ms each (= 0)
   - Stop bit: HIGH 200 ms
3. Switch to 15625 baud
4. Receive sync bytes: `C0 55 EF 85`
5. Begin sending request/command bytes

> **Note**: The original protocol documentation shows an extended handshake after sync
> (send `FE` → receive ECU ID high, send `FF` → receive ECU ID low, repeated, then
> `FD` exchanges). In practice via J2534, the `FIVE_BAUD_INIT` IOCTL handles steps 1–4
> and you can start sending requests immediately after sync.

### Communication Flow

1. Open ISO9141 channel at 15625 baud with `ISO9141_NO_CHECKSUM` flag (`0x0200`)
2. Perform `FIVE_BAUD_INIT` IOCTL with address `0x01`
3. ECU responds with sync bytes: `C0 55 EF 85`
4. Send 1-byte PID address, receive 1-byte value

### MUT over OBD-II (ELM Adapters)

MUT-II can also be accessed via ELM327-compatible adapters (Bluetooth/WiFi OBD-II dongles):

1. Open serial connection at 19200 baud
2. Send `ATSP0\r\n` — wait for `OK`
3. Send `A0<MUT_ID>\r\n` (e.g. `A032` for AFR map target)
4. Parse response `E0 <value>` (e.g. `E0 80` → value is `0x80`)
5. Apply the standard formula to get the scaled value

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

Reads diagnostic trouble codes as bitmasks. See also fault count/bitmask PIDs `0x36`–`0x48` in the PID table.

| Request | Description |
|---|---|
| `0x47` | Active faults, low byte (bits 0-7) |
| `0x48` | Active faults, high byte (bits 8-15) |
| `0x40` | Stored faults, low byte |
| `0x41` | Stored faults, high byte |

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

Sends `0xFC` to clear active EFI DTCs, or `0xFA` to clear both active and stored faults. Returns `0x00` on success.

> **Note**: EvoScan documents this as supported on 1994-1998 vehicles only.

### Pin 1 Ground (`--pin1-ground`)

Some Mitsubishi ECUs require OBD-II pin 1 to be pulled to ground to enter diagnostic mode. This option uses the OpenPort's `SetProgrammingVoltage` with `SHORT_TO_GROUND` on pin 1 before init, and releases it on cleanup.

### Raw Request (`--raw`)

Send an arbitrary 1-byte MUT-II request:

```bash
pnpm start -- --raw 21   # Read engine speed raw byte
```

## PID Table (Requests `0x00`–`0xBF`)

Formulas sourced from EvoScan `Mitsubishi MUTII EFI.xml` and [EvoEcu MUT Requests](https://web.archive.org/web/20170117231229/http://evoecu.logic.net/wiki/MUT_Requests). Not all PIDs apply to all vehicles.

> **Note**: MUT requests are read-only — changing a value has no effect on internal ECU calculations.

### Engine & Sensors

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x04` | Timing Advance (Interpolated) | `x - 20` | ° |
| `0x06` | Timing Advance | `x - 20` | ° |
| `0x07` | Coolant Temp | `x * 1.8 + 32` | °F |
| `0x10` | Coolant Temp Scaled | `1.8 * x - 40` | °F |
| `0x11` | MAF Air Temp Scaled | `1.8 * x - 40` | °F |
| `0x12` | EGR Temperature | `-2.7 * x + 597.7` | °F |
| `0x13` | O2 Sensor (Front) | `x * 0.01952` | V |
| `0x14` | Battery Voltage | `x * 0.07333` | V |
| `0x15` | Barometer | `x * 0.49` | kPa |
| `0x16` | ISC Steps | `x` | steps |
| `0x17` | Throttle Position | `x * 100 / 255` | % |
| `0x1A` | MAF Sensor (Airflow) | `x * 6.25` | Hz |
| `0x1C` | ECU Load | `x * 5 / 8` | load |
| `0x1D` | Accel Enrichment / Airflow per Rev | `x * 200 / 255` | load |
| `0x1F` | ECU Load (Previous) | `x * 5 / 8` | load |
| `0x20` | Engine RPM (Idle Scaled) | `x * 31.25` | RPM |
| `0x21` | Engine RPM | `x * 31.25` | RPM |
| `0x24` | Target Idle RPM | `x * 7.8` | RPM |
| `0x25` | Idle Stepper Value | `x` | count |
| `0x26` | Knock Sum | `x` | count |
| `0x27` | Octane Level | `x * 100 / 255` | % |
| `0x2A` | Injector Pulse Width | `x / 1000` | ms |
| `0x2C` | Air Volume | `x` | — |
| `0x2F` | Vehicle Speed | `x * 1.2427` | MPH |
| `0x30` | Knock Voltage | `x * 0.0195` | V |
| `0x31` | Volumetric Efficiency | `x * 0.0195` | V |
| `0x33` | Corrected Timing Advance | `x - 20` | ° |
| `0x38` | Boost (MAP) | `x * 0.19348` | PSI |
| `0x3A` | Intake Air Temp (Unscaled) | `x * 1.8 + 32` | °F |
| `0x3C` | Rear O2 Sensor #1 | `x * 0.01952` | V |
| `0x3D` | Front O2 Sensor #2 | `x * 0.01952` | V |
| `0x3E` | Rear O2 Sensor #2 | `x * 0.01952` | V |
| `0x79` | Injector Latency | `x` | ms |
| `0x96` | Raw MAF ADC | `x` | — |

### Fuel Trims

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x0C` | Fuel Trim Low (LTFT) | `(x - 128) / 5` | % |
| `0x0D` | Fuel Trim Mid (LTFT) | `(x - 128) / 5` | % |
| `0x0E` | Fuel Trim High (LTFT) | `(x - 128) / 5` | % |
| `0x0F` | O2 Feedback Trim (STFT) | `(x - 128) / 5` | % |
| `0x32` | AFR Map Target | `14.7 * 128 / x` | AFR |
| `0x4C` | Fuel Trim Low Bank 2 | — | — |
| `0x4D` | Fuel Trim Mid Bank 2 | — | — |
| `0x4E` | Fuel Trim High Bank 2 | — | — |
| `0x4F` | O2 Feedback Trim Bank 2 | — | — |
| `0x50` | Long Fuel Trim Bank 1 | — | — |
| `0x51` | Long Fuel Trim Bank 2 | — | — |
| `0x52` | Rear Long Fuel Trim Bank 1 | — | — |
| `0x53` | Rear Long Fuel Trim Bank 2 | — | — |

### Accel/Decel Enrichment

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x54` | Accel Enrichment (TPS increasing) | `x * 100 / 255` | % |
| `0x55` | Decel Enleanment (TPS decreasing) | `x * 100 / 255` | % |
| `0x56` | Accel Load Change | `x * 100 / 255` | % |
| `0x57` | Decel Load Change | `x * 100 / 255` | % |

### Boost Control (1998+)

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x86` | Wastegate Duty Cycle | `x / 2` | % |
| `0x8A` | Load Error | `0.15625 * x - 20` | load |
| `0x8B` | WGDC Correction | `0.5 * x - 64` | % |

### Knock Sub-Channels

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x6A` | Knock ADC (processed) | `x` | count |
| `0x6B` | Knock Base | `x` | count |
| `0x6C` | Knock Var (Sum Addition) | `x` | count |
| `0x6D` | Knock Change | `x` | count |
| `0x6E` | Knock Dynamics | `x` | count |
| `0x6F` | Knock Flag (Acceleration) | `x` | count |

### Duty Cycles & Outputs

| PID | Name | Formula | Units |
|---|---|---|---|
| `0x4A` | Purge Solenoid Duty | `x * 100 / 255` | % |
| `0x76` | ISCV % Demand | `x * 100 / 255` | % |
| `0x84` | Thermo Fan Duty | — | % |
| `0x85` | EGR Duty Cycle | `x / 1.28` | % |
| `0x8E` | Solenoid Duty | — | % |

### Fault Codes (Bitmask)

| PID | Name |
|---|---|
| `0x36` | Active Fault Count |
| `0x37` | Stored Fault Count |
| `0x40` | Stored Faults Low |
| `0x41` | Stored Faults High |
| `0x42` | Stored Faults Low 1 |
| `0x43` | Stored Faults High 1 |
| `0x44` | Stored Faults Low 2 |
| `0x45` | Stored Faults High 2 |
| `0x47` | Active Faults Low |
| `0x48` | Active Faults High |

### Bit-Field PIDs

| PID | Bit | Name |
|---|---|---|
| `0x49` | bit 4 | A/C Relay |
| `0x9A` | bit 1 | A/C Clutch |
| `0x9B` | — | Output Pins |
| `0xA2` | bit 1 | Crankshaft Sensor Pulse |
| `0xA2` | bit 2 | MAF Sensor Pulse |
| `0xA2` | bit 4 | Camshaft Sensor Pulse |
| `0xA8` | bit 1 | A/T Input Shaft Speed Pulse |
| `0xA8` | bit 2 | A/T Output Shaft Speed Pulse |
| `0xA8` | bit 32 | A/T Gear Low |
| `0xA8` | bit 64 | A/T Gear 2 |
| `0xA8` | bit 128 | A/T Gear 3 |
| `0xA9` | bit 16 | Front O2 Heater Bank 1 (Left) |
| `0xA9` | bit 32 | Rear O2 Heater Bank 1 (Left) |
| `0xA9` | bit 64 | Front O2 Heater Bank 2 (Right) |
| `0xA9` | bit 128 | Rear O2 Heater Bank 2 (Right) |
| `0xAA` | bit 16 | Brakes Pressed |
| `0xB3` | bit 1 | A/T Gear Neutral |
| `0xB3` | bit 2 | A/T Gear Drive |
| `0xB4` | bit 64 | A/T Gear Park |
| `0xB4` | bit 128 | A/T Gear Reverse |
| `0xB8` | bit 1 | A/C Switch |
| `0xB8` | bit 4 | Power Steering |
| `0xB8` | bit 8 | Front O2 Heater Circuit Open Bank 1 |
| `0xB9` | bit 8 | Rear O2 Heater Circuit Open Bank 2 |
| `0xBA` | bit 8 | Rear O2 Heater Circuit Open Bank 1 |

### ECU Identification

| PID | Name |
|---|---|
| `0x81` | ECU ID Type |
| `0x82` | ECU ID Version |
| `0xEC` | Calibration ID (Digits 7,8) |
| `0xED` | Calibration ID (Digits 5,6) |
| `0xEE` | Calibration ID (Digits 3,4) |
| `0xEF` | Calibration ID Identifier |

## Command Table (`0xC0`–`0xFF`)

Commands control actuators, solenoids, and ECU test functions. Send the command byte; the ECU acknowledges or activates the function.

| ID | Description |
|---|---|
| `0xC3` | SAS (Speed Adjusting Screw) — throttle bypass air |
| `0xC5` | Purge solenoid venting |
| `0xCD` | A/C fan high |
| `0xCE` | A/C fan low |
| `0xCF` | Main fan high |
| `0xD0` | Main fan low |
| `0xD2` | Lower RPM |
| `0xD3` | Boost control solenoid |
| `0xD5` | EGR solenoid |
| `0xD6` | Fuel pressure solenoid |
| `0xD7` | Purge solenoid |
| `0xD8` | Fuel pump |
| `0xD9` | Fix timing at 5 degrees |
| `0xDA` | Disable injector 1 |
| `0xDB` | Disable injector 2 |
| `0xDC` | Disable injector 3 |
| `0xDD` | Disable injector 4 |
| `0xDE` | Disable injector 5 (unused) |
| `0xDF` | Disable injector 6 (unused) |
| `0xF3` | Cancel previously-active command (e.g. SAS mode) |
| `0xF9` | Keep-alive (keeps actuator engaged, responds `0xFF`) |
| `0xFA` | Clear active and stored faults |
| `0xFB` | Force tests to run |
| `0xFC` | Clear active faults |
| `0xFE` | Immobilizer |
| `0xFF` | Init code |

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
- [EvoEcu: MUT Protocol](https://web.archive.org/web/20160805042316/http://evoecu.logic.net/wiki/MUT_Protocol) — 5-baud init sequence, protocol details
- [EvoEcu: MUT Requests](https://web.archive.org/web/20170117231229/http://evoecu.logic.net/wiki/MUT_Requests) — Comprehensive PID table
- [EvoEcu: MUT Commands](https://web.archive.org/web/20160805042719/http://evoecu.logic.net/wiki/MUT_Commands) — Actuator command IDs
- [libftdimut](https://github.com/niallmcandrew/libftdimut) — MUT-II over OpenPort 1.3u (FTDI), by Niall McAndrew
- [modifiedmitsubishi](https://www.modifiedmitsubishi.com/) — Community protocol documentation
