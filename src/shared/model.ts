export const TOOL_NAMES = [
  'now-time-info',
  'query-my-coupons',
  'query-my-account',
  'campaign-calendar',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type Mode = 'demo' | 'live';
export type Category = 'coupon' | 'points' | 'campaign';
export type ItemDate =
  | { precision: 'day'; value: string }
  | { precision: 'instant'; value: string };

export interface RadarItem {
  id: string;
  category: Category;
  title: string;
  date: ItemDate | null;
  amount?: number;
  note: string;
  source: ToolName;
}

export type SourceState = 'ok' | 'empty' | 'partial' | 'unsupported' | 'error';

export interface SourceReport {
  tool: ToolName;
  state: SourceState;
  message: string;
  code?: string;
}

export interface Snapshot {
  id: string;
  mode: Mode;
  fetchedAt: string;
  now: string;
  clock: 'official' | 'local';
  items: RadarItem[];
  sources: SourceReport[];
}

export interface AppConfig {
  liveAvailable: boolean;
  endpoint: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  coupon: '优惠券',
  points: '积分风险',
  campaign: '活动日历',
};
