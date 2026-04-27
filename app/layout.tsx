import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: '규정 신구조문 대비표 분석 대시보드', description: 'HWP/PDF 규정 개정안 실무검토용 AI 분석 대시보드' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
