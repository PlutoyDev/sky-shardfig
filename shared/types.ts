export const memories = [
  'Jellyfish',
  'Crab',
  'Manta',
  'Krill',
  'Whale',
  'Elder',
] as const;

export interface DailyShardConfig {
  memory?: (typeof memories)[number];
  variation?: string;
  isBugged?: boolean;
  bugType?: 'noShard' | 'noMemory';
  isDisabled?: boolean;
  disabledReason?: string;
  credits?: string[];
  lastModified?: string;
  lastModifiedBy?: string;
}

export interface GlobalShardConfig {
  dailyMap: Record<string, DailyShardConfig>; //key = yyyy-mm-dd
  isBugged?: boolean;
  bugType?: 'inaccurate' | 'tgc :/';
  lastModified?: string;
  lastModifiedBy?: string;
}
