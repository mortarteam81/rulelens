import { parseSourceInput } from '@/lib/parsers';
import type { ParsedComparisonTable } from '@/lib/parsers/types';
import type { SourceInput } from '@/lib/sources/types';

export async function parseComparisonSource(input: SourceInput): Promise<ParsedComparisonTable> {
  return parseSourceInput(input);
}
