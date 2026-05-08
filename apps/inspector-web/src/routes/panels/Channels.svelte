<script lang="ts">
  import {
    deviceStore,
    CONNECTABLE_PROTOCOLS,
    ConnectFlag,
    FilterType,
    getProtocolName,
    Protocol,
  } from "$lib/device.svelte";

  let selectedProtocol = $state(CONNECTABLE_PROTOCOLS[0].value);
  let baudRate = $state("500000");
  let flagSniff = $state(false);
  let flagCan29 = $state(false);
  let flagCanBoth = $state(false);
  let flagNoChecksum = $state(false);
  let flagKLineOnly = $state(false);

  // Filter form
  let filterChannelId = $state<number | null>(null);
  let filterType = $state(FilterType.PASS_FILTER);
  let filterMask = $state("00 00 00 00");
  let filterPattern = $state("00 00 00 00");
  let filterFlow = $state("00 00 00 00");
  let filterUseFlow = $state(false);

  function parseHexBytes(s: string): number[] {
    return s
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((b) => parseInt(b, 16));
  }

  function computeFlags(): number {
    let f = 0;
    if (flagSniff) f |= ConnectFlag.SNIFF_MODE;
    if (flagCan29) f |= ConnectFlag.CAN_29BIT_ID;
    if (flagCanBoth) f |= ConnectFlag.CAN_ID_BOTH;
    if (flagNoChecksum) f |= ConnectFlag.ISO9141_NO_CHECKSUM;
    if (flagKLineOnly) f |= ConnectFlag.ISO9141_K_LINE_ONLY;
    return f;
  }

  async function openChannel() {
    const id = await deviceStore.connectChannel(
      selectedProtocol,
      computeFlags(),
      parseInt(baudRate),
    );
    filterChannelId = id;
  }

  async function applyFilter() {
    if (filterChannelId == null) return;
    await deviceStore.addFilter(
      filterChannelId,
      filterType,
      parseHexBytes(filterMask),
      parseHexBytes(filterPattern),
      filterUseFlow ? parseHexBytes(filterFlow) : undefined,
    );
  }
</script>

<div class="max-w-2xl space-y-6">
  <h2 class="text-base font-semibold">Channel Management</h2>

  {#if !deviceStore.connected}
    <p class="text-gray-500 text-sm">Connect a device to manage channels.</p>
  {:else}
    <!-- Open channel form -->
    <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-4">
      <h3 class="text-sm font-medium text-gray-300">Open Channel</h3>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-sm text-gray-400 block mb-1">Protocol</label>
          <select
            bind:value={selectedProtocol}
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          >
            {#each CONNECTABLE_PROTOCOLS as p}
              <option value={p.value}>{p.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="text-sm text-gray-400 block mb-1">Baud Rate</label>
          <input
            type="number"
            bind:value={baudRate}
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div>
        <label class="text-sm text-gray-400 block mb-2">Flags</label>
        <div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" bind:checked={flagSniff} class="rounded bg-gray-800 border-gray-600" />
            Sniff Mode
          </label>
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" bind:checked={flagCan29} class="rounded bg-gray-800 border-gray-600" />
            CAN 29-bit
          </label>
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" bind:checked={flagCanBoth} class="rounded bg-gray-800 border-gray-600" />
            CAN Both IDs
          </label>
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" bind:checked={flagNoChecksum} class="rounded bg-gray-800 border-gray-600" />
            No Checksum
          </label>
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" bind:checked={flagKLineOnly} class="rounded bg-gray-800 border-gray-600" />
            K-Line Only
          </label>
        </div>
      </div>

      <button
        onclick={openChannel}
        disabled={deviceStore.busy}
        class="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
      >
        Open Channel
      </button>
    </div>

    <!-- Active channels -->
    {#if deviceStore.channels.length > 0}
      <div>
        <h3 class="text-sm font-medium text-gray-300 mb-2">Active Channels</h3>
        <div class="space-y-2">
          {#each deviceStore.channels as ch}
            <div class="bg-gray-900 rounded border border-gray-800 p-3 flex items-center justify-between">
              <div>
                <span class="text-sm font-medium">CH{ch.id}</span>
                <span class="text-sm text-gray-400 ml-2">{ch.protocolName}</span>
                <span class="text-xs text-gray-500 ml-2 font-mono">{ch.baudRate} baud</span>
                <span class="text-xs text-gray-500 ml-2">
                  {ch.filterIds.length} filter{ch.filterIds.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div class="flex gap-2">
                <button
                  onclick={() => deviceStore.clearFilters(ch.id)}
                  class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
                >
                  Clear Filters
                </button>
                <button
                  onclick={() => deviceStore.disconnectChannel(ch.id)}
                  class="text-xs px-2 py-1 bg-red-900/50 hover:bg-red-900 text-red-300 rounded border border-red-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Filter form -->
      <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-4">
        <h3 class="text-sm font-medium text-gray-300">Add Message Filter</h3>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-sm text-gray-400 block mb-1">Channel</label>
            <select
              bind:value={filterChannelId}
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            >
              {#each deviceStore.channels as ch}
                <option value={ch.id}>CH{ch.id} — {ch.protocolName}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="text-sm text-gray-400 block mb-1">Filter Type</label>
            <select
              bind:value={filterType}
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            >
              <option value={FilterType.PASS_FILTER}>Pass Filter</option>
              <option value={FilterType.BLOCK_FILTER}>Block Filter</option>
              <option value={FilterType.FLOW_CONTROL_FILTER}>Flow Control</option>
            </select>
          </div>
        </div>

        <div>
          <label class="text-sm text-gray-400 block mb-1">Mask (hex bytes)</label>
          <input
            type="text"
            bind:value={filterMask}
            placeholder="00 00 00 00"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label class="text-sm text-gray-400 block mb-1">Pattern (hex bytes)</label>
          <input
            type="text"
            bind:value={filterPattern}
            placeholder="00 00 00 00"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        <label class="flex items-center gap-1.5 text-sm">
          <input type="checkbox" bind:checked={filterUseFlow} class="rounded bg-gray-800 border-gray-600" />
          Include Flow Control
        </label>

        {#if filterUseFlow}
          <div>
            <label class="text-sm text-gray-400 block mb-1">Flow Control (hex bytes)</label>
            <input
              type="text"
              bind:value={filterFlow}
              placeholder="00 00 00 00"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
        {/if}

        <button
          onclick={applyFilter}
          disabled={deviceStore.busy || filterChannelId == null}
          class="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
        >
          Add Filter
        </button>
      </div>
    {/if}
  {/if}
</div>
