import { NextRequest, NextResponse } from 'next/server';
import { analyzeRegulation } from '@/lib/analyzer';
export async function POST(req:NextRequest){const form=await req.formData();const file=form.get('file') as File|null;const regulationName=String(form.get('regulationName')||'');const purpose=String(form.get('purpose')||'실무검토용');const sourceFormat=file?.name?.split('.').pop()?.toLowerCase()||'unknown';const result=await analyzeRegulation({regulationName,purpose,sourceFormat});return NextResponse.json(result);}
