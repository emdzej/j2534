<script lang="ts">
  import { deviceStore, IO_PINS, getPinName } from "$lib/device.svelte";

  let selectedPin = $state(IO_PINS[0]);
  let voltageInput = $state("5000");
  let mode = $state<"voltage" | "off" | "ground">("voltage");
</script>

<div class="max-w-2xl space-y-6">
  <h2 class="text-base font-semibold">I/O Pin Control</h2>

  {#if !deviceStore.connected}
    <p class="text-gray-500 text-sm">Connect a device to control I/O pins.</p>
  {:else}
    <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-4">
      <div>
        <label class="text-sm text-gray-400 block mb-1">Pin</label>
        <select
          bind:value={selectedPin}
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        >
          {#each IO_PINS as pin}
            <option value={pin}>{getPinName(pin)}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="text-sm text-gray-400 block mb-2">Action</label>
        <div class="flex gap-2">
          <button
            onclick={() => (mode = "voltage")}
            class="px-3 py-1.5 text-sm rounded border transition-colors {mode === 'voltage'
              ? 'bg-blue-900/50 border-blue-700 text-blue-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}"
          >
            Set Voltage
          </button>
          <button
            onclick={() => (mode = "off")}
            class="px-3 py-1.5 text-sm rounded border transition-colors {mode === 'off'
              ? 'bg-yellow-900/50 border-yellow-700 text-yellow-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}"
          >
            Voltage Off
          </button>
          <button
            onclick={() => (mode = "ground")}
            class="px-3 py-1.5 text-sm rounded border transition-colors {mode === 'ground'
              ? 'bg-red-900/50 border-red-700 text-red-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}"
          >
            Short to Ground
          </button>
        </div>
      </div>

      {#if mode === "voltage"}
        <div>
          <label class="text-sm text-gray-400 block mb-1">Voltage (mV)</label>
          <input
            type="number"
            bind:value={voltageInput}
            min="0"
            max="25000"
            step="100"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
          <span class="text-xs text-gray-500 mt-1 block">
            = {(parseInt(voltageInput) / 1000).toFixed(2)}V
          </span>
        </div>
      {/if}

      <button
        onclick={() => {
          if (mode === "voltage") {
            deviceStore.setPinVoltage(selectedPin, parseInt(voltageInput));
          } else if (mode === "off") {
            deviceStore.setPinOff(selectedPin);
          } else {
            deviceStore.setPinShortToGround(selectedPin);
          }
        }}
        disabled={deviceStore.busy}
        class="w-full px-4 py-2 text-sm font-medium rounded transition-colors disabled:opacity-50 {
          mode === 'ground'
            ? 'bg-red-700 hover:bg-red-600 text-white'
            : mode === 'off'
              ? 'bg-yellow-700 hover:bg-yellow-600 text-white'
              : 'bg-blue-700 hover:bg-blue-600 text-white'
        }"
      >
        {mode === "voltage"
          ? `Apply ${(parseInt(voltageInput) / 1000).toFixed(2)}V to ${getPinName(selectedPin)}`
          : mode === "off"
            ? `Turn Off ${getPinName(selectedPin)}`
            : `Short ${getPinName(selectedPin)} to Ground`}
      </button>
    </div>

    <div class="bg-amber-950/30 border border-amber-900/50 rounded p-3">
      <p class="text-xs text-amber-400">
        Warning: Incorrect voltage or shorting pins can damage connected hardware.
        Only use these controls if you understand the OBD-II pin assignments and your vehicle's wiring.
      </p>
    </div>
  {/if}
</div>
