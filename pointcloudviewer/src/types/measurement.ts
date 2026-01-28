export type MeasurementKind = 'distance' | 'area';

export interface Measurement {
  id: string;
  name: string;
  value: number;
  unit: string;
  kind: MeasurementKind;
  createdAt: string;
  imagePath?: string;
  snapshotPath?: string;
  points?: Array<{ x: number; y: number; z: number }>;
}

export interface CurrentMeasurement {
  value: number;
  unit: string;
  kind: MeasurementKind;
}
