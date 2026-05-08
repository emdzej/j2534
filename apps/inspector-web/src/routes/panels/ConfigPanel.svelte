<script lang="ts">
  import { deviceStore, CONFIG_PARAMS, ConfigParam, type SConfig } from "$lib/device.svelte";

  let selectedChannel = $state<number | null>(null);
  let configResults = $state<SConfig[]>([]);
  let loading = $state(false);

  // Set config form
  let setParam = $state(ConfigParam.DATA_RATE);
  let setValue = $state("0");

  async function readAllConfig() {
    if (selectedChannel == null) return;
    loading = true;
    configResults = [];
    const results: SConfig[] = [];
    for (const p of CONFIG_PARAMS) {
      try {
        const r = await deviceStore.getConfig(selectedChannel, [p.value]);
        results.push(...r);
      } catch {
        // Unsupported param, skip
      }
    }
    configResults = results;
    loading = false;
  }

  async function writeConfig() {
    if (selectedChannel == null) return;
    await deviceStore.setConfig(selectedChannel, [
      { parameter: setParam, value: parseInt(setValue) },
    ]);
  }

  async function clearBuffers() {
    if (selectedChannel == null) return;
    await deviceStore.clearRxBuffer(selectedChannel);
    await deviceStore.clearTxBuffer(selectedChannel);
  }

  function paramLabel(p: number): string {
    return CONFIG_PARAMS.find((c) => c.value === p)?.label ?? `0x${p.toString(16)}`;
  }

  $effect(() => {
    if (deviceStore.channels.length > 0 && selectedChannel == null) {
      selectedChannel = deviceStore.channels[0].id;
    }
  });
</script>

<div class="max-w-2xl space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-base font-semibold">Configuration Parameters</h2>
    <select
      bind:value={selectedChannel}
      class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
    >
      {#each deviceStore.channels as ch}
        <option value={ch.id}>CH{ch.id} — {ch.protocolName}</option>
      {/each}
    </select>
  </div>

  {#if !deviceStore.connected || deviceStore.channels.length === 0}
    <p class="text-gray-500 text-sm">Connect a device and open a channel to manage configuration.</p>
  {:else}
    <div class="flex gap-2">
      <button
        onclick={readAllConfig}
        disabled={loading || selectedChannel == null}
        class="px-3 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
      >
        {loading ? "Reading..." : "Read All Config"}
      </button>
      <button
        onclick={clearBuffers}
        disabled={selectedChannel == null}
        class="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
      >
        Clear Buffers
      </button>
    </div>

    {#if configResults.length > 0}
      <div class="bg-gray-900 rounded border border-gray-800 divide-y divide-gray-800">
        {#each configResults as cfg}
          <div class="flex justify-between px-4 py-2">
            <span class="text-sm text-gray-400">{paramLabel(cfg.parameter)}</span>
            <span class="text-sm font-mono">{cfg.value}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Set config -->
    <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-4">
      <h3 class="text-sm font-medium text-gray-300">Set Configuration</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-sm text-gray-400 block mb-1">Parameter</label>
          <select
            bind:value={setParam}
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          >
            {#each CONFIG_PARAMS as p}
              <option value={p.value}>{p.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="text-sm text-gray-400 block mb-1">Value</label>
          <input
            type="number"
            bind:value={setValue}
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>
      <button
        onclick={writeConfig}
        disabled={deviceStore.busy || selectedChannel == null}
        class="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
      >
        Set
      </button>
    </div>
  {/if}
</div>
