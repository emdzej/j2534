<script lang="ts">
  import { deviceStore } from "$lib/device.svelte";
  import type { PassThruMsg } from "@emdzej/j2534-types";

  let selectedChannel = $state<number | null>(null);
  let initType = $state<"fast" | "fivebaud">("fast");
  let fastInitData = $state("C1 33 F1 81");
  let fiveBaudAddr = $state("33");
  let initResult = $state<string | null>(null);

  $effect(() => {
    if (deviceStore.channels.length > 0 && selectedChannel == null) {
      selectedChannel = deviceStore.channels[0].id;
    }
  });

  async function runInit() {
    if (selectedChannel == null) return;
    initResult = null;
    try {
      let result: PassThruMsg | null;
      if (initType === "fast") {
        const bytes = fastInitData
          .trim()
          .split(/[\s,]+/)
          .map((b) => parseInt(b, 16));
        result = await deviceStore.fastInit(selectedChannel, bytes);
      } else {
        result = await deviceStore.fiveBaudInit(
          selectedChannel,
          parseInt(fiveBaudAddr, 16),
        );
      }
      if (result) {
        const data = Array.from(result.data.slice(0, result.dataSize))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        initResult = `Response (${result.dataSize} bytes): ${data}`;
      } else {
        initResult = "No response";
      }
    } catch (e: any) {
      initResult = `Error: ${e.message}`;
    }
  }
</script>

<div class="max-w-2xl space-y-6">
  <h2 class="text-base font-semibold">Diagnostic Initialization</h2>

  {#if !deviceStore.connected || deviceStore.channels.length === 0}
    <p class="text-gray-500 text-sm">
      Connect a device and open an ISO 9141 or ISO 14230 channel to use diagnostic initialization.
    </p>
  {:else}
    <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-4">
      <div>
        <label class="text-sm text-gray-400 block mb-1">Channel</label>
        <select
          bind:value={selectedChannel}
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        >
          {#each deviceStore.channels as ch}
            <option value={ch.id}>CH{ch.id} — {ch.protocolName}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="text-sm text-gray-400 block mb-2">Init Type</label>
        <div class="flex gap-2">
          <button
            onclick={() => (initType = "fast")}
            class="px-3 py-1.5 text-sm rounded border transition-colors {initType === 'fast'
              ? 'bg-blue-900/50 border-blue-700 text-blue-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}"
          >
            Fast Init (ISO 14230)
          </button>
          <button
            onclick={() => (initType = "fivebaud")}
            class="px-3 py-1.5 text-sm rounded border transition-colors {initType === 'fivebaud'
              ? 'bg-blue-900/50 border-blue-700 text-blue-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}"
          >
            5-Baud Init (ISO 9141)
          </button>
        </div>
      </div>

      {#if initType === "fast"}
        <div>
          <label class="text-sm text-gray-400 block mb-1">Init Data (hex bytes)</label>
          <input
            type="text"
            bind:value={fastInitData}
            placeholder="C1 33 F1 81"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
          <p class="text-xs text-gray-500 mt-1">
            Default: StartCommunication request (C1 33 F1 81)
          </p>
        </div>
      {:else}
        <div>
          <label class="text-sm text-gray-400 block mb-1">Target Address (hex)</label>
          <input
            type="text"
            bind:value={fiveBaudAddr}
            placeholder="33"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          />
          <p class="text-xs text-gray-500 mt-1">
            Common: 0x33 (ISO 9141-2), 0x01 (KWP slow init)
          </p>
        </div>
      {/if}

      <button
        onclick={runInit}
        disabled={deviceStore.busy || selectedChannel == null}
        class="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
      >
        {initType === "fast" ? "Send Fast Init" : "Send 5-Baud Init"}
      </button>

      {#if initResult}
        <div class="bg-gray-800 rounded p-3 font-mono text-sm {initResult.startsWith('Error')
          ? 'text-red-400'
          : 'text-green-400'}">
          {initResult}
        </div>
      {/if}
    </div>

    <div class="bg-gray-900 rounded border border-gray-800 p-4 space-y-3">
      <h3 class="text-sm font-medium text-gray-300">Quick Reference</h3>
      <div class="text-xs text-gray-400 space-y-2">
        <p>
          <span class="font-mono text-gray-300">Fast Init</span> — ISO 14230 (KWP2000) initialization.
          Sends a wakeup pattern followed by a StartCommunication request. Requires an ISO14230 channel.
        </p>
        <p>
          <span class="font-mono text-gray-300">5-Baud Init</span> — ISO 9141-2 slow initialization.
          Sends target address at 5 baud and waits for the ECU's keyword response. Requires an ISO9141 channel.
          Timeout is ~5 seconds.
        </p>
      </div>
    </div>
  {/if}
</div>
