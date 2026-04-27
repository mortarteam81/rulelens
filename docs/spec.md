# 규정 신구조문 대비표 분석 대시보드 MVP 명세

## 목적
HWP/PDF 규정 신구조문 대비표를 업로드하여 조문별 변경사항, 위험도, 실무 영향, 검토의견 초안을 생성하는 외부 접속 웹앱.

## 1차 범위
- HWP/PDF 업로드 UI
- 조문별 비교 대시보드
- 변경 유형/위험도/확인 질문/검토의견 생성
- Korean Law MCP, kordoc MCP 연동 지점 설계

## 향후 구현
- HWP 파싱: hwp5txt/pyhwp 또는 변환 서버
- PDF 파싱: PyMuPDF/pdf-parse
- 로그인/권한: Supabase Auth 또는 NextAuth
- 저장소: Supabase Postgres + Private Storage
- AI 분석: JSON schema 기반 조문별 분석
- MCP: 법령 검색, 상위규정 근거 확인, 문서 추론 도구 호출
