/**
 * J2534 Error/Status Codes (SAE J2534-1)
 */
export enum J2534Error {
  STATUS_NOERROR = 0x00,
  ERR_NOT_SUPPORTED = 0x01,
  ERR_INVALID_CHANNEL_ID = 0x02,
  ERR_INVALID_PROTOCOL_ID = 0x03,
  ERR_NULL_PARAMETER = 0x04,
  ERR_INVALID_IOCTL_VALUE = 0x05,
  ERR_INVALID_FLAGS = 0x06,
  ERR_FAILED = 0x07,
  ERR_DEVICE_NOT_CONNECTED = 0x08,
  ERR_TIMEOUT = 0x09,
  ERR_INVALID_MSG = 0x0a,
  ERR_INVALID_TIME_INTERVAL = 0x0b,
  ERR_EXCEEDED_LIMIT = 0x0c,
  ERR_INVALID_MSG_ID = 0x0d,
  ERR_DEVICE_IN_USE = 0x0e,
  ERR_INVALID_IOCTL_ID = 0x0f,
  ERR_BUFFER_EMPTY = 0x10,
  ERR_BUFFER_FULL = 0x11,
  ERR_BUFFER_OVERFLOW = 0x12,
  ERR_PIN_INVALID = 0x13,
  ERR_CHANNEL_IN_USE = 0x14,
  ERR_MSG_PROTOCOL_ID = 0x15,
  ERR_INVALID_FILTER_ID = 0x16,
  ERR_NO_FLOW_CONTROL = 0x17,
  ERR_NOT_UNIQUE = 0x18,
  ERR_INVALID_BAUDRATE = 0x19,
  ERR_INVALID_DEVICE_ID = 0x1a,
}

/**
 * J2534 Protocol IDs (J2534-1)
 */
export enum Protocol {
  J1850VPW = 0x01,
  J1850PWM = 0x02,
  ISO9141 = 0x03,
  ISO14230 = 0x04,
  CAN = 0x05,
  ISO15765 = 0x06,
  SCI_A_ENGINE = 0x07,
  SCI_A_TRANS = 0x08,
  SCI_B_ENGINE = 0x09,
  SCI_B_TRANS = 0x0a,
}

/**
 * J2534-2 Extended Protocol/Channel IDs (Tactrix OpenPort 2.0)
 */
export enum ProtocolExt {
  /** CAN channel 1 */
  CAN_CH1 = 0x00009000,
  /** ISO15765 channel 1 */
  ISO15765_CH1 = 0x00009040,
  /** J1850VPW channel 1 */
  J1850VPW_CH1 = 0x00009080,
  /** J1850PWM channel 1 */
  J1850PWM_CH1 = 0x00009160,
  /** ISO9141 K-line (channel 1) */
  ISO9141_K = 0x00009200,
  /** ISO9141 L-line (channel 2) */
  ISO9141_L = 0x00009201,
  /** ISO9141 AUX / RS-232 via 2.5mm jack (channel 3) */
  ISO9141_INNO = 0x00009202,
  /** ISO14230 K-line (channel 1) */
  ISO14230_K = 0x00009280,
  /** ISO14230 L-line (channel 2) */
  ISO14230_L = 0x00009281,
}

/**
 * Connect flags
 */
export enum ConnectFlag {
  CAN_29BIT_ID = 0x0100,
  ISO9141_NO_CHECKSUM = 0x0200,
  CAN_ID_BOTH = 0x0800,
  ISO9141_K_LINE_ONLY = 0x1000,
  /** Tactrix: passive sniff mode (CAN: no ACK sent) */
  SNIFF_MODE = 0x10000000,
}

/**
 * OBD-II connector pin numbers (for SetProgrammingVoltage / ReadVoltage)
 */
export enum Pin {
  AUX = 0,
  PIN_1 = 1,
  PIN_2_J1850P = 2,
  PIN_3 = 3,
  PIN_6_CAN_H = 6,
  PIN_7_K_LINE = 7,
  PIN_9 = 9,
  PIN_10_J1850M = 10,
  PIN_11 = 11,
  PIN_12 = 12,
  PIN_13 = 13,
  PIN_14_CAN_L = 14,
  PIN_15_L_LINE = 15,
  PIN_16_VBATT = 16,
}

/**
 * Special voltage values for PassThruSetProgrammingVoltage
 */
export const VOLTAGE_OFF = 0xffffffff;
export const SHORT_TO_GROUND = 0xfffffffe;

/**
 * Rx/Tx status flags
 */
export enum RxStatus {
  TX_MSG_TYPE = 0x0001,
  START_OF_MESSAGE = 0x0002,
  ISO15765_FIRST_FRAME = 0x0002,
  RX_BREAK = 0x0004,
  TX_INDICATION = 0x0008,
  ISO15765_PADDING_ERROR = 0x0010,
  ISO15765_EXT_ADDR = 0x0080,
  CAN_29BIT_ID = 0x0100,
}

