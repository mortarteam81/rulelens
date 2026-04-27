import { NextResponse } from 'next/server';
export async function POST(){return NextResponse.json({status:'planned',tools:[{name:'Korean Law MCP',use:'관련 법령·상위규정 검색, 조문 근거 확인',state:'connection required'},{name:'Gordon MCP',use:'긴 문서 추론, 검토 쟁점·체크리스트 생성',state:'connection required'}],message:'MCP 서버 연결 정보가 설정되면 조문별 법령 검토 단계에서 호출합니다.'});}
