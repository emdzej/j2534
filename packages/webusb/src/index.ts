import {
  type Transport,
  type DeviceInfo,
  OPENPORT_VID,
  OPENPORT_PID,
} from "@emdzej/j2534-types";

/**
 * Browser WebUSB transport implementation.
 * Requires user gesture for device selection (browser security model).
 */
export class WebUsbTransport implements Transport {
  private device: USBDevice | null = null;
  private interfaceNumber = 0;
  private endpointIn = 0;
  private endpointOut = 0;
  private _isConnected = false;

  constructor(
    private vendorId = OPENPORT_VID,
    private productId = OPENPORT_PID
  ) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Request device access and open. Must be called from a user gesture handler.
   */
  async open(): Promise<void> {
    if (!navigator.usb) {
      throw new Error("WebUSB is not supported in this browser");
    }

    // Try to find an already-paired device first
    const devices = await navigator.usb.getDevices();
    this.device =
      devices.find(
        (d) =>
          d.vendorId === this.vendorId && d.productId === this.productId
      ) ?? null;

    // If not found, request from user
    if (!this.device) {
      this.device = await navigator.usb.requestDevice({
        filters: [{ vendorId: this.vendorId, productId: this.productId }],
      });
    }

    await this.device.open();

    // Select configuration 1 if needed
    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }

    // Find the interface with bulk endpoints
    const iface = this.device.configuration!.interfaces[0];
    this.interfaceNumber = iface.interfaceNumber;
    await this.device.claimInterface(this.interfaceNumber);

    // Find bulk IN/OUT endpoints
    const alternate = iface.alternate;
    for (const ep of alternate.endpoints) {
      if (ep.type === "bulk" && ep.direction === "in") {
        this.endpointIn = ep.endpointNumber;
      } else if (ep.type === "bulk" && ep.direction === "out") {
        this.endpointOut = ep.endpointNumber;
      }
    }

    if (!this.endpointIn || !this.endpointOut) {
      throw new Error("Could not find bulk IN/OUT endpoints");
    }

    this._isConnected = true;
  }

  async close(): Promise<void> {
    if (this.device) {
      try {
        await this.device.releaseInterface(this.interfaceNumber);
        await this.device.close();
      } catch {
        // ignore
      }
      this.device = null;
    }
    this._isConnected = false;
  }

  async write(data: Uint8Array): Promise<number> {
    if (!this.device) {
      throw new Error("Transport not connected");
    }
    const result = await this.device.transferOut(this.endpointOut, data as unknown as BufferSource);
    return result.bytesWritten;
  }

  async read(timeout = 1000): Promise<Uint8Array> {
    if (!this.device) {
      throw new Error("Transport not connected");
    }

    // WebUSB doesn't have native timeout support, use AbortController pattern
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const result = await this.device.transferIn(this.endpointIn, 512);
      clearTimeout(timer);
      if (result.data) {
        return new Uint8Array(result.data.buffer);
      }
      return new Uint8Array(0);
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new Error("Read timeout");
      }
      throw err;
    }
  }
}

/**
 * List already-paired WebUSB devices (no user gesture required).
 */
export async function listDevices(
  vid = OPENPORT_VID,
  pid = OPENPORT_PID
): Promise<DeviceInfo[]> {
  if (!navigator.usb) return [];
  const devices = await navigator.usb.getDevices();
  return devices
    .filter((d) => d.vendorId === vid && d.productId === pid)
    .map((d) => ({
      vendorId: d.vendorId,
      productId: d.productId,
      serialNumber: d.serialNumber ?? undefined,
      manufacturer: d.manufacturerName ?? undefined,
      product: d.productName ?? undefined,
    }));
}

export default WebUsbTransport;
