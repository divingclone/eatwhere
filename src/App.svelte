<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Utensils,
    MapPin,
    ChevronDown,
    Plus,
    X,
    UsersRound,
    RotateCcw,
    ArrowRight,
    ArrowUpRight,
    SlidersHorizontal,
    Info,
    Check,
    TrainFront,
    CircleHelp,
    Heart,
    LocateFixed,
    Compass,
    Scale,
    Zap,
    CheckCheck,
    Car,
    LoaderCircle,
  } from 'lucide-svelte';
  import CityMap from './lib/components/CityMap.svelte';
  import AddressInput from './lib/components/AddressInput.svelte';
  import RouteDetail from './lib/components/RouteDetail.svelte';
  import { defaultFriends, districts, dataInfo, metroLines, metroStations } from './lib/data';
  import { rankDistricts } from './lib/routing';
  import { loadDrivingRoutes } from './lib/driving';
  import { parseSavedPlan } from './lib/plan';
  import type { Friend, Coordinate, TravelMode, DrivingRouteOverrides } from './lib/types';

  type Strategy = 'balanced' | 'total' | 'fair';
  const palette = [
    '#f07850',
    '#7186db',
    '#4fa89a',
    '#be8cb1',
    '#c4a04b',
    '#658dae',
    '#a38a6d',
    '#849c59',
  ];
  const cloneDefaults = () => defaultFriends.map((f) => ({ ...f, location: { ...f.location } }));
  let friends = $state<Friend[]>(cloneDefaults());
  let strategy = $state<Strategy>('balanced');
  let selectedId = $state('');
  let detailOpen = $state(false);
  let pickingFriendId = $state<string | null>(null);
  let showAll = $state(false);
  let helpDialog: HTMLDialogElement;
  let resetDialog: HTMLDialogElement;
  let ready = $state(false);
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;
  let stored = $state(false);
  let mobileTab = $state<'friends' | 'map' | 'results'>('map');
  let drivingRoutes = $state<DrivingRouteOverrides>({});
  let drivingLoading = $state(false);
  let drivingError = $state('');
  let drivingRetry = $state(0);
  let lastDrivingRetry = 0;
  const hasDrivers = $derived(friends.some((friend) => friend.travelMode === 'driving'));
  // Only location/mode changes trigger network work, never names, weights or strategy.
  const drivingOrigins = $derived(
    JSON.stringify(
      friends.filter((friend) => friend.travelMode === 'driving').map((friend) => friend.location),
    ),
  );
  const recommendations = $derived(
    rankDistricts(friends, strategy, drivingRoutes).filter((r) => Number.isFinite(r.score)),
  );
  const selected = $derived(
    recommendations.find((r) => r.district.id === selectedId) ?? recommendations[0],
  );
  const best = $derived(recommendations[0]);
  const visibleRecommendations = $derived(showAll ? recommendations : recommendations.slice(0, 4));
  const changedWeights = $derived(friends.some((f) => f.weight !== 1));

  function notify(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3500);
  }
  function updateLocation(id: string, address: string, location: Coordinate) {
    friends = friends.map((f) => (f.id === id ? { ...f, address, location } : f));
    selectedId = '';
    detailOpen = false;
  }
  function addFriend() {
    if (friends.length >= 8) return;
    const station = metroStations.find((s) => s.name === '五和') ?? metroStations[0];
    const used = new Set(friends.map((f) => f.color));
    friends = [
      ...friends,
      {
        id: crypto.randomUUID(),
        name: `朋友 ${friends.length + 1}`,
        address: station.name + '地铁站',
        location: { ...station.location },
        color: palette.find((c) => !used.has(c)) ?? palette[0],
        weight: 1,
        travelMode: 'transit',
      },
    ];
    selectedId = '';
    detailOpen = false;
    notify('已添加朋友，点击地址设置出发点');
  }
  function removeFriend(id: string) {
    if (friends.length <= 2) return;
    friends = friends.filter((f) => f.id !== id);
    if (pickingFriendId === id) pickingFriendId = null;
    selectedId = '';
    detailOpen = false;
  }
  function pick(location: Coordinate) {
    if (!pickingFriendId) return;
    if (
      location.lng < 113.7 ||
      location.lng > 114.65 ||
      location.lat < 22.38 ||
      location.lat > 22.9
    ) {
      notify('请选择深圳市范围内的出发点');
      return;
    }
    const closest = [...metroStations].sort(
      (a, b) =>
        (a.location.lng - location.lng) ** 2 +
        (a.location.lat - location.lat) ** 2 -
        ((b.location.lng - location.lng) ** 2 + (b.location.lat - location.lat) ** 2),
    )[0];
    updateLocation(pickingFriendId, `${closest.name}附近 · 地图选点`, location);
    pickingFriendId = null;
    notify('出发点已更新，商圈推荐已重新计算');
  }
  function beginPick(id: string) {
    pickingFriendId = id;
    mobileTab = 'map';
  }
  function openDistrict(id: string) {
    selectedId = id;
    detailOpen = true;
    mobileTab = 'results';
  }
  function setStrategy(value: Strategy) {
    strategy = value;
    selectedId = '';
    detailOpen = false;
  }
  function setTravelMode(id: string, travelMode: TravelMode) {
    friends = friends.map((friend) => (friend.id === id ? { ...friend, travelMode } : friend));
    selectedId = '';
    detailOpen = false;
  }
  function reset() {
    friends = cloneDefaults();
    strategy = 'balanced';
    selectedId = '';
    detailOpen = false;
    pickingFriendId = null;
    resetDialog.close();
    notify('已恢复三人示例计划');
  }
  function weightLabel(weight: number) {
    return weight < 0.8 ? '我可以多坐一会儿' : weight > 1.2 ? '希望离我近一点' : '大家一样方便';
  }

  onMount(() => {
    try {
      const saved = parseSavedPlan(localStorage.getItem('eatwhere:plan:v1'));
      if (saved) {
        friends = saved.friends;
        strategy = saved.strategy;
      }
    } catch {
      /* Unavailable or outdated browser storage does not prevent planning. */
    }
    ready = true;
    return () => clearTimeout(toastTimer);
  });
  $effect(() => {
    const plan = JSON.stringify({ friends, strategy });
    if (ready) {
      try {
        localStorage.setItem('eatwhere:plan:v1', plan);
        stored = true;
      } catch {
        stored = false;
      }
    }
  });
  $effect(() => {
    const origins: Coordinate[] = JSON.parse(drivingOrigins);
    const refresh = drivingRetry !== lastDrivingRetry;
    lastDrivingRetry = drivingRetry;
    if (!ready) return;
    if (!origins.length) {
      drivingLoading = false;
      drivingError = '';
      drivingRoutes = {};
      return;
    }
    const controller = new AbortController();
    drivingLoading = true;
    drivingError = '';
    const timer = setTimeout(async () => {
      try {
        const result = await loadDrivingRoutes(origins, controller.signal, refresh);
        if (controller.signal.aborted) return;
        drivingRoutes = result.routes;
        drivingError = result.errors[0] ?? '';
      } catch {
        if (!controller.signal.aborted) {
          drivingRoutes = {};
          drivingError = '驾车估时暂不可用，已使用粗略估算。';
        }
      } finally {
        if (!controller.signal.aborted) drivingLoading = false;
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') pickingFriendId = null;
  }}
/>

<header class="app-header">
  <a class="brand" href="/" aria-label="去哪吃饭？深圳首页"
    ><span class="brand-icon"><Utensils size={24} strokeWidth={1.7} /></span><span
      class="brand-name">去哪吃饭<span class="brand-question">?</span></span
    ><span class="city-tag">深圳</span></a
  >
  <div class="header-center">
    <span class="active-nav">约饭规划<span></span></span><span class="header-separator"></span><span
      >找个地方，好好见面</span
    >
  </div>
  <button class="help-button" onclick={() => helpDialog.showModal()}
    ><CircleHelp size={17} /><span>怎么选更公平</span></button
  >
</header>

<main>
  <section class="page-heading">
    <div>
      <div class="eyebrow heading-eyebrow">GOOD FOOD, GREAT COMPANY</div>
      <h1>住得再远，也要<span>一起吃饭。</span><span class="heading-spark">✳</span></h1>
      <p>把出发点交给我们，把时间留给见面。</p>
    </div>
    <div class="heading-mode">
      <span class="mode-icon"><TrainFront size={19} /><span>/</span><Car size={19} /></span>
      <div><strong>各自出发，一起抵达</strong><span>步行 + 地铁 · 开车 / 打车</span></div>
    </div>
  </section>

  <nav class="mobile-tabs" aria-label="规划视图">
    <button class:active={mobileTab === 'friends'} onclick={() => (mobileTab = 'friends')}
      ><UsersRound size={16} />朋友 · {friends.length}</button
    ><button class:active={mobileTab === 'map'} onclick={() => (mobileTab = 'map')}
      ><MapPin size={16} />地图</button
    ><button class:active={mobileTab === 'results'} onclick={() => (mobileTab = 'results')}
      ><Utensils size={16} />推荐商圈</button
    >
  </nav>

  <div class="workspace">
    <aside class="friends-panel" class:mobile-visible={mobileTab === 'friends'}>
      <div class="panel-heading">
        <div class="panel-title">
          <UsersRound size={18} />
          <h2>这次，和谁一起？</h2>
          <span class="count-badge">{friends.length}</span>
        </div>
        <button
          class="icon-button reset-button"
          aria-label="重置为示例计划"
          title="重置为示例计划"
          onclick={() => resetDialog.showModal()}><RotateCcw size={15} /></button
        >
      </div>
      <p class="panel-subtitle">添加出发点，找到大家的交集。</p>
      <div class="friends-list">
        {#each friends as friend, i (friend.id)}
          <article
            class="friend-card"
            class:picking={pickingFriendId === friend.id}
            style={`--friend-color:${friend.color}`}
          >
            <div class="friend-top">
              <span class="friend-avatar">{friend.name.slice(0, 1) || i + 1}</span><input
                class="friend-name"
                aria-label={`朋友 ${i + 1} 的名字`}
                maxlength="12"
                bind:value={friend.name}
                onblur={() => {
                  if (!friend.name.trim()) friend.name = `朋友 ${i + 1}`;
                }}
              /><button
                class="icon-button friend-remove"
                aria-label={`移除${friend.name}`}
                disabled={friends.length <= 2}
                onclick={() => removeFriend(friend.id)}><X size={14} /></button
              >
            </div>
            <AddressInput
              id={friend.id}
              address={friend.address}
              onchange={(address, location) => updateLocation(friend.id, address, location)}
              onpick={() => beginPick(friend.id)}
            />
            <div class="travel-mode-options" role="group" aria-label={`${friend.name}的出行方式`}>
              <button
                class:active={friend.travelMode !== 'driving'}
                aria-pressed={friend.travelMode !== 'driving'}
                onclick={() => setTravelMode(friend.id, 'transit')}
                ><TrainFront size={13} />步行 + 地铁</button
              >
              <button
                class:active={friend.travelMode === 'driving'}
                aria-pressed={friend.travelMode === 'driving'}
                onclick={() => setTravelMode(friend.id, 'driving')}
                ><Car size={13} />开车 / 打车</button
              >
            </div>
            <div class="friend-preference">
              <span
                >通勤优先级 <button
                  class="inline-help"
                  aria-label="了解通勤权重"
                  onclick={() => helpDialog.showModal()}><Info size={12} /></button
                ></span
              ><strong>{friend.weight.toFixed(1)}<span>×</span></strong>
            </div>
            <input
              class="weight-slider"
              type="range"
              min="0.2"
              max="2"
              step="0.1"
              bind:value={friend.weight}
              aria-label={`${friend.name}的通勤优先级`}
              aria-valuetext={`${friend.weight.toFixed(1)}倍，${weightLabel(friend.weight)}`}
              style={`--range-progress:${((friend.weight - 0.2) / 1.8) * 100}%`}
            />
            <div class="weight-labels"><span>我多走一点</span><span>照顾我一点</span></div>
          </article>
        {/each}
      </div>
      <button class="add-friend" onclick={addFriend} disabled={friends.length >= 8}
        ><Plus size={17} />{friends.length >= 8 ? '已添加 8 位朋友' : '再叫上一位朋友'}</button
      >
      <div class="kind-note">
        <Heart size={17} strokeWidth={1.6} />
        <p>
          <strong>多一点体谅，少一点路程</strong><span
            >愿意多花一点时间在路上？把自己的优先级往左调，让推荐更靠近朋友。</span
          >
        </p>
      </div>
      <div class="local-save">
        {#if stored}<CheckCheck size={14} />计划已保存在此设备{:else}<Info
            size={14}
          />计划仅在当前页面可用{/if}
      </div>
    </aside>

    <section
      class="map-panel"
      class:mobile-visible={mobileTab === 'map'}
      aria-label="深圳地铁与商圈地图"
    >
      <CityMap
        {friends}
        {recommendations}
        selectedId={selected?.district.id ?? ''}
        onselect={openDistrict}
        {pickingFriendId}
        onpick={pick}
      />
      {#if pickingFriendId}<button class="cancel-picking" onclick={() => (pickingFriendId = null)}
          ><X size={14} />取消选点</button
        >{/if}
      {#if best && !pickingFriendId}<button
          class="map-recommendation"
          onclick={() => openDistrict(best.district.id)}
          ><span class="map-rec-icon"><Utensils size={20} /></span><span
            ><small>这次不如，就在这里见</small><strong
              >{best.district.name}<span>人均 {best.averageMinutes} 分钟</span></strong
            ></span
          ><ArrowUpRight size={20} /></button
        >{/if}
    </section>

    <aside
      class="results-panel"
      class:mobile-visible={mobileTab === 'results'}
      aria-label="商圈推荐"
    >
      {#if hasDrivers}
        <div class="driving-status" class:has-error={Boolean(drivingError)} role="status">
          {#if drivingLoading}<LoaderCircle size={14} class="loading-spin" />{:else}<Car
              size={14}
            />{/if}
          <span
            >{drivingLoading
              ? '正在更新驾车估时…'
              : drivingError
                ? drivingError.includes('粗估') || drivingError.includes('粗略')
                  ? drivingError
                  : `${drivingError} 当前使用粗略估算。`
                : '已更新高德驾车估时 · 含到店步行'}</span
          >
          {#if !drivingLoading}<button
              onclick={() => (drivingRetry += 1)}
              aria-label="刷新驾车估时"
              title="刷新驾车估时"><RotateCcw size={13} /></button
            >{/if}
        </div>
      {/if}
      {#if detailOpen && selected}
        <RouteDetail recommendation={selected} {friends} onback={() => (detailOpen = false)} />
      {:else}
        <div class="results-heading">
          <div>
            <span class="eyebrow">LET'S MEET IN THE MIDDLE</span>
            <h2>找到你们的好去处<span>↗</span></h2>
          </div>
          <span class="result-total">{recommendations.length} 个商圈</span>
        </div>
        <div class="strategy-tabs" aria-label="推荐策略">
          <button class:active={strategy === 'balanced'} onclick={() => setStrategy('balanced')}
            >综合最优</button
          ><button class:active={strategy === 'total'} onclick={() => setStrategy('total')}
            >总耗时少</button
          ><button class:active={strategy === 'fair'} onclick={() => setStrategy('fair')}
            >照顾最远</button
          >
        </div>
        <div class="ranking-description">
          <SlidersHorizontal size={13} /><span
            >{strategy === 'balanced'
              ? '兼顾大家的平均用时与最远路程'
              : strategy === 'total'
                ? '优先减少按个人权重计算的总耗时'
                : '优先降低按个人权重计算的最久通勤'}{changedWeights ? ' · 权重已调整' : ''}</span
          >
        </div>
        {#if recommendations.length}
          <div class="recommendation-list" aria-live="polite">
            {#each visibleRecommendations as recommendation, i (recommendation.district.id)}
              <button
                class="recommendation-card"
                class:best={i === 0}
                onclick={() => openDistrict(recommendation.district.id)}
              >
                {#if i === 0}<div class="best-label">
                    <span><Check size={12} strokeWidth={3} />本次首选</span><span
                      >为 {friends.length} 位朋友找到的交集</span
                    >
                  </div>{/if}
                <div class="rec-main">
                  <span class="rank-number">{String(i + 1).padStart(2, '0')}</span>
                  <div class="rec-name">
                    <h3>{recommendation.district.name}</h3>
                    <p>{recommendation.district.area} · {recommendation.district.stationName}</p>
                  </div>
                  <ArrowUpRight size={18} class="rec-arrow" />
                </div>
                <div class="rec-tags">
                  {#each recommendation.district.tags.slice(0, 3) as tag}<span>{tag}</span>{/each}
                </div>
                <div class="rec-person-times">
                  {#each recommendation.routes as route}{@const person = friends.find(
                      (f) => f.id === route.friendId,
                    )}{#if person}<span
                        title={`${person.name} · ${person.travelMode === 'driving' ? (route.source === 'amap' ? '开车 / 打车 · 高德估时' : '开车 / 打车 · 粗略估算') : '步行 + 地铁'}`}
                        ><i style={`background:${person.color}`}
                        ></i>{person.name}{#if person.travelMode === 'driving'}<Car
                            size={11}
                          />{/if}<strong>{route.minutes}<small> 分</small></strong></span
                      >{/if}{/each}
                </div>
                <div class="rec-footer">
                  <span
                    >人均 <strong>{recommendation.averageMinutes}</strong> 分钟<span
                      class="footer-dot">·</span
                    >最长 {recommendation.maxMinutes} 分</span
                  ><span class="rec-view">查看路线<ArrowRight size={12} /></span>
                </div>
              </button>
            {/each}
          </div>
          <button class="show-more" onclick={() => (showAll = !showAll)}
            >{showAll
              ? '收起更多商圈'
              : `看看其余 ${Math.max(0, recommendations.length - 4)} 个商圈`}<ChevronDown
              size={15}
              class={showAll ? 'rotate' : ''}
            /></button
          >
        {:else}<div class="empty-results">
            <Compass size={32} />
            <h3>调整一下出发方式吧</h3>
            <p>有朋友离地铁路网太远。可选择附近地铁站，或把这位朋友改为开车 / 打车。</p>
          </div>{/if}
        <div class="results-footnote">
          <Info size={13} /><span
            >{hasDrivers
              ? '按每人的出行方式比较，实际用时随路况变化。'
              : '按地铁线路估算，出发前请确认实际运营情况。'}</span
          >
        </div>
      {/if}
    </aside>
  </div>
  <footer class="page-footer">
    <span><span class="footer-mark">✳</span>距离有远近，见面不将就。</span><button
      onclick={() => helpDialog.showModal()}>数据与计算说明<ArrowUpRight size={12} /></button
    >
  </footer>
</main>

{#if toast}<div class="toast" role="status"><Check size={16} />{toast}</div>{/if}

<dialog
  class="info-dialog"
  bind:this={helpDialog}
  onclick={(e) => {
    if (e.target === helpDialog) helpDialog.close();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') helpDialog.close();
  }}
>
  <div class="dialog-content">
    <button
      class="dialog-close icon-button"
      aria-label="关闭计算说明"
      onclick={() => helpDialog.close()}><X size={20} /></button
    ><span class="dialog-symbol"><Scale size={27} /></span><span class="eyebrow"
      >A LITTLE CLOSER TO EVERYONE</span
    >
    <h2>让约饭，对每个人都友好。</h2>
    <p class="dialog-intro">我们比较深圳 {districts.length} 个商圈，帮你找到值得一起出发的地方。</p>
    <div class="explain-row">
      <span>01</span>
      <div>
        <h3>各选出行方式，一起比较用时</h3>
        <p>
          路线包含进出站步行、列车行驶、候车和换乘。内置 {metroLines.length} 条线路、{metroStations.length}
          个站点，选择多座附近车站比较路线。步行按距离估算，不是道路导航；不提供末班车和实时到站预测。
        </p>
        <p>
          开车 / 打车优先使用高德道路路线和估时，并预留 5
          分钟到店步行，等车与找车位另计。接口不可用时按直线距离 × 1.35、平均 30 km/h
          粗估，地图长虚线仅表示出发方向。出发前请核实路况。
        </p>
      </div>
    </div>
    <div class="explain-row">
      <span>02</span>
      <div>
        <h3>权重越高，越优先照顾你</h3>
        <p>
          1.0× 表示平等参与。调到
          0.5×，你的通勤时间在评分中按一半计算，推荐会更照顾其他朋友。分钟数始终展示实际估算，不会随权重打折。
        </p>
      </div>
    </div>
    <div class="explain-row">
      <span>03</span>
      <div>
        <h3>三种方式，找到共同的好去处</h3>
        <p>
          综合最优兼顾加权平均与加权最长用时；总耗时少优先加权平均；照顾最远优先加权最长用时。所有策略都会响应个人权重。
        </p>
      </div>
    </div>
    <div class="data-source">
      <strong>数据与隐私</strong>
      <p>{dataInfo.description}</p>
      <p>
        线路快照：{dataInfo.updatedAt}。<a href={dataInfo.source} target="_blank" rel="noreferrer"
          >查看数据来源 ↗</a
        >
        ·
        <a
          href="https://www.szmc.net/shentieyunying/yunyingfuwu/szsgdjtyyxlwlt/"
          target="_blank"
          rel="noreferrer">官方运营线路图 ↗</a
        >
      </p>
      <p>
        计划仅保存在本设备浏览器。详细地址搜索会向高德发送查询词；选择开车 /
        打车时会发送出发坐标和候选商圈坐标以查询路线，结果短暂缓存。地图底图由 OpenStreetMap 提供。
      </p>
    </div>
    <button class="primary-button" onclick={() => helpDialog.close()}
      >懂了，找朋友吃饭<ArrowRight size={16} /></button
    >
  </div>
</dialog>
<dialog class="reset-dialog" bind:this={resetDialog}>
  <div class="dialog-content">
    <span class="dialog-symbol"><RotateCcw size={24} /></span>
    <h2>重新来一份约饭计划？</h2>
    <p>当前朋友、地址、出行方式和权重将恢复为三人示例。</p>
    <div class="dialog-actions">
      <button class="secondary-button" onclick={() => resetDialog.close()}>保留当前计划</button
      ><button class="primary-button" onclick={reset}>恢复示例</button>
    </div>
  </div>
</dialog>
