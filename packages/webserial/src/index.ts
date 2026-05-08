import {
  type Transport,
  type DeviceInfo,
  OPENPORT_VID,
  OPENPORT_PID,
} from "@emdzej/j2534-types";

/**
 * Browser Web Serial transport for J2534 devices.
 *
 * The Tactrix OpenPort 2.0 presents as a CDC ACM device (virtual COM port),
 * which Chrome's WebUSB blocks but Web Serial handles natively.
 */
export class WebSerialTransport implements Transport {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _isConnected = false;
  private rxBuffer: Uint8Array[] = [];

  constructor(
    private vendorId = OPENPORT_VID,
    private productId = OPENPORT_PID,
  ) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Request a serial port and open it. Must be called from a user gesture.
   *
   * The OpenPort 2.0 CDC device doesn't use standard baud rate negotiation —
   * the baud rate parameter is ignored by the firmware. We set a high value
   * to avoid any artificial throttling by the OS serial driver.
   */
  async open(): Promise<void> {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API is not supported in this browser");
    }

    // Try to find an already-granted port first
    const ports = await navigator.serial.getPorts();
    this.port =
      ports.find((p) => {
        const info = p.getInfo();
        return (
          info.usbVendorId === this.vendorId &&
          info.usbProductId === this.productId
        );
      }) ?? null;

    // If not found, prompt user
    if (!this.port) {
      this.port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: this.vendorId, usbProductId: this.productId }],
      });
    }

    await this.port.open({
      baudRate: 500000, // ignored by OpenPort firmware, but required by API
      bufferSize: 4096,
    });

    if (this.port.readable && this.port.writable) {
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
    } else {
      throw new Error("Failed to obtain readable/writable streams from serial port");
    }

    this._isConnected = true;

    // Start background reading into buffer
    this.readLoop();
  }

  /**
   * Background read loop that accumulates incoming data.
   * The J2534 device sends asynchronous responses (ack, messages, etc.)
   * that we need to buffer for the driver's polling read calls.
   */
  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    try {
      while (this._isConnected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
          this.rxBuffer.push(value);
        }
      }
    } catch {
      // Port closed or error — expected during disconnect
    }
  }

  async close(): Promise<void> {
    this._isConnected = false;
    try {
      this.reader?.releaseLock();
    } catch {}
    try {
      this.writer?.releaseLock();
    } catch {}
    this.reader = null;
    this.writer = null;
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
    this.rxBuffer = [];
  }

  async write(data: Uint8Array): Promise<number> {
    if (!this.writer) {
      throw new Error("Transport not connected");
    }
    await this.writer.write(data);
    return data.length;
  }

  async read(timeout = 1000): Promise<Uint8Array> {
    const deadline = Date.now() + timeout;

    // Wait for data to appear in the rx buffer
    while (this.rxBuffer.length === 0) {
      if (Date.now() >= deadline) {
        throw new Error("Read timeout");
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    // Drain all buffered chunks into a single response
    // (matches the bulk transfer behavior of USB transport)
    if (this.rxBuffer.length === 1) {
      return this.rxBuffer.shift()!;
    }

    const total = this.rxBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.rxBuffer) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.rxBuffer = [];
    return result;
  }
}

/**
 * List already-granted serial ports matching the OpenPort VID/PID.
 * No user gesture required.
 */
export async function listDevices(
  vid = OPENPORT_VID,
  pid = OPENPORT_PID,
): Promise<DeviceInfo[]> {
  if (!("serial" in navigator)) return [];
  const ports = await navigator.serial.getPorts();
  return ports
    .filter((p) => {
      const info = p.getInfo();
      return info.usbVendorId === vid && info.usbProductId === pid;
    })
    .map((p) => {
      const info = p.getInfo();
      return {
        vendorId: info.usbVendorId!,
        productId: info.usbProductId!,
      };
    });
}

export default WebSerialTransport;
