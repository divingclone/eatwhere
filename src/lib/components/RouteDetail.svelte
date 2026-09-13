<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    CarFront,
    Footprints,
    TrainFront,
    Clock3,
    MapPin,
    ArrowLeftRight,
    ChevronDown,
    ChevronUp,
    ExternalLink,
  } from 'lucide-svelte';
  import type { Recommendation, Friend, PersonRoute } from '../types';
  let {
    recommendation,
    friends,
    onback,
  }: { recommendation: Recommendation; friends: Friend[]; onback: () => void } = $props();
  let expanded = $state<string[]>([]);
  const hasDriving = $derived(recommendation.routes.some((route) => isDriving(route)));
  const hasTransit = $derived(recommendation.routes.some((route) => !isDriving(route)));
  const hasEstimatedDriving = $derived(
    recommendation.routes.some((route) => isDriving(route) && route.source !== 'amap'),
  );
  $effect(() => {
    expanded = friends.length ? [friends[0].id] : [];
  });
  function toggle(id: string) {
    expanded = expanded.includes(id) ? expanded.filter((i) => i !== id) : [...expanded, id];
  }
  function isDriving(route: PersonRoute) {
    return (
      (route.travelMode ??
        friends.find((friend) => friend.id === route.friendId)?.travelMode ??
        'transit') === 'driving'
    );
  }
  function distanceLabel(route: PersonRoute) {
    if (route.distanceKm === undefined || !Number.isFinite(route.distanceKm)) return '';
    return `${route.source === 'amap' ? '道路' : '路程粗估'} ${route.distanceKm.toFixed(1)} 公里`;
  }
</script>

