import { NextRequest, NextResponse } from 'next/server';
import { analyzeRegulation } from '@/lib/analyzer';
import { buildHybridComparisonTable } from '@/lib/comparison/hybrid';
import { enrichWithIrMappings } from '@/lib/ir-mapping/mapper';
import { parseComparisonSource } from '@/lib/pipeline';
import type { ParsedComparisonTable } from '@/lib/parsers/types';
import type { SourceInput } from '@/lib/sources/types';
import type { InputMode, SourceMetadata } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req:NextRequest){
  try{
    const form=await req.formData();
    const file=form.get('file') as File|null;
    const sourceUrl=String(form.get('sourceUrl')||'').trim();
    const regulationName=String(form.get('regulationName')||'');
    const purpose=String(form.get('purpose')||'실무검토용');

    if(!sourceUrl&&!file){
      return NextResponse.json({error:'성신 규정 URL 또는 업로드 파일 중 하나 이상이 필요합니다.'},{status:400});
    }

    const inputMode:InputMode=sourceUrl&&file?'hybrid':sourceUrl?'url-only':'file-only';
    const urlInput:SourceInput|undefined=sourceUrl?{kind:'sungshin-url',url:sourceUrl}:undefined;
    const uploadInput:SourceInput|undefined=file?{kind:'upload',fileName:file.name,mimeType:file.type,bytes:await file.arrayBuffer()}:undefined;

    const [urlTable,uploadTable]=await Promise.all([
      urlInput?parseComparisonSource(urlInput):Promise.resolve(undefined),
      uploadInput?parseComparisonSource(uploadInput):Promise.resolve(undefined),
    ]);

    const parsedTable=selectAnalysisTable(inputMode,urlTable,uploadTable);
    const sourceFormat=parsedTable?.sourceFormat||file?.name?.split('.').pop()?.toLowerCase()||'unknown';
    const sourceMetadata=buildSourceMetadata({sourceUrl,file,urlTable,uploadTable,inputMode});
    const hybridComparisonSummary=inputMode==='hybrid'?buildHybridSummary(urlTable,uploadTable,parsedTable):undefined;
    const parserWarnings=[...(parsedTable?.warnings||[])];
    if(inputMode==='hybrid'&&parsedTable===urlTable&&uploadTable){
      parserWarnings.push('업로드 개정안에서 분석 가능한 행을 찾지 못해 URL 기준 대비표를 분석 대상으로 사용했습니다.');
    }

    if(!parsedTable?.rows.length&&process.env.RULELENS_ALLOW_SAMPLE_ROWS!=='true'){
      return NextResponse.json({
        error:'분석 가능한 조문 행을 찾지 못했습니다. 샘플 데이터 fallback은 운영 API에서 비활성화되어 있습니다.',
        inputMode,
        sourceFormat,
        sourceMetadata,
        hybridComparisonSummary,
        parserWarnings,
      },{status:422});
    }

    const result=await analyzeRegulation({
      regulationName,
      purpose,
      sourceFormat,
      parsedTable:parsedTable?{...parsedTable,warnings:parserWarnings}:undefined,
      inputMode,
      sourceMetadata,
      hybridComparisonSummary,
    });
    const enrichedResult=enrichWithIrMappings(result);
    return NextResponse.json(enrichedResult);
  }catch(error){
    const message=error instanceof Error?error.message:'분석 중 알 수 없는 오류가 발생했습니다.';
    return NextResponse.json({error:message},{status:400});
  }
}

function selectAnalysisTable(inputMode:InputMode,urlTable?:ParsedComparisonTable,uploadTable?:ParsedComparisonTable){
  if(inputMode==='hybrid'&&urlTable&&uploadTable) return buildHybridComparisonTable(urlTable,uploadTable);
  return uploadTable||urlTable;
}

function buildSourceMetadata(input:{sourceUrl:string;file:File|null;urlTable?:ParsedComparisonTable;uploadTable?:ParsedComparisonTable;inputMode:InputMode}):SourceMetadata[]{
  const sources:SourceMetadata[]=[];
  if(input.urlTable){
    sources.push({
      role:input.inputMode==='hybrid'?'baseline':'analysis',
      label:input.inputMode==='hybrid'?'기준/현행 규정':'URL 신구대비표',
      kind:input.urlTable.sourceKind,
      format:input.urlTable.sourceFormat,
      url:input.sourceUrl,
      name:input.urlTable.regulationName,
      rowCount:input.urlTable.rows.length,
      confidence:averageConfidence(input.urlTable),
      warnings:input.urlTable.warnings,
    });
  }
  if(input.uploadTable){
    sources.push({
      role:input.inputMode==='hybrid'?'amendment':'analysis',
      label:input.inputMode==='hybrid'?'제안 개정안':'업로드 파일',
      kind:input.uploadTable.sourceKind,
      format:input.uploadTable.sourceFormat,
      name:input.file?.name||input.uploadTable.regulationName,
      rowCount:input.uploadTable.rows.length,
      confidence:averageConfidence(input.uploadTable),
      warnings:input.uploadTable.warnings,
    });
  }
  return sources;
}

function buildHybridSummary(urlTable?:ParsedComparisonTable,uploadTable?:ParsedComparisonTable,parsedTable?:ParsedComparisonTable){
  const warnings:string[]=[];
  if(!urlTable?.rows.length) warnings.push('기준/현행 규정 URL에서 비교 행을 찾지 못했습니다.');
  if(!uploadTable?.rows.length) warnings.push('제안 개정안 파일에서 비교 행을 찾지 못했습니다.');
  const comparedRows=parsedTable?.rows.length||0;
  return {
    mode:'url-file-hybrid',
    baselineLabel:'기준/현행 규정',
    amendmentLabel:'제안 개정안',
    comparedRows,
    summary:`기준 URL ${urlTable?.rows.length||0}행, 제안 개정안 ${uploadTable?.rows.length||0}행을 수집했습니다. 현재 분석 표시는 하이브리드 비교 엔진 결과를 사용합니다.`,
    warnings,
  };
}

function averageConfidence(table:ParsedComparisonTable){
  if(!table.rows.length) return undefined;
  return table.rows.reduce((sum,row)=>sum+(row.confidence||0),0)/table.rows.length;
}
