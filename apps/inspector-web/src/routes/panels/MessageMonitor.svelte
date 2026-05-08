<script lang="ts">
  import { deviceStore } from "$lib/device.svelte";

  let selectedChannel = $state<number | null>(null);
  let txData = $state("");
  let autoScroll = $state(true);
  let filterHex = $state("");

  function formatData(msg: import("@emdzej/j2534-types").PassThruMsg): string {
    return Array.from(msg.data.slice(0, msg.dataSize))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }

  function formatTimestamp(msg: import("@emdzej/j2534-types").PassThruMsg): string {
    if (msg.timestamp === 0) return "—";
    return (msg.timestamp / 1000).toFixed(1) + "ms";
  }

  $effect(() => {
    if (autoScroll) {
      // Trigger reactivity on rxMessages length
      deviceStore.rxMessages.length;
      const el = document.getElementById("rx-scroll");
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  function filteredMessages() {
    let msgs = deviceStore.rxMessages;
    if (selectedChannel != null) {
      msgs = msgs.filter((m) => m.channelId === selectedChannel);
    }
    if (filterHex) {
      const search = filterHex.toLowerCase().replace(/\s/g, "");
      msgs = msgs.filter((m) => {
        const hex = Array.from(m.msg.data.slice(0, m.msg.dataSize))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return hex.includes(search);
      });
    }
    return msgs;
  }

  async function sendTx() {
    if (selectedChannel == null || !txData.trim()) return;
    const ch = deviceStore.channels.find((c) => c.id === selectedChannel);
    if (!ch) return;
    const bytes = txData
      .trim()
      .split(/[\s,]+/)
      .map((b) => parseInt(b, 16));
    await deviceStore.sendMessage(selectedChannel, ch.protocol, bytes);
    txData = "";
  }
</script>

<div class="h-full flex flex-col space-y-3">
  <div class="flex items-center justify-between shrink-0">
    <h2 class="text-base font-semibold">Message Monitor</h2>
    <div class="flex items-center gap-2">
      <select
        bind:value={selectedChannel}
        class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
      >
        <option value={null}>All Channels</option>
        {#each deviceStore.channels as ch}
          <option value={ch.id}>CH{ch.id} — {ch.protocolName}</option>
        {/each}
      </select>
      <input
        type="text"
        bind:value={filterHex}
        placeholder="Filter hex..."
        class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm font-mono w-32"
      />
      <label class="flex items-center gap-1 text-xs text-gray-400">
        <input type="checkbox" bind:checked={autoScroll} />
        Auto-scroll
      </label>
    </div>
  </div>

  {#if !deviceStore.connected}
    <p class="text-gray-500 text-sm">Connect a device and open a channel to monitor messages.</p>
  {:else}
    <!-- Polling controls -->
    <div class="flex gap-2 shrink-0">
      {#each deviceStore.channels as ch}
        <button
          onclick={() => deviceStore.startRxPolling(ch.id)}
          class="text-xs px-2 py-1 bg-green-900/50 hover:bg-green-900 text-green-300 rounded border border-green-800 transition-colors"
        >
          Start RX CH{ch.id}
        </button>
        <button
          onclick={() => deviceStore.stopRxPolling(ch.id)}
          class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
        >
          Stop RX CH{ch.id}
        </button>
      {/each}
      <button
        onclick={() => deviceStore.clearRxMessages()}
        class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors ml-auto"
      >
        Clear ({deviceStore.rxMessages.length})
      </button>
    </div>

    <!-- Message table -->
    <div id="rx-scroll" class="flex-1 overflow-auto bg-gray-900 rounded border border-gray-800">
      <table class="w-full text-xs font-mono">
        <thead class="sticky top-0 bg-gray-900 border-b border-gray-800">
          <tr class="text-gray-500">
            <th class="text-left px-2 py-1.5 w-10">CH</th>
            <th class="text-left px-2 py-1.5 w-24">Time</th>
            <th class="text-left px-2 py-1.5 w-16">Len</th>
            <th class="text-left px-2 py-1.5">Data</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredMessages() as { channelId, msg, receivedAt }}
            <tr class="border-b border-gray-800/50 hover:bg-gray-800/50">
              <td class="px-2 py-1 text-gray-500">{channelId}</td>
              <td class="px-2 py-1 text-gray-400">{formatTimestamp(msg)}</td>
              <td class="px-2 py-1 text-gray-400">{msg.dataSize}</td>
              <td class="px-2 py-1 text-green-400">{formatData(msg)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- TX input -->
    {#if selectedChannel != null}
      <div class="flex gap-2 shrink-0">
        <input
          type="text"
          bind:value={txData}
          placeholder="Hex bytes to send (e.g. 07 DF 01 00)"
          onkeydown={(e) => e.key === "Enter" && sendTx()}
          class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
        />
        <button
          onclick={sendTx}
          disabled={deviceStore.busy || !txData.trim()}
          class="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
    {/if}
  {/if}
</div>
