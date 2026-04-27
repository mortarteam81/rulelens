const SUNGSHIN_RULES_ORIGIN = 'https://rule.sungshin.ac.kr';

export function isSungshinLawChangeListUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === SUNGSHIN_RULES_ORIGIN &&
      url.pathname === '/service/law/lawChangeList.do' &&
      Boolean(url.searchParams.get('seq')) &&
      Boolean(url.searchParams.get('historySeq'))
    );
  } catch {
    return false;
  }
}

export async function fetchSungshinLawChangeListHtml(rawUrl: string): Promise<string> {
  if (!isSungshinLawChangeListUrl(rawUrl)) {
    throw new Error('성신 규정관리시스템 lawChangeList 공개 URL만 지원합니다.');
  }

  const response = await fetch(rawUrl, {
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
