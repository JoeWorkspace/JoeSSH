import React from 'react';

type IconProps = {
  color?: string;
  size?: number;
  strokeWidth?: number;
};

function createIcon(name: string) {
  const Icon = (props: IconProps) => React.createElement('LucideIcon', { ...props, name });
  Icon.displayName = name;
  return Icon;
}

export const Check = createIcon('Check');
export const CloudDownload = createIcon('CloudDownload');
export const RefreshCw = createIcon('RefreshCw');
export const Smartphone = createIcon('Smartphone');
export const WifiOff = createIcon('WifiOff');
