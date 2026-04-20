import { AfterViewInit, Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SearchHistoryItem } from '../models/search-history-item.model';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';

export interface StoreMapDialogData {
  stores: SearchHistoryItem[];
  apiKey: string;
}

@Component({
  selector: 'app-store-map-dialog',
  templateUrl: './store-map-dialog.component.html',
  styleUrls: ['./store-map-dialog.component.scss']
})
export class StoreMapDialogComponent implements AfterViewInit {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  isLoading = true;
  errorMessage = '';

  constructor(
    private readonly dialogRef: MatDialogRef<StoreMapDialogComponent, SearchHistoryItem | null>,
    private readonly googleMapsLoader: GoogleMapsLoaderService,
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

  private initMap(googleObj: any): void {
    const map = new googleObj.maps.Map(this.mapContainer.nativeElement, {
      center: { lat: 23.6978, lng: 120.9605 },
      zoom: 7,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });

    const geoJson = {
      type: 'FeatureCollection',
      features: this.data.stores.map((store) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [store.longitude, store.latitude]
        },
        properties: {
          name: store.name,
          label: store.label,
          addr: store.addr,
          latitude: store.latitude,
          longitude: store.longitude
        }
      }))
    };

    map.data.addGeoJson(geoJson);
    map.data.setStyle((feature: any) => {
      const label = String(feature.getProperty('label') ?? '');
      const isSeven = label === '7-11';
      return {
        icon: {
          path: googleObj.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: isSeven ? '#D62828' : '#2E7D32',
          fillOpacity: 0.9,
          strokeColor: '#FFFFFF',
          strokeWeight: 1
        }
      };
    });

    map.data.addListener('click', (event: any) => {
      const selectedStore: SearchHistoryItem = {
        name: String(event.feature.getProperty('name') ?? ''),
        label: String(event.feature.getProperty('label') ?? ''),
        addr: String(event.feature.getProperty('addr') ?? ''),
        latitude: Number(event.feature.getProperty('latitude')),
        longitude: Number(event.feature.getProperty('longitude'))
      };
      this.dialogRef.close(selectedStore);
    });
  }
}
