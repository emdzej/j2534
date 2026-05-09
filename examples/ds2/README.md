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
- The tool echoes all TX/RX traffic for debugging. TX loopback is enabled to confirm K-line output.

## DS2-MS43 Command Reference

Complete DS2 command set for the MS43 DME (Siemens Motronic, M54 engine), reconstructed from the BMW EDIABAS SGBD file `MS430DS0.prg` (BEST/1 bytecode disassembly).

All commands target ECU address `0x12`. Checksum (XOR of all preceding bytes) is appended automatically. The `xsetpar` configuration from the SGBD:

```
Konzept: 6 (DS2)
Baud:    9600 (0x2580)
ECU:     0x12
Timeout: 2000ms (0x07D0)
Retry:   100ms (0x0064)
Inter-byte: 20ms (0x0014)
```

### DS2 Service IDs

| Service | Hex | Description |
|---|---|---|
| IDENT | `0x00` | Read ECU identification |
| STATUS_LESEN | `0x04` | Read fault memory (quick) |
| DIAGNOSE_ENDE | `0x05` | End diagnostic session / clear faults |
| READ_MEMORY | `0x06` | Read arbitrary RAM addresses |
| STEUERN_STOP | `0x0A` | Stop actuator control |
| STATUS_BLOCK | `0x0B` | Read status data group |
| AIF_LESEN | `0x0D` | Read application info field |
| STEUERN_STOP_FUNC | `0x0E` | Stop diagnostic function |
| SHADOW_LESEN | `0x14` | Read shadow fault memory |
| STEUERN | `0x22` | Actuator control |
| DIAGNOSE_STOP | `0x23` | Stop individual diagnostic function |
| SYSTEMCHECK | `0x2B` | Start/read system check |
| ABGLEICH_LESEN | `0x40` | Read adjustment value |
| ABGLEICH_PROG | `0x42` | Write/program adjustment value |
| ABGLEICH_VERST | `0x44` | Adjust fuel consumption factor |
| ADAPT_LOESCHEN | `0x43` | Reset adaptations |
| SPEICHER_LIN | `0x6C` | Read linear memory |
| PRUEFCODE | `0x6D` | Read check code |
| PRUEFSTEMPEL | `0x90` | Read/write inspection stamp |
| SEED_KEY | `0x9E`/`0x9F` | Security access (challenge/response) |

### Status Groups (`0x0B <group>`)

| Group | Hex | EDIABAS Job | Data |
|---|---|---|---|
| Group 0x02 | `12 09 0B 02 ...` | STATUS_*_ADC | Analog sensor raw ADC values (air temp, coolant, oil, battery, TPS, etc.) |
| Group 0x03 | `12 05 0B 03` | STATUS_MESSWERTEBLOCK | Engine parameters (RPM, temps, voltages) — our `--live` command |
| Group 0x04 | `12 05 0B 04` | STATUS_DIGITAL | Digital I/O states (switches, relays, flags) |
| Group 0x05 | `12 05 0B 05` | STATUS_DIGITAL_OBDII | OBD-II readiness, MIL status, monitored systems |
| Group 0x91 | `12 05 0B 91` | STATUS_ADAP_AKTIV | Adaptation active flags (bank 1/2) |
| Group 0x92 | `12 05 0B 92` | STATUS_LL_*_ADAPTION | Idle adaptation values |
| Group 0x94 | `12 05 0B 94` | ECU_CONFIG, STATUS_PROG_STAT_EWS | ECU configuration flags, EWS status |
| Group 0x95 | `12 05 0B 95` | STATUS_FREIGABEZAEHLER_DMTL | DMTL release counter |
| Group 0xA3 | `12 05 0B A3` | STATUS_KM_MIL | Kilometers since MIL |

### ADC Status Group 0x02

Group 0x02 jobs use an 8-byte request template where byte 7 selects the sensor channel:

```
12 09 0B 02 0E 00 00 <channel> 00
```

Each STATUS_*_ADC job sets byte 7 to a channel selector, sends the request, then looks up the response status byte in the `JobResult` table and retrieves the converted value via table lookup.

### Actuator Control (`0x22 <actuator> <value>`)

