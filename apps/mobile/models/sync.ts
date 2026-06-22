export type ConnectionQuality = 'online' | 'degraded' | 'offline';

export type SyncPhase = 'idle' | 'registering' | 'previewing' | 'ready' | 'offline' | 'error';

export type EmergencyChannel = {
  id: string;
  label: string;
  detail: string;
  availableOffline: boolean;
};

export type RegisteredDevice = {
  id: string;
  name: string;
  platform: string;
  registeredAt: string;
  connectionQuality: ConnectionQuality;
  syncCursor?: string;
};

export type SyncPreview = {
  generatedAt: string;
  profileCount: number;
  openSessionCount: number;
  pendingChangeCount: number;
  syncCursor?: string;
  cursor: {
    workspace: string;
    branch: string;
    lastCommand: string;
  };
  devices: RegisteredDevice[];
  emergencyChannels: EmergencyChannel[];
};

export type SyncConflict = {
  entity_type: string;
  entity_id: string;
  reason: 'changed_after_base_cursor';
};

export type SyncErrorCode = 'offline' | 'unauthorized' | 'timeout' | 'unknown';

export type SyncError = {
  code: SyncErrorCode;
  title: string;
  message: string;
  recoverable: boolean;
};

export type SyncDashboardState = {
  phase: SyncPhase;
  device?: RegisteredDevice;
  preview?: SyncPreview;
  error?: SyncError;
};
