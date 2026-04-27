import type { ParsedComparisonRow } from '@/lib/parsers/types';

export type SourceInput =
  | { kind: 'sungshin-url'; url: string }
  | { kind: 'upload'; fileName: string; mimeType: string; bytes: ArrayBuffer }
  | { kind: 'manual'; regulationName: string; rows: ParsedComparisonRow[] };
