export type Platform = 'ios' | 'android' | 'web'
export type Channel = 'production' | 'beta' | 'internal'

export interface Client {
  platform: Platform
  /** 앱 버전. 'major.minor.patch' */
  appVersion: string
  channel: Channel
}

export type Feature =
  | 'biometricLogin'
  | 'inAppPurchase'
  | 'pushRichMedia'
  | 'darkMode'
  | 'offlineCart'

export interface Sdk {
  supports(client: Client, feature: Feature): boolean
}
