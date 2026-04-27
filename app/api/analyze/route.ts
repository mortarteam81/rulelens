import { NextRequest, NextResponse } from 'next/server';
import { analyzeRegulation } from '@/lib/analyzer';
import { parseComparisonSource } from '@/lib/pipeline';
import type { SourceInput } from '@/lib/sources/types';

export async function POST(req:NextRequest){
  try{
    const form=await req.formData();
    const file=form.get('file') as File|null;
    const sourceUrl=String(form.get('sourceUrl')||'').trim();
    const regulationName=String(form.get('regulationName')||'');
    const purpose=String(form.get('purpose')||'실무검토용');

    let sourceInput:SourceInput|undefined;
    if(sourceUrl){
      sourceInput={kind:'sungshin-url',url:sourceUrl};
    }else if(file){
      sourceInput={kind:'upload',fileName:file.name,mimeType:file.type,bytes:await file.arrayBuffer()};
    }

    const parsedTable=sourceInput?await parseComparisonSource(sourceInput):undefined;
    const sourceFormat=parsedTable?.sourceFormat||file?.name?.split('.').pop()?.toLowerCase()||'unknown';
    const result=await analyzeRegulation({regulationName,purpose,sourceFormat,parsedTable});
    return NextResponse.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'분석 중 알 수 없는 오류가 발생했습니다.';
    return NextResponse.json({error:message},{status:400});
  }
}
