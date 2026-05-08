#!/bin/bash
#
# Install/uninstall the codeless kext that prevents macOS from claiming
# the Tactrix OpenPort 2.0 via the CDC ACM driver.
#
# After installation, the device is accessible via libusb without sudo.
#
# Usage:
#   sudo ./install-kext.sh          # install
#   sudo ./install-kext.sh remove   # uninstall

set -euo pipefail

KEXT_NAME="TactrixOpenPort.kext"
KEXT_SRC="$(dirname "$0")/${KEXT_NAME}"
KEXT_DST="/Library/Extensions/${KEXT_NAME}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run with sudo."
  exit 1
fi

if [ "${1:-}" = "remove" ]; then
  echo "Removing ${KEXT_DST}..."
  rm -rf "${KEXT_DST}"
  kextcache -invalidate / 2>/dev/null || true
  echo "Done. Unplug and replug the device for changes to take effect."
  exit 0
fi

if [ ! -d "${KEXT_SRC}" ]; then
  echo "Error: ${KEXT_SRC} not found."
  exit 1
fi

echo "Installing ${KEXT_NAME} to /Library/Extensions/..."
cp -R "${KEXT_SRC}" "${KEXT_DST}"
chown -R root:wheel "${KEXT_DST}"
chmod -R 755 "${KEXT_DST}"
kextcache -invalidate / 2>/dev/null || true

echo ""
echo "Installed successfully."
echo ""
echo "IMPORTANT:"
echo "  1. Unplug and replug the Tactrix OpenPort device."
echo "  2. You may need to reboot for the kext cache to update."
echo "  3. On macOS 10.13+, you may need to allow the kext in:"
echo "     System Preferences > Security & Privacy > General"
echo ""
echo "After this, you can run the inspector without sudo:"
echo "  pnpm --filter @emdzej/j2534-inspector-cli start"
