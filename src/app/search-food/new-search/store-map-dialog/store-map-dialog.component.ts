import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { SearchHistoryItem } from '../models/search-history-item.model';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';
import { GeolocationService } from '../../../services/geolocation.service';
import { environment } from '../../../../environments/environment';

export interface MapPoint {
  lat: number;
  lng: number;
}

@Component({
  selector: 'app-store-map-dialog',
  templateUrl: './store-map-dialog.component.html',
  styleUrls: ['./store-map-dialog.component.scss']
})
export class StoreMapDialogComponent implements OnChanges, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  @Input() visible = false;
  @Input() stores: SearchHistoryItem[] = [];
  @Input() apiKey = '';
  @Input() initialCenter: MapPoint | null = null;
  @Input() fallbackCenter: MapPoint | null = null;

  @Output() closed = new EventEmitter<SearchHistoryItem | null>();

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
  private storeOrderMap = new Map<string, number>();
  private syncVisibleMarkersFn: (() => void) | null = null;
  private initialized = false;
  private initializing = false;

  constructor(
    private readonly googleMapsLoader: GoogleMapsLoaderService,
    private readonly geolocationService: GeolocationService,
    private readonly zone: NgZone
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      const becameVisible = changes['visible'].currentValue && !changes['visible'].previousValue;
      if (becameVisible) {
        this.handleOpen();
      }
      return;
    }

    if (this.initialized && changes['stores'] && !changes['stores'].firstChange) {
      this.refreshStoreOrderMap();
      if (this.syncVisibleMarkersFn) {
        this.syncVisibleMarkersFn();
      }
    }
  }

  private handleOpen(): void {
    if (this.initialized) {
      this.recenterOnReopen();
      return;
    }

    if (this.initializing) {
      return;
    }

    this.errorMessage = '';

    if (!this.apiKey) {
      this.isLoading = false;
      this.errorMessage = '尚未設定 Google Maps API Key';
      return;
    }

    if (!this.stores?.length) {
      this.isLoading = false;
      this.errorMessage = '目前沒有可顯示的門市資料';
      return;
    }

    this.initializing = true;
    this.isLoading = true;

    setTimeout(async () => {
      try {
        const googleObj = await this.googleMapsLoader.load(this.apiKey);
        this.initMap(googleObj);
        this.initialized = true;
        this.isLoading = false;
      } catch (error) {
        console.error('Google Maps 初始化失敗:', error);
        this.isLoading = false;
        this.errorMessage = '地圖初始化失敗，請稍後再試';
      } finally {
        this.initializing = false;
      }
    });
  }

  private recenterOnReopen(): void {
    if (!this.map) {
      return;
    }

    if (this.infoWindow) {
      this.infoWindow.close();
    }

    setTimeout(() => {
      if (this.map && this.googleObj) {
        this.googleObj.maps.event.trigger(this.map, 'resize');
      }
    });
  }

  close(): void {
    if (this.infoWindow) {
      this.infoWindow.close();
    }
    this.closed.emit(null);
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
      const displayName = this.getDisplayName(store);

      const headerContent = document.createElement('div');
      headerContent.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:16px 0 16px 14px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "min-width:0;flex:1;";
      headerContent.innerHTML = `
        <span style="display:inline-block;font-size:11px;font-weight:700;color:${labelColor};background:${labelBg};padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0;">${store.label}</span>
        <span style="font-size:14px;font-weight:700;color:#2f2f2f;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${displayName}</span>
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
      if (this.infoWindow) {
        this.infoWindow.close();
      }
      this.closed.emit({
        name: this.selectedStore.name,
        label: this.selectedStore.label,
        addr: this.selectedStore.addr,
        latitude: this.selectedStore.latitude,
        longitude: this.selectedStore.longitude
      });
    }
  }

  private refreshStoreOrderMap(): void {
    this.storeOrderMap = new Map<string, number>(
      (this.stores ?? []).map((store, index) => [this.getStoreKey(store), index] as const)
    );
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
    this.refreshStoreOrderMap();

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
        labelText: this.getDisplayName(store),
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

      const visible = (this.stores ?? []).filter((s) =>
        s.latitude <= north &&
        s.latitude >= south &&
        s.longitude <= east &&
        s.longitude >= west
          );

      const visibleStoreMap = new Map<string, { store: SearchHistoryItem; index: number }>(
        visible.map((store, index) => [this.getStoreKey(store), { store, index }] as const)
      );
      const useCluster = visible.length > EXPAND_THRESHOLD;
      const desiredStoreKeys = new Set<string>();
      const desiredClusters = useCluster
        ? this.buildVisibleClusters(googleObj, map, visible, this.storeOrderMap, CLUSTER_GRID_SIZE)
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
          this.storeOrderMap.get(key) ?? visibleStore.index
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

    this.syncVisibleMarkersFn = syncVisibleMarkers;
    this.initializeCurrentLocation();
  }

  moveToCurrentLocation(): void {
    this.centerOnLastKnownLocation();
    this.requestCurrentLocation(
      (position) => this.centerOnCurrentLocation(position),
      () => this.centerOnFallbackLocation()
    );
  }

  private async initializeCurrentLocation(): Promise<void> {
    let permission: PermissionState = 'prompt';
    try {
      permission = await this.geolocationService.checkPermission();
    } catch {
      permission = 'prompt';
    }

    if (permission === 'granted') {
      this.requestCurrentLocation(
        (position) => this.centerOnCurrentLocation(position),
        () => this.centerOnFallbackLocation()
      );
      return;
    }

    // 沒有 GPS 權限時，直接使用歷史地點（不主動要求權限）
    this.centerOnFallbackLocation();
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

    if (this.isValidMapPoint(this.initialCenter)) {
      this.map.panTo(this.initialCenter);
      return;
    }

    if (this.isValidMapPoint(this.fallbackCenter)) {
      this.map.panTo(this.fallbackCenter);
    }
  }

  private centerOnFallbackLocation(): void {
    if (!this.map || !this.isValidMapPoint(this.fallbackCenter)) {
      return;
    }

    this.map.panTo(this.fallbackCenter);
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
    const radius = 7;
    const ICON_SIZE = 24;
    const ICON_MARGIN = 1;
    const ANCHOR_OFFSET_FROM_BOTTOM = 16;

    return class StoreOverlayMarker extends googleObj.maps.OverlayView {
      private positionLatLng: any;
      private element: HTMLDivElement | null = null;
      private readonly titleText: string;
      private readonly iconUrl: string;
      private readonly labelText: string;
      private readonly labelColor: string;
      private zIndexValue: number;
      private readonly clickHandler: () => void;
      private anchorX = width / 2;
      private anchorY = 32;

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
        const chars = Array.from(this.labelText || '');
        const labelLength = chars.length;
        const isTwoLine = labelLength >= 4;

        let firstLine = this.labelText || '';
        let secondLine = '';
        if (isTwoLine) {
          firstLine = chars.slice(0, 2).join('');
          secondLine = chars.slice(2).join('');
        }

        let fontSize: number;
        if (labelLength <= 2) {
          fontSize = 12;
        } else if (labelLength === 3) {
          fontSize = 10;
        } else if (labelLength === 4) {
          fontSize = 9;
        } else if (labelLength === 5) {
          fontSize = 8;
        } else {
          fontSize = 7;
        }

        const lineHeight = fontSize;
        const labelHeight = isTwoLine ? lineHeight * 2 : 18;
        const totalHeight = labelHeight + ICON_MARGIN + ICON_SIZE;
        this.anchorX = width / 2;
        this.anchorY = totalHeight - ANCHOR_OFFSET_FROM_BOTTOM;

        const element = document.createElement('div');
        element.title = this.titleText;
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.style.position = 'absolute';
        element.style.width = `${width}px`;
        element.style.height = `${totalHeight}px`;
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
        label.style.width = '100%';
        label.style.height = `${labelHeight}px`;
        label.style.display = 'flex';
        label.style.flexDirection = 'column';
        label.style.alignItems = 'center';
        label.style.justifyContent = 'center';
        label.style.color = this.labelColor;
        label.style.fontSize = `${fontSize}px`;
        label.style.fontWeight = '700';
        label.style.lineHeight = `${lineHeight}px`;
        label.style.padding = '0 1px';
        label.style.boxSizing = 'border-box';

        const line1 = document.createElement('div');
        line1.textContent = firstLine;
        line1.style.whiteSpace = 'nowrap';
        line1.style.overflow = 'hidden';
        label.appendChild(line1);

        if (isTwoLine) {
          const line2 = document.createElement('div');
          line2.textContent = secondLine;
          line2.style.whiteSpace = 'nowrap';
          line2.style.overflow = 'hidden';
          label.appendChild(line2);
        }

        const icon = document.createElement('img');
        icon.src = this.iconUrl;
        icon.alt = '';
        icon.draggable = false;
        icon.style.width = `${ICON_SIZE}px`;
        icon.style.height = `${ICON_SIZE}px`;
        icon.style.objectFit = 'contain';
        icon.style.marginTop = `${ICON_MARGIN}px`;

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
          `translate(${point.x}px, ${point.y}px) translate(${-this.anchorX}px, ${-this.anchorY}px)`;
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

  private getDisplayName(store: SearchHistoryItem): string {
    const name = (store.name ?? '').trim();
    if (store.label === '全家') {
      return name.replace(/^全家/, '').replace(/店$/, '');
    }
    return name;
  }

  private computeInitialCenter(): { lat: number; lng: number } {
    if (this.isValidMapPoint(this.initialCenter)) {
      return this.initialCenter;
    }
    if (this.isValidMapPoint(this.fallbackCenter)) {
      return this.fallbackCenter;
    }

    const stores = this.stores;
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
