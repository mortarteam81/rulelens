export type SourceKind = 'sungshin' | 'upload' | 'manual' | 'hybrid';
export type SourceFormat = 'html' | 'hwp' | 'hwpx' | 'pdf' | 'text' | 'unknown';

export type ParsedComparisonRow = {
  id: string;
  article?: string;
  oldText: string;
  newText: string;
  reason?: string;
  page?: number;
  confidence: number;
  warnings: string[];
};

export type ParsedComparisonTable = {
  regulationName?: string;
  sourceKind: SourceKind;
  sourceFormat: SourceFormat;
  currentHistory?: string;
  previousHistory?: string;
  rows: ParsedComparisonRow[];
  warnings: string[];
};