| Actuator | Bytes | EDIABAS Job | Args |
|---|---|---|---|
| `0x81` | `12 06 22 81 xx` | STEUERN_SEK_PUMPE | `PUMPE_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x82` | `12 06 22 82 xx` | STEUERN_DMTL_MOTOR | `MOTOR_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x83` | `12 06 22 83 xx` | STEUERN_KF_THERMOSTAT | `TASTVERHAELTNIS`: 0-100% (default 80%) |
| `0x84` | `12 06 22 84 xx` | STEUERN_EKP | `PUMPE_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x86` | `12 06 22 86 xx` | STEUERN_DMTL_VENTIL | `VENTIL_AUF_ZU`: 0x00=closed, 0xFF=open |
| `0x87` | `12 06 22 87 xx` | STEUERN_DISA | `DISA_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x88` | `12 06 22 88 xx` | STEUERN_ABGASKLAPPE | `AKL_AUF_ZU`: 0x00=closed, 0xFF=open |
| `0x8A` | `12 06 22 8A xx` | STEUERN_MIL | `MIL_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x8E` | `12 06 22 8E xx` | STEUERN_KO | `KOMPRESSOR_EIN_AUS`: 0x00=off, 0xFF=on |
| `0x91` | `12 06 22 91 xx` | STEUERN_SEK_VENTIL | `VENTIL_AUF_ZU`: 0x00=inactive, 0xFF=active |
| `0x94` | `12 06 22 94 xx` | STEUERN_TEV | `TASTVERHAELTNIS`: duty cycle % |
| `0x9A` | `12 06 22 9A xx` | STEUERN_LS_HEIZUNG_VKAT_BANK1 | `TASTVERHAELTNIS`: 0-99% |
| `0x9B` | `12 06 22 9B xx` | STEUERN_LS_HEIZUNG_VKAT_BANK2 | `TASTVERHAELTNIS`: 0-99% |
| `0x9C` | `12 06 22 9C xx` | STEUERN_LS_HEIZUNG_NKAT_BANK1 | `TASTVERHAELTNIS`: 0-99% |
| `0x9D` | `12 06 22 9D xx` | STEUERN_LS_HEIZUNG_NKAT_BANK2 | `TASTVERHAELTNIS`: 0-99% |
| `0xA4` | `12 06 22 A4 xx` | STEUERN_VANOS_E_SOLLWERT | `NW_SPREIZUNG`: cam spread |
| `0xA5` | `12 06 22 A5 xx` | STEUERN_VANOS_A_SOLLWERT | `NW_SPREIZUNG`: cam spread |
| `0xA6` | `12 06 22 A6 xx` | STEUERN_VANOS_E_VENTIL | `TASTVERHAELTNIS`: duty cycle |
| `0xA7` | `12 06 22 A7 xx` | STEUERN_VANOS_A_VENTIL | `TASTVERHAELTNIS`: duty cycle |
| `0xB1-B6` | `12 07 22 Bx 5D 0A` | STEUERN_EV_1-6 | Injector cyl 1-6 (default: 23.3ms period) |
| `0xB7` | `12 06 22 B7 xx` | STEUERN_LL_STELLER | Idle actuator, 5-94% |
| `0xBA` | `12 06 22 BA xx` | STEUERN_DMTL_HEIZUNG | DMTL heater on/off |
| `0xBB` | `12 06 22 BB xx` | STEUERN_DMTL_TEV | TEV + DMTL combined |
| `0x92` | `12 07 22 92 xx xx` | STEUERN_E_LUEFTER | E-fan duty (2 bytes) |
| `0x95` | `12 07 22 95 xx xx` | STEUERN_TEMP_ANZEIGE_KOMBI | Temp gauge + overheat flag |
| `0xA2` | `12 07 22 A2 xx ...` | STEUERN_VANOS_E_VERSTELLZEIT | 2 position args |
| `0xA3` | `12 07 22 A3 xx ...` | STEUERN_VANOS_A_VERSTELLZEIT | 2 position args |

### Injector Control (Selective Blanking)

Individual injectors can be controlled with `STEUERN_EV_x_ARG` using:

```
12 07 22 Bx <pulse_hi> <pulse_lo>
```

Where `Bx` = `B1`-`B6` for cylinders 1-6, and `<pulse_hi><pulse_lo>` encode the injection pulse width (0-2.72ms) and period (0-2550ms). Default values from SGBD: `5D 0A` = 23.3ms/2560ms.

`STEUERN_EV_SELEKTIV_AUSBLENDEN` takes a cylinder number (1-6) as argument and uses `B1`-`B6` accordingly.

### Fault Memory

| Command | Bytes | EDIABAS Job | Description |
|---|---|---|---|
| Quick read | `12 05 04 00` | FS_QUICK_LESEN | Fault count + operating hours |
| Full read | `12 04 00` + parse | FS_LESEN | Full fault list with env conditions |
| Shadow read | `12 05 14 01` | FS_SHADOW_LESEN | Shadow fault memory |
| Clear all | `12 04 05` | FS_LOESCHEN | Clear entire fault memory |
| Clear selective | dynamic | FS_SELEKTIV_LOESCHEN | Clear specific faults (10 args) |

FS_LESEN returns structured fault data per fault code:
- `F_ORT_NR` / `F_ORT_TEXT` — fault location code + text (from table lookup)
- `F_HFK` — occurrence count
- `F_LZ` — logistics counter
- `F_ART1-8` — up to 8 fault type flags with text
- `F_UW1-5` — up to 5 environmental conditions (value + unit + text)
- `F_HEX_CODE` — raw 5-byte fault code

### Adaptation Reset (`0x43`)

| Command | Bytes | EDIABAS Job |
|---|---|---|
| Reset all | `12 06 43 FF FF` | ADAPT_LOESCHEN |
| Reset specific | `12 06 43 xx xx` | ADAPT_*_LOESCHEN (individual) |

