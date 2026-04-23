import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class GeolocationService {
  constructor() {}

  /** 檢查目前 GPS 權限狀態：'granted' | 'denied' | 'prompt' */
  async checkPermission(): Promise<PermissionState> {
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    }
    // 不支援 Permissions API 時回傳 'prompt'，交由使用者操作決定
    return 'prompt';
  }

  getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position),
          (error) => reject(error)
        );
      } else {
        reject(new Error('瀏覽器不支援地理位置功能'));
      }
    });
  }
}
