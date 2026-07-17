type OriginItem = {
  prefixList: string[];
  originConfig: Record<string, string>;
};

/** Structural prefix→origin map (shape matters, not the symbol name). */
export const GATEWAY_MAP: OriginItem[] = [
  {
    prefixList: ['/permission'],
    originConfig: {
      development: 'https://gateway-dev.example.com/enterprise-platform',
      online: 'https://kong.example.com/enterprise-platform',
    },
  },
  {
    prefixList: ['/external'],
    originConfig: {
      development: 'https://api-dev.example.com/eva-schedule',
      online: 'https://api.example.com/eva-schedule',
    },
  },
  {
    prefixList: ['/'],
    originConfig: {
      development: 'https://api-dev.example.com',
      online: 'https://api.example.com',
    },
  },
];
