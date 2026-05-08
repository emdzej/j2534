<script lang="ts">
  import "../app.css";
  import { deviceStore } from "$lib/device.svelte";

  let activeTab = $state<string>("info");

  const tabs = [
    { id: "info", label: "Device Info" },
    { id: "io", label: "I/O Control" },
    { id: "channels", label: "Channels" },
    { id: "monitor", label: "Message Monitor" },
    { id: "config", label: "Config" },
    { id: "diag", label: "Diagnostics" },
  ];
</script>

<div class="flex flex-col h-screen">
  <!-- Header -->
  <header class="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between shrink-0">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-bold tracking-tight">J2534 Inspector</h1>
      <span class="text-xs text-gray-500 font-mono">WebUSB</span>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full {deviceStore.connected ? 'bg-green-400' : 'bg-gray-600'}"></span>
        <span class="text-sm text-gray-400">
          {deviceStore.connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      {#if deviceStore.connected}
        <button
          onclick={() => deviceStore.disconnect()}
          disabled={deviceStore.busy}
          class="px-3 py-1.5 text-sm bg-red-900/50 hover:bg-red-900 text-red-300 rounded border border-red-800 disabled:opacity-50 transition-colors"
        >
          Disconnect
        </button>
      {:else}
        <button
          onclick={() => deviceStore.connect()}
          disabled={deviceStore.busy}
          class="px-3 py-1.5 text-sm bg-blue-900/50 hover:bg-blue-900 text-blue-300 rounded border border-blue-800 disabled:opacity-50 transition-colors"
        >
          Connect Device
        </button>
      {/if}
    </div>
  </header>

  <!-- Tabs -->
  <nav class="bg-gray-900 border-b border-gray-800 px-4 flex gap-1 shrink-0">
    {#each tabs as tab}
      <button
        onclick={() => (activeTab = tab.id)}
        class="px-3 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === tab.id
          ? 'border-blue-500 text-blue-400'
          : 'border-transparent text-gray-500 hover:text-gray-300'}"
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  <!-- Content -->
  <main class="flex-1 overflow-hidden flex flex-col">
    <div class="flex-1 overflow-auto p-4">
      {#if activeTab === "info"}
        {#await import("./panels/DeviceInfo.svelte") then { default: Component }}
          <Component />
        {/await}
      {:else if activeTab === "io"}
        {#await import("./panels/IoControl.svelte") then { default: Component }}
          <Component />
        {/await}
      {:else if activeTab === "channels"}
        {#await import("./panels/Channels.svelte") then { default: Component }}
          <Component />
        {/await}
      {:else if activeTab === "monitor"}
        {#await import("./panels/MessageMonitor.svelte") then { default: Component }}
          <Component />
        {/await}
      {:else if activeTab === "config"}
        {#await import("./panels/ConfigPanel.svelte") then { default: Component }}
          <Component />
        {/await}
      {:else if activeTab === "diag"}
        {#await import("./panels/Diagnostics.svelte") then { default: Component }}
          <Component />
        {/await}
      {/if}
    </div>

    <!-- Log panel -->
    <div class="h-48 shrink-0 border-t border-gray-800 bg-gray-900 flex flex-col">
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
        <span class="text-xs font-medium text-gray-400">Log</span>
        <button
          onclick={() => (deviceStore.log.length = 0)}
          class="text-xs text-gray-500 hover:text-gray-300"
        >
          Clear
        </button>
      </div>
      <div class="flex-1 overflow-auto px-3 py-1 font-mono text-xs">
        {#each deviceStore.log as entry}
          <div class="flex gap-2 py-0.5 {
            entry.level === 'error' ? 'text-red-400' :
            entry.level === 'warn' ? 'text-yellow-400' :
            entry.level === 'tx' ? 'text-blue-400' :
            entry.level === 'rx' ? 'text-green-400' :
            'text-gray-400'
          }">
            <span class="text-gray-600 shrink-0">
              {entry.timestamp.toLocaleTimeString()}.{entry.timestamp.getMilliseconds().toString().padStart(3, '0')}
            </span>
            <span class="shrink-0 uppercase w-5">{entry.level === 'info' ? 'INF' : entry.level === 'warn' ? 'WRN' : entry.level === 'error' ? 'ERR' : entry.level.toUpperCase()}</span>
            <span>{entry.message}</span>
          </div>
        {/each}
      </div>
    </div>
  </main>
</div>
