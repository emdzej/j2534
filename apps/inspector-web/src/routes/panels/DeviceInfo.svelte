<script lang="ts">
  import { deviceStore } from "$lib/device.svelte";
</script>

<div class="max-w-2xl space-y-6">
  <div>
    <h2 class="text-base font-semibold mb-3">Device Information</h2>

    {#if !deviceStore.connected}
      <p class="text-gray-500 text-sm">Connect a device to view information.</p>
    {:else}
      <div class="bg-gray-900 rounded border border-gray-800 divide-y divide-gray-800">
        <div class="flex justify-between px-4 py-2.5">
          <span class="text-sm text-gray-400">Firmware Version</span>
          <span class="text-sm font-mono">{deviceStore.version?.firmwareVersion ?? "—"}</span>
        </div>
        <div class="flex justify-between px-4 py-2.5">
          <span class="text-sm text-gray-400">DLL Version</span>
          <span class="text-sm font-mono">{deviceStore.version?.dllVersion ?? "—"}</span>
        </div>
        <div class="flex justify-between px-4 py-2.5">
          <span class="text-sm text-gray-400">API Version</span>
          <span class="text-sm font-mono">{deviceStore.version?.apiVersion ?? "—"}</span>
        </div>
      </div>
    {/if}
  </div>

  {#if deviceStore.connected}
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold">Voltages</h2>
        <button
          onclick={() => deviceStore.refreshVoltages()}
          class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="bg-gray-900 rounded border border-gray-800 p-4">
          <div class="text-xs text-gray-500 mb-1">Battery (Pin 16)</div>
          <div class="text-2xl font-mono font-bold">
            {deviceStore.batteryVoltage != null
              ? (deviceStore.batteryVoltage / 1000).toFixed(2) + "V"
              : "—"}
          </div>
        </div>
        <div class="bg-gray-900 rounded border border-gray-800 p-4">
          <div class="text-xs text-gray-500 mb-1">Programming (Pin 2)</div>
          <div class="text-2xl font-mono font-bold">
            {deviceStore.progVoltage != null
              ? (deviceStore.progVoltage / 1000).toFixed(2) + "V"
              : "—"}
          </div>
        </div>
      </div>
    </div>

    <div>
      <h2 class="text-base font-semibold mb-3">Active Channels</h2>
      {#if deviceStore.channels.length === 0}
        <p class="text-gray-500 text-sm">No channels open.</p>
      {:else}
        <div class="bg-gray-900 rounded border border-gray-800 divide-y divide-gray-800">
          {#each deviceStore.channels as ch}
            <div class="flex justify-between px-4 py-2.5">
              <span class="text-sm">CH{ch.id}: {ch.protocolName}</span>
              <span class="text-sm font-mono text-gray-400">{ch.baudRate} baud</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