Individual adaptation resets use specific bitmask values in the 2 data bytes. Known mappings from SGBD:
- ADAPT_LAUFUNRUHE_LOESCHEN — roughness
- ADAPT_SCHLIESSZEIT_LOESCHEN — injector closing time
- ADAPT_LM_SENSOR_LOESCHEN — air mass sensor
- ADAPT_DROSSELKLAPPE_LOESCHEN — throttle
- ADAPT_LAMBDA_LOESCHEN — lambda/O2
- ADAPT_LEERLAUF_LOESCHEN — idle
- ADAPT_KLOPFREGELUNG_LOESCHEN — knock control
- ADAPT_VARIANTEN_LOESCHEN — variants

### Adjustment Values (`0x40`/`0x42`/`0x44`)

| Command | Bytes | EDIABAS Job | Description |
|---|---|---|---|
| CO read | `12 05 40 01` | CO_ABGLEICH_LESEN | Read CO adjustment |
| LL read | `12 05 40 02` | LL_ABGLEICH_LESEN | Read idle adjustment |
| Fuel read | `12 05 44 02/03` | VERBRAUCH_ABGLEICH_LESEN | Read fuel consumption factor |
| CO program | `12 05 42 01` | CO_ABGLEICH_PROGRAMMIEREN | Write CO adjustment |
| LL program | `12 05 42 02` | LL_ABGLEICH_PROGRAMMIEREN | Write idle adjustment |

CO/LL adjustment can be modified via `CO_ABGLEICH_VERSTELLEN` / `LL_ABGLEICH_VERSTELLEN` (takes new value as arg), then programmed permanently with the `0x42` write commands.

### Memory Read (`0x06`)

```
12 09 06 <addr_hi> <addr_mid> <addr_lo> 00 <count>
```

SPEICHER_LIN_LESEN reads arbitrary RAM cells. Arguments:
- `SPEICHER_LIN_LESEN_ADRESSE` (long) — 24-bit start address
- `SPEICHER_LIN_LESEN_ANZAHL_BYTE` (int) — byte count

### System Checks (`0x2B`)

| Command | Bytes | EDIABAS Job |
|---|---|---|
| Start sync | `12 05 2B 01` | STEUERN_SYNC_MODE |
| Read sync | `12 05 2B 03` | STATUS_SYNC_MODE |
| Start misfire | `12 05 2B 05` | START_SYSTEMCHECK_LAUFUNRUHE |
| Start SAF | `12 05 2B A0` | START_SYSTEMCHECK_SEK_LUFT |
| Stop SAF | `12 05 2B A1` | STOP_SYSTEMCHECK_SEK_LUFT |

### Security Access (`0x9E`/`0x9F`)

SEED_KEY job: sends `12 04 9E` to get seed (random number), computes key, sends `12 04 9F` with response. Required for operations like KW_GEBER_FEHLER_RUECKSETZEN (crankshaft sensor error reset).

### Diagnostic Session

| Command | Bytes | EDIABAS Job | Description |
|---|---|---|---|
| Keep alive | `12 05 22 01` | DIAGNOSE_AUFRECHT | Keep diagnostic session alive |
| End session | `12 05 23 00/01` | DIAGNOSE_ENDE | End diagnostic session |
| Stop function | `12 04 0E` | (various) | Stop specific diagnostic function |

### Inspection Stamp (`0x90`)

```
12 08 90 42 4D 57 <byte1> <byte2> <byte3>
```

PRUEFSTEMPEL_SCHREIBEN writes 3 bytes. The prefix `42 4D 57` = ASCII "BMW".

### IDENT Results

The IDENT job (`0x00`) returns rich structured data:

| Result | Type | Description |
|---|---|---|
| ID_BMW_NR | string | BMW part number |
| ID_HW_NR | int | Hardware number |
| ID_COD_INDEX | string | Coding index |
| ID_DIAG_INDEX | string | Diagnostic index |
| ID_BUS_INDEX | string | Bus index |
| ID_DATUM_KW | string | Production date (calendar week) |
| ID_DATUM_JAHR | string | Production date (year) |
| ID_LIEF_NR | string | Supplier number |
| ID_SW_NR | string | Software number |
| ID_AI_NR | string | Change index |
| ID_PROD_NR | string | Production number |
| ID_MOTOR | string | Engine type identifier |
| ID_EWS_SS | int | EWS interface version |

### AIF (Application Info Field)

AIF_LESEN (`0x0D`) returns:

| Result | Type | Description |
|---|---|---|
| AIF_FG_NR | string | VIN (chassis number) |
| AIF_DATUM | string | Production date |
| AIF_SW_NR | long | Software number |
| AIF_ZB_NR | long | Assembly number |
| AIF_KM_STAND | long | Odometer (km) |
| AIF_ANZAHL_PROG | int | Flash/programming count |
| AIF_WERKSCODE | string | Dealer/workshop code |

## References

- BMW EDIABAS SGBD `MS430DS0.prg` — disassembled BEST/1 bytecode, 230 jobs (authoritative command source)
- [RomRaider](https://github.com/RomRaider/RomRaider) — `DS2Protocol.java`, `DS2LoggerConnection.java`
- [handmade0octopus/ds2](https://github.com/handmade0octopus/ds2) — Arduino DS2 library with offset tables
- Logger.S wiki — MS43 group data documentation