export enum TxFlag {
  ISO15765_FRAME_PAD = 0x0040,
  ISO15765_ADDR_TYPE = 0x0080,
  CAN_29BIT_ID = 0x0100,
  WAIT_P3_MIN_ONLY = 0x0200,
  SCI_MODE = 0x400000,
  SCI_TX_VOLTAGE = 0x800000,
}

/**
 * Filter types
 */
export enum FilterType {
  PASS_FILTER = 0x01,
  BLOCK_FILTER = 0x02,
  FLOW_CONTROL_FILTER = 0x03,
}

/**
 * IOCTL IDs
 */
export enum IoctlId {
  GET_CONFIG = 0x01,
  SET_CONFIG = 0x02,
  READ_VBATT = 0x03,
  FIVE_BAUD_INIT = 0x04,
  FAST_INIT = 0x05,
  CLEAR_TX_BUFFER = 0x07,
  CLEAR_RX_BUFFER = 0x08,
  CLEAR_PERIODIC_MSGS = 0x09,
  CLEAR_MSG_FILTERS = 0x0a,
  CLEAR_FUNCT_MSG_LOOKUP_TABLE = 0x0b,
  ADD_TO_FUNCT_MSG_LOOKUP_TABLE = 0x0c,
  DELETE_FROM_FUNCT_MSG_LOOKUP_TABLE = 0x0d,
  READ_PROG_VOLTAGE = 0x0e,
}

/**
 * Configuration parameter IDs
 */
export enum ConfigParam {
  DATA_RATE = 0x01,
  LOOPBACK = 0x03,
  NODE_ADDRESS = 0x04,
  NETWORK_LINE = 0x05,
  P1_MIN = 0x06,
  P1_MAX = 0x07,
  P2_MIN = 0x08,
  P2_MAX = 0x09,
  P3_MIN = 0x0a,
  P3_MAX = 0x0b,
  P4_MIN = 0x0c,
  P4_MAX = 0x0d,
  W0 = 0x19,
  W1 = 0x0e,
  W2 = 0x0f,
  W3 = 0x10,
  W4 = 0x11,
  W5 = 0x12,
  TIDLE = 0x13,
  TINIL = 0x14,
  TWUP = 0x15,
  PARITY = 0x16,
  BIT_SAMPLE_POINT = 0x17,
  SYNC_JUMP_WIDTH = 0x18,
  T1_MAX = 0x1a,
  T2_MAX = 0x1b,
  T3_MAX = 0x1c,
  T4_MAX = 0x1d,
  T5_MAX = 0x1e,
  ISO15765_BS = 0x1f,
  ISO15765_STMIN = 0x20,
  ISO15765_BS_TX = 0x22,
  ISO15765_STMIN_TX = 0x23,
  DATA_BITS = 0x21,
  ISO15765_WFT_MAX = 0x24,
}

/**
 * PASSTHRU_MSG structure
 */
export interface PassThruMsg {
  protocolId: Protocol;
  rxStatus: number;
  txFlags: number;
  timestamp: number;
  dataSize: number;
  extraDataIndex: number;
  data: Uint8Array;
}

/**
 * Configuration item (for GET_CONFIG / SET_CONFIG)
 */
export interface SConfig {
  parameter: ConfigParam;
  value: number;
}

/**
 * Byte array (for IOCTL input/output)
 */
export interface SByteArray {
  numOfBytes: number;
  data: Uint8Array;
}

/**
 * Version info returned by PassThruReadVersion
 */
export interface VersionInfo {
  firmwareVersion: string;
  dllVersion: string;
  apiVersion: string;
}

/**
 * Transport interface - abstraction over USB implementations.
 * Both Node.js `usb` and browser WebUSB implement this.
 */
export interface Transport {
  /** Open connection to device */
  open(): Promise<void>;

  /** Close connection */
  close(): Promise<void>;

  /** Write raw bytes to device bulk OUT endpoint */
  write(data: Uint8Array): Promise<number>;

  /** Read raw bytes from device bulk IN endpoint */
  read(timeout?: number): Promise<Uint8Array>;

  /** Whether the transport is currently connected */
  readonly isConnected: boolean;
}

/**
 * Device descriptor for discovery
 */
export interface DeviceInfo {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
}

/**
 * Openport 2.0 USB identifiers
 */
export const OPENPORT_VID = 0x0403;
export const OPENPORT_PID = 0xcc4d;

/**
 * Periodic message state
 */
export interface PeriodicMsgState {
  id: number;
  channelId: number;
  msg: PassThruMsg;
  intervalMs: number;
  timer: unknown;
}

/**
 * Functional message lookup table entry
 */
export interface FunctionalAddress {
  address: Uint8Array;
}
