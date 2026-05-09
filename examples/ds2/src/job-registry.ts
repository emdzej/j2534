/**
 * MS43 Job Registry — metadata for TUI job selector
 *
 * Each job entry describes a DS2 command from ms43-jobs.ts with:
 * - Display name and category
 * - Argument definitions (for modal prompt)
 * - Command builder function
 * - Response formatter (optional)
 */

import {
  MS43,
  ACTUATOR_ID,
  STATUS_GROUP,
  DS2_ACK,
  parseDS2Response,
  parseIdent,
  parseEcuConfig,
  parseObdReadiness,
  parseDigitalIO,
  parseEngineParams,
  parseFgrAbschaltung,
  type DS2Response,
} from "./ms43-jobs.js";
import { decodeFaultMemory, formatFaultMemory } from "./ms43-faults.js";

// ─── Types ────────────────────────────────────────────────────────

export interface JobArg {
  name: string;
  label: string;
  type: "number" | "boolean" | "hex" | "select";
  default?: string;
  min?: number;
  max?: number;
  options?: { label: string; value: string }[];
  description?: string;
}

export interface JobResult {
  success: boolean;
  ack: number;
  fields: { label: string; value: string }[];
  rawHex: string;
}

export type CommandBuilder = (args: Record<string, string>) => number[];
export type ResponseFormatter = (resp: DS2Response) => JobResult;

export interface JobEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  args: JobArg[];
  build: CommandBuilder;
  format: ResponseFormatter;
  /** If true, this job is safe for watch mode */
  watchable: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function defaultFormat(resp: DS2Response): JobResult {
  const fields: { label: string; value: string }[] = [
    { label: "ACK", value: `0x${resp.ack.toString(16)}` },
    { label: "Payload length", value: `${resp.payload.length} bytes` },
    { label: "Checksum", value: resp.checksumOk ? "OK" : "FAIL" },
  ];

  // Show payload as hex dump with ASCII
  const hex = formatHex(resp.payload);
  const ascii = Array.from(resp.payload)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
    .join("");
  fields.push({ label: "Payload (hex)", value: hex });
  fields.push({ label: "Payload (ASCII)", value: ascii });

  return {
    success: resp.ack === DS2_ACK.OK,
    ack: resp.ack,
    fields,
    rawHex: formatHex(resp.raw),
  };
}

function identFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const ident = parseIdent(resp.payload);
  return {
    ...base,
    fields: [
      { label: "Part Number", value: ident.partNumber },
      { label: "Software #", value: ident.softwareNumber },
      { label: "Coding Index", value: ident.codingIndex },
      { label: "Diag Index", value: ident.diagnosticIndex },
      { label: "Bus Index", value: ident.busIndex },
      { label: "Production", value: `W${ident.productionWeek}/${ident.productionYear}` },
      { label: "Supplier", value: ident.supplierNumber },
      { label: "Prod Number", value: ident.productionNumber },
      { label: "Raw", value: ident.raw },
    ],
  };
}

function ecuConfigFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const cfg = parseEcuConfig(resp.payload);
  return {
    ...base,
    fields: Object.entries(cfg).map(([k, v]) => ({
      label: k.replace(/^has/, "").replace(/([A-Z])/g, " $1").trim(),
      value: v ? "Yes" : "No",
    })),
  };
}

function obdReadinessFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const obd = parseObdReadiness(resp.payload);
  return {
    ...base,
    fields: Object.entries(obd).map(([k, v]) => ({
      label: k.replace(/([A-Z])/g, " $1").trim(),
      value: k === "milFaultCount" ? String(v) : v ? "Yes" : "No",
    })),
  };
}

function engineParamsFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const params = parseEngineParams(resp.payload);
  return {
    ...base,
    fields: params.map((p) => ({
      label: p.label,
      value: `${p.value} ${p.unit}`.trim(),
    })),
  };
}

function digitalIOFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const bits = parseDigitalIO(resp.payload);
  return {
    ...base,
    fields: bits.map((b) => ({
      label: b.label,
      value: b.active ? "ON" : "off",
    })),
  };
}

function fgrAbschaltungFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const bits = parseFgrAbschaltung(resp.payload);
  // Only show active flags + always show all for context
  return {
    ...base,
    fields: bits.map((b) => ({
      label: b.label,
      value: b.active ? "ACTIVE" : "ok",
    })),
  };
}

// ─── Fault Formatter ──────────────────────────────────────────────

function faultFormat(resp: DS2Response): JobResult {
  const base = defaultFormat(resp);
  if (resp.ack !== DS2_ACK.OK) return base;

  const decoded = decodeFaultMemory(resp.payload);
  if (!decoded.valid) return base;

  return {
    ...base,
    fields: formatFaultMemory(decoded),
  };
}

// ─── Registry ─────────────────────────────────────────────────────

const CYLINDER_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({
  label: `Cylinder ${n}`,
  value: String(n),
}));

const O2_HEATER_OPTIONS = [
  { label: "Pre-cat Bank 1", value: String(ACTUATOR_ID.O2_HEATER_PRE_CAT_B1) },
  { label: "Pre-cat Bank 2", value: String(ACTUATOR_ID.O2_HEATER_PRE_CAT_B2) },
  { label: "Post-cat Bank 1", value: String(ACTUATOR_ID.O2_HEATER_POST_CAT_B1) },
  { label: "Post-cat Bank 2", value: String(ACTUATOR_ID.O2_HEATER_POST_CAT_B2) },
];

