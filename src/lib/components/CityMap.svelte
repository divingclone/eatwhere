<script lang="ts">
  import { onMount } from 'svelte';
  import * as L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import {
    ChevronDown,
    CarFront,
    LocateFixed,
    MapPin,
    Minus,
    MousePointer2,
    Plus,
    TrainFront,
    Utensils,
  } from 'lucide-svelte';
  import type { Coordinate, Friend, Recommendation } from '../types';
  import { districts, metroLines, metroStations } from '../data';

  let {
    friends,
    recommendations,
    selectedId,
    onselect,
    pickingFriendId,
    onpick,
  }: {
    friends: Friend[];
    recommendations: Recommendation[];
    selectedId: string;
    onselect: (id: string) => void;
    pickingFriendId: string | null;
    onpick: (location: Coordinate) => void;
  } = $props();

  let container: HTMLDivElement;
  let map: L.Map | undefined;
  let metroLayer: L.LayerGroup;
  let districtLayer: L.LayerGroup;
  let friendLayer: L.LayerGroup;
  let routeLayer: L.LayerGroup;
  let ready = $state(false);
  let showMetro = $state(true);
  let showDistricts = $state(true);
  let legendOpen = $state(false);
  let tileUnavailable = $state(false);
  let zoom = $state(11);
  let firstFit = false;
  const stationsById = new Map(metroStations.map((station) => [station.id, station]));
  const defaultBounds: L.LatLngBoundsExpression = [
    [22.507, 113.866],
    [22.713, 114.258],
  ];
  const pickedFriend = $derived(friends.find((friend) => friend.id === pickingFriendId));
  const selectedRecommendation = $derived(
    recommendations.find((recommendation) => recommendation.district.id === selectedId),
  );
  const hasDriving = $derived(friends.some((friend) => friend.travelMode === 'driving'));
  const hasTransit = $derived(friends.some((friend) => friend.travelMode !== 'driving'));
  const hasEstimatedDriving = $derived(
    selectedRecommendation?.routes.some(
      (route) => route.travelMode === 'driving' && route.source !== 'amap',
    ) ?? hasDriving,
  );
  const hasRoadDriving = $derived(
    selectedRecommendation?.routes.some(
      (route) => route.travelMode === 'driving' && route.source === 'amap',
    ) ?? false,
  );
  const routeMapNote = $derived(
    hasEstimatedDriving
      ? `驾车长虚线仅为方向示意${hasTransit ? ' · 地铁按站点估算' : '，非道路导航'}`
      : hasRoadDriving
        ? `驾车显示高德道路路线${hasTransit ? ' · 地铁按站点估算' : ''}`
        : '地铁路线基于站点估算',
  );

  const latLng = (location: Coordinate): L.LatLngTuple => [location.lat, location.lng];

  function createElement(tag: string, className: string, content?: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function fitEveryone() {
    if (!map) return;
    const points: L.LatLngTuple[] = friends.map((friend) => latLng(friend.location));
    const selected =
      recommendations.find((item) => item.district.id === selectedId) ?? recommendations[0];
    if (selected) points.push(latLng(selected.district.location));
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [76, 90], maxZoom: 13, animate: true });
    } else {
      map.fitBounds(defaultBounds, { padding: [30, 60], animate: true });
    }
  }

  onMount(() => {
    map = L.map(container, {
      center: [22.595, 114.057],
      zoom: 11,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      zoomControl: false,
      minZoom: 9,
      maxZoom: 18,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    map.createPane('metro');
    map.getPane('metro')!.style.zIndex = '410';
    map.createPane('routes');
    map.getPane('routes')!.style.zIndex = '430';
    let tileErrors = 0;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.55,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      className: 'shenzhen-basemap',
    });
    tiles.on('tileerror', () => {
      tileErrors += 1;
      if (tileErrors >= 4) tileUnavailable = true;
    });
    tiles.on('tileload', () => {
      tileErrors = 0;
      tileUnavailable = false;
    });
    tiles.addTo(map);
    metroLayer = L.layerGroup().addTo(map);
    districtLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    friendLayer = L.layerGroup().addTo(map);
    map.fitBounds(defaultBounds, { padding: [30, 60], animate: false });
    map.on('zoomend', () => {
      if (map) zoom = map.getZoom();
    });
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (pickingFriendId) onpick({ lng: event.latlng.lng, lat: event.latlng.lat });
      legendOpen = false;
    });
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]?.contentRect.width && entries[0]?.contentRect.height)
        map?.invalidateSize({ pan: false });
    });
    resizeObserver.observe(container);
    zoom = map.getZoom();
    ready = true;
    return () => {
      resizeObserver.disconnect();
      tiles.off();
      map?.remove();
      map = undefined;
    };
  });

  $effect(() => {
    if (!ready || !map) return;
    const currentFriends = friends;
    const firstRecommendation = recommendations[0];
    if (!firstFit && currentFriends.length > 0 && firstRecommendation) {
      firstFit = true;
      const points: L.LatLngTuple[] = currentFriends.map((friend) => latLng(friend.location));
      points.push(latLng(firstRecommendation.district.location));
      map.fitBounds(L.latLngBounds(points), { padding: [45, 80], maxZoom: 12, animate: false });
    }
  });

  $effect(() => {
    if (!ready || !map) return;
    metroLayer.clearLayers();
    if (!showMetro) return;
    const currentZoom = zoom;
    for (const line of metroLines) {
      const coordinates = line.stationIds
        .map((stationId) => stationsById.get(stationId))
        .filter((station) => station !== undefined)
        .map((station) => latLng(station.location));
      if (coordinates.length < 2) continue;
      L.polyline(coordinates, {
        color: line.color,
        weight: currentZoom >= 13 ? 3 : 2.4,
        opacity: 0.45,
        pane: 'metro',
        interactive: false,
        smoothFactor: 0.5,
      }).addTo(metroLayer);
    }
    if (currentZoom >= 12) {
      for (const station of metroStations) {
        const interchange = station.lineIds.length > 1;
        if (currentZoom < 13 && !interchange) continue;
        const line = metroLines.find((item) => item.id === station.lineIds[0]);
        L.circleMarker(latLng(station.location), {
          radius: interchange ? 3 : 1.8,
          color: interchange ? '#8b9a94' : (line?.color ?? '#8b9a94'),
          weight: 1.3,
          fillColor: '#fff',
          fillOpacity: 0.95,
          opacity: 0.8,
          pane: 'metro',
        })
          .bindTooltip(createElement('span', 'station-tooltip', station.name), {
            direction: 'top',
            offset: [0, -4],
          })
          .addTo(metroLayer);
      }
    }
  });

  $effect(() => {
    if (!ready || !map) return;
    districtLayer.clearLayers();
    if (!showDistricts) return;
    const currentZoom = zoom;
    const currentPicking = pickingFriendId;
    const ranks = new Map(
      recommendations.map((recommendation, index) => [recommendation.district.id, index + 1]),
    );
    for (const district of districts) {
      const rank = ranks.get(district.id);
      const selected = district.id === selectedId;
      const topRank = rank !== undefined && rank <= 3;
      const showLabel = selected || topRank || currentZoom >= 12;
      const color = selected ? '#28594a' : topRank ? '#ed885a' : '#7d9686';
      const ring = L.circle(latLng(district.location), {
        radius: selected ? 850 : 650,
        color,
        weight: selected ? 1.5 : 1,
        opacity: selected ? 0.65 : 0.3,
        fillColor: color,
        fillOpacity: selected ? 0.15 : 0.07,
        className: 'business-radius',
        bubblingMouseEvents: false,
      }).addTo(districtLayer);
      const pin = createElement(
        'div',
        `business-pin${selected ? ' is-selected' : ''}${topRank ? ' is-top' : ''}${showLabel ? '' : ' is-compact'}`,
      );
      const badge = createElement(
        'span',
        'business-pin-badge',
        topRank ? String(rank).padStart(2, '0') : '',
      );
      if (!topRank) {
        const dot = createElement('span', 'business-pin-dot');
        badge.appendChild(dot);
      }
      pin.appendChild(badge);
      if (showLabel) {
        pin.appendChild(createElement('span', 'business-pin-name', district.name));
        if (selected)
          pin.appendChild(
            createElement('span', 'business-pin-selected', rank === 1 ? '首选' : '已选'),
          );
      }
      const marker = L.marker(latLng(district.location), {
        icon: L.divIcon({
          className: 'business-map-icon',
          html: pin,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        title: `${district.name}${rank ? `，推荐第 ${rank} 名` : ''}`,
        alt: district.name,
        keyboard: true,
        bubblingMouseEvents: false,
        zIndexOffset: selected ? 1500 : topRank ? 900 : 0,
      }).addTo(districtLayer);
      const select = () => {
        if (currentPicking) onpick(district.location);
        else onselect(district.id);
      };
      marker.on('click', select);
      ring.on('click', select);
      if (!showLabel)
        marker.bindTooltip(createElement('span', 'business-tooltip', district.name), {
          direction: 'top',
          offset: [0, -15],
        });
    }
  });

  $effect(() => {
    if (!ready || !map) return;
    routeLayer.clearLayers();
    const selected = recommendations.find(
      (recommendation) => recommendation.district.id === selectedId,
    );
    if (!selected) return;
    for (const route of selected.routes) {
      const friend = friends.find((item) => item.id === route.friendId);
      if (!friend || !route.reachable) continue;
      const driving = (route.travelMode ?? friend.travelMode ?? 'transit') === 'driving';
      const legs = route.steps.filter((step) => step.coordinates && step.coordinates.length >= 2);
      const paths =
        legs.length > 0
          ? legs.map((step) => ({ coordinates: step.coordinates!, type: step.type }))
          : [{ coordinates: route.coordinates, type: driving ? 'drive' : 'metro' }];
      for (const path of paths) {
        if (path.coordinates.length < 2) continue;
        const walk = path.type === 'walk';
        const estimatedDrive = path.type === 'drive' && route.source !== 'amap';
        const dashArray = walk ? '3 7' : estimatedDrive ? '13 10' : undefined;
        const coordinates = path.coordinates.map(latLng);
        L.polyline(coordinates, {
          color: '#ffffff',
          weight: walk ? 6.5 : 7,
          opacity: 0.9,
          dashArray,
          pane: 'routes',
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeLayer);
        L.polyline(coordinates, {
          color: friend.color,
          weight: walk ? 3 : 4.1,
          opacity: walk ? 0.9 : 0.88,
          dashArray,
          className: `friend-route route-${path.type}${estimatedDrive ? ' is-direction-only' : ''}`,
          pane: 'routes',
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeLayer);
      }
    }
  });

  $effect(() => {
    if (!ready || !map) return;
    friendLayer.clearLayers();
    const selected = recommendations.find(
      (recommendation) => recommendation.district.id === selectedId,
    );
    for (const friend of friends) {
      const route = selected?.routes.find((item) => item.friendId === friend.id);
      const person = createElement('div', 'person-map-pin');
      person.style.setProperty('--person-color', friend.color);
      person.appendChild(
        createElement('span', 'person-map-avatar', Array.from(friend.name)[0] || '友'),
      );
      const label = createElement('div', 'person-map-label');
      const heading = createElement('div', 'person-map-heading');
      heading.appendChild(createElement('strong', 'person-map-name', friend.name || '朋友'));
      const driving = (route?.travelMode ?? friend.travelMode ?? 'transit') === 'driving';
      heading.appendChild(createElement('span', 'person-map-mode', driving ? '开车/打车' : '地铁'));
      label.appendChild(heading);
      if (route?.reachable)
        label.appendChild(createElement('span', 'person-map-time', `${route.minutes} 分钟`));
      person.appendChild(label);
      L.marker(latLng(friend.location), {
        icon: L.divIcon({
          className: 'person-map-icon',
          html: person,
          iconSize: [36, 44],
          iconAnchor: [18, 42],
        }),
        title: `${friend.name}：${friend.address}`,
        alt: friend.name,
        zIndexOffset: 1800,
        interactive: false,
        keyboard: false,
      }).addTo(friendLayer);
    }
  });
</script>

<div class="map-shell">
  <div
    class="map-canvas"
    class:is-picking={Boolean(pickingFriendId)}
    bind:this={container}
    aria-label="深圳约饭地图，显示商圈与朋友各自的出行路线，可切换地铁图层"
  ></div>

  <div class="map-tools">
    <div class="city-label">
      <span class="city-dot"></span>深圳<span class="city-english">SHENZHEN</span>
    </div>
    <div class="layer-switches" aria-label="地图图层">
      <button
        type="button"
        class:active={showMetro}
        aria-pressed={showMetro}
        onclick={() => (showMetro = !showMetro)}
        title="显示或隐藏深圳地铁"
      >
        <TrainFront size={14} strokeWidth={1.7} /><span>地铁</span>
      </button>
      <span class="tool-divider"></span>
      <button
        type="button"
        class:active={showDistricts}
        aria-pressed={showDistricts}
        onclick={() => (showDistricts = !showDistricts)}
        title="显示或隐藏约饭商圈"
      >
        <Utensils size={14} strokeWidth={1.7} /><span>商圈</span>
      </button>
    </div>
  </div>

  {#if pickingFriendId}
    <div class="picking-banner" role="status">
      <MousePointer2 size={16} /><span>点击地图，设置{pickedFriend?.name || '朋友'}的出发点</span>
    </div>
  {/if}

  {#if tileUnavailable}
    <div class="tile-note" role="status">
      <MapPin size={14} />底图暂时无法加载，商圈与路线仍可操作
    </div>
  {/if}

  <div class="map-bottom-left">
    {#if legendOpen}
      <div class="legend-popover">
        <div class="legend-heading">出行路线<span>颜色对应每位朋友</span></div>
        <div class="route-legend-items">
          {#if hasTransit}
            <div>
              <i class="route-swatch"></i><TrainFront size={13} /><span>地铁 · 按站点连接</span>
            </div>
          {/if}
          {#if hasRoadDriving}
            <div>
              <i class="route-swatch"></i><CarFront size={13} /><span>开车/打车 · 高德道路路线</span
              >
            </div>
          {/if}
          {#if hasEstimatedDriving}
            <div>
              <i class="route-swatch drive-estimate"></i><CarFront size={13} /><span
                >开车/打车 · 方向示意</span
              >
            </div>
          {/if}
          <div><i class="route-swatch walking"></i><span>短虚线 · 步行</span></div>
        </div>
        {#if hasEstimatedDriving}
          <p class="legend-route-note">驾车长虚线只连接起终点，不代表实际道路。</p>
        {/if}
        {#if showMetro}
          <div class="legend-heading metro-legend-heading">
            地铁图层<span>{metroLines.length} 条线路</span>
          </div>
          <div class="all-lines">
            {#each metroLines as line (line.id)}
              <span class="legend-line"><i style:background={line.color}></i>{line.name}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <button
      type="button"
      class="legend-button"
      aria-expanded={legendOpen}
      onclick={() => (legendOpen = !legendOpen)}
    >
      <span class="legend-label">出行路线</span>
      <span class="mini-lines">
        {#each friends.slice(0, 4) as friend (friend.id)}
          <i style:background={friend.color} title={friend.name}></i>
        {/each}
      </span>
      <span class="legend-more">图例</span><ChevronDown
        size={13}
        class={legendOpen ? 'is-open' : ''}
      />
    </button>
    <span class="map-scale-note">{routeMapNote}</span>
  </div>

  <div class="map-controls">
    <button
      type="button"
      class="locate-button"
      onclick={fitEveryone}
      title="查看所有朋友和推荐商圈"
      aria-label="查看所有朋友和推荐商圈"><LocateFixed size={19} strokeWidth={1.6} /></button
    >
    <div class="zoom-controls">
      <button type="button" onclick={() => map?.zoomIn()} title="放大地图" aria-label="放大地图"
        ><Plus size={20} strokeWidth={1.5} /></button
      >
      <span></span>
      <button type="button" onclick={() => map?.zoomOut()} title="缩小地图" aria-label="缩小地图"
        ><Minus size={20} strokeWidth={1.5} /></button
      >
    </div>
  </div>
</div>

<style>
  .map-shell {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 480px;
    overflow: hidden;
    border-radius: inherit;
    background: #f2f4ef;
    isolation: isolate;
  }
  .map-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #f2f4ef;
    z-index: 0;
    font-family: inherit;
  }
  .map-canvas.is-picking {
    cursor: crosshair;
  }
  .map-tools {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 500;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .city-label,
  .layer-switches {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 2px 10px #2747350d;
    border: 1px solid #e4e9e2;
    border-radius: 9px;
    height: 37px;
  }
  .city-label {
    padding: 0 12px;
    gap: 7px;
    color: #2f473d;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
  }
  .city-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #53755a;
  }
  .city-english {
    color: #8b968d;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.1em;
  }
  .layer-switches {
    padding: 3px;
    gap: 2px;
  }
  .layer-switches button {
    height: 29px;
    padding: 0 9px;
    display: flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: transparent;
    color: #9baba1;
    font: inherit;
    font-size: 11px;
    border-radius: 6px;
    cursor: pointer;
    transition:
      background 0.18s,
      color 0.18s;
  }
  .layer-switches button.active {
    background: #edf3ec;
    color: #3d6550;
  }
  .layer-switches button:hover {
    background: #e6eee5;
    color: #244f3e;
  }
  .tool-divider {
    height: 12px;
    width: 1px;
    background: #e8ece6;
  }
  .picking-banner {
    position: absolute;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 550;
    display: flex;
    align-items: center;
    gap: 8px;
    color: white;
    background: #2c5747;
    padding: 12px 16px;
    border-radius: 11px;
    box-shadow: 0 5px 18px #254f4630;
    font-size: 12px;
    white-space: nowrap;
    animation: banner-in 0.2s ease-out;
  }
  .tile-note {
    position: absolute;
    left: 20px;
    right: 70px;
    top: 72px;
    z-index: 490;
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 7px;
    background: #fffcf0f2;
    border: 1px solid #e6dfbf;
    color: #8b7853;
    font-size: 11px;
  }
  .picking-banner + .tile-note {
    top: 124px;
  }
  .map-bottom-left {
    position: absolute;
    left: 20px;
    bottom: 119px;
    z-index: 500;
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
    max-width: calc(100% - 86px);
  }
  .legend-button {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 37px;
    padding: 0 11px;
    border: 1px solid #e0e6dd;
    border-radius: 8px;
    background: #fffffff5;
    box-shadow: 0 2px 12px #2039290b;
    color: #53655a;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .legend-label {
    font-size: 11px;
    font-weight: 550;
  }
  .mini-lines {
    display: flex;
    gap: 4px;
  }
  .mini-lines i {
    width: 12px;
    height: 3px;
    border-radius: 3px;
  }
  .legend-more {
    margin-left: 3px;
    color: #849187;
  }
  .legend-button :global(svg) {
    transition: transform 0.2s;
  }
  .legend-button :global(svg.is-open) {
    transform: rotate(180deg);
  }
  .map-scale-note {
    color: #657762;
    font-size: 10px;
    line-height: 1.5;
    max-width: 310px;
    background: #ffffffeb;
    padding: 3px 6px;
    border-radius: 3px;
    letter-spacing: 0.02em;
  }
  .legend-popover {
    width: 268px;
    max-width: 100%;
    max-height: 270px;
    overflow: auto;
    box-sizing: border-box;
    padding: 14px;
    background: #fffffffc;
    border: 1px solid #e0e7dc;
    border-radius: 12px;
    box-shadow: 0 8px 30px #254c3520;
    animation: banner-in 0.18s ease-out;
  }
  .legend-heading {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #354e3f;
    font-weight: 600;
    padding-bottom: 11px;
  }
  .legend-heading span {
    font-size: 10px;
    font-weight: 400;
    color: #8b978c;
  }
  .all-lines {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
    max-height: 156px;
    overflow: auto;
  }
  .legend-line {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #637066;
    font-size: 10px;
  }
  .legend-line i {
    width: 16px;
    height: 3px;
    border-radius: 5px;
    flex: 0 0 16px;
  }
  .route-legend-items {
    display: grid;
    gap: 10px;
    color: #657661;
    font-size: 10px;
  }
  .route-legend-items > div {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .route-swatch {
    flex: 0 0 29px;
    width: 29px;
    height: 3px;
    border-radius: 2px;
    background: #78927c;
  }
  .route-swatch.drive-estimate {
    background: repeating-linear-gradient(to right, #78927c 0 11px, transparent 11px 18px);
  }
  .route-swatch.walking {
    background: repeating-linear-gradient(to right, #78927c 0 3px, transparent 3px 7px);
  }
  .legend-route-note {
    margin: 12px 0 0;
    color: #7c896f;
    font-size: 10px;
    line-height: 1.6;
  }
  .metro-legend-heading {
    border-top: 1px solid #ecf0e9;
    margin-top: 13px;
    padding-top: 12px;
  }
  .map-controls {
    position: absolute;
    right: 18px;
    bottom: 126px;
    z-index: 500;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .map-controls button {
    width: 37px;
    height: 36px;
    display: grid;
    place-items: center;
    background: #fffffff7;
    border: 0;
    color: #4b6252;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .map-controls button:hover {
    background: #edf3e9;
    color: #254f46;
  }
  .locate-button,
  .zoom-controls {
    border: 1px solid #dfe6dc !important;
    border-radius: 9px;
    box-shadow: 0 2px 12px #2540300c;
    overflow: hidden;
  }
  .zoom-controls {
    background: white;
  }
  .zoom-controls span {
    display: block;
    height: 1px;
    margin: 0 9px;
    background: #e7ece2;
  }
  button:focus-visible {
    outline: 3px solid #729b7f;
    outline-offset: 3px;
  }
  /* Soften only the base tiles; routes, markers and controls stay crisp. */
  :global(.map-shell .shenzhen-basemap) {
    filter: saturate(0.18) contrast(0.68) brightness(1.12);
  }
  :global(.map-shell .leaflet-control-attribution) {
    color: #8c968c;
    background: #ffffffbf;
    font-family: inherit;
    font-size: 8px;
    padding: 2px 5px;
  }
  :global(.map-shell .leaflet-control-attribution a) {
    color: #7a897a;
    text-decoration: none;
  }
  :global(.map-shell .leaflet-tooltip) {
    border: 1px solid #dde5d8;
    border-radius: 6px;
    box-shadow: 0 2px 8px #253e3310;
    color: #526551;
    font-family: inherit;
    font-size: 11px;
  }
  :global(.business-map-icon),
  :global(.person-map-icon) {
    border: 0;
    background: transparent;
  }
  :global(.business-pin) {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px 5px 5px;
    border: 1px solid #d8e1d3;
    border-radius: 8px;
    background: #ffffffed;
    box-shadow: 0 2px 7px #2b452415;
    color: #5e745b;
    white-space: nowrap;
    transform: translate(-50%, -50%);
    cursor: pointer;
    transition:
      background 0.16s,
      box-shadow 0.16s;
    font-family: inherit;
  }
  :global(.business-pin:hover) {
    box-shadow: 0 3px 13px #254f462a;
    background: white;
  }
  :global(.business-pin-badge) {
    height: 17px;
    min-width: 17px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    background: #eaf0e5;
    color: #6c815f;
    font-size: 9px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  :global(.business-pin-dot) {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #879e78;
  }
  :global(.business-pin-name) {
    font-size: 10px;
    font-weight: 550;
    letter-spacing: 0.015em;
  }
  :global(.business-pin.is-top) {
    border-color: #f0d7bc;
    color: #966336;
  }
  :global(.business-pin.is-top .business-pin-badge) {
    color: #c78048;
    background: #faf0df;
  }
  :global(.business-pin.is-selected) {
    padding: 8px 10px 8px 7px;
    gap: 7px;
    background: #2c5747;
    border-color: #fff;
    border-width: 2px;
    box-shadow: 0 5px 15px #264d4233;
    color: white;
    border-radius: 10px;
  }
  :global(.business-pin.is-selected .business-pin-badge) {
    background: #648171;
    color: white;
    width: 23px;
    height: 23px;
    font-size: 11px;
  }
  :global(.business-pin.is-selected .business-pin-name) {
    font-size: 12px;
    font-weight: 600;
  }
  :global(.business-pin.is-selected .business-pin-dot) {
    background: white;
  }
  :global(.business-pin-selected) {
    margin-left: 1px;
    padding: 2px 4px;
    font-size: 8px;
    background: #e2edcb;
    color: #426042;
    border-radius: 3px;
    font-weight: 600;
  }
  :global(.business-pin.is-compact) {
    border: 2px solid white;
    padding: 3px;
    border-radius: 50%;
    background: #99ad89;
  }
  :global(.business-pin.is-compact .business-pin-badge) {
    width: 6px;
    min-width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
  }
  :global(.business-pin.is-compact .business-pin-dot) {
    width: 4px;
    height: 4px;
    background: #88a175;
  }
  :global(.person-map-pin) {
    position: relative;
    width: 36px;
    height: 40px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    filter: drop-shadow(0 3px 5px #31473525);
  }
  :global(.person-map-pin::after) {
    content: '';
    position: absolute;
    bottom: 0;
    left: 14px;
    width: 9px;
    height: 9px;
    transform: rotate(45deg);
    background: var(--person-color);
    border-radius: 1px;
    border-right: 2px solid white;
    border-bottom: 2px solid white;
  }
  :global(.person-map-avatar) {
    position: relative;
    z-index: 1;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 3px solid white;
    background: var(--person-color);
    color: white;
    font-family: inherit;
    font-size: 13px;
    font-weight: 650;
    box-sizing: border-box;
  }
  :global(.person-map-label) {
    position: absolute;
    left: 42px;
    top: 0;
    min-width: 56px;
    padding: 6px 9px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: 7px;
    background: #ffffffed;
    white-space: nowrap;
    filter: none;
    font-family: inherit;
  }
  :global(.person-map-name) {
    color: #475a4a;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.25;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.person-map-heading) {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  :global(.person-map-mode) {
    color: #758470;
    background: #edf2e8;
    border-radius: 3px;
    padding: 2px 3px;
    font-size: 8px;
    line-height: 1;
    font-weight: 500;
  }
  :global(.person-map-time) {
    color: var(--person-color);
    font-size: 9px;
    line-height: 1.2;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  @keyframes banner-in {
    from {
      opacity: 0;
      margin-top: -4px;
    }
    to {
      opacity: 1;
      margin-top: 0;
    }
  }
  @media (max-width: 700px) {
    .map-shell {
      min-height: 410px;
    }
    .map-tools {
      top: 13px;
      left: 12px;
      gap: 6px;
    }
    .city-label {
      padding: 0 9px;
      font-size: 11px;
    }
    .city-english {
      display: none;
    }
    .layer-switches button {
      padding: 0 7px;
    }
    .map-bottom-left {
      left: 12px;
      bottom: 119px;
    }
    .map-controls {
      right: 12px;
      bottom: 126px;
    }
    .picking-banner {
      top: 65px;
      font-size: 11px;
      gap: 6px;
      padding: 10px 12px;
    }
    .tile-note {
      left: 12px;
      top: 62px;
      font-size: 10px;
      max-width: 240px;
    }
    .legend-button {
      gap: 7px;
      height: 34px;
    }
    :global(.business-pin.is-selected .business-pin-name) {
      font-size: 11px;
    }
    :global(.person-map-label) {
      left: 37px;
      padding: 5px 6px;
      min-width: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    :global(.business-pin) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