<div class="route-detail">
  <button class="back-button" onclick={onback}><ArrowLeft size={16} />返回商圈推荐</button>
  <div class="detail-title">
    <span class="eyebrow">MEET HERE</span>
    <h2>{recommendation.district.name}</h2>
    <p>
      <MapPin size={13} />{recommendation.district.area} · {recommendation.district
        .stationName}站周边
    </p>
  </div>
  <div class="detail-tags">
    {#each recommendation.district.tags as tag}<span>{tag}</span>{/each}
  </div>
  <p class="district-description">{recommendation.district.description}</p>
  <div class="detail-highlights">
    {#each recommendation.district.highlights as highlight}<span>{highlight}</span>{/each}
  </div>
  <div class="detail-metrics">
    <div>
      <strong>{recommendation.averageMinutes}<small> 分钟</small></strong><span>人均通勤</span>
    </div>
    <div><strong>{recommendation.maxMinutes}<small> 分钟</small></strong><span>最久通勤</span></div>
  </div>
  <div class="routes-title">
    <h3>大家怎么去</h3>
    <span>按每人的出行方式</span>
  </div>
  <div class="person-routes">
    {#each recommendation.routes as route}
      {@const friend = friends.find((f) => f.id === route.friendId)}
      {@const driving = isDriving(route)}
      {#if friend}
        <div class="person-route" style={`--person-color:${friend.color}`}>
          <button
            class="person-route-summary"
            onclick={() => toggle(route.friendId)}
            aria-expanded={expanded.includes(route.friendId)}
          >
            <span class="mini-avatar" style={`background:${friend.color}`}
              >{Array.from(friend.name)[0] || '友'}</span
            >
            <span class="person-route-name">
              <strong>
                <span class="route-friend-name">{friend.name}</span>
                <span class="route-mode-label">
                  {#if driving}<CarFront size={11} />{:else}<TrainFront size={11} />{/if}
                  {driving ? '开车/打车' : '地铁'}
                </span>
              </strong>
              {#if route.reachable}
                {#if driving}
                  <small>{route.source === 'amap' ? '高德驾车估时' : '驾车粗略估算'}</small>
                  {#if distanceLabel(route)}<small class="route-distance"
                      >{distanceLabel(route)}</small
                    >{/if}
                {:else}
                  <small
                    >{route.transfers === 0 ? '无需换乘' : route.transfers + ' 次换乘'} · 步行 {route.walkingMinutes}
                    分</small
                  >
                {/if}
              {:else}
                <small>{driving ? '暂无法估算用时' : '距离路网过远'}</small>
              {/if}
            </span>
            <span class="route-total">
              <strong class="route-time"
                >{route.reachable ? route.minutes : '—'}<small> 分</small></strong
              >
              {#if driving && route.reachable}<small>含到店步行</small>{/if}
            </span>
            {#if expanded.includes(route.friendId)}<ChevronUp size={15} />{:else}<ChevronDown
                size={15}
              />{/if}
          </button>
          {#if expanded.includes(route.friendId)}
            <div class="route-steps">
              <div class="route-origin"><span></span>{friend.address}</div>
              {#if route.reachable}
                {#each route.steps as step}
                  <div
                    class="route-step"
                    class:is-metro={step.type === 'metro'}
                    class:is-drive={step.type === 'drive'}
                    class:is-estimated-drive={step.type === 'drive' && route.source !== 'amap'}
                    style={`--line-color:${step.color ?? '#a4aaa5'}`}
                  >
                    <div class="step-icon">
                      {#if step.type === 'metro'}<TrainFront
                          size={14}
                        />{:else if step.type === 'drive'}<CarFront
                          size={14}
                        />{:else if step.type === 'transfer'}<ArrowLeftRight
                          size={14}
                        />{:else}<Footprints size={14} />{/if}
                    </div>
                    <div class="step-description">
                      {#if step.type === 'metro'}<span
                          class="line-badge"
                          style={`background:${step.color ?? '#285b48'}`}>{step.lineName}</span
                        >
                        <p>{step.from}<ArrowRight size={11} />{step.to}</p>
                        <small>{step.stops} 站 · 约 {step.minutes} 分钟</small>
                      {:else if step.type === 'drive'}
                        <span class="drive-badge">开车/打车</span>
                        <p>{step.label}</p>
                        <small>约 {step.minutes} 分钟</small>
                      {:else}<p>
                          {step.label}
                        </p>
                        <small>约 {step.minutes} 分钟</small>{/if}
                    </div>
                  </div>
                {/each}
                <div class="route-destination">
                  <MapPin size={15} />{recommendation.district.name}
                </div>
                {#if driving && route.source !== 'amap'}
                  <p class="drive-direction-note">
                    地图长虚线仅示意出发点到商圈的方向，实际道路与用时以导航为准。
                  </p>
                {/if}
              {:else}<p class="route-unavailable">
                  {driving
                    ? '暂无法估算这段驾车路线，请检查出发点位置。'
                    : '暂无法通过内置路网规划，请选择靠近地铁站的出发点。'}
                </p>{/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
  <div class="route-estimate-notes">
    {#if hasTransit}
      <p class="estimate-note">
        <Clock3 size={13} /><span>地铁预计用时包含候车和换乘，不含实时运营变化。</span>
      </p>
    {/if}
    {#if hasDriving}
      <p class="estimate-note">
        <CarFront size={13} /><span
          >驾车总用时含 5 分钟到店步行，打车等车和找车位另计。{hasEstimatedDriving
            ? '粗估按距离与绕路系数计算，不是道路导航。'
            : '路况变化可能影响实际到达时间。'}</span
        >
      </p>
    {/if}
  </div>
  <a
    class="map-search-link"
    href={`https://uri.amap.com/search?keyword=${encodeURIComponent(recommendation.district.name + ' 美食')}&city=深圳&view=map`}
    target="_blank"
    rel="noreferrer">在高德查看附近美食<ExternalLink size={14} /></a
  >
</div>

<style>
  .routes-title {
    flex-wrap: wrap;
    gap: 7px;
  }
  .person-route-summary {
    gap: 7px;
  }
  .person-route-summary > :global(svg) {
    flex-shrink: 0;
  }
  .person-route-name > strong {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    line-height: 1.5;
  }
  .route-friend-name {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .route-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    border-radius: 4px;
    background: #f0f4e9;
    color: #71845f;
    font-size: 9px;
    font-weight: 500;
    line-height: 1.5;
    padding: 2px 4px;
  }
  .person-route-name > small {
    line-height: 1.5;
    color: #7c8d6e;
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .person-route-name > .route-distance {
    margin-top: 1px;
    font-size: 10px;
    color: #89967c;
  }
  .route-total {
    text-align: right;
    flex-shrink: 0;
  }
  .route-total > small {
    display: block;
    color: #91a080;
    font-size: 8px;
    margin-top: 4px;
  }
  .route-origin,
  .route-destination {
    overflow-wrap: anywhere;
  }
  .route-destination > :global(svg) {
    flex-shrink: 0;
  }
  .route-step.is-drive {
    border-left: 2px solid var(--person-color);
    margin-left: 6px;
  }
  .route-step.is-estimated-drive {
    border-left-style: dashed;
  }
  .is-drive .step-icon {
    color: var(--person-color);
  }
  .step-description {
    overflow-wrap: anywhere;
  }
  .drive-badge {
    display: inline-block;
    color: var(--person-color);
    border: 1px solid currentColor;
    border-radius: 4px;
    font-size: 9px;
    line-height: 1.4;
    padding: 2px 5px;
    margin-bottom: 6px;
  }
  .drive-direction-note {
    margin: 10px 0 0;
    padding: 8px 9px;
    border-radius: 5px;
    color: #889476;
    background: #f5f7ef;
    font-size: 10px;
    line-height: 1.7;
  }
  .route-estimate-notes {
    margin: 15px 0;
  }
  .estimate-note {
    margin: 8px 0;
    color: #849571;
    font-size: 10px;
  }
  @media (max-width: 760px) {
    .person-route-name > small,
    .person-route-name > .route-distance {
      font-size: 11px;
    }
    .route-mode-label {
      font-size: 10px;
    }
    .estimate-note,
    .drive-direction-note {
      font-size: 11px;
    }
  }
</style>
