import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class GoogleMapsLoaderService {
  private loadingPromise?: Promise<any>;

  load(apiKey: string): Promise<any> {
    const win = window as any;
    if (win.google?.maps) {
      return Promise.resolve(win.google);
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = new Promise((resolve, reject) => {
      const scriptId = 'google-maps-js-sdk';
      const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(win.google));
        existingScript.addEventListener('error', () => reject(new Error('Google Maps 載入失敗')));
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(win.google);
      script.onerror = () => reject(new Error('Google Maps 載入失敗'));
      document.head.appendChild(script);
    });

    return this.loadingPromise;
  }
}
