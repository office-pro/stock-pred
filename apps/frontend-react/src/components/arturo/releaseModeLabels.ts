import { ArturoReleaseMode } from '@stockpred/shared-types';

export const RELEASE_MODE_OPTIONS: {
  mode: ArturoReleaseMode;
  title: string;
  description: string;
}[] = [
  {
    mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
    title: 'General Availability',
    description: 'Enable for all accounts (excluding those with -)',
  },
  {
    mode: ArturoReleaseMode.CODE_BETA,
    title: 'Code Beta',
    description: 'Enable for specific accounts only',
  },
  {
    mode: ArturoReleaseMode.OFF,
    title: 'Off',
    description: 'Disable for all accounts',
  },
];

export function releaseModeLabel(mode: ArturoReleaseMode): string {
  switch (mode) {
    case ArturoReleaseMode.GENERAL_AVAILABILITY:
      return 'General Availability';
    case ArturoReleaseMode.CODE_BETA:
      return 'Code Beta';
    case ArturoReleaseMode.OFF:
      return 'Off';
    default:
      return mode;
  }
}

export function releaseModeChipColor(mode: ArturoReleaseMode): 'primary' | 'info' | 'default' {
  switch (mode) {
    case ArturoReleaseMode.GENERAL_AVAILABILITY:
      return 'primary';
    case ArturoReleaseMode.CODE_BETA:
      return 'info';
    default:
      return 'default';
  }
}