export const JOB_REGISTRY: JobEntry[] = [
  // ── Identification ─────────────────────────────────────────────
  {
    id: "ident",
    name: "Read Identification",
    category: "Identification",
    description: "Read ECU identification block (IDENT)",
    args: [],
    build: () => MS43.readIdent(),
    format: identFormat,
    watchable: false,
  },
  {
    id: "app_info",
    name: "Read Application Info",
    category: "Identification",
    description: "Read VIN, odometer, etc. (AIF_LESEN)",
    args: [],
    build: () => MS43.readAppInfo(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "check_code",
    name: "Read Check Code",
    category: "Identification",
    description: "Read check code data (PRUEFCODE_LESEN)",
    args: [],
    build: () => MS43.readCheckCode(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "inspection_stamp",
    name: "Read Inspection Stamp",
    category: "Identification",
    description: "Read 3-byte inspection stamp (PRUEFSTEMPEL_LESEN)",
    args: [],
    build: () => MS43.readInspectionStamp(),
    format: defaultFormat,
    watchable: false,
  },

  // ── Status Groups ──────────────────────────────────────────────
  {
    id: "engine_params",
    name: "Engine Parameters",
    category: "Status",
    description: "RPM, temps, voltages (STATUS_MESSWERTEBLOCK)",
    args: [],
    build: () => MS43.readEngineParams(),
    format: engineParamsFormat,
    watchable: true,
  },
  {
    id: "digital_io",
    name: "Digital I/O States",
    category: "Status",
    description: "Digital input/output states (STATUS_DIGITAL)",
    args: [],
    build: () => MS43.readDigitalIO(),
    format: digitalIOFormat,
    watchable: true,
  },
  {
    id: "obd_readiness",
    name: "OBD-II Readiness",
    category: "Status",
    description: "MIL status and monitor readiness (STATUS_DIGITAL_OBDII)",
    args: [],
    build: () => MS43.readObdReadiness(),
    format: obdReadinessFormat,
    watchable: true,
  },
  {
    id: "ecu_config",
    name: "ECU Configuration",
    category: "Status",
    description: "ECU config flags / EWS status (ECU_CONFIG)",
    args: [],
    build: () => MS43.readEcuConfig(),
    format: ecuConfigFormat,
    watchable: false,
  },
  {
    id: "adaptation_active",
    name: "Adaptation Active",
    category: "Status",
    description: "Adaptation active flags bank 1/2 (STATUS_ADAP_AKTIV)",
    args: [],
    build: () => MS43.readAdaptationActive(),
    format: defaultFormat,
    watchable: true,
  },
  {
    id: "idle_adaptation",
    name: "Idle Adaptation",
    category: "Status",
    description: "Idle adaptation values (STATUS_LL_ADAPTION)",
    args: [],
    build: () => MS43.readIdleAdaptation(),
    format: defaultFormat,
    watchable: true,
  },
  {
    id: "leak_detection_counter",
    name: "DMTL Release Counter",
    category: "Status",
    description: "DMTL leak detection release counter",
    args: [],
    build: () => MS43.readLeakDetectionCounter(),
    format: defaultFormat,
    watchable: true,
  },
  {
    id: "fgr_abschaltung",
    name: "Cruise Control Cutoff",
    category: "Status",
    description: "Cruise control cutoff reason flags (STATUS_FGR_ABSCHALTUNG)",
    args: [],
    build: () => MS43.readFgrAbschaltung(),
    format: fgrAbschaltungFormat,
    watchable: true,
  },
  {
    id: "status_group",
    name: "Read Status Group",
    category: "Status",
    description: "Read arbitrary status group by ID",
    args: [
      { name: "group", label: "Group ID", type: "hex", default: "03", description: "Status group byte (hex)" },
    ],
    build: (args) => MS43.readStatusGroup(parseInt(args.group, 16)),
    format: defaultFormat,
    watchable: true,
  },
  {
    id: "adc_sensor",
    name: "Read ADC Sensor",
    category: "Status",
    description: "Read analog sensor ADC channel",
    args: [
      { name: "channel", label: "ADC Channel", type: "hex", default: "00", description: "Channel selector byte (hex)" },
    ],
    build: (args) => MS43.readAdcSensor(parseInt(args.channel, 16)),
    format: defaultFormat,
    watchable: true,
  },

  // ── Fault Memory ───────────────────────────────────────────────
  {
    id: "faults_quick",
    name: "Quick Fault Read",
    category: "Faults",
    description: "Fault count + operating hours (FS_QUICK_LESEN)",
    args: [],
    build: () => MS43.readFaultsQuick(),
    format: faultFormat,
    watchable: false,
  },
  {
    id: "faults_shadow",
    name: "Shadow Faults",
    category: "Faults",
    description: "Read stored/shadow fault memory (FS_SHADOW_LESEN)",
    args: [],
    build: () => MS43.readShadowFaults(),
    format: faultFormat,
    watchable: false,
  },
  {
    id: "clear_faults",
    name: "Clear All Faults",
    category: "Faults",
    description: "Clear entire fault memory (FS_LOESCHEN)",
    args: [],
    build: () => MS43.clearFaults(),
    format: defaultFormat,
    watchable: false,
  },

  // ── Actuator Control ───────────────────────────────────────────
  {
    id: "fuel_pump",
    name: "Fuel Pump",
    category: "Actuators",
    description: "EKP relay on/off (STEUERN_EKP)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlFuelPump(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "check_engine_light",
    name: "Check Engine Light",
    category: "Actuators",
    description: "MIL on/off (STEUERN_MIL)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlCheckEngineLight(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "secondary_air_pump",
    name: "Secondary Air Pump",
    category: "Actuators",
    description: "Secondary air pump on/off (STEUERN_SEK_PUMPE)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlSecondaryAirPump(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "secondary_air_valve",
    name: "Secondary Air Valve",
    category: "Actuators",
    description: "Secondary air valve on/off (STEUERN_SEK_VENTIL)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlSecondaryAirValve(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "intake_manifold",
    name: "Intake Manifold (DISA)",
    category: "Actuators",
    description: "DISA intake manifold on/off (STEUERN_DISA)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlIntakeManifold(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "exhaust_flap",
    name: "Exhaust Flap",
    category: "Actuators",
    description: "Exhaust flap open/close (STEUERN_ABGASKLAPPE)",
    args: [{ name: "open", label: "Open", type: "boolean", default: "true" }],
    build: (args) => MS43.controlExhaustFlap(args.open === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "ac_compressor",
    name: "AC Compressor",
    category: "Actuators",
    description: "AC compressor relay on/off (STEUERN_KO)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlAcCompressor(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "leak_detection_motor",
    name: "DMTL Motor",
    category: "Actuators",
    description: "Leak detection motor on/off (STEUERN_DMTL_MOTOR)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlLeakDetectionMotor(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "leak_detection_valve",
    name: "DMTL Valve",
    category: "Actuators",
    description: "Leak detection valve open/close (STEUERN_DMTL_VENTIL)",
    args: [{ name: "open", label: "Open", type: "boolean", default: "true" }],
    build: (args) => MS43.controlLeakDetectionValve(args.open === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "leak_detection_heater",
    name: "DMTL Heater",
    category: "Actuators",
    description: "Leak detection heater on/off (STEUERN_DMTL_HEIZUNG)",
    args: [{ name: "on", label: "Enable", type: "boolean", default: "true" }],
    build: (args) => MS43.controlLeakDetectionHeater(args.on === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "electric_fan",
    name: "Electric Fan",
    category: "Actuators",
    description: "Electric fan duty cycle (STEUERN_E_LUEFTER)",
    args: [{ name: "duty", label: "Duty %", type: "number", default: "50", min: 0, max: 100 }],
    build: (args) => MS43.controlElectricFan(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "map_thermostat",
    name: "Map Thermostat",
    category: "Actuators",
    description: "Map thermostat duty cycle (STEUERN_KF_THERMOSTAT)",
    args: [{ name: "duty", label: "Duty %", type: "number", default: "80", min: 0, max: 100 }],
    build: (args) => MS43.controlMapThermostat(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "evap_purge",
    name: "Evap Purge Valve (TEV)",
    category: "Actuators",
    description: "Evap purge valve duty cycle (STEUERN_TEV)",
    args: [{ name: "duty", label: "Duty %", type: "number", default: "50", min: 0, max: 100 }],
    build: (args) => MS43.controlEvapPurgeValve(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "evap_combined",
    name: "Evap Combined (TEV+DMTL)",
    category: "Actuators",
    description: "Combined TEV + DMTL duty cycle (STEUERN_DMTL_TEV)",
    args: [{ name: "duty", label: "Duty %", type: "number", default: "50", min: 0, max: 100 }],
    build: (args) => MS43.controlEvapCombined(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "idle_actuator",
    name: "Idle Actuator",
    category: "Actuators",
    description: "Idle actuator duty cycle 5-94% (STEUERN_LL_STELLER)",
    args: [{ name: "duty", label: "Duty %", type: "number", default: "50", min: 5, max: 94 }],
    build: (args) => MS43.controlIdleActuator(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "temp_gauge",
    name: "Temperature Gauge",
    category: "Actuators",
    description: "Set cluster temperature gauge (STEUERN_TEMP_ANZEIGE_KOMBI)",
    args: [
      { name: "temp", label: "Temp Value", type: "number", default: "100", min: 0, max: 255 },
      { name: "overheat", label: "Overheat Flag", type: "boolean", default: "false" },
    ],
    build: (args) => MS43.controlTempGauge(Number(args.temp), args.overheat === "true"),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "vanos_intake_setpoint",
    name: "VANOS Intake Setpoint",
    category: "Actuators",
    description: "VANOS intake cam spread (STEUERN_VANOS_E_SOLLWERT)",
    args: [{ name: "spread", label: "Spread (KW)", type: "number", default: "100", min: 80, max: 120 }],
    build: (args) => MS43.controlVanosIntakeSetpoint(Number(args.spread)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "vanos_exhaust_setpoint",
    name: "VANOS Exhaust Setpoint",
    category: "Actuators",
    description: "VANOS exhaust cam spread (STEUERN_VANOS_A_SOLLWERT)",
    args: [{ name: "spread", label: "Spread (KW)", type: "number", default: "90", min: 0, max: 255 }],
    build: (args) => MS43.controlVanosExhaustSetpoint(Number(args.spread)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "vanos_intake_valve",
    name: "VANOS Intake Valve",
    category: "Actuators",
    description: "VANOS intake valve duty (STEUERN_VANOS_E_VENTIL)",
    args: [{ name: "duty", label: "Duty", type: "number", default: "128", min: 0, max: 255 }],
    build: (args) => MS43.controlVanosIntakeValve(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "vanos_exhaust_valve",
    name: "VANOS Exhaust Valve",
    category: "Actuators",
    description: "VANOS exhaust valve duty (STEUERN_VANOS_A_VENTIL)",
    args: [{ name: "duty", label: "Duty", type: "number", default: "128", min: 0, max: 255 }],
    build: (args) => MS43.controlVanosExhaustValve(Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "o2_heater",
    name: "O2 Sensor Heater",
    category: "Actuators",
    description: "O2 sensor heater duty cycle (STEUERN_LS_HEIZUNG)",
    args: [
      { name: "sensor", label: "Sensor", type: "select", options: O2_HEATER_OPTIONS, default: String(ACTUATOR_ID.O2_HEATER_PRE_CAT_B1) },
      { name: "duty", label: "Duty %", type: "number", default: "50", min: 0, max: 99 },
    ],
    build: (args) => MS43.controlO2Heater(Number(args.sensor) as any, Number(args.duty)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "injector",
    name: "Injector Control",
    category: "Actuators",
    description: "Control individual cylinder injector (STEUERN_EV)",
    args: [
      { name: "cylinder", label: "Cylinder", type: "select", options: CYLINDER_OPTIONS, default: "1" },
      { name: "pulseHi", label: "Pulse Hi", type: "hex", default: "5d" },
      { name: "pulseLo", label: "Pulse Lo", type: "hex", default: "0a" },
    ],
    build: (args) => MS43.controlInjector(
      Number(args.cylinder) as any,
      parseInt(args.pulseHi, 16),
      parseInt(args.pulseLo, 16),
    ),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "throttle",
    name: "Throttle Angle",
    category: "Actuators",
    description: "Throttle body angle control (STEUERN_DK_WINKEL)",
    args: [{ name: "angle", label: "Angle", type: "number", default: "0", min: 0, max: 255 }],
    build: (args) => MS43.controlThrottle(Number(args.angle)),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "idle_speed",
    name: "Idle Speed",
    category: "Actuators",
    description: "Adjust idle RPM 512-1792 (STEUERN_LL_DREHZAHL_VERSTELLEN)",
    args: [{ name: "rpm", label: "Target RPM", type: "number", default: "800", min: 512, max: 1792 }],
    build: (args) => MS43.controlIdleSpeed(Number(args.rpm)),
    format: defaultFormat,
    watchable: false,
  },

  // ── Control ────────────────────────────────────────────────────
  {
    id: "stop_control",
    name: "Stop Actuator Control",
    category: "Control",
    description: "Stop all actuator control (STEUERN_STOP)",
    args: [],
    build: () => MS43.stopControl(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "keep_alive",
    name: "Keep Alive",
    category: "Control",
    description: "Keep diagnostic session alive (DIAGNOSE_AUFRECHT)",
    args: [],
    build: () => MS43.keepAlive(),
    format: defaultFormat,
    watchable: true,
  },
  {
    id: "end_session",
    name: "End Session",
    category: "Control",
    description: "End diagnostic session (DIAGNOSE_ENDE)",
    args: [],
    build: () => MS43.endSession(),
    format: defaultFormat,
    watchable: false,
  },

  // ── Adaptation ─────────────────────────────────────────────────
  {
    id: "reset_all_adaptations",
    name: "Reset ALL Adaptations",
    category: "Adaptation",
    description: "Reset all adaptation values (ADAPT_LOESCHEN)",
    args: [],
    build: () => MS43.resetAllAdaptations(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "co_adjustment_read",
    name: "Read CO Adjustment",
    category: "Adaptation",
    description: "Read CO trim value (CO_ABGLEICH_LESEN)",
    args: [],
    build: () => MS43.readCoAdjustment(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "idle_adjustment_read",
    name: "Read Idle Adjustment",
    category: "Adaptation",
    description: "Read idle trim value (LL_ABGLEICH_LESEN)",
    args: [],
    build: () => MS43.readIdleAdjustment(),
    format: defaultFormat,
    watchable: false,
  },

  // ── Memory ─────────────────────────────────────────────────────
  {
    id: "read_memory",
    name: "Read Memory",
    category: "Memory",
    description: "Read arbitrary RAM cells (SPEICHER_LIN_LESEN)",
    args: [
      { name: "address", label: "Address (hex)", type: "hex", default: "000000", description: "24-bit start address" },
      { name: "count", label: "Byte Count", type: "number", default: "16", min: 1, max: 255 },
    ],
    build: (args) => MS43.readMemory(parseInt(args.address, 16), Number(args.count)),
    format: defaultFormat,
    watchable: true,
  },

  // ── Security ───────────────────────────────────────────────────
  {
    id: "request_seed",
    name: "Request Seed",
    category: "Security",
    description: "Request security access seed (SEED_KEY step 1)",
    args: [],
    build: () => MS43.requestSeed(),
    format: defaultFormat,
    watchable: false,
  },

  // ── System Checks ──────────────────────────────────────────────
  {
    id: "misfire_test",
    name: "Start Misfire Test",
    category: "System Check",
    description: "Start roughness/misfire test (START_SYSTEMCHECK_LAUFUNRUHE)",
    args: [],
    build: () => MS43.startMisfireTest(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "secondary_air_test_start",
    name: "Start Secondary Air Test",
    category: "System Check",
    description: "Start secondary air system check",
    args: [],
    build: () => MS43.startSecondaryAirTest(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "secondary_air_test_stop",
    name: "Stop Secondary Air Test",
    category: "System Check",
    description: "Stop secondary air system check",
    args: [],
    build: () => MS43.stopSecondaryAirTest(),
    format: defaultFormat,
    watchable: false,
  },
  {
    id: "ews_sync_status",
    name: "EWS Sync Status",
    category: "System Check",
    description: "Read EWS synchronization status",
    args: [],
    build: () => MS43.readEwsSyncStatus(),
    format: defaultFormat,
    watchable: false,
  },

  // ── Raw ────────────────────────────────────────────────────────
  {
    id: "raw_command",
    name: "Raw DS2 Command",
    category: "Advanced",
    description: "Send arbitrary DS2 hex bytes (auto-framed)",
    args: [
      { name: "payload", label: "Payload (hex)", type: "hex", default: "00", description: "Payload bytes without addr/len/checksum" },
    ],
    build: (args) => {
      const bytes = args.payload
        .trim()
        .split(/[\s,]+/)
        .map((b) => parseInt(b, 16));
      // Use ds2Build via the generic actuator wrapper — or build manually
      const ECU_ADDR = 0x12;
      const length = 2 + bytes.length + 1;
      const frame = [ECU_ADDR, length, ...bytes];
      let xor = 0;
      for (const b of frame) xor ^= b;
      frame.push(xor);
      return frame;
    },
    format: defaultFormat,
    watchable: false,
  },
];

/**
 * Get unique categories in registry order
 */
export function getCategories(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const job of JOB_REGISTRY) {
    if (!seen.has(job.category)) {
      seen.add(job.category);
      result.push(job.category);
    }
  }
  return result;
}
