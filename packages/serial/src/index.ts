import { type Transport, type DeviceInfo } from "@emdzej/j2534-types";
import { SerialPort } from "serialport";

/**
 * Default serial port path pattern for Tactrix OpenPort 2.0 on macOS.
 * The device shows up as /dev/cu.usbmodemXXXX when the CDC ACM driver claims it.
 */
const OPENPORT_PATH_PATTERN = /usbmodem/i;

/**
 * Node.js serial port transport for the Tactrix OpenPort 2.0.
 *
 * Works with the macOS CDC ACM kernel driver — no sudo required.
 * The kernel driver creates a serial device at /dev/cu.usbmodemXXXX
 * which this transport communicates through.
 */
export class SerialTransport implements Transport {
  private port: SerialPort | null = null;
  private _isConnected = false;
  private rxBuffer: Buffer[] = [];
  private rxResolve: ((data: Uint8Array) => void) | null = null;
  private rxReject: ((err: Error) => void) | null = null;
  private rxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private path?: string, private baudRate = 115200) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async open(): Promise<void> {
    const portPath = this.path ?? (await this.autoDetectPath());

    this.port = new SerialPort({
      path: portPath,
      baudRate: this.baudRate,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => {
        if (err) reject(new Error(`Failed to open ${portPath}: ${err.message}`));
        else resolve();
      });
    });

    this.port.on("data", (chunk: Buffer) => {
      if (this.rxResolve) {
        // A read is pending — deliver immediately
        const resolve = this.rxResolve;
        this.rxResolve = null;
        this.rxReject = null;
        if (this.rxTimer) {
          clearTimeout(this.rxTimer);
          this.rxTimer = null;
        }
        // Include any previously buffered data
        if (this.rxBuffer.length > 0) {
          this.rxBuffer.push(chunk);
          const combined = Buffer.concat(this.rxBuffer);
          this.rxBuffer = [];
          resolve(new Uint8Array(combined));
        } else {
          resolve(new Uint8Array(chunk));
        }
      } else {
        // No pending read — buffer it
        this.rxBuffer.push(chunk);
      }
    });

    this.port.on("error", (err) => {
      if (this.rxReject) {
        const reject = this.rxReject;
        this.rxResolve = null;
        this.rxReject = null;
        if (this.rxTimer) {
          clearTimeout(this.rxTimer);
          this.rxTimer = null;
        }
        reject(err);
      }
    });

    this._isConnected = true;
  }

  async close(): Promise<void> {
    if (this.rxReject) {
      this.rxReject(new Error("Transport closed"));
      this.rxResolve = null;
      this.rxReject = null;
    }
    if (this.rxTimer) {
      clearTimeout(this.rxTimer);
      this.rxTimer = null;
    }
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => {
        this.port!.close(() => resolve());
      });
    }
    this.port = null;
    this.rxBuffer = [];
    this._isConnected = false;
  }

  async write(data: Uint8Array): Promise<number> {
    if (!this.port?.isOpen) {
      throw new Error("Transport not connected");
    }
    return new Promise((resolve, reject) => {
      this.port!.write(Buffer.from(data), (err) => {
        if (err) reject(err);
        else {
          this.port!.drain((drainErr) => {
            if (drainErr) reject(drainErr);
            else resolve(data.length);
          });
        }
      });
    });
  }

  async read(timeout = 1000): Promise<Uint8Array> {
    if (!this.port?.isOpen) {
      throw new Error("Transport not connected");
    }

    // If we already have buffered data, return it immediately
    if (this.rxBuffer.length > 0) {
      const combined = Buffer.concat(this.rxBuffer);
      this.rxBuffer = [];
      return new Uint8Array(combined);
    }

    // Wait for incoming data with timeout
    return new Promise((resolve, reject) => {
      this.rxResolve = resolve;
      this.rxReject = reject;
      this.rxTimer = setTimeout(() => {
        this.rxResolve = null;
        this.rxReject = null;
        this.rxTimer = null;
        reject(new Error("LIBUSB_TRANSFER_TIMED_OUT"));
      }, timeout);
    });
  }

  /**
   * Auto-detect the serial port path for a Tactrix OpenPort 2.0.
   */
  private async autoDetectPath(): Promise<string> {
    const ports = await SerialPort.list();
    const match = ports.find(
      (p) =>
        OPENPORT_PATH_PATTERN.test(p.path) &&
        (p.vendorId?.toLowerCase() === "0403" ||
          p.manufacturer?.toLowerCase().includes("tactrix"))
    );
    if (match) {
      return match.path;
    }

    // Fallback: any usbmodem port
    const fallback = ports.find((p) => OPENPORT_PATH_PATTERN.test(p.path));
    if (fallback) {
      return fallback.path;
    }

    throw new Error(
      "Tactrix OpenPort not found. Available ports: " +
        ports.map((p) => p.path).join(", ")
    );
  }
}

/**
 * List serial ports that look like Tactrix OpenPort devices.
 */
export async function listSerialDevices(): Promise<DeviceInfo[]> {
  const ports = await SerialPort.list();
  return ports
    .filter(
      (p) =>
        OPENPORT_PATH_PATTERN.test(p.path) ||
        p.manufacturer?.toLowerCase().includes("tactrix")
    )
    .map((p) => ({
      vendorId: parseInt(p.vendorId ?? "0", 16),
      productId: parseInt(p.productId ?? "0", 16),
      serialNumber: p.serialNumber,
      manufacturer: p.manufacturer,
      product: p.path,
    }));
}

export default SerialTransport;
