import { AfterViewInit, Component, ElementRef, Inject, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SearchHistoryItem } from '../models/search-history-item.model';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';
import { environment } from '../../../../environments/environment';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface StoreMapDialogData {
  stores: SearchHistoryItem[];
  apiKey: string;
  initialCenter?: MapPoint | null;
  fallbackCenter?: MapPoint | null;
}

@Component({
  selector: 'app-store-map-dialog',
  templateUrl: './store-map-dialog.component.html',
  styleUrls: ['./store-map-dialog.component.scss']
})
export class StoreMapDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  isLoading = true;
  errorMessage = '';
  selectedStore: SearchHistoryItem | null = null;

  private googleObj: any = null;
  private map: any = null;
  private currentMarkers = new Map<string, any>();
  private currentClusterMarkers = new Map<string, { marker: any; signature: string }>();
  private currentLocationMarker: any = null;
  private currentLocationOverlayClass: any = null;
  private lastCurrentLocation: MapPoint | null = null;
  private idleListener: any = null;
  private pendingFrame: number | null = null;
  private infoWindow: any = null;

  constructor(
    private readonly dialogRef: MatDialogRef<StoreMapDialogComponent, SearchHistoryItem | null>,
    private readonly googleMapsLoader: GoogleMapsLoaderService,
    private readonly zone: NgZone,
    @Inject(MAT_DIALOG_DATA) public data: StoreMapDialogData
  ) {}

  async ngAfterViewInit(): Promise<void> {
    if (!this.data?.apiKey) {
      this.isLoading = false;
      this.errorMessage = '尚未設定 Google Maps API Key';
      return;
    }

    if (!this.data?.stores?.length) {
      this.isLoading = false;
      this.errorMessage = '目前沒有可顯示的門市資料';
      return;
    }

    try {
      const googleObj = await this.googleMapsLoader.load(this.data.apiKey);
      this.initMap(googleObj);
      this.isLoading = false;
    } catch (error) {
      console.error('Google Maps 初始化失敗:', error);
      this.isLoading = false;
      this.errorMessage = '地圖初始化失敗，請稍後再試';
    }
  }

  close(): void {
    this.dialogRef.close(null);
  }

  focusStore(store: SearchHistoryItem): void {
    this.zone.run(() => {
      this.selectedStore = store;
    });
    if (this.map && this.googleObj) {
      (window as any).__storeMapConfirm = () => {
        this.zone.run(() => this.confirmSelection());
      };

      const isSeven = store.label === '7-11';
      const labelColor = isSeven ? '#f58220' : '#0072bc';
      const labelBg = isSeven ? '#fff7ed' : '#eff6ff';

      const headerContent = document.createElement('div');
      headerContent.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:16px 0 16px 14px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "min-width:0;flex:1;";
      headerContent.innerHTML = `
        <span style="display:inline-block;font-size:11px;font-weight:700;color:${labelColor};background:${labelBg};padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0;">${store.label}</span>
        <span style="font-size:14px;font-weight:700;color:#2f2f2f;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${store.name}</span>
      `;

      const bodyContent = `
        <div style="min-width:220px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
          <div style="padding:0 12px;font-size:12px;color:#6b7280;line-height:1.4;word-break:break-word">
            ${store.addr}
          </div>
          <div style="padding:12px 12px 12px 12px;border-top:1px solid #e5e7eb;margin-top:10px;">
            <button onclick="window.__storeMapConfirm()"
              style="width:100%;padding:8px 12px;border:none;border-radius:4px;background:#1976d2;color:#fff;font-size:13px;font-weight:600;cursor:pointer">
              載入商品
            </button>
          </div>
        </div>
      `;

      if (this.infoWindow) {
        this.infoWindow.close();
      }

      this.infoWindow = new this.googleObj.maps.InfoWindow({
        content: bodyContent,
        headerContent,
        position: {
          lat: store.latitude,
          lng: store.longitude
        },
        pixelOffset: new this.googleObj.maps.Size(0, -36)
      });

      this.infoWindow.open(this.map);
    }
  }

  confirmSelection(): void {
    if (this.selectedStore) {
      this.dialogRef.close({
        name: this.selectedStore.name,
        label: this.selectedStore.label,
        addr: this.selectedStore.addr,
        latitude: this.selectedStore.latitude,
        longitude: this.selectedStore.longitude
      });
    }
  }

  ngOnDestroy(): void {
    if (this.infoWindow) {
      this.infoWindow.close();
      this.infoWindow = null;
    }
    this.destroyMarkers();
    if (this.currentLocationMarker) {
      this.googleObj?.maps.event.clearInstanceListeners(this.currentLocationMarker);
      this.currentLocationMarker.setMap(null);
      this.currentLocationMarker = null;
    }
    if (this.idleListener && this.googleObj) {
      this.googleObj.maps.event.removeListener(this.idleListener);
      this.idleListener = null;
    }
    if (this.pendingFrame != null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  private destroyMarkers(): void {
    if (!this.googleObj) {
      return;
    }
    for (const marker of this.currentMarkers.values()) {
      this.releaseMarker(marker);
    }
    for (const { marker } of this.currentClusterMarkers.values()) {
      this.releaseMarker(marker);
    }
    this.currentMarkers.clear();
    this.currentClusterMarkers.clear();
  }

  private releaseMarker(marker: any): void {
    if (!this.googleObj || !marker) {
      return;
    }

    this.googleObj.maps.event.clearInstanceListeners(marker);
    marker.setMap(null);
  }

  private initMap(googleObj: any): void {
    this.googleObj = googleObj;
    const center = this.computeInitialCenter();
    const map = new googleObj.maps.Map(this.mapContainer.nativeElement, {
      center,
      zoom: 16,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy'
    });
    this.map = map;

    const EXPAND_THRESHOLD = 150;
    const CLUSTER_GRID_SIZE = 54;
    const SEVEN_LABEL_COLOR = '#f58220';
    const FAMILY_LABEL_COLOR = '#0072bc';
    const CLUSTER_COLOR = '#2e7d32';
    const StoreOverlayMarker = this.createStoreOverlayMarkerClass(googleObj);
    this.currentLocationOverlayClass = this.createCurrentLocationOverlayClass(googleObj);
    const storeOrderMap = new Map(
      this.data.stores.map((store, index) => [this.getStoreKey(store), index] as const)
    );

    const createStoreMarker = (store: SearchHistoryItem, index: number) => {
      const isSeven = store.label === '7-11';
      const markerPosition = { lat: store.latitude, lng: store.longitude };
      const focusStore = () => {
        this.focusStore(store);
      };

      const marker = new StoreOverlayMarker({
        position: markerPosition,
        title: store.name,
        iconUrl: isSeven ? environment.sevenElevenUrl.icon : environment.familyMartUrl.icon,
        labelText: this.getStoreShortName(store),
        labelColor: isSeven ? SEVEN_LABEL_COLOR : FAMILY_LABEL_COLOR,
        zIndex: this.getStoreMarkerZIndex(store, index),
        onClick: focusStore,
        map
      });

      return marker;
    };

    const createClusterMarker = (cluster: {
      count: number;
      position: MapPoint;
      zIndex: number;
    }) => {
      const marker = new googleObj.maps.Marker({
        position: cluster.position,
        icon: this.buildClusterIcon(googleObj, cluster.count, CLUSTER_COLOR),
        label: {
          text: String(cluster.count),
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: '700'
        },
        map,
        zIndex: cluster.zIndex
      });

      marker.addListener('click', () => {
        const position = marker.getPosition();
        if (position) {
          map.panTo(position);
        }
        map.setZoom(Math.min((map.getZoom() ?? 16) + 1, 20));
      });

      return marker;
    };

    const syncVisibleMarkers = () => {
      const bounds = map.getBounds();
      if (!bounds) {
        return;
      }

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const north = ne.lat();
      const south = sw.lat();
      const east = ne.lng();
      const west = sw.lng();

      const visible = this.data.stores.filter((s) =>
        s.latitude <= north &&
        s.latitude >= south &&
        s.longitude <= east &&
        s.longitude >= west
          );

      const visibleStoreMap = new Map(
        visible.map((store, index) => [this.getStoreKey(store), { store, index }] as const)
      );
      const useCluster = visible.length > EXPAND_THRESHOLD;
      const desiredStoreKeys = new Set<string>();
      const desiredClusters = useCluster
        ? this.buildVisibleClusters(googleObj, map, visible, storeOrderMap, CLUSTER_GRID_SIZE)
        : new Map<string, {
          count: number;
          position: MapPoint;
          signature: string;
          zIndex: number;
        }>();

      if (useCluster) {
        for (const cluster of desiredClusters.values()) {
          if (cluster.count === 1) {
            desiredStoreKeys.add(cluster.signature);
          }
        }
      } else {
        for (const key of visibleStoreMap.keys()) {
          desiredStoreKeys.add(key);
        }
      }

      for (const [key, marker] of Array.from(this.currentMarkers.entries())) {
        if (desiredStoreKeys.has(key)) {
          continue;
        }

        this.releaseMarker(marker);
        this.currentMarkers.delete(key);
      }

      for (const key of desiredStoreKeys) {
        if (this.currentMarkers.has(key)) {
          continue;
        }

        const visibleStore = visibleStoreMap.get(key);
        if (!visibleStore) {
          continue;
        }

        const marker = createStoreMarker(
          visibleStore.store,
          storeOrderMap.get(key) ?? visibleStore.index
        );
        this.currentMarkers.set(key, marker);
      }

      for (const [key, clusterMarker] of Array.from(this.currentClusterMarkers.entries())) {
        const desiredCluster = desiredClusters.get(key);
        if (desiredCluster && desiredCluster.count > 1) {
          continue;
        }

        this.releaseMarker(clusterMarker.marker);
        this.currentClusterMarkers.delete(key);
      }

      for (const [key, cluster] of desiredClusters.entries()) {
        if (cluster.count === 1) {
          continue;
        }

        const currentCluster = this.currentClusterMarkers.get(key);
        if (!currentCluster) {
          this.currentClusterMarkers.set(key, {
            marker: createClusterMarker(cluster),
            signature: cluster.signature
          });
          continue;
        }

        if (currentCluster.signature === cluster.signature) {
          continue;
        }

        currentCluster.marker.setPosition(cluster.position);
        currentCluster.marker.setIcon(this.buildClusterIcon(googleObj, cluster.count, CLUSTER_COLOR));
        currentCluster.marker.setLabel({
          text: String(cluster.count),
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: '700'
        });
        currentCluster.marker.setZIndex(cluster.zIndex);
        currentCluster.signature = cluster.signature;
      }
    };

    this.idleListener = map.addListener('idle', () => {
      if (this.pendingFrame != null) {
        cancelAnimationFrame(this.pendingFrame);
      }
      this.pendingFrame = requestAnimationFrame(() => {
        this.pendingFrame = null;
        syncVisibleMarkers();
      });
    });

    map.addListener('click', () => {
      if (this.infoWindow) {
        this.infoWindow.close();
      }
    });

    this.initializeCurrentLocation();
  }

  moveToCurrentLocation(): void {
    this.centerOnLastKnownLocation();
    this.requestCurrentLocation(
      (position) => this.centerOnCurrentLocation(position),
      () => this.centerOnFallbackLocation()
    );
  }

  private initializeCurrentLocation(): void {
    if (this.isValidMapPoint(this.data.initialCenter)) {
      this.centerOnCurrentLocation(this.data.initialCenter);
      return;
    }

    this.requestCurrentLocation(
      (position) => this.centerOnCurrentLocation(position),
      () => this.centerOnFallbackLocation()
    );
  }

  private requestCurrentLocation(onSuccess: (position: MapPoint) => void, onError: () => void): void {
    if (!navigator.geolocation) {
      onError();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onSuccess({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => onError(),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  }

  private centerOnCurrentLocation(position: MapPoint): void {
    if (!this.map || !this.googleObj) {
      return;
    }

    this.lastCurrentLocation = position;
    this.map.panTo(position);
    this.setCurrentLocationMarker(position);
  }

  private centerOnLastKnownLocation(): void {
    if (!this.map) {
      return;
    }

    if (this.isValidMapPoint(this.lastCurrentLocation)) {
      this.map.panTo(this.lastCurrentLocation);
      return;
    }

    if (this.isValidMapPoint(this.data.initialCenter)) {
      this.map.panTo(this.data.initialCenter);
      return;
    }

    if (this.isValidMapPoint(this.data.fallbackCenter)) {
      this.map.panTo(this.data.fallbackCenter);
    }
  }

  private centerOnFallbackLocation(): void {
    if (!this.map || !this.isValidMapPoint(this.data.fallbackCenter)) {
      return;
    }

    this.map.panTo(this.data.fallbackCenter);
  }

  private setCurrentLocationMarker(position: MapPoint): void {
    if (!this.map || !this.googleObj || !this.currentLocationOverlayClass) {
      return;
    }

    if (!this.currentLocationMarker) {
      this.currentLocationMarker = new this.currentLocationOverlayClass(position, this.map);
      return;
    }

    this.currentLocationMarker.setPosition(position);
  }

  private createCurrentLocationOverlayClass(googleObj: any): any {
    return class CurrentLocationOverlay extends googleObj.maps.OverlayView {
      private positionLatLng: any;
      private element: HTMLDivElement | null = null;

      constructor(position: MapPoint, map: any) {
        super();
        this.positionLatLng = new googleObj.maps.LatLng(position.lat, position.lng);
        (this as any).setMap(map);
      }

      onAdd(): void {
        const element = document.createElement('div');
        element.style.position = 'absolute';
        element.style.width = '16px';
        element.style.height = '16px';
        element.style.borderRadius = '50%';
        element.style.background = '#1a73e8';
        element.style.border = '3px solid #ffffff';
        element.style.boxSizing = 'content-box';
        element.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.35)';
        element.style.pointerEvents = 'none';
        element.style.willChange = 'transform';
        this.element = element;
        (this as any).getPanes()?.floatPane.appendChild(element);
      }

      draw(): void {
        if (!this.element) {
          return;
        }
        const projection = (this as any).getProjection();
        const point = projection?.fromLatLngToDivPixel(this.positionLatLng);
        if (!point) {
          return;
        }
        this.element.style.transform = `translate(${point.x - 11}px, ${point.y - 11}px)`;
      }

      onRemove(): void {
        if (!this.element) {
          return;
        }
        this.element.remove();
        this.element = null;
      }

      setPosition(position: MapPoint): void {
        this.positionLatLng = new googleObj.maps.LatLng(position.lat, position.lng);
        this.draw();
      }
    };
  }

  private buildVisibleClusters(
    googleObj: any,
    map: any,
    stores: SearchHistoryItem[],
    storeOrderMap: Map<string, number>,
    gridSize: number
  ): Map<string, { count: number; position: MapPoint; signature: string; zIndex: number }> {
    const projection = map.getProjection();
    const zoom = map.getZoom() ?? 16;
    const scale = Math.pow(2, zoom);
    const groups = new Map<string, {
      keys: string[];
      latTotal: number;
      lngTotal: number;
      minOrder: number;
    }>();

    for (const store of stores) {
      const storeKey = this.getStoreKey(store);
      let clusterKey = `single:${storeKey}`;

      if (projection) {
        const point = projection.fromLatLngToPoint(
          new googleObj.maps.LatLng(store.latitude, store.longitude)
        );
        if (point) {
          const gridX = Math.floor((point.x * scale) / gridSize);
          const gridY = Math.floor((point.y * scale) / gridSize);
          clusterKey = `${zoom}:${gridX}:${gridY}`;
        }
      }

      let group = groups.get(clusterKey);
      if (!group) {
        group = {
          keys: [],
          latTotal: 0,
          lngTotal: 0,
          minOrder: Number.MAX_SAFE_INTEGER
        };
        groups.set(clusterKey, group);
      }

      group.keys.push(storeKey);
      group.latTotal += store.latitude;
      group.lngTotal += store.longitude;
      group.minOrder = Math.min(group.minOrder, storeOrderMap.get(storeKey) ?? group.minOrder);
    }

    const clusters = new Map<string, {
      count: number;
      position: MapPoint;
      signature: string;
      zIndex: number;
    }>();

    for (const [clusterKey, group] of groups.entries()) {
      const count = group.keys.length;
      const signature = count === 1 ? group.keys[0] : [...group.keys].sort().join('~');
      clusters.set(clusterKey, {
        count,
        position: {
          lat: group.latTotal / count,
          lng: group.lngTotal / count
        },
        signature,
        zIndex: 50000000 + count + group.minOrder
      });
    }

    return clusters;
  }

  private getStoreMarkerZIndex(store: SearchHistoryItem, index: number): number {
    return this.getStoreStackZIndex(store, index);
  }

  private getStoreStackZIndex(store: SearchHistoryItem, index: number): number {
    return 1000000 + (Math.round((90 - store.latitude) * 1000) * 2 + index) * 2;
  }

  private getStoreKey(store: SearchHistoryItem): string {
    return [
      store.label,
      store.name,
      store.addr,
      Number(store.latitude).toFixed(6),
      Number(store.longitude).toFixed(6)
    ].join('|');
  }

  private createStoreOverlayMarkerClass(googleObj: any): any {
    const width = 32;
    const height = 48;
    const radius = 7;
    const anchorX = width / 2;
    const anchorY = 32;

    return class StoreOverlayMarker extends googleObj.maps.OverlayView {
      private positionLatLng: any;
      private element: HTMLDivElement | null = null;
      private readonly titleText: string;
      private readonly iconUrl: string;
      private readonly labelText: string;
      private readonly labelColor: string;
      private zIndexValue: number;
      private readonly clickHandler: () => void;

      constructor(options: {
        position: MapPoint;
        title: string;
        iconUrl: string;
        labelText: string;
        labelColor: string;
        zIndex: number;
        onClick: () => void;
        map?: any;
      }) {
        super();
        this.positionLatLng = new googleObj.maps.LatLng(options.position.lat, options.position.lng);
        this.titleText = options.title;
        this.iconUrl = options.iconUrl;
        this.labelText = options.labelText;
        this.labelColor = options.labelColor;
        this.zIndexValue = options.zIndex;
        this.clickHandler = options.onClick;

        if (options.map) {
          (this as any).setMap(options.map);
        }
      }

      onAdd(): void {
        const element = document.createElement('div');
        element.title = this.titleText;
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.style.position = 'absolute';
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.boxSizing = 'border-box';
        element.style.display = 'flex';
        element.style.flexDirection = 'column';
        element.style.alignItems = 'center';
        element.style.background = 'rgba(255, 255, 255, 0.82)';
        element.style.border = '1px solid rgba(31, 41, 55, 0.18)';
        element.style.borderRadius = `${radius}px`;
        element.style.overflow = 'hidden';
        element.style.cursor = 'pointer';
        element.style.userSelect = 'none';
        element.style.willChange = 'transform';
        element.style.zIndex = String(this.zIndexValue);

        const label = document.createElement('div');
        label.textContent = this.labelText;
        label.style.width = '100%';
        label.style.height = '18px';
        label.style.lineHeight = '18px';
        label.style.textAlign = 'center';
        label.style.color = this.labelColor;
        label.style.fontSize = '12px';
        label.style.fontWeight = '700';
        label.style.whiteSpace = 'nowrap';
        label.style.overflow = 'hidden';

        const icon = document.createElement('img');
        icon.src = this.iconUrl;
        icon.alt = '';
        icon.draggable = false;
        icon.style.width = '24px';
        icon.style.height = '24px';
        icon.style.objectFit = 'contain';
        icon.style.marginTop = '1px';

        element.append(label, icon);
        element.addEventListener('click', this.handleClick);
        element.addEventListener('keydown', this.handleKeyDown);
        this.element = element;
        (this as any).getPanes()?.overlayMouseTarget.appendChild(element);
      }

      draw(): void {
        if (!this.element) {
          return;
        }

        const projection = (this as any).getProjection();
        const point = projection?.fromLatLngToDivPixel(this.positionLatLng);
        if (!point) {
          return;
        }

        this.element.style.transform =
          `translate(${point.x}px, ${point.y}px) translate(${-anchorX}px, ${-anchorY}px)`;
        this.element.style.zIndex = String(this.zIndexValue);
      }

      onRemove(): void {
        if (!this.element) {
          return;
        }

        this.element.removeEventListener('click', this.handleClick);
        this.element.removeEventListener('keydown', this.handleKeyDown);
        this.element.remove();
        this.element = null;
      }

      getPosition(): any {
        return this.positionLatLng;
      }

      getVisible(): boolean {
        return true;
      }

      setPosition(position: MapPoint): void {
        this.positionLatLng = new googleObj.maps.LatLng(position.lat, position.lng);
        this.draw();
      }

      setZIndex(zIndex: number): void {
        this.zIndexValue = zIndex;
        if (this.element) {
          this.element.style.zIndex = String(zIndex);
        }
      }

      private handleClick = (event: MouseEvent) => {
        event.stopPropagation();
        this.clickHandler();
      };

      private handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        event.preventDefault();
        this.clickHandler();
      };
    };
  }

  private buildClusterIcon(googleObj: any, count: number, clusterColor: string): any {
    const size = count >= 100 ? 48 : count >= 10 ? 42 : 36;
    const radius = size / 2;
    const innerRadius = radius - 7;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${radius}" cy="${radius}" r="${radius - 2}" fill="#ffffff" fill-opacity="0.42"/>
        <circle cx="${radius}" cy="${radius}" r="${innerRadius}" fill="${clusterColor}" fill-opacity="0.72"/>
        <circle cx="${radius}" cy="${radius}" r="${innerRadius}" fill="none" stroke="#ffffff" stroke-opacity="0.82" stroke-width="2"/>
      </svg>
    `;

    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new googleObj.maps.Size(size, size),
      anchor: new googleObj.maps.Point(radius, radius)
    };
  }

  private getStoreShortName(store: SearchHistoryItem): string {
    if (store.label === '全家') {
      const chars = Array.from((store.name ?? '').trim());
      const shortName = chars.slice(4, 6).join('');
      if (shortName) {
        return shortName;
      }
    }
    const normalizedName = this.normalizeStoreName(store.name);
    const sourceName = normalizedName || store.name.trim() || store.label;
    return Array.from(sourceName).slice(0, 2).join('');
  }

  private normalizeStoreName(name: string): string {
    if (!name) {
      return '';
    }

    return name
      .trim()
      .replace(/^(7\s*[-－]?\s*11|7\s*[-－]?\s*ELEVEN|統一超商)\s*/i, '')
      .replace(/^(全家便利商店|全家|FamilyMart)\s*/i, '')
      .replace(/門市$/, '')
      .trim();
  }

  private computeInitialCenter(): { lat: number; lng: number } {
    if (this.isValidMapPoint(this.data.initialCenter)) {
      return this.data.initialCenter;
    }
    if (this.isValidMapPoint(this.data.fallbackCenter)) {
      return this.data.fallbackCenter;
    }

    const stores = this.data.stores;
    if (!stores?.length) {
      return { lat: 23.6978, lng: 120.9605 };
    }
    const first = stores[0];
    return { lat: first.latitude, lng: first.longitude };
  }

  private isValidMapPoint(point?: MapPoint | null): point is MapPoint {
    return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
  }
}
