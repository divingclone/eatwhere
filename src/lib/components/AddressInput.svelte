<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Search, MapPin, LoaderCircle, ArrowUpRight, X } from 'lucide-svelte';
  import { metroStations, districts } from '../data';
  import type { Coordinate } from '../types';
  import { searchAddresses } from '../geocode';

  let {
    id,
    address,
    onchange,
    onpick,
  }: {
    id: string;
    address: string;
    onchange: (address: string, location: Coordinate) => void;
    onpick: () => void;
  } = $props();
  let query = $state('');
  let open = $state(false);
  let active = $state(0);
  let busy = $state(false);
  let error = $state('');
  let container: HTMLDivElement;
  let menuTop = $state(0);
  let menuLeft = $state(0);
  let menuWidth = $state(250);
  let menuHeight = $state(320);
  let controller: AbortController | undefined;
  let remote = $state<Array<{ id: string; name: string; address: string; location: Coordinate }>>(
    [],
  );
  onMount(() => {
    const closeOnParentScroll = (event: Event) => {
      const target = event.target;
      if (target === document || (target instanceof Element && target.contains(container)))
        open = false;
    };
    document.addEventListener('scroll', closeOnParentScroll, true);
    return () => document.removeEventListener('scroll', closeOnParentScroll, true);
  });
  onDestroy(() => controller?.abort());
  $effect(() => {
    query = address;
  });
  const localResults = $derived.by(() => {
    const term = query
      .trim()
      .replace(/ · 地图选点$/, '')
      .replace(/地铁站|地铁|站?附近|站$/g, '');
    if (!term)
      return metroStations
        .filter((s) => ['宝安中心', '深圳北站', '大运', '后海', '五和', '车公庙'].includes(s.name))
        .slice(0, 6);
    return metroStations
      .filter((s) => s.name.includes(term))
      .sort((a, b) => Number(b.name === term) - Number(a.name === term))
      .slice(0, 5);
  });
  const options = $derived([
    ...localResults.map((s) => ({
      id: s.id,
      name: s.name,
      address: `${s.name}地铁站`,
      location: s.location,
      kind: '地铁站',
    })),
    ...districts
      .filter((d) => query.trim() && d.name.includes(query.trim()))
      .slice(0, 2)
      .map((d) => ({
        id: d.id,
        name: d.name,
        address: d.name,
        location: d.location,
        kind: d.area,
      })),
    ...remote.map((r) => ({ ...r, kind: '地址' })),
  ]);

  function openMenu() {
    const rect = container.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 20;
    menuHeight = Math.min(360, Math.max(220, below < 230 ? rect.top - 20 : below));
    menuTop = below < 230 ? Math.max(12, rect.top - menuHeight - 5) : rect.bottom + 5;
    menuLeft = rect.left;
    menuWidth = rect.width;
    open = true;
    active = 0;
  }
  function select(option: (typeof options)[number]) {
    controller?.abort();
    query = option.address;
    onchange(option.address, option.location);
    open = false;
    error = '';
    remote = [];
  }
  async function search() {
    if (query.trim().length < 2) {
      error = '请输入至少 2 个字的地址';
      return;
    }
    controller?.abort();
    const request = new AbortController();
    controller = request;
    busy = true;
    error = '';
    try {
      const results = await searchAddresses(query.trim(), request.signal);
      if (request.signal.aborted) return;
      remote = results;
      if (!results.length) error = '没有找到深圳的匹配地址，试试附近地铁站或地图选点。';
    } catch (e) {
      if (!request.signal.aborted)
        error = e instanceof Error ? e.message : '地址查询暂不可用，请使用地图选点。';
    } finally {
      if (controller === request) busy = false;
    }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      open = false;
      query = address;
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openMenu();
      else active = Math.min(active + 1, options.length - 1);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (options[active]) select(options[active]);
      else void search();
    }
  }
</script>

<svelte:document
  onclick={(e) => {
    if (container && !container.contains(e.target as Node)) open = false;
  }}
/>
<svelte:window onresize={() => (open = false)} />

<div class="address-control" bind:this={container}>
  <div class:focused={open} class="address-field">
    <MapPin size={15} strokeWidth={1.8} />
    <input
      id={`address-${id}`}
      aria-label="出发地址或地铁站"
      role="combobox"
      aria-expanded={open}
      aria-controls={`locations-${id}`}
      aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
      placeholder="搜索地址或地铁站"
      bind:value={query}
      onfocus={openMenu}
      oninput={() => {
        openMenu();
        remote = [];
        error = '';
        controller?.abort();
        busy = false;
      }}
      onkeydown={keydown}
      autocomplete="off"
    />
    {#if query !== address}<button
        class="input-clear"
        aria-label="取消地址编辑"
        onclick={() => {
          query = address;
          open = false;
        }}><X size={13} /></button
      >{/if}
  </div>
  {#if query !== address && !open}<p class="pending-address">请选择搜索结果以更新出发点</p>{/if}
  {#if open}
    <div
      class="address-dropdown"
      style={`position:fixed;top:${menuTop}px;left:${menuLeft}px;right:auto;width:${menuWidth}px;max-height:${menuHeight}px;overflow-y:auto`}
    >
      <div class="dropdown-label">
        {query.trim() ? '匹配地点' : '常用地铁站'}<span>深圳市</span>
      </div>
      <div id={`locations-${id}`} role="listbox" aria-label="地址搜索结果">
        {#each options as option, i (`${option.id}-${i}`)}
          <button
            id={`${id}-option-${i}`}
            type="button"
            role="option"
            aria-selected={active === i}
            class:active={active === i}
            class="address-option"
            onclick={() => select(option)}
          >
            <MapPin size={15} /><span
              ><strong>{option.name}</strong><small
                >{option.kind === '地址' ? option.address : option.kind}</small
              ></span
            ><ArrowUpRight size={13} />
          </button>
        {/each}
      </div>
      {#if !options.length && !error}<p class="search-hint">
          搜索详细地址，或直接在地图上选点。
        </p>{/if}
      {#if error}<p class="search-error" role="status">{error}</p>{/if}
      <div class="address-actions">
        <button onclick={search} disabled={busy || query.trim().length < 2}
          >{#if busy}<LoaderCircle size={14} class="spin" />{:else}<Search
              size={14}
            />{/if}搜索详细地址</button
        >
        <button
          onclick={() => {
            open = false;
            query = address;
            onpick();
          }}><MapPin size={14} />地图选点</button
        >
      </div>
      <div class="search-privacy">详细地址查询由高德地图提供</div>
    </div>
  {/if}
</div>
