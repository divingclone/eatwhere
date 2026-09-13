<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    Footprints,
    TrainFront,
    Clock3,
    MapPin,
    ArrowLeftRight,
    ChevronDown,
    ChevronUp,
    ExternalLink,
  } from 'lucide-svelte';
  import type { Recommendation, Friend } from '../types';
  let {
    recommendation,
    friends,
    onback,
  }: { recommendation: Recommendation; friends: Friend[]; onback: () => void } = $props();
  let expanded = $state<string[]>([]);
  $effect(() => {
    expanded = friends.length ? [friends[0].id] : [];
  });
  function toggle(id: string) {
    expanded = expanded.includes(id) ? expanded.filter((i) => i !== id) : [...expanded, id];
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
    <span>步行 + 地铁</span>
  </div>
  <div class="person-routes">
    {#each recommendation.routes as route}
      {@const friend = friends.find((f) => f.id === route.friendId)}
      {#if friend}
        <div class="person-route" style={`--person-color:${friend.color}`}>
          <button
            class="person-route-summary"
            onclick={() => toggle(route.friendId)}
            aria-expanded={expanded.includes(route.friendId)}
          >
            <span class="mini-avatar" style={`background:${friend.color}`}
              >{friend.name.slice(0, 1)}</span
            >
            <span class="person-route-name"
              ><strong>{friend.name}</strong><small
                >{route.reachable
                  ? `${route.transfers === 0 ? '无需换乘' : route.transfers + ' 次换乘'} · 步行 ${route.walkingMinutes} 分`
                  : '距离路网过远'}</small
              ></span
            >
            <strong class="route-time"
              >{route.reachable ? route.minutes : '—'}<small> 分</small></strong
            >
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
                    style={`--line-color:${step.color ?? '#a4aaa5'}`}
                  >
                    <div class="step-icon">
                      {#if step.type === 'metro'}<TrainFront
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
                        <small>{step.stops} 站 · 约 {step.minutes} 分钟</small>{:else}<p>
                          {step.label}
                        </p>
                        <small>约 {step.minutes} 分钟</small>{/if}
                    </div>
                  </div>
                {/each}
                <div class="route-destination">
                  <MapPin size={15} />{recommendation.district.name}
                </div>
              {:else}<p class="route-unavailable">
                  暂无法通过内置路网规划，请选择靠近地铁站的出发点。
                </p>{/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
  <p class="estimate-note"><Clock3 size={13} />预计用时包含候车和换乘，不含实时运营变化。</p>
  <a
    class="map-search-link"
    href={`https://uri.amap.com/search?keyword=${encodeURIComponent(recommendation.district.name + ' 美食')}&city=深圳&view=map`}
    target="_blank"
    rel="noreferrer">在高德查看附近美食<ExternalLink size={14} /></a
  >
</div>
