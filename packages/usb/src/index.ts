import {
  type Transport,
  type DeviceInfo,
  OPENPORT_VID,
  OPENPORT_PID,
} from "@emdzej/j2534-types";
import { usb, type Device, type InEndpoint, type OutEndpoint } from "usb";

/**
 * Node.js USB transport using the `usb` package (libusb bindings).
 */
export class NodeUsbTransport implements Transport {
  private device: Device | null = null;
  private inEndpoint: InEndpoint | null = null;
  private outEndpoint: OutEndpoint | null = null;
  private _isConnected = false;

  constructor(
    private vendorId = OPENPORT_VID,
    private productId = OPENPORT_PID
  ) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async open(): Promise<void> {
    const devices = usb.getDeviceList();
    const device = devices.find(
      (d) =>
        d.deviceDescriptor.idVendor === this.vendorId &&
        d.deviceDescriptor.idProduct === this.productId
    );

    if (!device) {
      throw new Error(
        `Device not found (VID=${this.vendorId.toString(16)} PID=${this.productId.toString(16)})`
      );
    }

    this.device = device;
    this.device.open();

    // Find the interface with exactly 2 bulk endpoints (the data interface).
    // The OpenPort 2.0 is a CDC device — interface 0 is control (interrupt),
    // interface 1 is data (bulk IN + bulk OUT).
    const config = this.device.configDescriptor!;
    let claimedIface: number | null = null;

    for (let i = 0; i < config.interfaces.length; i++) {
      const iface = this.device.interface(i);
      const bulkEps = iface.endpoints.filter(
        (ep) => ep.transferType === usb.LIBUSB_TRANSFER_TYPE_BULK
      );
      if (bulkEps.length === 2) {
        if (iface.isKernelDriverActive()) {
          iface.detachKernelDriver();
        }
        iface.claim();
        this.claimedInterface = i;

        for (const ep of bulkEps) {
          if (ep.direction === "in") {
            this.inEndpoint = ep as InEndpoint;
          } else {
            this.outEndpoint = ep as OutEndpoint;
          }
        }
        break;
      }
    }

    if (!this.inEndpoint || !this.outEndpoint) {
      throw new Error("Could not find bulk IN/OUT endpoints");
    }

    this._isConnected = true;
  }

  private claimedInterface: number | null = null;

  async close(): Promise<void> {
    if (this.device) {
      try {
        if (this.claimedInterface !== null) {
          this.device.interface(this.claimedInterface).release();
        }
      } catch {
        // ignore
      }
      this.device.close();
      this.device = null;
    }
    this.inEndpoint = null;
    this.outEndpoint = null;
    this.claimedInterface = null;
    this._isConnected = false;
  }

  async write(data: Uint8Array): Promise<number> {
    if (!this.outEndpoint) {
      throw new Error("Transport not connected");
    }
    return new Promise((resolve, reject) => {
      this.outEndpoint!.transfer(Buffer.from(data), (err) => {
        if (err) reject(err);
        else resolve(data.length);
      });
    });
  }

  async read(timeout = 1000): Promise<Uint8Array> {
    if (!this.inEndpoint) {
      throw new Error("Transport not connected");
    }
    this.inEndpoint.timeout = timeout;
    return new Promise((resolve, reject) => {
      this.inEndpoint!.transfer(512, (err, data) => {
        if (err) reject(err);
        else resolve(new Uint8Array(data ?? Buffer.alloc(0)));
      });
    });
  }
}

/**
 * List connected Openport devices.
 */
export function listDevices(
  vid = OPENPORT_VID,
  pid = OPENPORT_PID
): DeviceInfo[] {
  return usb
    .getDeviceList()
    .filter(
      (d) =>
        d.deviceDescriptor.idVendor === vid &&
        d.deviceDescriptor.idProduct === pid
    )
    .map((d) => ({
      vendorId: d.deviceDescriptor.idVendor,
      productId: d.deviceDescriptor.idProduct,
    }));
}

export default NodeUsbTransport;
