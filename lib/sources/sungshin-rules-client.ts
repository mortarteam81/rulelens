const SUNGSHIN_RULES_ORIGIN = 'https://rule.sungshin.ac.kr';

export function isSungshinRulesUrl(rawUrl: string): boolean {
  try {
    return normalizeSungshinLawChangeListUrl(rawUrl) !== undefined;
  } catch {
    return false;
  }
}

export function normalizeSungshinLawChangeListUrl(rawUrl: string): string | undefined {
  const url = new URL(rawUrl);
  if (url.origin !== SUNGSHIN_RULES_ORIGIN) return undefined;

  const supportedPaths = new Set([
    '/service/law/lawChangeList.do',
    '/service/law/lawFullScreen.do',
    '/service/law/lawView.do',
    '/service/law/lawTwoView.do',
    '/service/law/lawFullScreenContent.do',
  ]);
  if (!supportedPaths.has(url.pathname)) return undefined;

  const seq = url.searchParams.get('seq');
  const historySeq = url.searchParams.get('historySeq');
  if (!seq || !historySeq) return undefined;

  return `${SUNGSHIN_RULES_ORIGIN}/service/law/lawChangeList.do?seq=${encodeURIComponent(seq)}&historySeq=${encodeURIComponent(historySeq)}`;
}

export async function fetchSungshinLawChangeListHtml(rawUrl: string): Promise<string> {
  const normalizedUrl = normalizeSungshinLawChangeListUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error('성신 규정관리시스템 공개 규정 URL만 지원합니다. seq와 historySeq가 포함된 URL이 필요합니다.');
  }

  const response = await fetch(normalizedUrl, {
    headers: {
      'user-agent': 'regdiff-dashboard/0.1 (+https://rule.sungshin.ac.kr public law parser)',
      accept: 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`성신 규정 페이지를 가져오지 못했습니다. HTTP ${response.status}`);
  }

  return response.text();
}
